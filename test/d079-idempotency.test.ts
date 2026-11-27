import { describe, expect, it } from 'vitest';

import { IdempotencyStore } from '../src/runtime/idempotency.ts';

describe('D079 恢复与幂等', () => {
  it('重复 begin 返回同一运行记录，完成后重复结果短路', () => {
    const store = new IdempotencyStore<string>();
    expect(store.begin('call-1')).toEqual(store.begin('call-1'));
    expect(store.complete('call-1', 'ok')).toEqual(store.complete('call-1', 'new'));
    expect(store.get('call-1')?.result).toBe('ok');
  });

  it('未知副作用状态显式冻结为 unknown', () => {
    const store = new IdempotencyStore();
    expect(store.markUnknown('call-1').status).toBe('unknown');
    expect(store.get('call-1')?.status).toBe('unknown');
  });
});
