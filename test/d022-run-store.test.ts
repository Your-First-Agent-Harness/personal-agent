import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

interface ClosableStore {
  close(): void;
}

let directory: string;
const stores: ClosableStore[] = [];

async function openStore() {
  const { SqliteRunStore } = await import('../src/memory/run-store.ts');
  const store = new SqliteRunStore(join(directory, 'runs.sqlite'));
  stores.push(store);
  return store;
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'personal-agent-d022-runs-'));
});

afterEach(() => {
  for (const store of stores) {
    store.close();
  }
  stores.length = 0;
  rmSync(directory, { recursive: true, force: true });
});

describe('SqliteRunStore', () => {
  it('start 创建 running 记录，get/list 与重开数据库都返回同一记录', async () => {
    const first = await openStore();
    const started = first.start({ id: 'run-1', sessionId: 'session-1' });

    expect(started).toMatchObject({ id: 'run-1', sessionId: 'session-1', status: 'running' });
    expect(Date.parse(started.startedAt)).not.toBeNaN();
    expect(started.updatedAt).toBe(started.startedAt);
    expect(first.get('run-1')).toEqual(started);
    expect(first.get('missing')).toBeUndefined();
    expect(first.list()).toEqual([started]);
    first.close();

    const reopened = await openStore();
    expect(reopened.get('run-1')).toEqual(started);
  });

  it('finish 持久化 completed 与正常停止原因', async () => {
    const store = await openStore();
    store.start({ id: 'run-finished', sessionId: 'session-1' });

    const finished = store.finish('run-finished', 'max_turns');

    expect(finished).toMatchObject({
      id: 'run-finished',
      sessionId: 'session-1',
      status: 'completed',
      stopReason: 'max_turns',
    });
    expect(Date.parse(finished.updatedAt)).not.toBeNaN();
    store.close();

    const reopened = await openStore();
    expect(reopened.get('run-finished')).toEqual(finished);
  });

  it('fail 持久化 failed 终态', async () => {
    const store = await openStore();
    store.start({ id: 'run-failed', sessionId: 'session-1' });

    const failed = store.fail('run-failed');

    expect(failed).toMatchObject({ id: 'run-failed', status: 'failed' });
    expect(failed.stopReason).toBeUndefined();
    expect(store.get('run-failed')).toEqual(failed);
  });

  it('启动恢复只把遗留 running 标为 interrupted，不改 completed/failed', async () => {
    const store = await openStore();
    store.start({ id: 'running', sessionId: 'session-1' });
    store.start({ id: 'completed', sessionId: 'session-1' });
    store.start({ id: 'failed', sessionId: 'session-1' });
    store.finish('completed', 'completed');
    store.fail('failed');

    const interrupted = store.interruptRunning();

    expect(interrupted.map((run) => run.id)).toEqual(['running']);
    expect(interrupted[0]?.status).toBe('interrupted');
    expect(store.get('running')?.status).toBe('interrupted');
    expect(store.get('completed')).toMatchObject({ status: 'completed', stopReason: 'completed' });
    expect(store.get('failed')?.status).toBe('failed');
    expect(store.interruptRunning()).toEqual([]);
  });

  it('list 可按 session 隔离运行记录', async () => {
    const store = await openStore();
    const left = store.start({ id: 'left-run', sessionId: 'left' });
    const right = store.start({ id: 'right-run', sessionId: 'right' });

    expect(store.list('left')).toEqual([left]);
    expect(store.list('right')).toEqual([right]);
    expect(store.list('missing')).toEqual([]);
    expect(store.list()).toEqual([left, right]);
  });

  it('close 可重复调用，关闭后的操作给出明确错误', async () => {
    const store = await openStore();
    store.start({ id: 'closed-run', sessionId: 'closed-session' });
    store.close();
    store.close();
    const { RunStoreError } = await import('../src/memory/run-store.ts');

    expect(() => store.get('closed-run')).toThrow(RunStoreError);
    expect(() => store.list()).toThrow(/已关闭/);
    expect(() => store.start({ id: 'new', sessionId: 'closed-session' })).toThrow(RunStoreError);
    expect(() => store.finish('closed-run', 'completed')).toThrow(RunStoreError);
    expect(() => store.fail('closed-run')).toThrow(RunStoreError);
    expect(() => store.interruptRunning()).toThrow(RunStoreError);
  });
});
