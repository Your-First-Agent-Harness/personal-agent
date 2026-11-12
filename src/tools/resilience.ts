import type { Tool, ToolContext, ToolResult } from '../core/tool.ts';
import { errorResult, normalizeError, toolError } from './errors.ts';

export interface ToolRetryOptions {
  /** 首次失败之后最多再尝试几次；默认 0 */
  readonly maxRetries?: number;
  /** 第一次重试前等待毫秒数，之后每次翻倍；默认 100 */
  readonly baseDelayMs?: number;
  /** 仅对幂等工具开启自动重试 */
  readonly idempotent?: boolean;
  /** 明确承担非幂等工具重复执行的副作用风险 */
  readonly allowNonIdempotent?: boolean;
}

export interface ToolRateLimitOptions {
  /** 同一 Registry 条目中最多同时执行的逻辑调用数 */
  readonly maxConcurrent: number;
  /** 许可占满时最多排队多少个调用；默认 0，即直接拒绝 */
  readonly maxQueue?: number;
  /** 排队调用最长等待毫秒数；默认 1000 */
  readonly maxWaitMs?: number;
}

export interface ToolCircuitBreakerOptions {
  /** 连续多少个可计数的逻辑调用失败后打开熔断器 */
  readonly failureThreshold: number;
  /** 打开后经过多少毫秒允许一个 half-open 探针 */
  readonly cooldownMs: number;
}

export interface ToolResilienceOptions {
  /** 每一次工具尝试的最长执行时间；省略则不增加 Registry 超时 */
  readonly timeoutMs?: number;
  readonly retry?: ToolRetryOptions;
  readonly rateLimit?: ToolRateLimitOptions;
  readonly circuitBreaker?: ToolCircuitBreakerOptions;
}

const NEVER_RETRY = new Set([
  'INVALID_JSON',
  'INVALID_ARGUMENTS',
  'UNKNOWN_TOOL',
  'TOOL_SCHEMA_INVALID',
  'PATH_OUTSIDE_WORKSPACE',
  'TOOL_NOT_ALLOWED',
  'TOOL_CONFIRMATION_REQUIRED',
  'TOOL_CONFIRMATION_FAILED',
  'COMMAND_CANCELLED',
  'TOOL_CANCELLED',
  'TOOL_RATE_LIMITED',
  'TOOL_CIRCUIT_OPEN',
]);

function cancelledResult(): ToolResult {
  return toolError('TOOL_CANCELLED', '工具调用已被外部取消', false, '请重新发起任务');
}

function rateLimitedResult(message: string): ToolResult {
  return toolError('TOOL_RATE_LIMITED', message, true, '请稍后重试或调低调用并发');
}

interface PermitWaiter {
  readonly grant: () => void;
  readonly reject: (result: ToolResult) => void;
}

function shouldRetry(result: ToolResult): boolean {
  return result.isError === true
    && result.error?.retryable === true
    && !NEVER_RETRY.has(result.error.code);
}

