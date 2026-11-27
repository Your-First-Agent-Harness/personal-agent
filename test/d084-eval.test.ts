import { describe, expect, it } from 'vitest';

import { evaluateReplay } from '../src/observability/eval.ts';

describe('D084 Replay Eval', () => {
  it('通过完全匹配的回放结果', () => {
    expect(evaluateReplay({ id: 'case-1', expected: ['a', 'b'] }, ['a', 'b'])).toEqual({ id: 'case-1', actual: ['a', 'b'], passed: true, mismatches: [] });
  });

  it('报告长度和步骤差异', () => {
    const result = evaluateReplay({ id: 'case-1', expected: ['a', 'b'] }, ['a', 'x', 'c']);
    expect(result.passed).toBe(false);
    expect(result.mismatches).toEqual(['长度 3 != 2', '步骤 1: x != b', '步骤 2: c != <missing>']);
  });
});
