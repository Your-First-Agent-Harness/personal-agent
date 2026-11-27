import { describe, expect, it } from 'vitest';

import { calculateCost } from '../src/runtime/cost.ts';

describe('D066 成本核算', () => {
  it('按事件类型汇总单位和耗时', () => {
    expect(calculateCost([
      { kind: 'model', units: 100, durationMs: 200 },
      { kind: 'tool', units: 2, durationMs: 50 },
      { kind: 'retry', units: 1 },
      { kind: 'compaction', units: 10, durationMs: 30 },
      { kind: 'wait', units: 0, durationMs: 20 },
    ])).toEqual({
      totalUnits: 113,
      totalDurationMs: 300,
      byKind: { model: 100, tool: 2, retry: 1, compaction: 10, wait: 0 },
    });
  });

  it('拒绝负成本', () => {
    expect(() => calculateCost([{ kind: 'model', units: -1 }])).toThrow('非负数');
  });
});
