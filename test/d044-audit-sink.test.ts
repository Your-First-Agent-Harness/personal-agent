import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createJsonlAuditSink,
  type CommandAuditRecord,
} from '../src/observability/audit-sink.ts';

const dirs: string[] = [];

function directory(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pa-d044-audit-'));
  dirs.push(dir);
  return dir;
}

function record(operationId: string, timestamp: string): CommandAuditRecord {
  return {
    schemaVersion: 1,
    timestamp,
    operationId,
    phase: 'decision',
    tool: 'secure_command',
    ruleId: 'fixed-rule',
    decision: 'denied',
    status: 'denied',
    resultCode: 'COMMAND_NOT_ALLOWED',
    executable: '/opt/example/node',
    argv: ['-e', '[REDACTED]'],
    argvSha256: 'a'.repeat(64),
    durationMs: 0,
    exitCode: null,
    signal: null,
    resource: {
      timeoutMs: 100,
      maxOutputBytes: 64,
      stdoutBytes: 0,
      stderrBytes: 0,
      outputTruncated: false,
      queueWaitMs: 0,
      cleanedUp: true,
    },
  };
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

describe('D044 JSONL AuditSink', () => {
  it('并发 append 串行落盘，每条记录恰好一行且保留确定性字段', async () => {
    const root = directory();
    const file = join(root, 'nested', 'audit.jsonl');
    const sink = createJsonlAuditSink({ filePath: file });
    const first = record('op-fixed-1', '2026-01-02T03:04:05.000Z');
    const second = { ...record('op-fixed-2', '2026-01-02T03:04:06.000Z'), phase: 'completion' as const };

    await Promise.all([sink.append(first), sink.append(second)]);
    const text = readFileSync(file, 'utf8');
    const lines = text.trimEnd().split('\n');

    expect(lines).toHaveLength(2);
    expect(lines.map((line) => JSON.parse(line) as CommandAuditRecord)).toEqual([first, second]);
    expect(text.endsWith('\n')).toBe(true);
  });

  it('一次写失败不会毒化后续串行写入，也不会被静默吞掉', async () => {
    const root = directory();
    const blocker = join(root, 'blocker');
    const file = join(blocker, 'audit.jsonl');
    writeFileSync(blocker, 'not-a-directory');
    const sink = createJsonlAuditSink({ filePath: file });
    const item = record('op-retry', '2026-01-02T03:04:05.000Z');

    await expect(sink.append(item)).rejects.toThrow();
    rmSync(blocker);
    await sink.append(item);
    expect(JSON.parse(readFileSync(file, 'utf8').trim())).toEqual(item);
  });
});
