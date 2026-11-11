import { describe, expect, it } from 'vitest';

import type { ChatResult, ModelProvider } from '../src/adapters/model/provider.ts';
import type { AgentEvent } from '../src/core/event.ts';
import { createLoggerEventSink } from '../src/observability/event-sink.ts';
import { createLogger } from '../src/observability/logger.ts';
import { runAgentLoop } from '../src/runtime/loop.ts';
import { ToolRegistry } from '../src/tools/registry.ts';

function providerFrom(results: ChatResult[]): ModelProvider {
  let index = 0;
  return {
    name: 'scripted',
    chat: () => {
      const result = results[index];
      index += 1;
      return result === undefined
        ? Promise.reject(new Error('没有更多响应'))
        : Promise.resolve(result);
    },
  };
}

function registryWithEcho(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register({
    name: 'echo',
    description: '原样返回参数',
    parameters: { type: 'object', properties: {} },
    execute(args) {
      return Promise.resolve({ content: JSON.stringify(args) });
    },
  });
  return registry;
}

async function runWithEvents(
  results: ChatResult[],
  registry = new ToolRegistry(),
  maxTurns = 3,
): Promise<{ result: Awaited<ReturnType<typeof runAgentLoop>>; events: AgentEvent[] }> {
  const events: AgentEvent[] = [];
  const result = await runAgentLoop({
    provider: providerFrom(results),
    registry,
    messages: [{ role: 'user', content: 'go' }],
    maxTurns,
    maxTokens: 128,
    workspaceRoot: '.',
    eventSink: { emit: (event) => events.push(event) },
  });
  return { result, events };
}

function record(line: string | undefined): Record<string, unknown> {
  return JSON.parse(line ?? '{}') as Record<string, unknown>;
}

describe('AgentEvent 顺序', () => {
  it('无工具路径按顺序发出轮次、响应和完成事件', async () => {
    const { result, events } = await runWithEvents([{ text: 'done', model: 'm' }]);

    expect(result.stopReason).toBe('completed');
    expect(events.map((event) => event.type)).toEqual([
      'turn_started',
      'assistant_responded',
      'run_completed',
    ]);
    expect(events[0]).toEqual({ type: 'turn_started', turn: 1, messageCount: 1 });
    expect(events[1]).toEqual({
      type: 'assistant_responded',
      turn: 1,
      textChars: 4,
      toolCallCount: 0,
    });
    expect(events[2]).toEqual({ type: 'run_completed', turn: 1, stopReason: 'completed' });
  });

  it('单个工具调用在响应后发出开始、结果和后续完成事件', async () => {
    const { result, events } = await runWithEvents(
      [
        {
          text: '',
          model: 'm',
          toolCalls: [{ id: 'c1', name: 'echo', arguments: '{"value":"secret"}' }],
        },
        { text: 'done', model: 'm' },
      ],
      registryWithEcho(),
    );

    expect(result.stopReason).toBe('completed');
    expect(events.map((event) => event.type)).toEqual([
      'turn_started',
      'assistant_responded',
      'tool_call_started',
      'tool_call_finished',
      'turn_started',
      'assistant_responded',
      'run_completed',
    ]);
    expect(events[2]).toEqual({
      type: 'tool_call_started',
      turn: 1,
      toolCallId: 'c1',
      toolName: 'echo',
    });
    expect(events[3]).toMatchObject({
      type: 'tool_call_finished',
      turn: 1,
      toolCallId: 'c1',
      toolName: 'echo',
      isError: false,
    });
    expect(JSON.stringify(events)).not.toContain('secret');
  });

  it('同一轮两个工具严格按调用顺序交替发出开始和结果事件', async () => {
    const { events } = await runWithEvents(
      [
        {
          text: '',
          model: 'm',
          toolCalls: [
            { id: 'c1', name: 'echo', arguments: '{"n":1}' },
            { id: 'c2', name: 'echo', arguments: '{"n":2}' },
          ],
        },
        { text: 'done', model: 'm' },
      ],
      registryWithEcho(),
    );

    expect(events.map((event) => event.type)).toEqual([
      'turn_started',
      'assistant_responded',
      'tool_call_started',
      'tool_call_finished',
      'tool_call_started',
      'tool_call_finished',
      'turn_started',
      'assistant_responded',
      'run_completed',
    ]);
    expect(events.slice(2, 6).map((event) => event.type === 'tool_call_started' || event.type === 'tool_call_finished' ? event.toolCallId : undefined)).toEqual([
      'c1',
      'c1',
      'c2',
      'c2',
    ]);
  });

  it('工具错误也发出开始和结果事件，且错误仍回喂', async () => {
    const { result, events } = await runWithEvents([
      { text: '', model: 'm', toolCalls: [{ id: 'c1', name: 'missing', arguments: '{}' }] },
      { text: 'done', model: 'm' },
    ]);

    expect(result.stopReason).toBe('completed');
    expect(events.map((event) => event.type)).toEqual([
      'turn_started',
      'assistant_responded',
      'tool_call_started',
      'tool_call_finished',
      'turn_started',
      'assistant_responded',
      'run_completed',
    ]);
    expect(events[3]).toMatchObject({ type: 'tool_call_finished', isError: true });
    expect(
      result.messages.some(
        (message) => message.role === 'tool' && message.content.includes('未知工具'),
      ),
    ).toBe(true);
  });

  it('达到 maxTurns 时最后发出 max_turns 完成事件', async () => {
    const { result, events } = await runWithEvents(
      [{ text: '', model: 'm', toolCalls: [{ id: 'c1', name: 'echo', arguments: '{}' }] }],
      registryWithEcho(),
      1,
    );

    expect(result.stopReason).toBe('max_turns');
    expect(events.map((event) => event.type)).toEqual([
      'turn_started',
      'assistant_responded',
      'tool_call_started',
      'tool_call_finished',
      'run_completed',
    ]);
    expect(events.at(-1)).toEqual({ type: 'run_completed', turn: 1, stopReason: 'max_turns' });
  });
});

