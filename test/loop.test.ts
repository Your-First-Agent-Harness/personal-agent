import { describe, expect, it } from 'vitest';

import type { ChatRequest, ChatResult, ModelProvider } from '../src/adapters/model/provider.ts';
import type { Message } from '../src/core/message.ts';
import type { Tool } from '../src/core/tool.ts';
import { runAgentLoop } from '../src/runtime/loop.ts';
import { ToolRegistry } from '../src/tools/registry.ts';

/** 按脚本依次返回结果的假 Provider，每次调用记录收到的消息 */
function scriptedProvider(results: ChatResult[]): { provider: ModelProvider; requests: ChatRequest[] } {
  const requests: ChatRequest[] = [];
  let index = 0;
  return {
    requests,
    provider: {
      name: 'scripted',
      chat(request) {
        // 固定本次调用的消息快照，避免 Loop 后续 push 改写历史请求
        requests.push({ ...request, messages: [...request.messages] });
        const result = results[Math.min(index, results.length - 1)];
        index += 1;
        if (result === undefined) {
          throw new Error('脚本里没有更多响应');
        }
        return Promise.resolve(result);
      },
    },
  };
}

function echoTool(): Tool & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    name: 'echo',
    description: '原样返回参数',
    parameters: { type: 'object', properties: {} },
    execute(args) {
      calls.push(args);
      return Promise.resolve({ content: JSON.stringify(args) });
    },
  };
}

const baseMessages: Message[] = [{ role: 'user', content: '开始' }];

function loopWith(provider: ModelProvider, registry: ToolRegistry, maxTurns = 5) {
  return runAgentLoop({
    provider,
    registry,
    messages: baseMessages,
    maxTurns,
    maxTokens: 128,
    workspaceRoot: '.',
  });
}

describe('runAgentLoop', () => {
  it('模型不要工具时一轮就结束', async () => {
    const { provider, requests } = scriptedProvider([
      { text: '最终答案', model: 'm', usage: { inputTokens: 10, outputTokens: 4 } },
    ]);

    const result = await loopWith(provider, new ToolRegistry());

    expect(result.stopReason).toBe('completed');
    expect(result.turns).toBe(1);
    expect(result.text).toBe('最终答案');
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 4 });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.tools).toEqual([]);
  });

  it('工具结果作为 tool 消息回喂，并触发第二轮', async () => {
    const { provider, requests } = scriptedProvider([
      {
        text: '',
        model: 'm',
        toolCalls: [{ id: 'c1', name: 'echo', arguments: '{"a":1}' }],
        usage: { inputTokens: 10, outputTokens: 2 },
      },
      { text: '看到了', model: 'm', usage: { inputTokens: 20, outputTokens: 3 } },
    ]);
    const registry = new ToolRegistry();
    const tool = echoTool();
    registry.register(tool);

    const result = await loopWith(provider, registry);

    expect(result.stopReason).toBe('completed');
    expect(result.turns).toBe(2);
    expect(result.text).toBe('看到了');
    expect(tool.calls).toEqual([{ a: 1 }]);

    // 第二轮请求里必须带着 assistant 的 tool_calls 和对应的 tool 结果
    const secondMessages = requests[1]?.messages ?? [];
    expect(secondMessages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool']);
    expect(secondMessages[2]).toMatchObject({ toolCallId: 'c1', name: 'echo', content: '{"a":1}' });

    // usage 跨轮累加，成本才看得出来
    expect(result.usage).toEqual({ inputTokens: 30, outputTokens: 5 });
  });

  it('同一轮的多个工具调用按顺序串行执行', async () => {
    const { provider } = scriptedProvider([
      {
        text: '',
        model: 'm',
        toolCalls: [
          { id: 'c1', name: 'echo', arguments: '{"n":1}' },
          { id: 'c2', name: 'echo', arguments: '{"n":2}' },
        ],
      },
      { text: 'done', model: 'm' },
    ]);
    const registry = new ToolRegistry();
    const tool = echoTool();
    registry.register(tool);

    const result = await loopWith(provider, registry);

    expect(tool.calls).toEqual([{ n: 1 }, { n: 2 }]);
    expect(result.messages.filter((m) => m.role === 'tool').map((m) => m.toolCallId)).toEqual([
      'c1',
      'c2',
    ]);
  });

  it('未知工具不中断循环，错误回喂给模型', async () => {
    const { provider } = scriptedProvider([
      {
        text: '',
        model: 'm',
        toolCalls: [{ id: 'c1', name: 'not_exist', arguments: '{}' }],
      },
      { text: '我换个工具', model: 'm' },
    ]);

    const result = await loopWith(provider, new ToolRegistry());

    expect(result.stopReason).toBe('completed');
    const toolMessage = result.messages.find((m) => m.role === 'tool');
    expect(toolMessage?.content).toContain('未知工具');
  });

  it('工具参数不是 JSON 时也回喂错误而不是抛异常', async () => {
    const { provider } = scriptedProvider([
      {
        text: '',
        model: 'm',
        toolCalls: [{ id: 'c1', name: 'echo', arguments: '{bad json' }],
      },
      { text: '参数写错了', model: 'm' },
    ]);
    const registry = new ToolRegistry();
    registry.register(echoTool());

    const result = await loopWith(provider, registry);

    expect(result.stopReason).toBe('completed');
    expect(result.messages.find((m) => m.role === 'tool')?.content).toContain('合法 JSON');
  });

  it('模型一直要工具时，maxTurns 是保险丝', async () => {
    const { provider, requests } = scriptedProvider([
      {
        text: '',
        model: 'm',
        toolCalls: [{ id: 'c1', name: 'echo', arguments: '{}' }],
      },
    ]);
    const registry = new ToolRegistry();
    registry.register(echoTool());

    const result = await loopWith(provider, registry, 3);

    expect(result.stopReason).toBe('max_turns');
    expect(result.turns).toBe(3);
    expect(requests).toHaveLength(3);
  });
});
