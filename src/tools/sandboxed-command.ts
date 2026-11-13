import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

import { ToolError, type Tool, type ToolContext, type ToolResult } from '../core/tool.ts';
import { errorResult, toolError } from './errors.ts';
import { resolveInWorkspace } from './workspace.ts';

const MAX_OUTPUT_CHARS = 8000;
const MAX_TIMEOUT_MS = 30_000;
const FIXED_ENV_NAMES = new Set(['PATH', 'HOME', 'TMPDIR', 'PWD', 'LANG']);
const SENSITIVE_ENV_NAME = /(SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|PRIVATE|API_KEY|ACCESS_KEY|AUTH|COOKIE)/;
const UNSAFE_ENV_NAME = /^(NODE_OPTIONS|BASH_ENV|ENV|SHELLOPTS|LD_.*|DYLD_.*)$/;

export interface SandboxedCommandResult {
  readonly command: string;
  readonly sandboxRoot: string;
  readonly cwd: string;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly timedOut: boolean;
  readonly cancelled: boolean;
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutTruncated: boolean;
  readonly stderrTruncated: boolean;
  readonly cleanedUp: boolean;
}

interface ValidatedInput {
  readonly command: string;
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly env: Readonly<Record<string, string>>;
}

function invalid(message: string): ToolError {
  return new ToolError('INVALID_ARGUMENTS', message, true, '请修正 sandboxed_command 参数后重试');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateInput(args: unknown): ValidatedInput {
  if (!isRecord(args)) throw invalid('参数必须是对象');
  for (const key of Object.keys(args)) {
    if (!['command', 'cwd', 'timeoutMs', 'env'].includes(key)) {
      throw invalid(`不支持额外参数：${key}`);
    }
  }

  const command = args['command'];
  if (typeof command !== 'string' || command.trim() === '' || command.includes('\0')) {
    throw invalid('command 必须是非空且不含 NUL 的字符串');
  }
  const cwd = args['cwd'] ?? '.';
  if (typeof cwd !== 'string' || cwd.trim() === '' || cwd.includes('\0')) {
    throw invalid('cwd 必须是沙箱内的非空相对路径');
  }
  const timeoutMs = args['timeoutMs'] ?? 10_000;
  if (
    typeof timeoutMs !== 'number'
    || !Number.isInteger(timeoutMs)
    || timeoutMs <= 0
    || timeoutMs > MAX_TIMEOUT_MS
  ) {
    throw invalid(`timeoutMs 必须是 1–${MAX_TIMEOUT_MS} 的整数`);
  }

  const rawEnv = args['env'] ?? {};
  if (!isRecord(rawEnv)) throw invalid('env 必须是字符串到字符串的对象');
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(rawEnv)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw invalid(`非法环境变量名：${name}`);
    if (FIXED_ENV_NAMES.has(name)) throw invalid(`不能覆盖固定环境变量：${name}`);
    if (SENSITIVE_ENV_NAME.test(name.toUpperCase()) || UNSAFE_ENV_NAME.test(name.toUpperCase())) {
      throw invalid(`不允许传入敏感或执行注入类环境变量：${name}`);
    }
    if (typeof value !== 'string' || value.includes('\0')) {
      throw invalid(`环境变量 ${name} 的值必须是不含 NUL 的字符串`);
    }
    env[name] = value;
  }
  return { command, cwd, timeoutMs, env };
}

function limitedAppend(current: string, chunk: string): { text: string; truncated: boolean } {
  const combined = current + chunk;
  return { text: combined.slice(0, MAX_OUTPUT_CHARS), truncated: combined.length > MAX_OUTPUT_CHARS };
}

