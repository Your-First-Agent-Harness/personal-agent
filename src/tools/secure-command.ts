import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { performance } from 'node:perf_hooks';

import type { Tool, ToolContext, ToolErrorCode, ToolResult } from '../core/tool.ts';
import type { AuditSink, CommandAuditRecord } from '../observability/audit-sink.ts';
import { toolError } from './errors.ts';

export interface CommandAllowRule {
  id: string;
  executable: string;
  args: readonly string[];
}

export interface SecureCommandResources {
  defaultTimeoutMs?: number;
  maxTimeoutMs?: number;
  maxOutputBytes?: number;
  maxConcurrent?: number;
  maxQueue?: number;
  maxQueueWaitMs?: number;
}

export interface SecureCommandToolOptions {
  allowlist: readonly CommandAllowRule[];
  auditSink: AuditSink;
  resources?: SecureCommandResources;
  sensitiveValues?: readonly string[];
  clock?: () => Date;
  idGenerator?: () => string;
  monotonicClock?: () => number;
  /** 默认使用 Node spawn；显式注入可用于正向进程启动计数与受控测试。 */
  spawnImplementation?: typeof spawn;
}

export interface SecureCommandResult {
  operationId: string;
  ruleId: string;
  executable: string;
  args: string[];
  sandboxRoot: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  cancelled: boolean;
  outputLimitExceeded: boolean;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  stdoutBytes: number;
  stderrBytes: number;
  cleanedUp: boolean;
}

interface RequiredResources {
  defaultTimeoutMs: number;
  maxTimeoutMs: number;
  maxOutputBytes: number;
  maxConcurrent: number;
  maxQueue: number;
  maxQueueWaitMs: number;
}

interface CommandInput {
  executable: string;
  args: string[];
  timeoutMs: number;
}

interface ProcessOutcome {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  cancelled: boolean;
  outputLimitExceeded: boolean;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  stdoutBytes: number;
  stderrBytes: number;
  spawnFailed: boolean;
}

interface AdmittedRun {
  outcome: ProcessOutcome;
  sandboxRoot: string;
  cleanedUp: boolean;
}

const REDACTED = '[REDACTED]';
const DEFAULT_RESOURCES: RequiredResources = {
  defaultTimeoutMs: 5_000,
  maxTimeoutMs: 30_000,
  maxOutputBytes: 8_192,
  maxConcurrent: 1,
  maxQueue: 0,
  maxQueueWaitMs: 1_000,
};

function positiveInteger(value: number, name: string, allowZero = false): number {
  if (!Number.isSafeInteger(value) || (allowZero ? value < 0 : value <= 0)) {
    throw new TypeError(`${name} 必须是${allowZero ? '非负' : '正'}安全整数`);
  }
  return value;
}

function normalizeResources(resources: SecureCommandResources = {}): RequiredResources {
  const merged = {
    ...DEFAULT_RESOURCES,
    ...resources,
    defaultTimeoutMs: resources.defaultTimeoutMs
      ?? Math.min(DEFAULT_RESOURCES.defaultTimeoutMs, resources.maxTimeoutMs ?? DEFAULT_RESOURCES.maxTimeoutMs),
  };
  positiveInteger(merged.defaultTimeoutMs, 'defaultTimeoutMs');
  positiveInteger(merged.maxTimeoutMs, 'maxTimeoutMs');
  positiveInteger(merged.maxOutputBytes, 'maxOutputBytes');
  positiveInteger(merged.maxConcurrent, 'maxConcurrent');
  positiveInteger(merged.maxQueue, 'maxQueue', true);
  positiveInteger(merged.maxQueueWaitMs, 'maxQueueWaitMs');
  if (merged.defaultTimeoutMs > merged.maxTimeoutMs) {
    throw new TypeError('defaultTimeoutMs 不得大于 maxTimeoutMs');
  }
  return merged;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.every((arg: unknown) => typeof arg === 'string' && !arg.includes('\0'));
}

function validateAllowlist(allowlist: readonly CommandAllowRule[]): void {
  const ids = new Set<string>();
  for (const rule of allowlist) {
    if (
      typeof rule.id !== 'string' || rule.id.trim().length === 0
      || typeof rule.executable !== 'string' || !isAbsolute(rule.executable)
      || !isStringArray(rule.args)
      || ids.has(rule.id)
    ) {
      throw new TypeError('白名单规则要求唯一非空 id、绝对 executable 和无 NUL 的 argv');
    }
    ids.add(rule.id);
  }
}

