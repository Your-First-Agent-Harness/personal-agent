import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Message } from '../src/core/message.ts';
import type { RunRecord } from '../src/memory/run-store.ts';
import type { AgentLoopResult } from '../src/runtime/loop.ts';

const fixturePath = fileURLToPath(new URL('./d023-process.ts', import.meta.url));
const children = new Set<ChildProcess>();
const outputs = new WeakMap<ChildProcess, { stdout: string; stderr: string }>();
let directory: string;

interface FixtureContext {
  databasePath: string;
  sessionId: string;
  completedRunId: string;
  crashedRunId: string;
  toolLogPath: string;
}

interface ExitResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

interface ExecutionPayload extends AgentLoopResult {
  readonly run: RunRecord;
}

interface CompletedPayload {
  readonly type: string;
  readonly execution: ExecutionPayload;
  readonly sessionMessages: readonly Message[];
  readonly toolLog: string[];
}

interface RecoveredPayload {
  readonly sessionId: string;
  readonly messages: readonly Message[];
  readonly interruptedRuns: RunRecord[];
}

interface VerifiedPayload {
  readonly type: string;
  readonly recovered: RecoveredPayload;
  readonly recoveredAgain: RecoveredPayload;
  readonly duplicate: ExecutionPayload;
  readonly runs: RunRecord[];
  readonly toolLog: string[];
  readonly providerCalls: number;
  readonly unexpectedToolCalls: number;
  readonly interruptedError: string;
}

function output(child: ChildProcess): { stdout: string; stderr: string } {
  return outputs.get(child)!;
}

function startChild(mode: 'complete' | 'crash' | 'verify', context: FixtureContext): ChildProcess {
  const child = spawn(
    process.execPath,
    [
      fixturePath,
      mode,
      context.databasePath,
      context.sessionId,
      context.completedRunId,
      context.crashedRunId,
      context.toolLogPath,
    ],
    { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const captured = { stdout: '', stderr: '' };
  outputs.set(child, captured);
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    captured.stdout += chunk;
  });
  child.stderr.on('data', (chunk: string) => {
    captured.stderr += chunk;
  });
  children.add(child);
  return child;
}

function waitForExit(child: ChildProcess): Promise<ExitResult> {
  if (child.exitCode !== null || child.signalCode !== null) {
    children.delete(child);
    return Promise.resolve({
      code: child.exitCode,
      signal: child.signalCode,
      ...output(child),
    });
  }
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      children.delete(child);
      resolve({ code, signal, ...output(child) });
    });
  });
}

function waitForReady(child: ChildProcess): Promise<void> {
  const stdout = child.stdout;
  if (stdout === null) {
    return Promise.reject(new Error('子进程没有 stdout'));
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`等待子进程 ready 超时：${output(child).stderr}`));
    }, 8_000);
    const cleanup = (): void => {
      clearTimeout(timeout);
      stdout.off('data', onData);
      child.off('exit', onExit);
      child.off('error', onError);
    };
    const onData = (): void => {
      if (output(child).stdout.includes('"type":"ready"')) {
        cleanup();
        resolve();
      }
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      cleanup();
      reject(new Error(
        `子进程在 ready 前退出（code=${String(code)}, signal=${String(signal)}）：${output(child).stderr}`,
      ));
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    stdout.on('data', onData);
    child.once('exit', onExit);
    child.once('error', onError);
    onData();
  });
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
  }
  await waitForExit(child);
}

async function runSuccessfully<T>(child: ChildProcess): Promise<T> {
  const exited = await waitForExit(child);
  expect(exited.stderr).toBe('');
  expect(exited.code).toBe(0);
  expect(exited.signal).toBeNull();
  const lastLine = exited.stdout.trim().split('\n').at(-1);
  expect(lastLine).toBeDefined();
  return JSON.parse(lastLine!) as T;
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'personal-agent-d023-crash-'));
});

afterEach(async () => {
  await Promise.all([...children].map(stopChild));
  children.clear();
  rmSync(directory, { recursive: true, force: true });
});

describe('D024 真实 SIGKILL 幂等恢复', () => {
  for (let iteration = 1; iteration <= 10; iteration += 1) {
    it(`第 ${iteration} 次杀进程后，重复恢复与重复请求保持同一快照且不重放工具`, async () => {
      const context: FixtureContext = {
        databasePath: join(directory, 'crash.sqlite'),
        sessionId: `session-${iteration}`,
        completedRunId: `complete-${iteration}`,
        crashedRunId: `crash-${iteration}`,
        toolLogPath: join(directory, 'tool.log'),
      };
      const completed = await runSuccessfully<CompletedPayload>(startChild('complete', context));
      expect(completed.type).toBe('completed');
      expect(completed.toolLog).toEqual(['complete']);
      expect(completed.sessionMessages).toEqual(completed.execution.messages);
      expect(completed.execution.run).toMatchObject({
        id: context.completedRunId,
        status: 'completed',
        userMessage: '完成请求',
      });

      const crashing = startChild('crash', context);
      await waitForReady(crashing);
      expect(crashing.kill('SIGKILL')).toBe(true);
      const crashed = await waitForExit(crashing);
      expect(crashed.signal).toBe('SIGKILL');

      const first = await runSuccessfully<VerifiedPayload>(startChild('verify', context));
      expect(first.type).toBe('verified');
      expect(first.recoveredAgain).toEqual(first.recovered);
      expect(first.duplicate).toEqual(completed.execution);
      expect(first.recovered.sessionId).toBe(context.sessionId);
      expect(first.recovered.messages).toEqual([
        ...completed.execution.messages,
        { role: 'user', content: '崩溃请求' },
      ]);
      expect(first.recovered.interruptedRuns.map((run) => run.id)).toEqual([context.crashedRunId]);
      expect(first.runs).toHaveLength(2);
      expect(first.runs.find((run) => run.id === context.completedRunId)).toMatchObject({
        status: 'completed',
        result: completed.execution.run.result,
      });
      expect(first.runs.find((run) => run.id === context.crashedRunId)).toMatchObject({
        status: 'interrupted',
        userMessage: '崩溃请求',
      });
      expect(first.interruptedError).toContain('中断');
      expect(first.providerCalls).toBe(0);
      expect(first.unexpectedToolCalls).toBe(0);
      expect(first.toolLog).toEqual(['complete', 'crash']);

      const second = await runSuccessfully<VerifiedPayload>(startChild('verify', context));
      expect(second).toEqual(first);
    }, 20_000);
  }
});
