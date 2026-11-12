import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  ChatRequest,
  ChatResult,
  ModelProvider,
} from '../src/adapters/model/provider.ts';
import { ToolError, type Tool, type ToolContext, type ToolResult } from '../src/core/tool.ts';
import {
  runAgentLoop,
  ToolRegistry,
  type ToolRegistrationOptions,
  type ToolResilienceOptions,
} from '../src/index.ts';

function withResilience(resilience: ToolResilienceOptions): ToolRegistrationOptions {
  return { resilience };
}

function makeTool(
  execute: Tool['execute'],
  name = 'test_tool',
): Tool {
  return {
    name,
    description: `${name} 测试工具`,
    parameters: { type: 'object', properties: {} },
    execute,
  };
}

function call(name = 'test_tool', id = 'call-1') {
  return { id, name, arguments: '{}' };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('D030 每次尝试超时与外部取消', () => {
  it('超时中止本次尝试的 signal，并返回标准 TOOL_TIMEOUT 而不是迟到成功', async () => {
    vi.useFakeTimers();
    let attemptSignal: AbortSignal | undefined;
    const registry = new ToolRegistry();
    registry.register(makeTool((_args, context: ToolContext) => {
      attemptSignal = context.signal;
      return new Promise<ToolResult>((resolve) => {
        setTimeout(() => resolve({ content: 'late success' }), 100);
      });
    }), withResilience({ timeoutMs: 50 }));

    const running = registry.execute(call(), { workspaceRoot: '.' });
    await vi.advanceTimersByTimeAsync(100);
    const result = await running;

    expect(result).toMatchObject({
      isError: true,
      error: { code: 'TOOL_TIMEOUT', retryable: true },
    });
    expect(result.content).not.toContain('late success');
    expect(attemptSignal?.aborted).toBe(true);
  });

  it('外部 AbortSignal 优先于超时，保留 reason 并立即结束忽略 signal 的等待', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const reason = new Error('caller stopped');
    let attemptSignal: AbortSignal | undefined;
    const registry = new ToolRegistry();
    registry.register(makeTool((_args, context: ToolContext) => {
      attemptSignal = context.signal;
      return new Promise<ToolResult>((resolve) => {
        setTimeout(() => resolve({ content: 'ignored cancellation' }), 100);
      });
    }), withResilience({ timeoutMs: 50 }));

    const running = registry.execute(call(), {
      workspaceRoot: '.',
      signal: controller.signal,
    });
    await vi.advanceTimersByTimeAsync(20);
    controller.abort(reason);
    await vi.advanceTimersByTimeAsync(100);
    const result = await running;

    expect(result).toMatchObject({
      isError: true,
      error: { code: 'TOOL_CANCELLED', retryable: false },
    });
    expect(result.content).not.toContain('caller stopped');
    expect(attemptSignal?.aborted).toBe(true);
    expect(attemptSignal?.reason).toBe(reason);
  });

  it('预先取消时不会调用工具', async () => {
    const controller = new AbortController();
    controller.abort();
    const execute = vi.fn(() => Promise.resolve({ content: 'should not run' }));
    const registry = new ToolRegistry();
    registry.register(makeTool(execute), withResilience({ timeoutMs: 50 }));

    const result = await registry.execute(call(), {
      workspaceRoot: '.',
      signal: controller.signal,
    });

    expect(result.error?.code).toBe('TOOL_CANCELLED');
    expect(execute).not.toHaveBeenCalled();
  });

  it('超时后迟到的 rejection 被消费，不会成为未处理 rejection', async () => {
    vi.useFakeTimers();
    const registry = new ToolRegistry();
    registry.register(makeTool(() => new Promise<ToolResult>((_resolve, reject) => {
      setTimeout(() => reject(new Error('late failure')), 100);
    })), withResilience({ timeoutMs: 50 }));

    const running = registry.execute(call(), { workspaceRoot: '.' });
    await vi.advanceTimersByTimeAsync(100);
    const result = await running;
    await Promise.resolve();

    expect(result.error?.code).toBe('TOOL_TIMEOUT');
    expect(result.content).not.toContain('late failure');
  });

  it('没有 resilience 配置时保持 D029 的 signal 身份和原结果对象', async () => {
    const controller = new AbortController();
    const expected = { content: 'unchanged' };
    let receivedSignal: AbortSignal | undefined;
    const registry = new ToolRegistry();
    registry.register(makeTool((_args, context) => {
      receivedSignal = context.signal;
      return Promise.resolve(expected);
    }));

    const result = await registry.execute(call(), {
      workspaceRoot: '.',
      signal: controller.signal,
    });

    expect(result).toBe(expected);
    expect(receivedSignal).toBe(controller.signal);
  });
});