function parseInput(args: unknown, resources: RequiredResources): CommandInput {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    throw new TypeError('参数必须是对象');
  }
  const input = args as Record<string, unknown>;
  const keys = Object.keys(input);
  if (keys.some((key) => !['executable', 'args', 'timeoutMs'].includes(key))) {
    throw new TypeError('存在未声明参数');
  }
  if (
    typeof input.executable !== 'string'
    || !isAbsolute(input.executable)
    || input.executable.includes('\0')
    || !isStringArray(input.args)
  ) {
    throw new TypeError('executable 必须是绝对路径，args 必须是无 NUL 的字符串数组');
  }
  const timeoutMs = input.timeoutMs ?? resources.defaultTimeoutMs;
  if (
    typeof timeoutMs !== 'number'
    || !Number.isSafeInteger(timeoutMs)
    || timeoutMs <= 0
    || timeoutMs > resources.maxTimeoutMs
  ) {
    throw new TypeError(`timeoutMs 必须是 1..${resources.maxTimeoutMs} 的整数`);
  }
  return { executable: input.executable, args: [...input.args], timeoutMs };
}

function createRedactor(sensitiveValues: readonly string[]): (text: string) => string {
  const secrets = sensitiveValues.filter((value) => value.length > 0);
  return (text) => {
    let redacted = text;
    for (const secret of secrets) redacted = redacted.split(secret).join(REDACTED);
    return redacted.replace(
      /\b(api[_-]?key|password|secret|token)(\s*[=:]\s*)([^\s,;]+)/gi,
      (_match, key: string, separator: string) => `${key}${separator}${REDACTED}`,
    );
  };
}

function elapsed(started: number, now: () => number): number {
  return Math.max(0, Math.round(now() - started));
}

function safeUtf8(buffers: Buffer[], maxOutputBytes: number): string {
  let text = Buffer.concat(buffers).toString('utf8');
  while (Buffer.byteLength(text) > maxOutputBytes) text = text.slice(0, -1);
  return text;
}

function terminateProcessGroup(child: ReturnType<typeof spawn>): void {
  if (child.pid === undefined) return;
  try {
    if (process.platform === 'win32') child.kill('SIGKILL');
    else process.kill(-child.pid, 'SIGKILL');
  } catch {
    // close 后进程组可能已不存在。
  }
}

async function runProcess(
  executable: string,
  input: CommandInput,
  sandboxRoot: string,
  resources: RequiredResources,
  redact: (text: string) => string,
  spawnImplementation: typeof spawn,
  signal?: AbortSignal,
): Promise<ProcessOutcome> {
  const empty: ProcessOutcome = {
    exitCode: null,
    signal: null,
    timedOut: false,
    cancelled: false,
    outputLimitExceeded: false,
    stdout: '',
    stderr: '',
    stdoutTruncated: false,
    stderrTruncated: false,
    stdoutBytes: 0,
    stderrBytes: 0,
    spawnFailed: false,
  };
  if (signal?.aborted === true) return { ...empty, cancelled: true };

  return new Promise<ProcessOutcome>((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawnImplementation(executable, input.args, {
        cwd: sandboxRoot,
        shell: false,
        env: { LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
        windowsHide: true,
      });
    } catch {
      resolve({ ...empty, spawnFailed: true, stderr: 'spawn failed' });
      return;
    }

    const stdoutBuffers: Buffer[] = [];
    const stderrBuffers: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let cancelled = signal?.aborted === true;
    let outputLimitExceeded = false;
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let spawnFailed = false;
    let settled = false;

    const onAbort = (): void => {
      cancelled = true;
      terminateProcessGroup(child);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      terminateProcessGroup(child);
    }, input.timeoutMs);

    const capture = (stream: 'stdout' | 'stderr', chunk: Buffer): void => {
      if (outputLimitExceeded) return;
      const captured = stdoutBytes + stderrBytes;
      const remaining = resources.maxOutputBytes - captured;
      const retained = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
      if (stream === 'stdout') {
        if (retained.length > 0) stdoutBuffers.push(retained);
        stdoutBytes += retained.length;
        if (retained.length < chunk.length) stdoutTruncated = true;
      } else {
        if (retained.length > 0) stderrBuffers.push(retained);
        stderrBytes += retained.length;
        if (retained.length < chunk.length) stderrTruncated = true;
      }
      if (retained.length < chunk.length) {
        outputLimitExceeded = true;
        terminateProcessGroup(child);
      }
    };

    const finish = (exitCode: number | null, exitSignal: NodeJS.Signals | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      terminateProcessGroup(child);
      resolve({
        exitCode,
        signal: exitSignal,
        timedOut,
        cancelled,
        outputLimitExceeded,
        stdout: redact(safeUtf8(stdoutBuffers, resources.maxOutputBytes)),
        stderr: redact(safeUtf8(stderrBuffers, resources.maxOutputBytes)),
        stdoutTruncated,
        stderrTruncated,
        stdoutBytes,
        stderrBytes,
        spawnFailed,
      });
    };

    child.stdout?.on('data', (chunk: Buffer) => capture('stdout', chunk));
    child.stderr?.on('data', (chunk: Buffer) => capture('stderr', chunk));
    signal?.addEventListener('abort', onAbort, { once: true });
    if (cancelled) terminateProcessGroup(child);
    child.once('error', () => {
      spawnFailed = true;
      finish(null, null);
    });
    child.once('close', (code, exitSignal) => finish(code, exitSignal));
  });
}

