import { describe, expect, it } from 'vitest';

import type { ChatRequest, ChatResult, ModelProvider } from '../src/adapters/model/provider.ts';
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

describe('Session', () => {
  it('连续五轮保留完整 user/assistant 历史并传给下一次 Loop', async () => {
    const answers = [1, 2, 3, 4, 5].map((round) => ({ text: `回答 ${round}`, model: 'm' }));
    const { provider, requests } = scriptedProvider(answers);
    const session = new Session('five-turns');

    for (let round = 1; round <= 5; round += 1) {
      session.append([{ role: 'user', content: `问题 ${round}` }]);
      const before = session.snapshot();
      const result = await runAgentLoop({
        provider,
        registry: new ToolRegistry(),
        messages: before,
        maxTurns: 3,
        maxTokens: 128,
        workspaceRoot: '.',
      });
      session.append(result.messages.slice(before.length));
      expect(result.text).toBe(`回答 ${round}`);
    }

    const expectedHistory = [1, 2, 3, 4, 5].flatMap((round): Message[] => [
      { role: 'user', content: `问题 ${round}` },
      { role: 'assistant', content: `回答 ${round}` },
    ]);
    expect(requests.map((request) => request.messages.length)).toEqual([1, 3, 5, 7, 9]);
    expect(requests[4]?.messages).toEqual(expectedHistory.slice(0, -1));
    expect(session.snapshot()).toEqual(expectedHistory);
    expect(session.snapshot().filter((message) => message.role === 'user')).toHaveLength(5);
    expect(session.snapshot().filter((message) => message.role === 'assistant')).toHaveLength(5);
    expect(session.id).toBe('five-turns');
  });

  it('快照被外部修改时不改变内部历史', () => {
    const session = new Session('snapshot', [{ role: 'user', content: '原始消息' }]);

    const snapshot = session.snapshot() as Message[];
    snapshot.push({ role: 'assistant', content: '外部消息' });

    expect(session.snapshot()).toEqual([{ role: 'user', content: '原始消息' }]);
  });

  it('两个 Session 的历史互不可见', () => {
    const left = new Session('left');
    const right = new Session('right');

    left.append([{ role: 'user', content: '只属于左边' }]);
    right.append([{ role: 'user', content: '只属于右边' }]);

    expect(left.snapshot()).toEqual([{ role: 'user', content: '只属于左边' }]);
    expect(right.snapshot()).toEqual([{ role: 'user', content: '只属于右边' }]);
  });

  it('外部修改 toolCalls 不会穿透 Session 边界', () => {
    const initial = {
      role: 'assistant' as const,
      content: '',
      toolCalls: [{ id: 'initial', name: 'read_file', arguments: '{"path":"initial.ts"}' }],
    };
    const appended = {
      role: 'assistant' as const,
      content: '',
      toolCalls: [{ id: 'appended', name: 'read_file', arguments: '{"path":"appended.ts"}' }],
    };
    const session = new Session('tool-calls', [initial]);
    session.append([appended]);

    initial.toolCalls[0]!.arguments = '{"path":"changed-initial.ts"}';
    appended.toolCalls[0]!.arguments = '{"path":"changed-appended.ts"}';
    const snapshot = session.snapshot();
    Reflect.set(snapshot[0]!.toolCalls![0]!, 'arguments', '{"path":"changed-snapshot.ts"}');

    expect(session.snapshot().map((message) => message.toolCalls?.[0]?.arguments)).toEqual([
      '{"path":"initial.ts"}',
      '{"path":"appended.ts"}',
    ]);
  });
});