describe('D030 安全重试', () => {
  it('maxRetries 默认为 0，即使工具声明幂等也不自动重试', async () => {
    let attempts = 0;
    const registry = new ToolRegistry();
    registry.register(makeTool(() => {
      attempts += 1;
      return Promise.resolve({
        content: 'failed',
        isError: true,
        error: { code: 'COMMAND_FAILED', message: 'failed', retryable: true },
      });
    }), withResilience({ retry: { idempotent: true } }));

    const result = await registry.execute(call(), { workspaceRoot: '.' });

    expect(attempts).toBe(1);
    expect(result.error?.code).toBe('COMMAND_FAILED');
  });

  it('幂等工具只重试明确 retryable 的故障，并使用指数退避', async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const registry = new ToolRegistry();
    registry.register(makeTool(() => {
      attempts += 1;
      return Promise.resolve(attempts < 3
        ? {
            content: 'temporary',
            isError: true,
            error: { code: 'COMMAND_FAILED', message: 'temporary', retryable: true },
          }
        : { content: 'recovered' });
    }), withResilience({
      retry: { maxRetries: 2, baseDelayMs: 10, idempotent: true },
    }));

    const running = registry.execute(call(), { workspaceRoot: '.' });
    await vi.advanceTimersByTimeAsync(0);
    expect(attempts).toBe(1);
    await vi.advanceTimersByTimeAsync(9);
    expect(attempts).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(attempts).toBe(2);
    await vi.advanceTimersByTimeAsync(19);
    expect(attempts).toBe(2);
    await vi.advanceTimersByTimeAsync(1);

    expect(await running).toEqual({ content: 'recovered' });
    expect(attempts).toBe(3);
  });

  it('非幂等工具默认不重试，只有 allowNonIdempotent 显式 opt-in 才重试', async () => {
    let safeAttempts = 0;
    const safe = new ToolRegistry();
    safe.register(makeTool(() => {
      safeAttempts += 1;
      return Promise.resolve({
        content: 'failed',
        isError: true,
        error: { code: 'COMMAND_FAILED', message: 'failed', retryable: true },
      });
    }), withResilience({ retry: { maxRetries: 3, baseDelayMs: 0 } }));
    await safe.execute(call(), { workspaceRoot: '.' });
    expect(safeAttempts).toBe(1);

    let optedInAttempts = 0;
    const optedIn = new ToolRegistry();
    optedIn.register(makeTool(() => {
      optedInAttempts += 1;
      return Promise.resolve(optedInAttempts === 1
        ? {
            content: 'failed',
            isError: true,
            error: { code: 'COMMAND_FAILED', message: 'failed', retryable: true },
          }
        : { content: 'recovered' });
    }), withResilience({
      retry: { maxRetries: 1, baseDelayMs: 0, allowNonIdempotent: true },
    }));

    expect(await optedIn.execute(call(), { workspaceRoot: '.' })).toEqual({ content: 'recovered' });
    expect(optedInAttempts).toBe(2);
  });

  it.each([
    'INVALID_JSON',
    'INVALID_ARGUMENTS',
    'PATH_OUTSIDE_WORKSPACE',
    'TOOL_NOT_ALLOWED',
    'TOOL_CONFIRMATION_REQUIRED',
    'TOOL_CONFIRMATION_FAILED',
  ] as const)('%s 即使被错误标成 retryable 也绝不重试', async (code) => {
    let attempts = 0;
    const registry = new ToolRegistry();
    registry.register(makeTool(() => {
      attempts += 1;
      return Promise.resolve({
        content: code,
        isError: true,
        error: { code, message: code, retryable: true },
      });
    }), withResilience({
      retry: { maxRetries: 2, baseDelayMs: 0, idempotent: true },
    }));

    const result = await registry.execute(call(), { workspaceRoot: '.' });

    expect(attempts).toBe(1);
    expect(result.error?.code).toBe(code);
  });

  it('retryable=false 的故障不重试', async () => {
    let attempts = 0;
    const registry = new ToolRegistry();
    registry.register(makeTool(() => {
      attempts += 1;
      return Promise.resolve({
        content: 'permanent',
        isError: true,
        error: { code: 'INTERNAL_ERROR', message: 'permanent', retryable: false },
      });
    }), withResilience({
      retry: { maxRetries: 2, baseDelayMs: 0, idempotent: true },
    }));

    await registry.execute(call(), { workspaceRoot: '.' });
    expect(attempts).toBe(1);
  });

  it('外部取消可以打断指数退避等待，之后不再执行尝试', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let attempts = 0;
    const registry = new ToolRegistry();
    registry.register(makeTool(() => {
      attempts += 1;
      return Promise.resolve({
        content: 'temporary',
        isError: true,
        error: { code: 'COMMAND_FAILED', message: 'temporary', retryable: true },
      });
    }), withResilience({
      retry: { maxRetries: 3, baseDelayMs: 1000, idempotent: true },
    }));

    const running = registry.execute(call(), {
      workspaceRoot: '.',
      signal: controller.signal,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(attempts).toBe(1);
    controller.abort();
    expect((await running).error?.code).toBe('TOOL_CANCELLED');
    await vi.advanceTimersByTimeAsync(5000);
    expect(attempts).toBe(1);
  });

  it('timeoutMs 对每一次重试尝试分别计时', async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const registry = new ToolRegistry();
    registry.register(makeTool(() => {
      attempts += 1;
      return new Promise<ToolResult>((_resolve, reject) => {
        setTimeout(() => reject(new Error('late rejection')), 100);
      });
    }), withResilience({
      timeoutMs: 20,
      retry: { maxRetries: 1, baseDelayMs: 5, idempotent: true },
    }));

    const running = registry.execute(call(), { workspaceRoot: '.' });
    await vi.advanceTimersByTimeAsync(200);
    const result = await running;

    expect(attempts).toBe(2);
    expect(result.error?.code).toBe('TOOL_TIMEOUT');
  });
});

