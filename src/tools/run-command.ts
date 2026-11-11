import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

import type { Tool, ToolResult } from '../core/tool.ts';

const MAX_OUTPUT_CHARS = 8000;
const MAX_TIMEOUT_MS = 30_000;

function limitedAppend(current: string, chunk: string): { text: string; truncated: boolean } {
  const combined = current + chunk;
  return { text: combined.slice(0, MAX_OUTPUT_CHARS), truncated: combined.length > MAX_OUTPUT_CHARS };
}

export const runCommandTool: Tool = {
  name: 'run_command',
  description: '在工作区根目录通过系统 shell 执行一条命令；不是安全沙箱',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: '要执行的单条 shell 命令' },
      timeoutMs: { type: 'integer', description: '超时毫秒数，默认 10000，最大 30000' },
    },
    required: ['command'],
    additionalProperties: false,
  },

  async execute(args, context) {
    const record = (args ?? {}) as Record<string, unknown>;
    const command = record['command'];
    const timeoutMs = record['timeoutMs'] ?? 10_000;
    if (typeof command !== 'string' || command.trim() === '') {
      throw new Error('command 必须是非空字符串');
    }
    if (
      typeof timeoutMs !== 'number' ||
      !Number.isInteger(timeoutMs) ||
      timeoutMs <= 0 ||
      timeoutMs > MAX_TIMEOUT_MS
    ) {
      throw new Error(`timeoutMs 必须是 1–${MAX_TIMEOUT_MS} 的整数`);
    }

    return new Promise<ToolResult>((resolveResult) => {
      const child = spawn(command, {
        cwd: resolve(context.workspaceRoot),
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      let stdoutTruncated = false;
      let stderrTruncated = false;
      let timedOut = false;
      let cancelled = false;
      let settled = false;

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        const next = limitedAppend(stdout, chunk);
        stdout = next.text;
        stdoutTruncated ||= next.truncated;
      });
      child.stderr.on('data', (chunk: string) => {
        const next = limitedAppend(stderr, chunk);
        stderr = next.text;
        stderrTruncated ||= next.truncated;
      });
      const onAbort = (): void => {
        cancelled = true;
        child.kill('SIGTERM');
      };
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, timeoutMs);
      const finish = (exitCode: number | null): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        context.signal?.removeEventListener('abort', onAbort);
        resolveResult({
          content: JSON.stringify({
            command,
            exitCode,
            timedOut,
            cancelled,
            stdout: stdoutTruncated ? `${stdout}\n…[stdout 已截断]` : stdout,
            stderr: stderrTruncated ? `${stderr}\n…[stderr 已截断]` : stderr,
            stdoutTruncated,
            stderrTruncated,
          }),
          ...(exitCode === 0 && !timedOut && !cancelled ? {} : { isError: true }),
        });
      };
      child.on('error', (error) => {
        stderr = error.message;
        finish(null);
      });
      child.on('close', (exitCode) => finish(exitCode));
      if (context.signal?.aborted === true) onAbort();
      else context.signal?.addEventListener('abort', onAbort, { once: true });
    });
  },
};
