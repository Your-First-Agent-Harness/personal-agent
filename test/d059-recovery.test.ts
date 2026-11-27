import { describe, expect, it } from 'vitest';

import { decideRecovery } from '../src/runtime/recovery.ts';

describe('D059 长任务故障恢复', () => {
  it('可恢复错误且未超限时重试', () => {
    expect(decideRecovery({ retryable: true, interrupted: false, attempts: 1, maxAttempts: 3 })).toEqual({
      action: 'retry', reason: '可恢复错误，允许第 2 次尝试',
    });
  });

  it('中断优先进入 resume，而不是重复执行副作用', () => {
    expect(decideRecovery({ retryable: true, interrupted: true, attempts: 1, maxAttempts: 3 }).action).toBe('resume');
  });

  it('不可恢复或超过次数时停止', () => {
    expect(decideRecovery({ retryable: false, interrupted: false, attempts: 1, maxAttempts: 3 }).action).toBe('stop');
    expect(decideRecovery({ retryable: true, interrupted: false, attempts: 3, maxAttempts: 3 }).action).toBe('stop');
  });
});