function outcomeCode(outcome: ProcessOutcome): ToolErrorCode | 'OK' {
  if (outcome.cancelled) return 'COMMAND_CANCELLED';
  if (outcome.timedOut) return 'COMMAND_TIMEOUT';
  if (outcome.outputLimitExceeded) return 'COMMAND_OUTPUT_LIMIT';
  if (outcome.spawnFailed) return 'INTERNAL_ERROR';
  if (outcome.exitCode !== 0) return 'COMMAND_FAILED';
  return 'OK';
}

class AdmissionError extends Error {
  readonly code: 'COMMAND_CANCELLED' | 'COMMAND_RESOURCE_LIMIT';

  constructor(code: 'COMMAND_CANCELLED' | 'COMMAND_RESOURCE_LIMIT') {
    super(code);
    this.code = code;
  }
}

function createAdmission(resources: RequiredResources) {
  let active = 0;
  interface Waiter {
    resolve: () => void;
    reject: (error: AdmissionError) => void;
    signal?: AbortSignal;
    timer: NodeJS.Timeout;
    onAbort: () => void;
  }
  const queue: Waiter[] = [];

  const remove = (waiter: Waiter): void => {
    const index = queue.indexOf(waiter);
    if (index >= 0) queue.splice(index, 1);
    clearTimeout(waiter.timer);
    waiter.signal?.removeEventListener('abort', waiter.onAbort);
  };
  const reject = (waiter: Waiter, code: AdmissionError['code']): void => {
    remove(waiter);
    waiter.reject(new AdmissionError(code));
  };
  const dispatch = (): void => {
    while (active < resources.maxConcurrent && queue.length > 0) {
      const waiter = queue.shift();
      if (waiter === undefined) return;
      remove(waiter);
      if (waiter.signal?.aborted === true) {
        waiter.reject(new AdmissionError('COMMAND_CANCELLED'));
        continue;
      }
      waiter.resolve();
    }
  };
  const release = (): void => {
    active = Math.max(0, active - 1);
    dispatch();
  };

  return {
    acquire(signal?: AbortSignal): Promise<() => void> {
      if (signal?.aborted === true) return Promise.reject(new AdmissionError('COMMAND_CANCELLED'));
      if (active < resources.maxConcurrent) {
        active += 1;
        return Promise.resolve(release);
      }
      if (queue.length >= resources.maxQueue) {
        return Promise.reject(new AdmissionError('COMMAND_RESOURCE_LIMIT'));
      }
      return new Promise<() => void>((resolve, rejectPromise) => {
        const waiter: Waiter = {
          resolve: () => {
            active += 1;
            resolve(release);
          },
          reject: rejectPromise,
          signal,
          timer: setTimeout(() => reject(waiter, 'COMMAND_RESOURCE_LIMIT'), resources.maxQueueWaitMs),
          onAbort: () => reject(waiter, 'COMMAND_CANCELLED'),
        };
        queue.push(waiter);
        signal?.addEventListener('abort', waiter.onAbort, { once: true });
      });
    },
  };
}

