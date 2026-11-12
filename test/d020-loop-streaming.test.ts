import { describe, expect, it } from 'vitest';

import type { ModelProvider } from '../src/adapters/model/provider.ts';
import type { AgentEvent } from '../src/core/event.ts';
import { runAgentLoop } from '../src/runtime/loop.ts';
import { ToolRegistry } from '../src/tools/registry.ts';

function runWith(provider: ModelProvider, events: AgentEvent[], streaming?: boolean) {
  return runAgentLoop({
    provider,
    registry: new ToolRegistry(),
    messages: [{ role: 'user', content: '开始' }],
    maxTurns: 3,
    maxTokens: 128,
    workspaceRoot: '.',
    eventSink: { emit: (event) => events.push(event) },
    ...(streaming === undefined ? {} : { streaming }),
  });
}

describe('runAgentLoop 流式输出', () => {
  it('显式开启且有流式能力时发出 assistant_delta，并保留聚合结果', async () => {
    const events: AgentEvent[] = [];
    let chatCalls = 0;
    let streamCalls = 0;
    const provider: ModelProvider = {
      name: 'streaming',
      chat: () => {
        chatCalls += 1;
        return Promise.resolve({ text: '不应使用', model: 'm' });
      },
      streamChat: (_request, onDelta) => {
        streamCalls += 1;
        onDelta('你');
        onDelta('好');
        return Promise.resolve({
          text: '你好',
          model: 'm',
          usage: { inputTokens: 3, outputTokens: 2 },
        });
      },
    };

    const result = await runWith(provider, events, true);

    expect(chatCalls).toBe(0);
    expect(streamCalls).toBe(1);
    expect(result.text).toBe('你好');
    expect(result.usage).toEqual({ inputTokens: 3, outputTokens: 2 });
    expect(result.messages.at(-1)).toEqual({ role: 'assistant', content: '你好' });
    expect(events).toEqual([
      { type: 'turn_started', turn: 1, messageCount: 1 },
      { type: 'assistant_delta', turn: 1, delta: '你' },
      { type: 'assistant_delta', turn: 1, delta: '好' },
      { type: 'assistant_responded', turn: 1, textChars: 2, toolCallCount: 0 },
      { type: 'run_completed', turn: 1, stopReason: 'completed' },
    ]);
  });

  it('默认关闭流式，即使 Provider 支持也不发增量事件', async () => {
    const events: AgentEvent[] = [];
    let streamCalls = 0;
    const provider: ModelProvider = {
      name: 'both',
      chat: () => Promise.resolve({ text: '完整回答', model: 'm' }),
      streamChat: () => {
        streamCalls += 1;
        return Promise.resolve({ text: '不应使用', model: 'm' });
      },
    };

    const result = await runWith(provider, events);

    expect(streamCalls).toBe(0);
    expect(result.text).toBe('完整回答');
    expect(events.map((event) => event.type)).toEqual([
      'turn_started',
      'assistant_responded',
      'run_completed',
    ]);
  });

  it('开启流式但 Provider 没有 streamChat 时回退 chat', async () => {
    const events: AgentEvent[] = [];
    let chatCalls = 0;
    const provider: ModelProvider = {
      name: 'non-streaming',
      chat: () => {
        chatCalls += 1;
        return Promise.resolve({ text: '回退回答', model: 'm' });
      },
    };

    const result = await runWith(provider, events, true);

    expect(chatCalls).toBe(1);
    expect(result.text).toBe('回退回答');
    expect(events.map((event) => event.type)).toEqual([
      'turn_started',
      'assistant_responded',
      'run_completed',
    ]);
  });
});
