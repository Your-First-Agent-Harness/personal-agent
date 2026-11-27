import { describe, expect, it } from 'vitest';

import { aggregateParallelResults, runParallelAgents } from '../src/runtime/parallel-agents.ts';

describe('D075 并行子 Agent 编排', () => {
  it('并行执行独立任务并聚合成功结果', async () => {
    const results = await runParallelAgents([
      { id: 'a', run: () => Promise.resolve('A') },
      { id: 'b', run: () => Promise.resolve('B') },
    ]);
    expect(aggregateParallelResults(results)).toEqual({ succeeded: ['A', 'B'], failed: [] });
  });

  it('单个子 Agent 失败不会吞掉其他成功结果', async () => {
    const results = await runParallelAgents([
      { id: 'ok', run: () => Promise.resolve(1) },
      { id: 'bad', run: () => Promise.reject(new Error('boom')) },
    ]);
    expect(aggregateParallelResults(results)).toEqual({ succeeded: [1], failed: ['bad: boom'] });
  });
});