describe('D030 有界限流', () => {
  it('maxQueue 默认 0，并发许可占满时立即拒绝新调用', async () => {
    const first = deferred<ToolResult>();
    let attempts = 0;
    const registry = new ToolRegistry();
    registry.register(makeTool(() => {
      attempts += 1;
      return attempts === 1 ? first.promise : Promise.resolve({ content: 'unexpected second run' });
    }), withResilience({ rateLimit: { maxConcurrent: 1 } }));

    const firstRunning = registry.execute(call('test_tool', 'first'), { workspaceRoot: '.' });
    await Promise.resolve();
    const second = await registry.execute(call('test_tool', 'second'), { workspaceRoot: '.' });

    expect(second.error?.code).toBe('TOOL_RATE_LIMITED');
    expect(attempts).toBe(1);
    first.resolve({ content: 'first done' });
    expect(await firstRunning).toEqual({ content: 'first done' });
  });

  it('排队长度有上限，队列满时拒绝而不形成无限队列', async () => {
    const first = deferred<ToolResult>();
    let attempts = 0;
    const registry = new ToolRegistry();
    registry.register(makeTool(() => {
      attempts += 1;
      return attempts === 1 ? first.promise : Promise.resolve({ content: `run ${attempts}` });
    }), withResilience({
      rateLimit: { maxConcurrent: 1, maxQueue: 1, maxWaitMs: 100 },
    }));

    const firstRunning = registry.execute(call('test_tool', 'first'), { workspaceRoot: '.' });
    const queued = registry.execute(call('test_tool', 'queued'), { workspaceRoot: '.' });
    await Promise.resolve();
    await Promise.resolve();
    const overflow = await registry.execute(call('test_tool', 'overflow'), { workspaceRoot: '.' });

    expect(overflow.error?.code).toBe('TOOL_RATE_LIMITED');
    expect(attempts).toBe(1);
    first.resolve({ content: 'first done' });
    expect(await queued).toEqual({ content: 'run 2' });
    expect(await firstRunning).toEqual({ content: 'first done' });
  });

  it('排队等待超过 maxWaitMs 会拒绝并移除等待者', async () => {
    vi.useFakeTimers();
    const first = deferred<ToolResult>();
    let attempts = 0;
    const registry = new ToolRegistry();
    registry.register(makeTool(() => {
      attempts += 1;
      return attempts === 1 ? first.promise : Promise.resolve({ content: 'late permit' });
    }), withResilience({
      rateLimit: { maxConcurrent: 1, maxQueue: 1, maxWaitMs: 25 },
    }));

    const firstRunning = registry.execute(call('test_tool', 'first'), { workspaceRoot: '.' });
    const queued = registry.execute(call('test_tool', 'queued'), { workspaceRoot: '.' });
    await vi.advanceTimersByTimeAsync(25);
    const result = await queued;

    expect(result.error?.code).toBe('TOOL_RATE_LIMITED');
    expect(result.content).toContain('25ms');
    expect(attempts).toBe(1);
    first.resolve({ content: 'first done' });
    expect(await firstRunning).toEqual({ content: 'first done' });
  });

  it('外部取消会移除排队者，许可随后授予仍存活的等待者', async () => {
    const first = deferred<ToolResult>();
    const controller = new AbortController();
    let attempts = 0;
    const registry = new ToolRegistry();
    registry.register(makeTool(() => {
      attempts += 1;
      return attempts === 1 ? first.promise : Promise.resolve({ content: `run ${attempts}` });
    }), withResilience({
      rateLimit: { maxConcurrent: 1, maxQueue: 2, maxWaitMs: 1000 },
    }));

    const firstRunning = registry.execute(call('test_tool', 'first'), { workspaceRoot: '.' });
    const cancelled = registry.execute(call('test_tool', 'cancelled'), {
      workspaceRoot: '.',
      signal: controller.signal,
    });
    const survivor = registry.execute(call('test_tool', 'survivor'), { workspaceRoot: '.' });
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();
    expect((await cancelled).error?.code).toBe('TOOL_CANCELLED');
    first.resolve({ content: 'first done' });

    expect(await survivor).toEqual({ content: 'run 2' });
    expect(await firstRunning).toEqual({ content: 'first done' });
    expect(attempts).toBe(2);
  });

  it('限流状态按 Registry 中的工具实例隔离', async () => {
    const slow = deferred<ToolResult>();
    const registry = new ToolRegistry();
    registry.register(makeTool(() => slow.promise, 'slow_tool'), withResilience({
      rateLimit: { maxConcurrent: 1 },
    }));
    registry.register(makeTool(() => Promise.resolve({ content: 'fast done' }), 'fast_tool'), withResilience({
      rateLimit: { maxConcurrent: 1 },
    }));

    const slowRunning = registry.execute(call('slow_tool', 'slow'), { workspaceRoot: '.' });
    await Promise.resolve();
    expect(await registry.execute(call('fast_tool', 'fast'), { workspaceRoot: '.' }))
      .toEqual({ content: 'fast done' });
    slow.resolve({ content: 'slow done' });
    expect(await slowRunning).toEqual({ content: 'slow done' });
  });
});

