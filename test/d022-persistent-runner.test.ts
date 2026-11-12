import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ChatResult, ModelProvider } from '../src/adapters/model/provider.ts';
import { Session } from '../src/memory/session.ts';
import { ToolRegistry } from '../src/tools/registry.ts';

interface ClosableStore {
  close(): void;
}

let directory: string;
const stores: ClosableStore[] = [];

function databasePath(): string {
  return join(directory, 'agent.sqlite');
}

async function openStores() {
  const { SqliteSessionStore } = await import('../src/memory/session-store.ts');
  const { SqliteRunStore } = await import('../src/memory/run-store.ts');
  const sessionStore = new SqliteSessionStore(databasePath());
  const runStore = new SqliteRunStore(databasePath());
  stores.push(sessionStore, runStore);
  return { sessionStore, runStore };
}

async function openService() {
  const stores = await openStores();
  const { PersistentAgentService } = await import('../src/runtime/persistent-runner.ts');
  return { ...stores, service: new PersistentAgentService(stores) };
}

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

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'personal-agent-d022-service-'));
});

afterEach(() => {
  for (const store of stores) {
    store.close();
  }
  stores.length = 0;
  rmSync(directory, { recursive: true, force: true });
});

describe('PersistentAgentService', () => {
  it('真实 Loop 正常结束后保存完整新增历史并持久化 completed', async () => {
    const { service, sessionStore, runStore } = await openService();
    sessionStore.save(
      new Session('success-session', [
        { role: 'system', content: '保留系统消息' },
        { role: 'user', content: '旧问题' },
        { role: 'assistant', content: '旧回答' },
      ]),
    );
    const registry = new ToolRegistry();
    registry.register({
      name: 'echo',
      description: '原样返回',
      parameters: { type: 'object', properties: {} },
      execute: (args) => Promise.resolve({ content: JSON.stringify(args) }),
    });
    const provider = providerFrom([
      {
        text: '',
        model: 'm',
        toolCalls: [{ id: 'call-1', name: 'echo', arguments: '{"value":"工具结果"}' }],
      },
      { text: '最终回答', model: 'm', usage: { inputTokens: 8, outputTokens: 3 } },
    ]);

    const result = await service.run({
      runId: 'success-run',
      sessionId: 'success-session',
      userMessage: '新问题',
      provider,
      registry,
      maxTurns: 3,
      maxTokens: 128,
      workspaceRoot: directory,
    });

    expect(result.text).toBe('最终回答');
    expect(result.stopReason).toBe('completed');
    expect(result.run).toMatchObject({
      id: 'success-run',
      sessionId: 'success-session',
      status: 'completed',
      stopReason: 'completed',
    });
    expect(result.messages.map((message) => message.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
      'assistant',
      'tool',
      'assistant',
    ]);
    expect(sessionStore.load('success-session')?.snapshot()).toEqual(result.messages);
    expect(sessionStore.load('success-session')?.snapshot().at(-1)).toEqual({
      role: 'assistant',
      content: '最终回答',
    });
    expect(runStore.get('success-run')).toEqual(result.run);
  });

  it('Provider 抛错时写 failed、保留已存用户消息并原样抛出同一错误', async () => {
    const { service, sessionStore, runStore } = await openService();
    const providerError = new Error('Provider 网络失败');
    const provider: ModelProvider = {
      name: 'failing',
      chat: () => Promise.reject(providerError),
    };

    const running = service.run({
      runId: 'failed-run',
      sessionId: 'failed-session',
      userMessage: '这次会失败',
      provider,
      registry: new ToolRegistry(),
      maxTurns: 2,
      maxTokens: 128,
      workspaceRoot: directory,
    });

    await expect(running).rejects.toBe(providerError);
    expect(runStore.get('failed-run')).toMatchObject({
      id: 'failed-run',
      sessionId: 'failed-session',
      status: 'failed',
    });
    expect(sessionStore.load('failed-session')?.snapshot()).toEqual([
      { role: 'user', content: '这次会失败' },
    ]);
  });

  it('启动时识别遗留 running，并按 session id 恢复 Session 与 interrupted run', async () => {
    const { sessionStore, runStore } = await openStores();
    sessionStore.save(
      new Session('recover-session', [
        { role: 'system', content: '系统' },
        { role: 'user', content: '中断前已保存\n🌱' },
      ]),
    );
    sessionStore.save(new Session('other-session', [{ role: 'user', content: '其他历史' }]));
    runStore.start({ id: 'recover-run', sessionId: 'recover-session' });
    runStore.start({ id: 'other-run', sessionId: 'other-session' });
    runStore.finish('other-run', 'completed');
    const { PersistentAgentService } = await import('../src/runtime/persistent-runner.ts');
    const service = new PersistentAgentService({ sessionStore, runStore });

    const recovered = service.recover('recover-session');

    expect(recovered?.session.id).toBe('recover-session');
    expect(recovered?.session.snapshot()).toEqual([
      { role: 'system', content: '系统' },
      { role: 'user', content: '中断前已保存\n🌱' },
    ]);
    expect(recovered?.interruptedRuns).toHaveLength(1);
    expect(recovered?.interruptedRuns[0]).toMatchObject({
      id: 'recover-run',
      sessionId: 'recover-session',
      status: 'interrupted',
    });
    expect(service.recover('other-session')?.interruptedRuns).toEqual([]);
    expect(service.recover('other-session')?.session.snapshot()).toEqual([
      { role: 'user', content: '其他历史' },
    ]);
    expect(runStore.get('other-run')?.status).toBe('completed');
    expect(service.recover('missing')).toBeUndefined();
  });

  it('协作式取消是 completed 终态并保留 cancelled StopReason', async () => {
    const { service, runStore, sessionStore } = await openService();
    const controller = new AbortController();
    controller.abort();
    let providerCalls = 0;

    const result = await service.run({
      runId: 'cancelled-run',
      sessionId: 'cancelled-session',
      userMessage: '取消这次运行',
      provider: {
        name: 'unused',
        chat: () => {
          providerCalls += 1;
          return Promise.reject(new Error('不应调用'));
        },
      },
      registry: new ToolRegistry(),
      maxTurns: 2,
      maxTokens: 128,
      workspaceRoot: directory,
      signal: controller.signal,
    });

    expect(providerCalls).toBe(0);
    expect(result.stopReason).toBe('cancelled');
    expect(result.run).toMatchObject({ status: 'completed', stopReason: 'cancelled' });
    expect(runStore.get('cancelled-run')).toEqual(result.run);
    expect(sessionStore.load('cancelled-session')?.snapshot()).toEqual(result.messages);
  });
});
