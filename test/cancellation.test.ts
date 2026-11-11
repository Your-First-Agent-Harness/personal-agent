import { describe, expect, it } from 'vitest';

import { createOpenAICompatibleProvider } from '../src/adapters/model/openai-compatible.ts';
import type { ChatResult, ModelProvider } from '../src/adapters/model/provider.ts';
import type { AgentEvent } from '../src/core/event.ts';
import type { ToolContext } from '../src/core/tool.ts';
import { createLoggerEventSink } from '../src/observability/event-sink.ts';
import { createLogger } from '../src/observability/logger.ts';
import { runAgentLoop } from '../src/runtime/loop.ts';
import { ToolRegistry } from '../src/tools/registry.ts';

function providerFrom(results: ChatResult[], beforeReturn?: () => void): ModelProvider {
  let index = 0;
  return {
    name: 'scripted',
    chat: () => {
      const result = results[index];
      index += 1;
      beforeReturn?.();
      return result === undefined
        ? Promise.reject(new Error('没有更多响应'))
        : Promise.resolve(result);
    },
  };
}

describe('runAgentLoop 协作式取消', () => {
  it('预先取消时不请求模型，返回零轮次和取消事件', async () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    const events: AgentEvent[] = [];
    const originalMessages = [{ role: 'user' as const, content: 'go' }];

    const result = await runAgentLoop({
      provider: {
        name: 'spy',
        chat: () => {
          calls += 1;
          return Promise.reject(new Error('不应调用'));
        },
      },
      registry: new ToolRegistry(),
      messages: originalMessages,
      maxTurns: 3,
      maxTokens: 128,
      workspaceRoot: '.',
      signal: controller.signal,
      eventSink: { emit: (event) => events.push(event) },
    });

    expect(calls).toBe(0);
    expect(result).toEqual({
      messages: originalMessages,
      text: '',
      turns: 0,
      stopReason: 'cancelled',
      usage: { inputTokens: 0, outputTokens: 0 },
    });
    expect(events).toEqual([{ type: 'run_cancelled', turn: 0 }]);
  });

  it('等待模型时取消，不执行后续工具或开启新轮次', async () => {
    const controller = new AbortController();
    const events: AgentEvent[] = [];
    let fetchCalls = 0;
    let toolCalls = 0;
    let markFetchStarted!: () => void;
    const fetchStarted = new Promise<void>((resolve) => {
      markFetchStarted = resolve;
    });
    const provider = createOpenAICompatibleProvider({
      baseUrl: 'https://example.com/v1',
      apiKey: 'test-key',
      model: 'test-model',
      fetchImpl: (_input, init) => {
        fetchCalls += 1;
        markFetchStarted();
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => {
              const reason: unknown = init.signal?.reason;
              reject(reason instanceof Error ? reason : new Error(String(reason)));
            },
            { once: true },
          );
        });
      },
    });
    const registry = new ToolRegistry();
    registry.register({
      name: 'echo',
      description: '不应执行',
      parameters: { type: 'object', properties: {} },
      execute: () => {
        toolCalls += 1;
        return Promise.resolve({ content: '不应执行' });
      },
    });

    const running = runAgentLoop({
      provider,
      registry,
      messages: [{ role: 'user', content: 'go' }],
      maxTurns: 3,
      maxTokens: 128,
      workspaceRoot: '.',
      signal: controller.signal,
      eventSink: { emit: (event) => events.push(event) },
    });
    await fetchStarted;
    controller.abort();
    const result = await running;

    expect(result.stopReason).toBe('cancelled');
    expect(result.turns).toBe(1);
    expect(result.text).toBe('');
    expect(result.messages).toEqual([{ role: 'user', content: 'go' }]);
    expect(fetchCalls).toBe(1);
    expect(toolCalls).toBe(0);
    expect(events.map((event) => event.type)).toEqual(['turn_started', 'run_cancelled']);
    expect(events.at(-1)).toEqual({ type: 'run_cancelled', turn: 1 });
  });

  it('assistant 已返回工具但执行前取消，保留消息与用量且工具数为零', async () => {
    const controller = new AbortController();
    const events: AgentEvent[] = [];
    let toolCalls = 0;
    const registry = new ToolRegistry();
    registry.register({
      name: 'echo',
      description: '不应执行',
      parameters: { type: 'object', properties: {} },
      execute: () => {
        toolCalls += 1;
        return Promise.resolve({ content: '不应执行' });
      },
    });
    const provider = providerFrom(
      [
        {
          text: '准备调用',
          model: 'm',
          toolCalls: [{ id: 'c1', name: 'echo', arguments: '{}' }],
          usage: { inputTokens: 11, outputTokens: 7 },
        },
        { text: '不应开启第二轮', model: 'm' },
      ],
      () => controller.abort(),
    );

    const result = await runAgentLoop({
      provider,
      registry,
      messages: [{ role: 'user', content: 'go' }],
      maxTurns: 3,
      maxTokens: 128,
      workspaceRoot: '.',
      signal: controller.signal,
      eventSink: { emit: (event) => events.push(event) },
    });

    expect(toolCalls).toBe(0);
    expect(result.stopReason).toBe('cancelled');
    expect(result.turns).toBe(1);
    expect(result.text).toBe('');
    expect(result.usage).toEqual({ inputTokens: 11, outputTokens: 7 });
    expect(result.messages).toEqual([
      { role: 'user', content: 'go' },
      {
        role: 'assistant',
        content: '准备调用',
        toolCalls: [{ id: 'c1', name: 'echo', arguments: '{}' }],
      },
    ]);
    expect(events.map((event) => event.type)).toEqual([
      'turn_started',
      'assistant_responded',
      'run_cancelled',
    ]);
    expect(events.at(-1)).toEqual({ type: 'run_cancelled', turn: 1 });
  });

  it('轮次事件后、模型调用前取消时不请求模型', async () => {
    const controller = new AbortController();
    const events: AgentEvent[] = [];
    let calls = 0;

    const result = await runAgentLoop({
      provider: {
        name: 'spy',
        chat: () => {
          calls += 1;
          return Promise.reject(new Error('不应调用'));
        },
      },
      registry: new ToolRegistry(),
      messages: [{ role: 'user', content: 'go' }],
      maxTurns: 3,
      maxTokens: 128,
      workspaceRoot: '.',
      signal: controller.signal,
      eventSink: {
        emit(event) {
          events.push(event);
          if (event.type === 'turn_started') controller.abort();
        },
      },
    });

    expect(calls).toBe(0);
    expect(result.stopReason).toBe('cancelled');
    expect(result.turns).toBe(1);
    expect(events).toEqual([
      { type: 'turn_started', turn: 1, messageCount: 1 },
      { type: 'run_cancelled', turn: 1 },
    ]);
  });

  it('非取消模型错误原样抛出且不发出取消事件', async () => {
    const failure = new Error('协议失败');
    const events: AgentEvent[] = [];

    await expect(
      runAgentLoop({
        provider: { name: 'failing', chat: () => Promise.reject(failure) },
        registry: new ToolRegistry(),
        messages: [{ role: 'user', content: 'go' }],
        maxTurns: 3,
        maxTokens: 128,
        workspaceRoot: '.',
        eventSink: { emit: (event) => events.push(event) },
      }),
    ).rejects.toBe(failure);
    expect(events.map((event) => event.type)).toEqual(['turn_started']);
  });

  it('把同一个 signal 传给 Provider 和工具上下文', async () => {
    const controller = new AbortController();
    const requestSignals: (AbortSignal | undefined)[] = [];
    const toolSignals: (AbortSignal | undefined)[] = [];
    let index = 0;
    const results: ChatResult[] = [
      { text: '', model: 'm', toolCalls: [{ id: 'c1', name: 'echo', arguments: '{}' }] },
      { text: 'done', model: 'm' },
    ];
    const provider: ModelProvider = {
      name: 'scripted',
      chat: (request) => {
        requestSignals.push(request.signal);
        const result = results[index];
        index += 1;
        return Promise.resolve(result!);
      },
    };
    const registry = new ToolRegistry();
    registry.register({
      name: 'echo',
      description: '记录取消信号',
      parameters: { type: 'object', properties: {} },
      execute: (_args, context: ToolContext) => {
        toolSignals.push(context.signal);
        return Promise.resolve({ content: 'ok' });
      },
    });

    const result = await runAgentLoop({
      provider,
      registry,
      messages: [{ role: 'user', content: 'go' }],
      maxTurns: 3,
      maxTokens: 128,
      workspaceRoot: '.',
      signal: controller.signal,
    });

    expect(result.stopReason).toBe('completed');
    expect(requestSignals).toEqual([controller.signal, controller.signal]);
    expect(toolSignals).toEqual([controller.signal]);
  });
});

describe('createLoggerEventSink 取消日志', () => {
  it('把 run_cancelled 记录为 loop.cancelled', () => {
    const lines: string[] = [];
    const logger = createLogger({ sink: (line) => lines.push(line) });
    const eventSink = createLoggerEventSink(logger);

    eventSink.emit({ type: 'run_cancelled', turn: 2 });

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!) as Record<string, unknown>).toMatchObject({
      level: 'info',
      message: 'loop.cancelled',
      turn: 2,
    });
  });
});
