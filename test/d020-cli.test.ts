import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(async (cleanup) => cleanup()));
});

describe('CLI 全链路流式输出', () => {
  it('一次性命令消费本地 SSE 且最终答案不重复', async () => {
    const requestBodies: Array<Record<string, unknown>> = [];
    const server = createServer((request, response) => {
      let raw = '';
      request.setEncoding('utf8');
      request.on('data', (chunk: string) => {
        raw += chunk;
      });
      request.on('end', () => {
        requestBodies.push(JSON.parse(raw) as Record<string, unknown>);
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.write('data: {"model":"local-mock","choices":[{"delta":{"content":"你"}}]}\n\n');
        setImmediate(() => {
          response.write('data: {"model":"local-mock","choices":[{"delta":{"content":"好"}}]}\n\n');
          response.end('data: [DONE]\n\n');
        });
      });
    });
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    cleanups.push(async () => {
      await new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => error === undefined ? resolveClose() : rejectClose(error));
      });
    });
    const address = server.address() as AddressInfo;
    const cwd = await mkdtemp(join(tmpdir(), 'personal-agent-d020-'));
    cleanups.push(async () => rm(cwd, { recursive: true, force: true }));
    const mainPath = resolve(import.meta.dirname, '../src/cli/main.ts');

    const child = spawn(process.execPath, [mainPath, '你好'], {
      cwd,
      env: {
        ...process.env,
        PA_MODEL_PROVIDER: 'openai-compatible',
        PA_MODEL_BASE_URL: `http://127.0.0.1:${String(address.port)}/v1`,
        PA_MODEL_API_KEY: 'local-test-only',
        PA_MODEL_NAME: 'local-mock',
        PA_LOG_LEVEL: 'error',
        PA_WORKSPACE: cwd,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    const exitCode = await new Promise<number | null>((resolveExit, rejectExit) => {
      child.once('error', rejectExit);
      child.once('close', resolveExit);
    });

    expect({ exitCode, stdout, stderr }).toEqual({ exitCode: 0, stdout: '你好\n', stderr: '' });
    expect(requestBodies).toHaveLength(1);
    expect(requestBodies[0]).toMatchObject({ stream: true });
  }, 10_000);
});
