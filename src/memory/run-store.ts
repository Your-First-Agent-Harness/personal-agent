import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

import type { AgentLoopResult, StopReason } from '../runtime/loop.ts';

export type RunStatus = 'running' | 'completed' | 'interrupted' | 'failed';

export interface RunRecord {
  readonly id: string;
  readonly sessionId: string;
  readonly status: RunStatus;
  readonly stopReason?: StopReason;
  readonly userMessage?: string;
  readonly result?: AgentLoopResult;
  readonly startedAt: string;
  readonly updatedAt: string;
}

export interface StartRun {
  readonly id?: string;
  readonly sessionId: string;
  readonly userMessage?: string;
}

export interface RunStore {
  start(run: StartRun): RunRecord;
  finish(id: string, stopReason?: StopReason, result?: AgentLoopResult): RunRecord;
  fail(id: string): RunRecord;
  get(id: string): RunRecord | undefined;
  list(sessionId?: string): RunRecord[];
  interruptRunning(): RunRecord[];
  close(): void;
}

export class RunStoreError extends Error {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = 'RunStoreError';
  }
}

function isStatus(value: unknown): value is RunStatus {
  return value === 'running' || value === 'completed' || value === 'interrupted' || value === 'failed';
}

function isStopReason(value: unknown): value is StopReason {
  return value === 'completed' || value === 'max_turns' || value === 'cancelled' || value === 'tool_errors';
}

function parseResult(json: string): AgentLoopResult {
  try {
    return JSON.parse(json) as AgentLoopResult;
  } catch (error) {
    throw new RunStoreError('Run 完成结果数据损坏', { cause: error });
  }
}

function toRunRecord(row: Record<string, unknown>): RunRecord {
  if (
    typeof row.id !== 'string' ||
    typeof row.session_id !== 'string' ||
    !isStatus(row.status) ||
    (row.stop_reason !== null && !isStopReason(row.stop_reason)) ||
    (row.user_message !== null && typeof row.user_message !== 'string') ||
    (row.result_json !== null && typeof row.result_json !== 'string') ||
    typeof row.started_at !== 'string' ||
    typeof row.updated_at !== 'string'
  ) {
    throw new RunStoreError('Run 记录数据损坏');
  }
  return {
    id: row.id,
    sessionId: row.session_id,
    status: row.status,
    ...(row.stop_reason === null ? {} : { stopReason: row.stop_reason }),
    ...(row.user_message === null ? {} : { userMessage: row.user_message }),
    ...(row.result_json === null ? {} : { result: parseResult(row.result_json) }),
    startedAt: row.started_at,
    updatedAt: row.updated_at,
  };
}

export class SqliteRunStore implements RunStore {
  private readonly database: DatabaseSync;
  private closed = false;

  constructor(path: string) {
    this.database = new DatabaseSync(path, { enableForeignKeyConstraints: true });
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'interrupted', 'failed')),
        stop_reason TEXT,
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        user_message TEXT,
        result_json TEXT
      );
    `);
    const columns = new Set(
      this.database.prepare('PRAGMA table_info(runs)').all().map((column) => column.name),
    );
    if (!columns.has('user_message')) {
      this.database.exec('ALTER TABLE runs ADD COLUMN user_message TEXT');
    }
    if (!columns.has('result_json')) {
      this.database.exec('ALTER TABLE runs ADD COLUMN result_json TEXT');
    }
  }

  start(run: StartRun): RunRecord {
    this.assertOpen();
    const id = run.id ?? randomUUID();
    const timestamp = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO runs (id, session_id, status, stop_reason, started_at, updated_at, user_message)
         VALUES (?, ?, 'running', NULL, ?, ?, ?)`,
      )
      .run(id, run.sessionId, timestamp, timestamp, run.userMessage ?? null);
    return {
      id,
      sessionId: run.sessionId,
      status: 'running',
      ...(run.userMessage === undefined ? {} : { userMessage: run.userMessage }),
      startedAt: timestamp,
      updatedAt: timestamp,
    };
  }

  finish(id: string, stopReason: StopReason = 'completed', result?: AgentLoopResult): RunRecord {
    this.assertOpen();
    this.finishTransition(id, 'completed', stopReason, result);
    return this.require(id);
  }

  fail(id: string): RunRecord {
    this.assertOpen();
    this.finishTransition(id, 'failed', null);
    return this.require(id);
  }

  get(id: string): RunRecord | undefined {
    this.assertOpen();
    const row = this.database.prepare('SELECT * FROM runs WHERE id = ?').get(id);
    return row === undefined ? undefined : toRunRecord(row);
  }

  list(sessionId?: string): RunRecord[] {
    this.assertOpen();
    const rows = sessionId === undefined
      ? this.database.prepare('SELECT * FROM runs ORDER BY started_at ASC, id ASC').all()
      : this.database
          .prepare('SELECT * FROM runs WHERE session_id = ? ORDER BY started_at ASC, id ASC')
          .all(sessionId);
    return rows.map(toRunRecord);
  }

  interruptRunning(): RunRecord[] {
    this.assertOpen();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const running = this.database
        .prepare("SELECT * FROM runs WHERE status = 'running' ORDER BY started_at ASC, id ASC")
        .all();
      const timestamp = new Date().toISOString();
      this.database
        .prepare("UPDATE runs SET status = 'interrupted', updated_at = ? WHERE status = 'running'")
        .run(timestamp);
      this.database.exec('COMMIT');
      return running.map((row) => ({ ...toRunRecord(row), status: 'interrupted', updatedAt: timestamp }));
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.database.close();
    this.closed = true;
  }

  private finishTransition(
    id: string,
    status: 'completed' | 'failed',
    stopReason: StopReason | null,
    result?: AgentLoopResult,
  ): void {
    const transition = this.database
      .prepare(
        `UPDATE runs SET status = ?, stop_reason = ?, result_json = ?, updated_at = ?
         WHERE id = ? AND status = 'running'`,
      )
      .run(
        status,
        stopReason,
        result === undefined ? null : JSON.stringify(result),
        new Date().toISOString(),
        id,
      );
    if (transition.changes === 0) {
      throw new RunStoreError(`Run "${id}" 不存在或已结束`);
    }
  }

  private require(id: string): RunRecord {
    const row = this.database.prepare('SELECT * FROM runs WHERE id = ?').get(id);
    if (row === undefined) {
      throw new RunStoreError(`Run "${id}" 不存在`);
    }
    return toRunRecord(row);
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new RunStoreError('RunStore 已关闭');
    }
  }
}