function wait(delayMs: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted === true) return Promise.resolve(false);
  return new Promise((resolve) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve(true);
    }, Math.min(delayMs, 2_147_483_647));
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export class ResilientToolExecutor {
  private readonly timeoutMs?: number;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly retryAllowed: boolean;
  private readonly rateLimit?: Required<ToolRateLimitOptions>;
  private readonly circuitBreaker?: ToolCircuitBreakerOptions;
  private active = 0;
  private readonly queue: PermitWaiter[] = [];
  private consecutiveFailures = 0;
  private openedAt?: number;
  private probeInFlight = false;

  constructor(options: ToolResilienceOptions) {
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('非法 resilience 配置：必须是对象');
    }
    if (
      options.timeoutMs !== undefined
      && (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0)
    ) {
      throw new TypeError('非法 resilience 配置：timeoutMs 必须是正整数');
    }
    if (options.retry !== undefined) {
      if (options.retry === null || typeof options.retry !== 'object' || Array.isArray(options.retry)) {
        throw new TypeError('非法 resilience 配置：retry 必须是对象');
      }
      const { maxRetries = 0, baseDelayMs = 100 } = options.retry;
      if (!Number.isSafeInteger(maxRetries) || maxRetries < 0) {
        throw new TypeError('非法 resilience 配置：retry.maxRetries 必须是非负整数');
      }
      if (!Number.isSafeInteger(baseDelayMs) || baseDelayMs < 0) {
        throw new TypeError('非法 resilience 配置：retry.baseDelayMs 必须是非负整数');
      }
    }
    if (options.rateLimit !== undefined) {
      if (
        options.rateLimit === null
        || typeof options.rateLimit !== 'object'
        || Array.isArray(options.rateLimit)
      ) {
        throw new TypeError('非法 resilience 配置：rateLimit 必须是对象');
      }
      const { maxConcurrent, maxQueue = 0, maxWaitMs = 1000 } = options.rateLimit;
      if (!Number.isSafeInteger(maxConcurrent) || maxConcurrent <= 0) {
        throw new TypeError('非法 resilience 配置：rateLimit.maxConcurrent 必须是正整数');
      }
      if (!Number.isSafeInteger(maxQueue) || maxQueue < 0) {
        throw new TypeError('非法 resilience 配置：rateLimit.maxQueue 必须是非负整数');
      }
      if (!Number.isSafeInteger(maxWaitMs) || maxWaitMs <= 0) {
        throw new TypeError('非法 resilience 配置：rateLimit.maxWaitMs 必须是正整数');
      }
    }
    if (options.circuitBreaker !== undefined) {
      if (
        options.circuitBreaker === null
        || typeof options.circuitBreaker !== 'object'
        || Array.isArray(options.circuitBreaker)
      ) {
        throw new TypeError('非法 resilience 配置：circuitBreaker 必须是对象');
      }
      const { failureThreshold, cooldownMs } = options.circuitBreaker;
      if (!Number.isSafeInteger(failureThreshold) || failureThreshold <= 0) {
        throw new TypeError('非法 resilience 配置：circuitBreaker.failureThreshold 必须是正整数');
      }
      if (!Number.isSafeInteger(cooldownMs) || cooldownMs < 0) {
        throw new TypeError('非法 resilience 配置：circuitBreaker.cooldownMs 必须是非负整数');
      }
    }
    this.timeoutMs = options.timeoutMs;
    this.maxRetries = options.retry?.maxRetries ?? 0;
    this.baseDelayMs = options.retry?.baseDelayMs ?? 100;
    this.retryAllowed = options.retry?.idempotent === true
      || options.retry?.allowNonIdempotent === true;
    this.rateLimit = options.rateLimit === undefined ? undefined : {
      maxConcurrent: options.rateLimit.maxConcurrent,
      maxQueue: options.rateLimit.maxQueue ?? 0,
      maxWaitMs: options.rateLimit.maxWaitMs ?? 1000,
    };
    this.circuitBreaker = options.circuitBreaker;
  }

  async execute(tool: Tool, args: unknown, context: ToolContext): Promise<ToolResult> {
    if (context.signal?.aborted === true) return cancelledResult();
    const earlyCircuitRejection = this.circuitRejection();
    if (earlyCircuitRejection !== undefined) return earlyCircuitRejection;

    const rejection = await this.acquirePermit(context.signal);
    if (rejection !== undefined) return rejection;
    let probing = false;
    try {
      const admission = this.admitCircuitCall();
      if (typeof admission !== 'boolean') return admission;
      probing = admission;
      const result = await this.executeWithRetries(tool, args, context);
      this.completeCircuitCall(result, probing);
      return result;
    } finally {
      if (probing) this.probeInFlight = false;
      this.releasePermit();
    }
  }

  private circuitRejection(): ToolResult | undefined {
    if (this.circuitBreaker === undefined || this.openedAt === undefined) return undefined;
    if (this.probeInFlight) {
      return toolError(
        'TOOL_CIRCUIT_OPEN',
        '工具已有 half-open 探针正在执行，其他调用暂不进入',
        true,
        '请等待探针结果后重试',
      );
    }
    if (Date.now() - this.openedAt < this.circuitBreaker.cooldownMs) {
      return toolError(
        'TOOL_CIRCUIT_OPEN',
        `工具连续失败已熔断，冷却 ${this.circuitBreaker.cooldownMs}ms 内拒绝执行`,
        true,
        '请等待冷却结束后重试',
      );
    }
    return undefined;
  }

  private admitCircuitCall(): boolean | ToolResult {
    const rejection = this.circuitRejection();
    if (rejection !== undefined) return rejection;
    if (this.openedAt === undefined) return false;
    this.probeInFlight = true;
    return true;
  }

  private completeCircuitCall(result: ToolResult, probing: boolean): void {
    if (this.circuitBreaker === undefined) return;
    if (probing) this.probeInFlight = false;
    if (result.isError !== true) {
      if (probing || this.openedAt === undefined) {
        this.consecutiveFailures = 0;
        this.openedAt = undefined;
      }
      return;
    }
    if (!shouldRetry(result)) return;
    if (probing) {
      this.consecutiveFailures = this.circuitBreaker.failureThreshold;
      this.openedAt = Date.now();
      return;
    }
    if (this.openedAt !== undefined) return;
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.circuitBreaker.failureThreshold) {
      this.openedAt = Date.now();
    }
  }

  private async executeWithRetries(
    tool: Tool,
    args: unknown,
    context: ToolContext,
  ): Promise<ToolResult> {
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      if (context.signal?.aborted === true) return cancelledResult();
      const result = await this.executeAttempt(tool, args, context);
      if (
        attempt === this.maxRetries
        || !this.retryAllowed
        || !shouldRetry(result)
      ) {
        return result;
      }
      const delayMs = this.baseDelayMs * 2 ** attempt;
      if (!await wait(delayMs, context.signal)) return cancelledResult();
    }
    throw new Error('unreachable');
  }

  private acquirePermit(signal?: AbortSignal): Promise<ToolResult | undefined> {
    if (signal?.aborted === true) return Promise.resolve(cancelledResult());
    if (this.rateLimit === undefined) return Promise.resolve(undefined);
    if (this.active < this.rateLimit.maxConcurrent) {
      this.active += 1;
      return Promise.resolve(undefined);
    }
    if (this.queue.length >= this.rateLimit.maxQueue) {
      return Promise.resolve(rateLimitedResult(
        `工具并发许可与有界队列均已占满（maxQueue=${this.rateLimit.maxQueue}）`,
      ));
    }

    const maxWaitMs = this.rateLimit.maxWaitMs;
    return new Promise((resolve) => {
      let settled = false;
      const cleanup = (): void => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      };
      const waiter: PermitWaiter = {
        grant: () => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(undefined);
        },
        reject: (result: ToolResult) => {
          if (settled) return;
          settled = true;
          const index = this.queue.indexOf(waiter);
          if (index >= 0) this.queue.splice(index, 1);
          cleanup();
          resolve(result);
        },
      };
      const onAbort = (): void => waiter.reject(cancelledResult());
      const timer = setTimeout(() => {
        waiter.reject(rateLimitedResult(`工具排队等待许可超过 ${maxWaitMs}ms`));
      }, maxWaitMs);
      signal?.addEventListener('abort', onAbort, { once: true });
      this.queue.push(waiter);
    });
  }

  private releasePermit(): void {
    if (this.rateLimit === undefined) return;
    const next = this.queue.shift();
    if (next === undefined) {
      this.active -= 1;
      return;
    }
    next.grant();
  }

  private executeAttempt(tool: Tool, args: unknown, context: ToolContext): Promise<ToolResult> {
    if (context.signal?.aborted === true) return Promise.resolve(cancelledResult());

    return new Promise<ToolResult>((resolve) => {
      const controller = new AbortController();
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (result: ToolResult): void => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        context.signal?.removeEventListener('abort', onExternalAbort);
        resolve(result);
      };
      const onExternalAbort = (): void => {
        controller.abort(context.signal?.reason);
        finish(cancelledResult());
      };

      context.signal?.addEventListener('abort', onExternalAbort, { once: true });
      if (this.timeoutMs !== undefined) {
        timer = setTimeout(() => {
          if (context.signal?.aborted === true) {
            onExternalAbort();
            return;
          }
          controller.abort(new Error('工具执行超时'));
          finish(toolError(
            'TOOL_TIMEOUT',
            `工具单次尝试超过 ${this.timeoutMs}ms 超时`,
            true,
            '请缩短操作、提高 timeoutMs 或稍后重试',
          ));
        }, this.timeoutMs);
      }

      let execution: Promise<ToolResult>;
      try {
        execution = Promise.resolve(tool.execute(args, { ...context, signal: controller.signal }));
      } catch (error) {
        finish(errorResult(normalizeError(error)));
        return;
      }
      void execution.then(finish, (error: unknown) => {
        finish(errorResult(normalizeError(error)));
      });
    });
  }
}
