import { describe, expect, it } from 'vitest';

import { decideCostAction } from '../src/runtime/cost-budget.ts';
import { calculateCost } from '../src/runtime/cost.ts';

describe('D067 成本预算与降级', () => {
  const report = (units: number) => calculateCost([{ kind: 'model', units }]);

  it('低于阈值继续，接近阈值降级，达到上限停止', () => {
    expect(decideCostAction(report(10), 100).action).toBe('continue');
    expect(decideCostAction(report(80), 100).action).toBe('degrade');
    expect(decideCostAction(report(100), 100).action).toBe('stop');
  });

  it('拒绝非法预算和阈值', () => {
    expect(() => decideCostAction(report(1), 0)).toThrow('正数');
    expect(() => decideCostAction(report(1), 10, 1.1)).toThrow('0 和 1');
  });
});