describe('D030 熔断与 half-open', () => {
  it('连续失败达到阈值后打开，冷却结束由成功探针关闭', async () => {
    vi.useFakeTimers();
    let attempts = 0;
    let shouldFail = true;
    const registry = new ToolRegistry();
    registry.register(makeTool(() => {
      attempts += 1;
      return Promise.resolve(shouldFail
        ? {
            content: 'failed',
            isError: true,
            error: { code: 'COMMAND_FAILED', message: 'failed', retryable: true },
          }
        : { content: 'healthy' });
    }), withResilience({ circuitBreaker: { failureThreshold: 2, cooldownMs: 100 } }));

    expect((await registry.execute(call('test_tool', 'first'), { workspaceRoot: '.' })).error?.code)
      .toBe('COMMAND_FAILED');
    expect((await registry.execute(call('test_tool', 'second'), { workspaceRoot: '.' })).error?.code)
      .toBe('COMMAND_FAILED');
    expect((await registry.execute(call('test_tool', 'open'), { workspaceRoot: '.' })).error?.code)
      .toBe('TOOL_CIRCUIT_OPEN');
    expect(attempts).toBe(2);

    await vi.advanceTimersByTimeAsync(99);
    expect((await registry.execute(call('test_tool', 'still-open'), { workspaceRoot: '.' })).error?.code)
      .toBe('TOOL_CIRCUIT_OPEN');
    expect(attempts).toBe(2);

    await vi.advanceTimersByTimeAsync(1);
    shouldFail = false;
    expect(await registry.execute(call('test_tool', 'probe'), { workspaceRoot: '.' }))
      .toEqual({ content: 'healthy' });
    expect(await registry.execute(call('test_tool', 'closed'), { workspaceRoot: '.' }))
      .toEqual({ content: 'healthy' });
    expect(attempts).toBe(4);
  });

  it('half-open 探针失败会重开并重新开始冷却', async () => {
    vi.useFakeTimers();
    let attempts = 0;
    let shouldFail = true;
    const registry = new ToolRegistry();
    registry.register(makeTool(() => {
      attempts += 1;
      return Promise.resolve(shouldFail
        ? {
            content: 'failed',
            isError: true,
            error: { code: 'COMMAND_FAILED', message: 'failed', retryable: true },
          }
        : { content: 'healthy' });
    }), withResilience({ circuitBreaker: { failureThreshold: 1, cooldownMs: 50 } }));

    await registry.execute(call('test_tool', 'first'), { workspaceRoot: '.' });
    await vi.advanceTimersByTimeAsync(50);
    expect((await registry.execute(call('test_tool', 'failed-probe'), { workspaceRoot: '.' })).error?.code)
      .toBe('COMMAND_FAILED');
    expect(attempts).toBe(2);
    expect((await registry.execute(call('test_tool', 'reopened'), { workspaceRoot: '.' })).error?.code)
      .toBe('TOOL_CIRCUIT_OPEN');
    expect(attempts).toBe(2);

    await vi.advanceTimersByTimeAsync(49);
    expect((await registry.execute(call('test_tool', 'not-yet'), { workspaceRoot: '.' })).error?.code)
      .toBe('TOOL_CIRCUIT_OPEN');
    await vi.advanceTimersByTimeAsync(1);
    shouldFail = false;
    expect(await registry.execute(call('test_tool', 'next-probe'), { workspaceRoot: '.' }))
      .toEqual({ content: 'healthy' });
    expect(attempts).toBe(3);
  });

  it('half-open 同时只允许一个探针，其他调用快速失败', async () => {
    vi.useFakeTimers();
    const probe = deferred<ToolResult>();
    let attempts = 0;
    const registry = new ToolRegistry();
    registry.register(makeTool(() => {
      attempts += 1;
      if (attempts === 1) {
        return Promise.resolve({
          content: 'failed',
          isError: true,
          error: { code: 'COMMAND_FAILED', message: 'failed', retryable: true },
        });
      }
      return attempts === 2 ? probe.promise : Promise.resolve({ content: 'healthy' });
    }), withResilience({ circuitBreaker: { failureThreshold: 1, cooldownMs: 50 } }));

    await registry.execute(call('test_tool', 'first'), { workspaceRoot: '.' });
    await vi.advanceTimersByTimeAsync(50);
    const probing = registry.execute(call('test_tool', 'probe'), { workspaceRoot: '.' });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    const concurrent = await registry.execute(call('test_tool', 'concurrent'), { workspaceRoot: '.' });

    expect(concurrent.error?.code).toBe('TOOL_CIRCUIT_OPEN');
    expect(attempts).toBe(2);
    probe.resolve({ content: 'probe healthy' });
    expect(await probing).toEqual({ content: 'probe healthy' });
    expect(await registry.execute(call('test_tool', 'closed'), { workspaceRoot: '.' }))
      .toEqual({ content: 'healthy' });
    expect(attempts).toBe(3);
  });

  it.each([
    'INVALID_ARGUMENTS',
    'PATH_OUTSIDE_WORKSPACE',
    'TOOL_NOT_ALLOWED',
    'TOOL_CONFIRMATION_FAILED',
  ] as const)('%s 即使 retryable=true 也不计入熔断失败', async (code) => {
    let attempts = 0;
    const registry = new ToolRegistry();
    registry.register(makeTool(() => {
      attempts += 1;
      return Promise.resolve({
        content: code,
        isError: true,
        error: { code, message: code, retryable: true },
      });
    }), withResilience({ circuitBreaker: { failureThreshold: 1, cooldownMs: 50 } }));

    for (let index = 0; index < 3; index += 1) {
      expect((await registry.execute(call('test_tool', `call-${index}`), { workspaceRoot: '.' })).error?.code)
        .toBe(code);
    }
    expect(attempts).toBe(3);
  });

  it('成功会重置 closed 状态的连续失败计数', async () => {
    let attempts = 0;
    const outcomes = ['fail', 'success', 'fail', 'fail', 'success'] as const;
    const registry = new ToolRegistry();
    registry.register(makeTool(() => {
      const outcome = outcomes[attempts];
      attempts += 1;
      return Promise.resolve(outcome === 'success'
        ? { content: 'healthy' }
        : {
            content: 'failed',
            isError: true,
            error: { code: 'COMMAND_FAILED', message: 'failed', retryable: true },
          });
    }), withResilience({ circuitBreaker: { failureThreshold: 2, cooldownMs: 50 } }));

    await registry.execute(call('test_tool', 'failure-1'), { workspaceRoot: '.' });
    await registry.execute(call('test_tool', 'success'), { workspaceRoot: '.' });
    await registry.execute(call('test_tool', 'failure-2'), { workspaceRoot: '.' });
    await registry.execute(call('test_tool', 'failure-3'), { workspaceRoot: '.' });
    const blocked = await registry.execute(call('test_tool', 'blocked'), { workspaceRoot: '.' });

    expect(blocked.error?.code).toBe('TOOL_CIRCUIT_OPEN');
    expect(attempts).toBe(4);
  });

  it('每个逻辑调用只计一次失败，内部重试不会提前烧断工具', async () => {
    let attempts = 0;
    const registry = new ToolRegistry();
    registry.register(makeTool(() => {
      attempts += 1;
      return Promise.resolve({
        content: 'failed',
        isError: true,
        error: { code: 'COMMAND_FAILED', message: 'failed', retryable: true },
      });
    }), withResilience({
      retry: { maxRetries: 2, baseDelayMs: 0, idempotent: true },
      circuitBreaker: { failureThreshold: 2, cooldownMs: 50 },
    }));

    await registry.execute(call('test_tool', 'first'), { workspaceRoot: '.' });
    expect(attempts).toBe(3);
    await registry.execute(call('test_tool', 'second'), { workspaceRoot: '.' });
    expect(attempts).toBe(6);
    const blocked = await registry.execute(call('test_tool', 'blocked'), { workspaceRoot: '.' });

    expect(blocked.error?.code).toBe('TOOL_CIRCUIT_OPEN');
    expect(attempts).toBe(6);
  });
});

