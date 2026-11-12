import { describe, expect, it } from 'vitest';

import type { ChatRequest, ChatResult, ModelProvider } from '../src/adapters/model/provider.ts';
import { runAgentLoop } from '../src/runtime/loop.ts';
import { ToolRegistry } from '../src/tools/registry.ts';

function scriptedProvider(results: readonly ChatResult[]): {
  provider: ModelProvider;
  requests: ChatRequest[];
} {
  const requests: ChatRequest[] = [];
  let index = 0;
  return {
    requests,
    provider: {
      name: 'scripted-d016',
      chat(request) {
        requests.push({ ...request, messages: request.messages.map((message) => ({
          ...message,
          ...(message.toolCalls === undefined
            ? {}
            : { toolCalls: message.toolCalls.map((call) => ({ ...call })) }),
        })) });
        const result = results[index];
        index += 1;
        return result === undefined
          ? Promise.reject(new Error('脚本里没有更多响应'))
          : Promise.resolve(result);
      },
    },
  };
}

function call(id: string, arguments_: string): ChatResult {
  return {
    text: '',
    model: 'scripted-d016',
    toolCalls: [{ id, name: 'echo', arguments: arguments_ }],
  };
}

function echoRegistry(): { registry: ToolRegistry; executions: unknown[] } {
  const executions: unknown[] = [];
  const registry = new ToolRegistry();
  registry.register({
    name: 'echo',
    description: '回显一段文本',
    parameters: {
      type: 'object',
      properties: { value: { type: 'string' } },
      required: ['value'],
      additionalProperties: false,
    },
    execute(args) {
      executions.push(args);
      const { value } = args as { value: string };
      return Promise.resolve({ content: `echo:${value}` });
    },
  });
  return { registry, executions };
}

function runLoop(provider: ModelProvider, registry: ToolRegistry) {
  return runAgentLoop({
    provider,
    registry,
    messages: [{ role: 'user', content: '调用 echo，非法参数要修正后重试。' }],
    maxTurns: 10,
    maxTokens: 128,
    workspaceRoot: '.',
  });
}

describe('D016 非法参数恢复闭环', () => {
  it('非法 JSON 回喂后修正为合法参数，工具成功并最终 completed', async () => {
    const { provider, requests } = scriptedProvider([
      call('json-invalid', '{"value":'),
      call('json-fixed', JSON.stringify({ value: 'json-ok' })),
      { text: '非法 JSON 已修正', model: 'scripted-d016' },
    ]);
    const { registry, executions } = echoRegistry();

    const result = await runLoop(provider, registry);

    expect(result).toMatchObject({
      stopReason: 'completed',
      turns: 3,
      text: '非法 JSON 已修正',
    });
    expect(requests).toHaveLength(3);
    expect(executions).toEqual([{ value: 'json-ok' }]);

    const errorFeedback = requests[1]?.messages.at(-1);
    expect(errorFeedback).toMatchObject({
      role: 'tool',
      toolCallId: 'json-invalid',
      name: 'echo',
    });
    expect(errorFeedback?.content).toContain('工具参数不是合法 JSON');
    expect(errorFeedback?.content).toContain('提示：请把 arguments 修正为合法 JSON 对象');
    expect(requests[2]?.messages.at(-1)).toMatchObject({
      role: 'tool',
      toolCallId: 'json-fixed',
      content: 'echo:json-ok',
    });
  });

  it('Schema 参数错误回喂后修正类型，工具成功并最终 completed', async () => {
    const { provider, requests } = scriptedProvider([
      call('schema-invalid', JSON.stringify({ value: 42 })),
      call('schema-fixed', JSON.stringify({ value: 'schema-ok' })),
      { text: 'Schema 参数已修正', model: 'scripted-d016' },
    ]);
    const { registry, executions } = echoRegistry();

    const result = await runLoop(provider, registry);

    expect(result).toMatchObject({
      stopReason: 'completed',
      turns: 3,
      text: 'Schema 参数已修正',
    });
    expect(requests).toHaveLength(3);
    expect(executions).toEqual([{ value: 'schema-ok' }]);

    const errorFeedback = requests[1]?.messages.at(-1);
    expect(errorFeedback).toMatchObject({
      role: 'tool',
      toolCallId: 'schema-invalid',
      name: 'echo',
    });
    expect(errorFeedback?.content).toContain('参数校验失败：$.value');
    expect(errorFeedback?.content).toContain('期望 string');
    expect(errorFeedback?.content).toContain('提示：请修正 $.value');
    expect(requests[2]?.messages.at(-1)).toMatchObject({
      role: 'tool',
      toolCallId: 'schema-fixed',
      content: 'echo:schema-ok',
    });
  });

  it('连续三次非法参数不执行工具，恰好请求三次并以 tool_errors 停止', async () => {
    const { provider, requests } = scriptedProvider([
      call('limit-json', '{"value":'),
      call('limit-type', JSON.stringify({ value: 42 })),
      call('limit-required', '{}'),
    ]);
    const { registry, executions } = echoRegistry();

    const result = await runLoop(provider, registry);

    expect(result).toMatchObject({ stopReason: 'tool_errors', turns: 3, text: '' });
    expect(requests).toHaveLength(3);
    expect(executions).toEqual([]);

    const toolMessages = result.messages.filter((message) => message.role === 'tool');
    expect(toolMessages.map((message) => message.toolCallId)).toEqual([
      'limit-json',
      'limit-type',
      'limit-required',
    ]);
    expect(toolMessages[0]?.content).toContain('工具参数不是合法 JSON');
    expect(toolMessages[1]?.content).toContain('参数校验失败：$.value');
    expect(toolMessages[2]?.content).toContain('缺少必填字段');
    expect(requests[1]?.messages.at(-1)?.content).toContain('工具参数不是合法 JSON');
    expect(requests[2]?.messages.at(-1)?.content).toContain('参数校验失败：$.value');
  });

  it('一次合法成功清零此前计数，之后重新累计三次非法参数才停止', async () => {
    const { provider, requests } = scriptedProvider([
      call('before-json', '{"value":'),
      call('before-schema', '{}'),
      call('reset-success', JSON.stringify({ value: 'reset' })),
      call('after-json', '{"value":'),
      call('after-schema', '{}'),
      call('after-limit', '{"value":'),
    ]);
    const { registry, executions } = echoRegistry();

    const result = await runLoop(provider, registry);

    expect(result).toMatchObject({ stopReason: 'tool_errors', turns: 6, text: '' });
    expect(requests).toHaveLength(6);
    expect(executions).toEqual([{ value: 'reset' }]);
    expect(requests[3]?.messages.at(-1)).toMatchObject({
      role: 'tool',
      toolCallId: 'reset-success',
      content: 'echo:reset',
    });
    expect(result.messages.filter((message) => message.role === 'tool')).toHaveLength(6);
    expect(result.messages.at(-1)).toMatchObject({
      role: 'tool',
      toolCallId: 'after-limit',
    });
  });
});
