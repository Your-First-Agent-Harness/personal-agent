import { describe, expect, it } from 'vitest';

import { summarizeBenchmark } from '../src/runtime/benchmark.ts';

describe('D068 长任务质量基准', () => {
  it('统计完成率和平均成本', () => {
    const summary = summarizeBenchmark([
      { turns: 10, completed: true, toolErrors: 0, totalUnits: 10 },
      { turns: 30, completed: false, toolErrors: 2, totalUnits: 30 },
      { turns: 100, completed: true, toolErrors: 1, totalUnits: 50 },
    ]);
    expect(summary.completionRate).toBeCloseTo(2 / 3);
    expect(summary.averageUnits).toBe(30);
  });

  it('拒绝空 Benchmark', () => {
    expect(() => summarizeBenchmark([])).toThrow('至少需要');
  });
});