describe('D030 执行边界与 Loop 集成', () => {
  it('抛出的 ToolError.retryable 与 ToolResult 使用相同重试语义', async () => {
    let attempts = 0;
    const registry = new ToolRegistry();
    registry.register(makeTool(() => {
      attempts += 1;
      if (attempts === 1) throw new ToolError('COMMAND_FAILED', 'temporary', true);
      return Promise.resolve({ content: 'recovered' });
    }), withResilience({
      retry: { maxRetries: 1, baseDelayMs: 0, idempotent: true },
    }));

    expect(await registry.execute(call(), { workspaceRoot: '.' })).toEqual({ content: 'recovered' });
    expect(attempts).toBe(2);
  });

  it.each([
    ['timeoutMs=0', { timeoutMs: 0 }],
    ['maxRetries=-1', { retry: { maxRetries: -1 } }],
    ['maxConcurrent=0', { rateLimit: { maxConcurrent: 0 } }],
    ['maxQueue=-1', { rateLimit: { maxConcurrent: 1, maxQueue: -1 } }],
    ['maxWaitMs=0', { rateLimit: { maxConcurrent: 1, maxWaitMs: 0 } }],
    ['failureThreshold=0', { circuitBreaker: { failureThreshold: 0, cooldownMs: 1 } }],
    ['cooldownMs=-1', { circuitBreaker: { failureThreshold: 1, cooldownMs: -1 } }],
  ])('%s 的非法配置会在注册时失败且不留下工具', (_label, resilience) => {
    const registry = new ToolRegistry();

    expect(() => registry.register(
      makeTool(() => Promise.resolve({ content: 'unused' })),
      { resilience },
    )).toThrow(TypeError);
    expect(registry.size).toBe(0);
  });

  it('单个工具重试后仍超时不拖垮 Loop，标准错误与健康结果都会回喂', async () => {
    vi.useFakeTimers();
    let brokenAttempts = 0;
    const registry = new ToolRegistry();
    registry.register(makeTool(() => {
      brokenAttempts += 1;
      return new Promise<ToolResult>((_resolve, reject) => {
        setTimeout(() => reject(new Error('late broken rejection')), 100);
      });
    }, 'broken_tool'), withResilience({
      timeoutMs: 10,
      retry: { maxRetries: 1, baseDelayMs: 5, idempotent: true },
    }));
    registry.register(makeTool(() => Promise.resolve({ content: 'healthy done' }), 'healthy_tool'));

    const responses: ChatResult[] = [
      {
        text: 'run both tools',
        model: 'scripted',
        toolCalls: [
          { id: 'broken', name: 'broken_tool', arguments: '{}' },
          { id: 'healthy', name: 'healthy_tool', arguments: '{}' },
        ],
      },
      { text: 'completed', model: 'scripted' },
    ];
    const requests: ChatRequest[] = [];
    let responseIndex = 0;
    const provider: ModelProvider = {
      name: 'scripted',
      chat(request) {
        requests.push({ ...request, messages: [...request.messages] });
        const response = responses[responseIndex];
        responseIndex += 1;
        if (response === undefined) throw new Error('脚本里没有更多响应');
        return Promise.resolve(response);
      },
    };

    const running = runAgentLoop({
      provider,
      registry,
      messages: [{ role: 'user', content: 'test resilience' }],
      maxTurns: 2,
      maxTokens: 128,
      workspaceRoot: '.',
    });
    await vi.advanceTimersByTimeAsync(250);
    const result = await running;

    expect(result.stopReason).toBe('completed');
    expect(result.text).toBe('completed');
    expect(brokenAttempts).toBe(2);
    expect(requests).toHaveLength(2);
    const toolMessages = requests[1]?.messages.filter((message) => message.role === 'tool');
    expect(toolMessages).toHaveLength(2);
    expect(toolMessages?.[0]).toMatchObject({
      role: 'tool',
      toolCallId: 'broken',
      name: 'broken_tool',
    });
    expect(toolMessages?.[0]?.content).toContain('工具单次尝试超过 10ms 超时');
    expect(toolMessages?.[1]).toMatchObject({
      role: 'tool',
      toolCallId: 'healthy',
      name: 'healthy_tool',
      content: 'healthy done',
    });
  });
});
