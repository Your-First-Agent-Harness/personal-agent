import { describe, expect, it } from 'vitest';

import { replayTrace } from '../src/observability/replay.ts';

describe('D083 Replay 执行器', () => {
  it('按 trace 顺序确定性执行每一步', async () => {
    const result = await replayTrace([
      { name: 'task', attributes: {} },
      { name: 'tool', attributes: { tool: 'read' } },
    ], (step) => Promise.resolve(`${step.name}:ok`));
    expect(result).toEqual({ steps: ['task:ok', 'tool:ok'], matched: true });
  });

  it('执行器失败会保留失败路径', async () => {
    await expect(replayTrace([{ name: 'task', attributes: {} }], async () => Promise.reject(new Error('replay failed')))).rejects.toThrow('replay failed');
  });
});
