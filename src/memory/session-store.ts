import { DatabaseSync } from 'node:sqlite';

import type { Message, MessageRole, ToolCall } from '../core/message.ts';
import { Session } from './session.ts';

export interface SessionStore {
  save(session: Session): void;
  load(id: string): Session | undefined;
  close(): void;
}

export class SessionStoreError extends Error {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = 'SessionStoreError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMessageRole(value: unknown): value is MessageRole {
  return value === 'system' || value === 'user' || value === 'assistant' || value === 'tool';
}

function corrupted(sessionId: string, position: number, cause?: unknown): SessionStoreError {
  return new SessionStoreError(`Session "${sessionId}" 第 ${position + 1} 条消息数据损坏`, { cause });
}

function parseToolCalls(value: unknown, sessionId: string, position: number): ToolCall[] {
  if (!Array.isArray(value)) {
    throw corrupted(sessionId, position);
  }

  return value.map((call) => {
    if (
      !isRecord(call) ||
      typeof call.id !== 'string' ||
      typeof call.name !== 'string' ||
      typeof call.arguments !== 'string'
    ) {
      throw corrupted(sessionId, position);
    }
    return { id: call.id, name: call.name, arguments: call.arguments };
  });
}

function parseMessage(value: unknown, sessionId: string, position: number): Message {
  if (!isRecord(value)) {
    throw corrupted(sessionId, position);
  }

  const { role, content, toolCalls, toolCallId, name } = value;
  if (
    !isMessageRole(role) ||
    typeof content !== 'string' ||
    (toolCallId !== undefined && typeof toolCallId !== 'string') ||
    (name !== undefined && typeof name !== 'string')
  ) {
    throw corrupted(sessionId, position);
  }

  return {
    role,
    content,
    ...(toolCalls === undefined ? {} : { toolCalls: parseToolCalls(toolCalls, sessionId, position) }),
    ...(toolCallId === undefined ? {} : { toolCallId }),
    ...(name === undefined ? {} : { name }),
  };
}

function parseMessageJson(json: string, sessionId: string, position: number): Message {
  let value: unknown;
  try {
    value = JSON.parse(json) as unknown;
  } catch (error) {
    throw corrupted(sessionId, position, error);
  }
  return parseMessage(value, sessionId, position);
}

export class SqliteSessionStore implements SessionStore {
  private readonly database: DatabaseSync;
  private closed = false;

  constructor(path: string) {
    this.database = new DatabaseSync(path, { enableForeignKeyConstraints: true });
    this.database.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY
      );
      CREATE TABLE IF NOT EXISTS session_messages (
        session_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        message_json TEXT NOT NULL,
        PRIMARY KEY (session_id, position),
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
    `);
  }

  save(session: Session): void {
    this.assertOpen();
    const messages = session.snapshot();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database
        .prepare('INSERT INTO sessions (id) VALUES (?) ON CONFLICT(id) DO NOTHING')
        .run(session.id);
      this.database.prepare('DELETE FROM session_messages WHERE session_id = ?').run(session.id);
      const insert = this.database.prepare(
        'INSERT INTO session_messages (session_id, position, message_json) VALUES (?, ?, ?)',
      );
      for (const [position, message] of messages.entries()) {
        insert.run(session.id, position, JSON.stringify(message));
      }
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  load(id: string): Session | undefined {
    this.assertOpen();
    const persisted = this.database.prepare('SELECT id FROM sessions WHERE id = ?').get(id);
    if (persisted === undefined) {
      return undefined;
    }

    const rows = this.database
      .prepare('SELECT message_json FROM session_messages WHERE session_id = ? ORDER BY position ASC')
      .all(id);
    const messages = rows.map((row, position) => {
      if (typeof row.message_json !== 'string') {
        throw corrupted(id, position);
      }
      return parseMessageJson(row.message_json, id, position);
    });
    return new Session(id, messages);
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.database.close();
    this.closed = true;
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new SessionStoreError('SessionStore 已关闭');
    }
  }
}
