import { describe, expect, it } from 'vitest';

import type { ChatRequest, ChatResult, ModelProvider } from '../src/adapters/model/provider.ts';
import {
  buildContext,
  CONTEXT_OMITTED,
  CONTEXT_TRUNCATED,
  totalChars,
} from '../src/context/build.ts';
import type { Message } from '../src/core/message.ts';
import { Session } from '../src/memory/session.ts';
import { runAgentLoop } from '../src/runtime/loop.ts';
import { ToolRegistry } from '../src/tools/registry.ts';

function scriptedProvider(results: ChatResult[]): { provider: ModelProvider; requests: ChatRequest[] } {
  const requests: ChatRequest[] = [];
  let index = 0;
  return {
    requests,
    provider: {
      name: 'scripted',
      chat(request) {
        requests.push({ ...request, messages: [...request.messages] });
        const result = results[index];
        index += 1;
        return result === undefined
          ? Promise.reject(new Error('没有更多响应'))
          : Promise.resolve(result);
      },
    },
  };
}

describe('buildContext', () => {
  it('短历史防御性原样复制', () => {
    const messages: Message[] = [
      { role: 'system', content: 's' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'c1', name: 'echo', arguments: '{}' }],
      },
      { role: 'tool', toolCallId: 'c1', name: 'echo', content: 'ok' },
      { role: 'user', content: 'u' },
    ];

    const result = buildContext(messages, 100);

    expect(result).toEqual(messages);
    expect(result).not.toBe(messages);
    expect(result[0]).not.toBe(messages[0]);
    expect(result[1]?.toolCalls).not.toBe(messages[1]?.toolCalls);
    expect(result[1]?.toolCalls?.[0]).not.toBe(messages[1]?.toolCalls?.[0]);
  });

  it('保留 system 和最新用户目标，并插入省略标记', () => {
    const messages: Message[] = [
      { role: 'system', content: '规则' },
      { role: 'user', content: '旧目标' },
      { role: 'assistant', content: 'x'.repeat(100) },
      { role: 'user', content: '最新目标' },
    ];

    const result = buildContext(messages, 40);

    expect(result[0]).toEqual(messages[0]);
    expect(result.at(-1)?.content).toBe('最新目标');
    expect(result.some((message) => message.content.includes('已省略'))).toBe(true);
    expect(totalChars(result)).toBeLessThanOrEqual(40);
  });

  it('system 自身超过预算时显式报错', () => {
    const messages: Message[] = [
      { role: 'system', content: '规'.repeat(41) },
      { role: 'user', content: '目标' },
    ];

    expect(() => buildContext(messages, 40)).toThrow('system 消息本身超过上下文预算');
  });

  it('超长最新用户消息保留末尾并标注截断', () => {
    const latestContent = `不再保留的开头${'x'.repeat(100)}必须保留的最新目标尾部`;

    const result = buildContext(
      [{ role: 'system', content: '规则' }, { role: 'user', content: latestContent }],
      60,
    );
    const latest = result.at(-1);

    expect(latest?.role).toBe('user');
    expect(latest?.content.startsWith(CONTEXT_TRUNCATED)).toBe(true);
    expect(latest?.content.endsWith('必须保留的最新目标尾部')).toBe(true);
    expect(latest?.content).not.toContain('不再保留的开头');
    expect(totalChars(result)).toBeLessThanOrEqual(60);
  });

  it('最新用户预算不足一个截断标记时仍严格限制字符数', () => {
    const system: Message = { role: 'system', content: '规' };
    const marker: Message = { role: 'system', content: CONTEXT_OMITTED };
    const budget = totalChars([system, marker]) + 3;

    const result = buildContext(
      [system, { role: 'user', content: '需要截断的最新用户目标'.repeat(3) }],
      budget,
    );

    expect(result.at(-1)).toEqual({ role: 'user', content: CONTEXT_TRUNCATED.slice(0, 3) });
    expect(totalChars(result)).toBeLessThanOrEqual(budget);
  });

  it('assistant toolCalls 与对应 tool 同组保留或同组省略', () => {
    const assistant: Message = {
      role: 'assistant',
      content: '调用工具',
      toolCalls: [{ id: 'c1', name: 'read_file', arguments: '{"path":"a.ts"}' }],
    };
    const tool: Message = {
      role: 'tool',
      toolCallId: 'c1',
      name: 'read_file',
      content: '工具结果',
    };
    const messages: Message[] = [
      { role: 'system', content: '规' },
      { role: 'assistant', content: '旧'.repeat(100) },
      assistant,
      tool,
      { role: 'user', content: '最新目标' },
    ];

    const retained = buildContext(messages, 80);
    const omitted = buildContext(messages, 35);

    expect(retained.map((message) => message.role)).toEqual([
      'system',
      'system',
      'assistant',
      'tool',
      'user',
    ]);
    expect(retained).toContainEqual(assistant);
    expect(retained).toContainEqual(tool);
    expect(omitted.map((message) => message.role)).toEqual(['system', 'system', 'user']);
    expect(omitted.some((message) => (message.toolCalls?.length ?? 0) > 0)).toBe(false);
    expect(omitted.some((message) => message.role === 'tool')).toBe(false);
  });

  it('裁剪时不让孤立 tool 进入请求', () => {
    const messages: Message[] = [
      { role: 'system', content: '规则' },
      { role: 'assistant', content: '旧'.repeat(100) },
      { role: 'tool', toolCallId: 'orphan', name: 'read_file', content: '孤立结果' },
      { role: 'user', content: '最新目标' },
    ];

    const result = buildContext(messages, 40);

    expect(result.some((message) => message.role === 'tool')).toBe(false);
    expect(result.at(-1)?.content).toBe('最新目标');
  });

  it('大工具组只截断 tool content 且不拆配对', () => {
    const assistant: Message = {
      role: 'assistant',
      content: '准备读取',
      toolCalls: [{ id: 'call-1', name: 'read_file', arguments: '{"path":"big.txt"}' }],
    };
    const originalToolContent = `工具开头${'资'.repeat(200)}工具原始结尾`;
    const messages: Message[] = [
      { role: 'system', content: '规则' },
      assistant,
      {
        role: 'tool',
        toolCallId: 'call-1',
        name: 'read_file',
        content: originalToolContent,
      },
      { role: 'user', content: '最新目标' },
    ];

    const result = buildContext(messages, 90);
    const resultAssistant = result.find((message) => message.role === 'assistant');
    const resultTool = result.find((message) => message.role === 'tool');

    expect(resultAssistant).toEqual(assistant);
    expect(resultTool?.toolCallId).toBe('call-1');
    expect(resultTool?.content.length).toBeLessThan(originalToolContent.length);
    expect(resultTool?.content.startsWith('工具开头')).toBe(true);
    expect(resultTool?.content.endsWith(CONTEXT_TRUNCATED)).toBe(true);
    expect(resultTool?.content.endsWith('工具原始结尾')).toBe(false);
    expect(result.some((message) => message.content === CONTEXT_OMITTED)).toBe(true);
    expect(totalChars(result)).toBeLessThanOrEqual(90);
  });

  it('Loop 每轮只发送窗口而 Session 保存完整历史', async () => {
    const largeToolContent = `完整工具结果${'资'.repeat(200)}`;
    const initialMessages: Message[] = [
      { role: 'system', content: '规则' },
      { role: 'user', content: '旧目标' },
      { role: 'assistant', content: '旧'.repeat(100) },
      { role: 'user', content: '读取大文件' },
    ];
    const { provider, requests } = scriptedProvider([
      {
        text: '',
        model: 'm',
        toolCalls: [{ id: 'c1', name: 'big', arguments: '{}' }],
      },
      { text: '完成', model: 'm' },
    ]);
    const registry = new ToolRegistry();
    registry.register({
      name: 'big',
      description: '返回大结果',
      parameters: { type: 'object', properties: {} },
      execute: () => Promise.resolve({ content: largeToolContent }),
    });
    const session = new Session('context', initialMessages);
    const before = session.snapshot();

    const result = await runAgentLoop({
      provider,
      registry,
      messages: before,
      maxTurns: 3,
      maxTokens: 128,
      maxContextChars: 90,
      workspaceRoot: '.',
    });
    session.append(result.messages.slice(before.length));

    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(totalChars(request.messages)).toBeLessThanOrEqual(90);
    }
    expect(
      requests[1]?.messages.some(
        (message) => message.role === 'tool' && message.content.length < largeToolContent.length,
      ),
    ).toBe(true);
    expect(result.messages).toHaveLength(initialMessages.length + 3);
    expect(result.messages.find((message) => message.role === 'tool')?.content).toBe(
      largeToolContent,
    );
    expect(session.snapshot()).toEqual(result.messages);
    expect(session.snapshot()[2]?.content).toBe('旧'.repeat(100));
    expect(totalChars(session.snapshot())).toBeGreaterThan(90);
  });
});