describe('createLoggerEventSink', () => {
  it('工具开始与正常完成各输出一行摘要日志', () => {
    const lines: string[] = [];
    const logger = createLogger({ sink: (line) => lines.push(line) });
    const eventSink = createLoggerEventSink(logger);

    eventSink.emit({ type: 'tool_call_started', turn: 1, toolCallId: 'c1', toolName: 'echo' });
    eventSink.emit({ type: 'run_completed', turn: 2, stopReason: 'completed' });

    expect(lines).toHaveLength(2);
    expect(record(lines[0])).toMatchObject({
      level: 'info',
      message: 'tool.call',
      turn: 1,
      tool: 'echo',
      toolCallId: 'c1',
    });
    expect(record(lines[1])).toMatchObject({
      level: 'info',
      message: 'loop.completed',
      turn: 2,
    });
    expect(lines.join('\n')).not.toContain('arguments');
    expect(lines.join('\n')).not.toContain('PA_MODEL_API_KEY');
  });

  it('映射其余事件摘要，并在 max_turns 时使用 warn', () => {
    const lines: string[] = [];
    const logger = createLogger({ level: 'debug', sink: (line) => lines.push(line) });
    const eventSink = createLoggerEventSink(logger);

    eventSink.emit({ type: 'turn_started', turn: 1, messageCount: 2 });
    eventSink.emit({ type: 'assistant_responded', turn: 1, textChars: 0, toolCallCount: 1 });
    eventSink.emit({
      type: 'tool_call_finished',
      turn: 1,
      toolCallId: 'c1',
      toolName: 'echo',
      isError: true,
      contentChars: 12,
    });
    eventSink.emit({ type: 'run_completed', turn: 1, stopReason: 'max_turns' });

    expect(lines).toHaveLength(4);
    expect(lines.map((line) => record(line).message)).toEqual([
      'loop.turn.start',
      'loop.assistant',
      'tool.result',
      'loop.max_turns',
    ]);
    expect(lines.map((line) => record(line).level)).toEqual(['info', 'debug', 'info', 'warn']);
    expect(record(lines[0])).toMatchObject({ turn: 1, messageCount: 2 });
    expect(record(lines[1])).toMatchObject({ turn: 1, textChars: 0, toolCallCount: 1 });
    expect(record(lines[2])).toMatchObject({
      turn: 1,
      tool: 'echo',
      toolCallId: 'c1',
      isError: true,
      chars: 12,
    });
    expect(record(lines[3])).toMatchObject({ turn: 1 });
  });
});
