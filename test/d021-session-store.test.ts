import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Message } from '../src/core/message.ts';
import { Session } from '../src/memory/session.ts';

interface StoredSession {
  save(session: Session): void;
  load(id: string): Session | undefined;
  close(): void;
}

let directory: string;
const stores: StoredSession[] = [];

function databasePath(): string {
  return join(directory, 'sessions.sqlite');
}

async function openStore(): Promise<StoredSession> {
  const { SqliteSessionStore } = await import('../src/memory/session-store.ts');
  const store: StoredSession = new SqliteSessionStore(databasePath());
  stores.push(store);
  return store;
}

function overwriteFirstMessage(sessionId: string, value: string): void {
  const database = new DatabaseSync(databasePath());
  try {
    const result = database
      .prepare('UPDATE session_messages SET message_json = ? WHERE session_id = ? AND position = 0')
      .run(value, sessionId);
    expect(result.changes).toBe(1);
  } finally {
    database.close();
  }
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'personal-agent-d021-'));
});

afterEach(() => {
  for (const store of stores) {
    store.close();
  }
  stores.length = 0;
  rmSync(directory, { recursive: true, force: true });
});

describe('SqliteSessionStore', () => {
  it('关闭并重开数据库后恢复三轮有序历史及原始文本', async () => {
    const messages: Message[] = [1, 2, 3].flatMap((round) => [
      { role: 'user', content: round === 2 ? '' : `第 ${round} 轮\n问题 🌱` },
      { role: 'assistant', content: round === 3 ? '' : `回答 ${round}\n你好，世界 👋` },
    ]);
    const session = new Session('three-rounds', messages);
    const first = await openStore();
    first.save(session);
    first.close();

    const reopened = await openStore();
    const restored = reopened.load('three-rounds');

    expect(restored).toBeInstanceOf(Session);
    expect(restored?.id).toBe(session.id);
    expect(restored?.snapshot()).toEqual(messages);
  });

  it('恢复工具调用和工具结果且不改变 id、name、arguments', async () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: 'call-你好-01',
            name: 'write_file',
            arguments: '{"path":"src/示例.ts","content":"第一行\\n第二行"}',
          },
        ],
      },
      {
        role: 'tool',
        toolCallId: 'call-你好-01',
        name: 'write_file',
        content: '\n写入完成 ✅\n',
      },
    ];
    const store = await openStore();
    store.save(new Session('tool-history', messages));

    expect(store.load('tool-history')?.snapshot()).toEqual(messages);
  });

  it('重复保存同一 id 会替换完整快照而不重复追加', async () => {
    const store = await openStore();
    const session = new Session('repeated', [
      { role: 'user', content: '第一问' },
      { role: 'assistant', content: '第一答' },
    ]);
    store.save(session);
    session.append([{ role: 'user', content: '第二问' }]);
    store.save(session);
    store.save(session);

    expect(store.load('repeated')?.snapshot()).toEqual(session.snapshot());

    const replacement = new Session('repeated', [{ role: 'user', content: '最终快照' }]);
    store.save(replacement);
    expect(store.load('repeated')?.snapshot()).toEqual(replacement.snapshot());
  });

  it('两个 session 的持久化历史彼此隔离', async () => {
    const store = await openStore();
    const left = new Session('left', [{ role: 'user', content: '只属于左边' }]);
    const right = new Session('right', [{ role: 'assistant', content: '只属于右边' }]);
    store.save(left);
    store.save(right);

    expect(store.load('left')?.snapshot()).toEqual(left.snapshot());
    expect(store.load('right')?.snapshot()).toEqual(right.snapshot());
  });

  it('load 不存在的 id 返回 undefined', async () => {
    const store = await openStore();

    expect(store.load('missing')).toBeUndefined();
  });

  it('外部修改恢复快照不污染再次读取', async () => {
    const original: Message[] = [
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call-1', name: 'read_file', arguments: '{"path":"原始.ts"}' }],
      },
    ];
    const store = await openStore();
    store.save(new Session('isolated', original));
    const restored = store.load('isolated');
    const snapshot = restored?.snapshot() as Message[];

    snapshot.push({ role: 'user', content: '外部消息' });
    Reflect.set(snapshot[0]!.toolCalls![0]!, 'arguments', '{"path":"篡改.ts"}');
    restored?.append([{ role: 'user', content: '仅追加到内存' }]);

    expect(store.load('isolated')?.snapshot()).toEqual(original);
  });

  it('损坏的 JSON 消息数据抛出明确 SessionStoreError', async () => {
    const store = await openStore();
    store.save(new Session('broken-json', [{ role: 'user', content: '原始消息' }]));
    overwriteFirstMessage('broken-json', '{not-json');
    const { SessionStoreError } = await import('../src/memory/session-store.ts');

    expect(() => store.load('broken-json')).toThrow(SessionStoreError);
    expect(() => store.load('broken-json')).toThrow(/消息数据损坏/);
  });

  it('JSON 结构不符合 Message 契约时抛出 SessionStoreError', async () => {
    const store = await openStore();
    store.save(new Session('broken-shape', [{ role: 'assistant', content: '' }]));
    overwriteFirstMessage(
      'broken-shape',
      JSON.stringify({
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call-1', name: 'read_file' }],
      }),
    );
    const { SessionStoreError } = await import('../src/memory/session-store.ts');

    expect(() => store.load('broken-shape')).toThrow(SessionStoreError);
    expect(() => store.load('broken-shape')).toThrow(/消息数据损坏/);
  });

  it('close 可重复调用，关闭后 save 和 load 给出明确错误', async () => {
    const store = await openStore();
    const session = new Session('closed', [{ role: 'user', content: '消息' }]);
    store.save(session);
    store.close();
    store.close();
    const { SessionStoreError } = await import('../src/memory/session-store.ts');

    expect(() => store.load('closed')).toThrow(SessionStoreError);
    expect(() => store.load('closed')).toThrow(/已关闭/);
    expect(() => store.save(session)).toThrow(SessionStoreError);
    expect(() => store.save(session)).toThrow(/已关闭/);
  });
});