export function createSecureCommandTool(options: SecureCommandToolOptions): Tool {
  validateAllowlist(options.allowlist);
  if (typeof options.auditSink?.append !== 'function') throw new TypeError('auditSink.append 必须是函数');
  const resources = normalizeResources(options.resources);
  const redact = createRedactor(options.sensitiveValues ?? []);
  const clock = options.clock ?? (() => new Date());
  const idGenerator = options.idGenerator ?? randomUUID;
  const now = options.monotonicClock ?? (() => performance.now());
  const admission = createAdmission(resources);
  const spawnImplementation = options.spawnImplementation ?? spawn;

  const auditRecord = (
    input: CommandInput,
    operationId: string,
    phase: CommandAuditRecord['phase'],
    rule: CommandAllowRule | null,
    status: CommandAuditRecord['status'],
    resultCode: string,
    started: number,
    overrides: Partial<CommandAuditRecord> = {},
  ): CommandAuditRecord => ({
    schemaVersion: 1,
    timestamp: clock().toISOString(),
    operationId,
    phase,
    tool: 'secure_command',
    ruleId: rule?.id ?? null,
    decision: rule === null ? 'denied' : 'allowed',
    status,
    resultCode,
    executable: redact(input.executable),
    argv: input.args.map(redact),
    argvSha256: createHash('sha256').update(JSON.stringify(input.args)).digest('hex'),
    durationMs: elapsed(started, now),
    exitCode: null,
    signal: null,
    resource: {
      timeoutMs: input.timeoutMs,
      maxOutputBytes: resources.maxOutputBytes,
      stdoutBytes: 0,
      stderrBytes: 0,
      outputTruncated: false,
      queueWaitMs: 0,
      cleanedUp: true,
    },
    ...overrides,
  });

  const auditFailure = (phase: 'decision' | 'completion'): ToolResult => toolError(
    'AUDIT_WRITE_FAILED',
    phase === 'decision'
      ? '审计写入失败；fail-closed 策略已阻止命令启动'
      : '完成审计写入失败；已发生的执行不可回滚，结果按失败处理',
    false,
  );

  return {
    name: 'secure_command',
    description: '精确 executable+argv 白名单命令执行；shell:false；有界超时、输出、并发/队列；JSONL 可注入审计，审计失败默认拒绝启动。',
    parameters: {
      type: 'object',
      required: ['executable', 'args'],
      additionalProperties: false,
      properties: {
        executable: { type: 'string', description: '绝对可执行文件路径；不会经过 shell 或 PATH 搜索' },
        args: { type: 'array', items: { type: 'string' }, description: '完整字面 argv；与白名单逐项精确匹配' },
        timeoutMs: { type: 'integer', minimum: 1, maximum: resources.maxTimeoutMs },
      },
    },
    async execute(args: unknown, context: ToolContext): Promise<ToolResult> {
      const started = now();
      const operationId = idGenerator();
      let input: CommandInput;
      try {
        input = parseInput(args, resources);
      } catch {
        return toolError('INVALID_ARGUMENTS', '需要绝对 executable、无 NUL 字符串 args 和配置范围内的 timeoutMs；不接受 shell 字符串', false);
      }

      let executable: string | null = null;
      try {
        executable = await realpath(input.executable);
      } catch {
        // 不存在或不可读的路径按未允许处理，不进入 spawn。
      }
      let matched: CommandAllowRule | null = null;
      if (executable !== null) {
        for (const rule of options.allowlist) {
          try {
            const allowedExecutable = await realpath(rule.executable);
            if (
              allowedExecutable === executable
              && rule.args.length === input.args.length
              && rule.args.every((arg, index) => arg === input.args[index])
            ) {
              matched = rule;
              break;
            }
          } catch {
            // 失效规则保持拒绝。
          }
        }
      }

      if (matched === null) {
        const record = auditRecord(
          input, operationId, 'decision', null, 'denied', 'COMMAND_NOT_ALLOWED', started,
        );
        try {
          await options.auditSink.append(record);
        } catch {
          return auditFailure('decision');
        }
        const completion = auditRecord(
          input, operationId, 'completion', null, 'denied', 'COMMAND_NOT_ALLOWED', started,
        );
        try {
          await options.auditSink.append(completion);
        } catch {
          return toolError('AUDIT_WRITE_FAILED', '拒绝决策的完成审计写入失败；命令未启动', false);
        }
        return toolError('COMMAND_NOT_ALLOWED', '命令不在精确 executable+argv 白名单内；未创建沙箱或子进程', false);
      }

      const decision = auditRecord(
        input, operationId, 'decision', matched, 'pending', 'SPAWN_PENDING', started,
        { resource: {
          timeoutMs: input.timeoutMs,
          maxOutputBytes: resources.maxOutputBytes,
          stdoutBytes: 0,
          stderrBytes: 0,
          outputTruncated: false,
          queueWaitMs: 0,
          cleanedUp: false,
        } },
      );
      try {
        await options.auditSink.append(decision);
      } catch {
        return auditFailure('decision');
      }

      let release: (() => void) | null = null;
      let queueWaitMs = 0;
      let run: AdmittedRun | null = null;
      let admissionError: AdmissionError | null = null;
      const queueStarted = now();
      try {
        release = await admission.acquire(context.signal);
        queueWaitMs = elapsed(queueStarted, now);
        if (context.signal?.aborted === true) throw new AdmissionError('COMMAND_CANCELLED');
        const sandboxRoot = await mkdtemp(join(context.workspaceRoot, '.d044-secure-'));
        let cleanedUp = false;
        let outcome: ProcessOutcome;
        try {
          outcome = await runProcess(
            executable as string, input, sandboxRoot, resources, redact, spawnImplementation, context.signal,
          );
        } finally {
          try {
            await rm(sandboxRoot, { recursive: true, force: true });
            cleanedUp = true;
          } catch {
            cleanedUp = false;
          }
        }
        run = { outcome, sandboxRoot, cleanedUp };
      } catch (error) {
        if (error instanceof AdmissionError) admissionError = error;
        else if (context.signal?.aborted === true) admissionError = new AdmissionError('COMMAND_CANCELLED');
      } finally {
        release?.();
      }

      const outcome = run?.outcome;
      const processCode = outcome === undefined ? 'INTERNAL_ERROR' : outcomeCode(outcome);
      const resultCode = outcome === undefined
        ? admissionError?.code ?? 'INTERNAL_ERROR'
        : run?.cleanedUp === false && processCode === 'OK' ? 'INTERNAL_ERROR' : processCode;
      const completion = auditRecord(
        input,
        operationId,
        'completion',
        matched,
        resultCode === 'OK' ? 'succeeded' : 'failed',
        resultCode,
        started,
        {
          executable: redact(executable ?? input.executable),
          exitCode: outcome?.exitCode ?? null,
          signal: outcome?.signal ?? null,
          resource: {
            timeoutMs: input.timeoutMs,
            maxOutputBytes: resources.maxOutputBytes,
            stdoutBytes: outcome?.stdoutBytes ?? 0,
            stderrBytes: outcome?.stderrBytes ?? 0,
            outputTruncated: outcome?.stdoutTruncated === true || outcome?.stderrTruncated === true,
            queueWaitMs,
            cleanedUp: run?.cleanedUp ?? true,
          },
        },
      );
      try {
        await options.auditSink.append(completion);
      } catch {
        return auditFailure('completion');
      }

      if (outcome === undefined) {
        return toolError(resultCode as ToolErrorCode, resultCode === 'COMMAND_CANCELLED' ? '调用已取消，未执行或已终止' : '并发或队列预算不足，命令未启动', false);
      }
      const payload: SecureCommandResult = {
        operationId,
        ruleId: matched.id,
        executable: redact(executable ?? input.executable),
        args: input.args.map(redact),
        sandboxRoot: run?.sandboxRoot ?? '',
        exitCode: outcome.exitCode,
        signal: outcome.signal,
        timedOut: outcome.timedOut,
        cancelled: outcome.cancelled,
        outputLimitExceeded: outcome.outputLimitExceeded,
        stdout: outcome.stdout,
        stderr: outcome.stderr,
        stdoutTruncated: outcome.stdoutTruncated,
        stderrTruncated: outcome.stderrTruncated,
        stdoutBytes: outcome.stdoutBytes,
        stderrBytes: outcome.stderrBytes,
        cleanedUp: run?.cleanedUp ?? false,
      };
      const content = JSON.stringify(payload);
      return resultCode === 'OK'
        ? { content }
        : { content, isError: true, error: { code: resultCode, message: content, retryable: false } };
    },
  };
}