function terminateProcessGroup(child: ChildProcess): void {
  if (child.pid === undefined) return;
  try {
    if (process.platform === 'win32') child.kill('SIGKILL');
    else process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
}

function cancelledBeforeStart(command: string): ToolResult {
  const content = JSON.stringify({
    command,
    sandboxRoot: '',
    cwd: '',
    exitCode: null,
    signal: null,
    timedOut: false,
    cancelled: true,
    stdout: '',
    stderr: '',
    stdoutTruncated: false,
    stderrTruncated: false,
    cleanedUp: true,
  } satisfies SandboxedCommandResult);
  const failure = toolError('COMMAND_CANCELLED', '命令已被外部取消', false, '请重新发起任务');
  return { content, isError: true, ...(failure.error === undefined ? {} : { error: failure.error }) };
}

async function spawnInSandbox(
  input: ValidatedInput,
  context: ToolContext,
  sandboxRoot: string,
  cwd: string,
): Promise<ToolResult> {
  return new Promise<ToolResult>((resolveResult) => {
    const child = spawn(input.command, {
      cwd,
      shell: true,
      detached: process.platform !== 'win32',
      env: {
        PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
        HOME: sandboxRoot,
        TMPDIR: sandboxRoot,
        PWD: cwd,
        LANG: 'C',
        ...input.env,
      },
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
      if (settled) return;
      cancelled = true;
      terminateProcessGroup(child);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      terminateProcessGroup(child);
    }, input.timeoutMs);

    const finish = (exitCode: number | null, exitSignal: NodeJS.Signals | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      context.signal?.removeEventListener('abort', onAbort);
      terminateProcessGroup(child);
      void rm(sandboxRoot, { recursive: true, force: true }).then(
        () => {
          const content = JSON.stringify({
            command: input.command,
            sandboxRoot,
            cwd,
            exitCode,
            signal: exitSignal,
            timedOut,
            cancelled,
            stdout: stdoutTruncated ? `${stdout}\n…[stdout 已截断]` : stdout,
            stderr: stderrTruncated ? `${stderr}\n…[stderr 已截断]` : stderr,
            stdoutTruncated,
            stderrTruncated,
            cleanedUp: true,
          } satisfies SandboxedCommandResult);
          const failure = cancelled
            ? toolError('COMMAND_CANCELLED', '命令已被外部取消', false, '请重新发起任务')
            : timedOut
              ? toolError('COMMAND_TIMEOUT', `命令超过 ${input.timeoutMs}ms 超时`, true, '请缩短命令或调整 timeoutMs')
              : exitCode !== 0
                ? toolError('COMMAND_FAILED', `命令执行失败，退出码：${String(exitCode)}`, true, '请根据 stdout 和 stderr 修正后重试')
                : undefined;
          resolveResult({
            content,
            ...(failure === undefined ? {} : { isError: true, error: failure.error }),
          });
        },
        () => {
          const failure = toolError('COMMAND_FAILED', '命令已结束，但临时沙箱目录清理失败', false, '请检查临时目录权限');
          resolveResult({
            content: JSON.stringify({
              command: input.command,
              sandboxRoot,
              cwd,
              exitCode,
              signal: exitSignal,
              timedOut,
              cancelled,
              stdout,
              stderr,
              stdoutTruncated,
              stderrTruncated,
              cleanedUp: false,
            } satisfies SandboxedCommandResult),
            isError: true,
            ...(failure.error === undefined ? {} : { error: failure.error }),
          });
        },
      );
    };

    child.on('error', (error) => {
      stderr = error.message;
      finish(null, null);
    });
    child.on('close', (exitCode, exitSignal) => finish(exitCode, exitSignal));
    if (context.signal?.aborted === true) onAbort();
    else context.signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export const sandboxedCommandTool: Tool = {
  name: 'sandboxed_command',
  description: '在一次性临时目录和清理后的环境变量中执行 shell 命令；仅提供最小进程/目录隔离，不是容器',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', minLength: 1, description: '要执行的单条 shell 命令' },
      cwd: { type: 'string', minLength: 1, description: '一次性沙箱根目录内的相对工作目录，默认 .' },
      timeoutMs: {
        type: 'integer',
        minimum: 1,
        maximum: MAX_TIMEOUT_MS,
        description: '超时毫秒数，默认 10000，最大 30000',
      },
      env: {
        type: 'object',
        additionalProperties: true,
        description: '显式传入的非敏感字符串环境变量；固定变量、秘密命名和执行注入变量会被拒绝',
      },
    },
    required: ['command'],
    additionalProperties: false,
  },

  async execute(args, context) {
    let input: ValidatedInput;
    try {
      input = validateInput(args);
    } catch (error) {
      return errorResult(error instanceof ToolError ? error : invalid('参数校验失败'));
    }
    if (context.signal?.aborted === true) return cancelledBeforeStart(input.command);

    let sandboxRoot: string | undefined;
    try {
      const workspaceRoot = await realpath(resolve(context.workspaceRoot));
      sandboxRoot = await mkdtemp(join(workspaceRoot, '.d043-sandbox-'));
      const cwd = resolveInWorkspace({ workspaceRoot: sandboxRoot }, input.cwd);
      await mkdir(cwd, { recursive: true });
      const [realRoot, realCwd] = await Promise.all([realpath(sandboxRoot), realpath(cwd)]);
      if (realCwd !== realRoot && !realCwd.startsWith(realRoot + sep)) {
        throw new ToolError(
          'PATH_OUTSIDE_WORKSPACE',
          `路径越出沙箱：${input.cwd}`,
          true,
          '请改用沙箱内的相对 cwd',
        );
      }
      return await spawnInSandbox(input, context, sandboxRoot, cwd);
    } catch (error) {
      if (sandboxRoot !== undefined) {
        await rm(sandboxRoot, { recursive: true, force: true }).catch(() => undefined);
      }
      if (error instanceof ToolError) return errorResult(error);
      return toolError('COMMAND_FAILED', '无法创建或启动沙箱命令', true, '请确认工作区存在且可写后重试');
    }
  },
};
