import { describe, expect, it } from 'vitest';

import { runD069G3Acceptance } from '../src/demo/d069.ts';

describe('D069 G3 综合验收', () => {
  it('验证 100 轮状态、成本预算和 Benchmark 汇总', () => {
    const output: string[] = [];
    expect(runD069G3Acceptance((line) => output.push(line))).toEqual({
      completionRate: 1,
      budgetAction: 'continue',
      maxTurnStatus: 'max_turns',
      recoveryReady: true,
    });
    expect(output.at(-1)).toContain('D069 G3 ACCEPTANCE PASS');
  });
});
