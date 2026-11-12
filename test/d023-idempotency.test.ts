import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ModelProvider } from '../src/adapters/model/provider.ts';
import { Session } from '../src/memory/session.ts';
import type { AgentLoopResult } from '../src/runtime/loop.ts';
import { ToolRegistry } from '../src/tools/registry.ts';

interface ClosableStore {
  close(): void;
}

let directory: string;
const stores: ClosableStore[] = [];

function databasePath(): string {
  return join(directory, 'agent.sqlite');
}

function closeStores(): void {
  for (const store of stores) {
    store.close();
  }
  stores.length = 0;
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
  const opened = await openStores();
  const { PersistentAgentService } = await import('../src/runtime/persistent-runner.ts');
  return { ...opened, service: new PersistentAgentService(opened) };
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'personal-agent-d023-idempotency-'));
});

afterEach(() => {
  closeStores();
  rmSync(directory, { recursive: true, force: true });
});

describe('PersistentAgentService 幂等契约', () => {
  it('重开数据库后重复已完成请求返回原结果，不调用 Provider/工具也不追加用户消息', async () => {
    const first = await openService();
    let providerCalls = 0;
    let toolCalls = 0;
    const provider: ModelProvider = {
      name: 'scripted',
      chat: () => {
        providerCalls += 1;
        if (providerCalls === 1) {
          return Promise.resolve({
            text: '',
            model: 'm',
            toolCalls: [{ id: 'call-1', name: 'count', arguments: '{}' }],
          });
        }
        return Promise.resolve({
          text: '只执行一次',
          model: 'm',
          usage: { inputTokens: 5, outputTokens: 2 },
        });
      },
    };
    const registry = new ToolRegistry();
    registry.register({
      name: 'count',
      description: '记录真实工具调用次数',
      parameters: { type: 'object', properties: {} },
      execute: () => {
        toolCalls += 1;
        return Promise.resolve({ content: 'done' });
      },
    });
    const options = {
      runId: 'completed-run',
      sessionId: 'completed-session',
      userMessage: '同一请求',
      provider,
      registry,
      maxTurns: 3,
      maxTokens: 128,
      workspaceRoot: directory,
    };
    const original = await first.service.run(options);
    expect(providerCalls).toBe(2);
    expect(toolCalls).toBe(1);
    closeStores();

    const reopened = await openService();
    let duplicateProviderCalls = 0;
    let duplicateToolCalls = 0;
    const duplicateRegistry = new ToolRegistry();
    duplicateRegistry.register({
      name: 'count',
      description: '不应再执行',
      parameters: { type: 'object', properties: {} },
      execute: () => {
        duplicateToolCalls += 1;
        return Promise.resolve({ content: 'unexpected' });
      },
    });
    const duplicate = await reopened.service.run({
      ...options,
      provider: {
        name: 'forbidden',
        chat: () => {
          duplicateProviderCalls += 1;
          return Promise.reject(new Error('重复请求不应调用 Provider'));
        },
      },
      registry: duplicateRegistry,
    });

    expect(duplicate).toEqual(original);
    expect(duplicateProviderCalls).toBe(0);
    expect(duplicateToolCalls).toBe(0);
    expect(reopened.sessionStore.load('completed-session')?.snapshot()).toEqual(original.messages);
    expect(reopened.runStore.list('completed-session')).toHaveLength(1);
  });

  it('同一 runId 携带不同 sessionId 或 userMessage 时明确拒绝且不改任何数据', async () => {
    const { service, sessionStore, runStore } = await openService();
    await service.run({
      runId: 'conflict-run',
      sessionId: 'original-session',
      userMessage: '原始输入',
      provider: {
        name: 'once',
        chat: () => Promise.resolve({ text: '原回答', model: 'm' }),
      },
      registry: new ToolRegistry(),
      maxTurns: 1,
      maxTokens: 128,
      workspaceRoot: directory,
    });
    const messagesBefore = sessionStore.load('original-session')?.snapshot();
    const runBefore = runStore.get('conflict-run');
    let conflictProviderCalls = 0;
    const conflictProvider: ModelProvider = {
      name: 'forbidden',
      chat: () => {
        conflictProviderCalls += 1;
        return Promise.reject(new Error('冲突请求不应调用 Provider'));
      },
    };
    const base = {
      runId: 'conflict-run',
      provider: conflictProvider,
      registry: new ToolRegistry(),
      maxTurns: 1,
      maxTokens: 128,
      workspaceRoot: directory,
    };

    const messageError = await service.run({
      ...base,
      sessionId: 'original-session',
      userMessage: '被篡改的输入',
    }).then(() => undefined, (error: unknown) => error);
    const sessionError = await service.run({
      ...base,
      sessionId: 'another-session',
      userMessage: '原始输入',
    }).then(() => undefined, (error: unknown) => error);

    expect(sessionStore.load('original-session')?.snapshot()).toEqual(messagesBefore);
    expect(sessionStore.load('another-session')).toBeUndefined();
    expect(runStore.get('conflict-run')).toEqual(runBefore);
    expect(runStore.list()).toHaveLength(1);
    expect(messageError).toBeInstanceOf(Error);
    expect(sessionError).toBeInstanceOf(Error);
    expect((messageError as Error).message).toContain('冲突');
    expect((sessionError as Error).message).toContain('冲突');
    expect(conflictProviderCalls).toBe(0);
  });

  it('interrupted 请求不会误报 completed，也不会隐式重放或重复追加用户消息', async () => {
    const { sessionStore, runStore } = await openStores();
    sessionStore.save(new Session('interrupted-session', [
      { role: 'user', content: '中断输入' },
    ]));
    runStore.start({
      id: 'interrupted-run',
      sessionId: 'interrupted-session',
      userMessage: '中断输入',
    });
    const { PersistentAgentService } = await import('../src/runtime/persistent-runner.ts');
    const service = new PersistentAgentService({ sessionStore, runStore });
    const interruptedBefore = runStore.get('interrupted-run');
    const messagesBefore = sessionStore.load('interrupted-session')?.snapshot();
    let providerCalls = 0;

    const error = await service.run({
      runId: 'interrupted-run',
      sessionId: 'interrupted-session',
      userMessage: '中断输入',
      provider: {
        name: 'forbidden',
        chat: () => {
          providerCalls += 1;
          return Promise.reject(new Error('中断请求不应自动重放'));
        },
      },
      registry: new ToolRegistry(),
      maxTurns: 1,
      maxTokens: 128,
      workspaceRoot: directory,
    }).then(() => undefined, (caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('中断');
    expect(runStore.get('interrupted-run')).toEqual(interruptedBefore);
    expect(runStore.get('interrupted-run')?.status).toBe('interrupted');
    expect(sessionStore.load('interrupted-session')?.snapshot()).toEqual(messagesBefore);
    expect(providerCalls).toBe(0);
  });
});

describe('SqliteRunStore D023 持久化', () => {
  it('在 D022 旧表上保存请求输入与完整完成结果，重开后仍可读取', async () => {
    const legacy = new DatabaseSync(databasePath());
    legacy.exec(`
      CREATE TABLE runs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'interrupted', 'failed')),
        stop_reason TEXT,
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    legacy.close();
    const { SqliteRunStore } = await import('../src/memory/run-store.ts');
    const store = new SqliteRunStore(databasePath());
    stores.push(store);
    const result: AgentLoopResult = {
      messages: [
        { role: 'user', content: '旧库新请求' },
        { role: 'assistant', content: '持久化回答' },
      ],
      text: '持久化回答',
      turns: 1,
      stopReason: 'completed',
      usage: { inputTokens: 3, outputTokens: 4 },
    };

    store.start({ id: 'migrated-run', sessionId: 'migrated-session', userMessage: '旧库新请求' });
    store.finish('migrated-run', 'completed', result);
    store.close();

    const reopened = new SqliteRunStore(databasePath());
    stores.push(reopened);
    expect(reopened.get('migrated-run')).toMatchObject({
      id: 'migrated-run',
      sessionId: 'migrated-session',
      status: 'completed',
      userMessage: '旧库新请求',
      result,
    });
  });
});
