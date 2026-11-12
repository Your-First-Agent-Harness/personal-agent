import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const fixturePath = fileURLToPath(new URL('./d022-process.ts', import.meta.url));
const children = new Set<ChildProcess>();
let directory: string;

interface ExitResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

function output(child: ChildProcess): { stdout: string; stderr: string } {
  return Reflect.get(child, 'capturedOutput') as { stdout: string; stderr: string };
}

function startChild(mode: 'crash' | 'recover', databasePath: string): ChildProcess {
  const child = spawn(
    process.execPath,
    [fixturePath, mode, databasePath, 'crash-session', 'crash-run'],
    { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const captured = { stdout: '', stderr: '' };
  Reflect.set(child, 'capturedOutput', captured);
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
      reject(new Error(`等待子进程 ready 超时：${output(child).stderr}`));
    }, 8_000);
    const cleanup = (): void => {
      clearTimeout(timeout);
      child.off('exit', onExit);
      child.off('error', onError);
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      cleanup();
      reject(
        new Error(
          `子进程在 ready 前退出（code=${String(code)}, signal=${String(signal)}）：${output(child).stderr}`,
        ),
      );
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    stdout.on('data', function onData() {
      if (output(child).stdout.includes('"type":"ready"')) {
        cleanup();
        stdout.off('data', onData);
        resolve();
      }
    });
    child.once('exit', onExit);
    child.once('error', onError);
  });
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
  }
  await waitForExit(child);
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'personal-agent-d022-crash-'));
});

afterEach(async () => {
  await Promise.all([...children].map(stopChild));
  children.clear();
  rmSync(directory, { recursive: true, force: true });
});

describe('真实进程崩溃恢复', () => {
  it('SIGKILL 阻塞在 Provider 的真实 Loop 后，第二个 Node 进程恢复同一 run 与 Session', async () => {
    const databasePath = join(directory, 'crash.sqlite');
    const first = startChild('crash', databasePath);

    await waitForReady(first);
    expect(first.kill('SIGKILL')).toBe(true);
    const crashed = await waitForExit(first);
    expect(crashed.signal).toBe('SIGKILL');

    const second = startChild('recover', databasePath);
    const recovered = await waitForExit(second);

    expect(recovered.stderr).toBe('');
    expect(recovered.code).toBe(0);
    expect(recovered.signal).toBeNull();
    const payload = JSON.parse(recovered.stdout) as {
      type: string;
      sessionId: string;
      messages: unknown;
      run: { id: string; sessionId: string; status: string };
    };
    expect(payload.type).toBe('recovered');
    expect(payload.sessionId).toBe('crash-session');
    expect(payload.messages).toEqual([{ role: 'user', content: '崩溃前必须落盘' }]);
    expect(payload.run).toMatchObject({
      id: 'crash-run',
      sessionId: 'crash-session',
      status: 'interrupted',
    });
  }, 15_000);
});
