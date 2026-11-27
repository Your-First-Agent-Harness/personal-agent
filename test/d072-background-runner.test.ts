import { describe, expect, it } from 'vitest';

import { createBackgroundRunner } from '../src/runtime/background-runner.ts';

describe('D072 后台任务运行', () => {
  it('提交任务、后台执行并查询完成结果', async () => {
    const runner = createBackgroundRunner<{ value: number }, number>();
    expect(runner.submit('1', { value: 2 }).status).toBe('queued');
    const result = await runner.runNext(({ value }) => Promise.resolve(value * 2));
    expect(result).toMatchObject({ id: '1', status: 'completed', result: 4 });
    expect(runner.status('1')?.result).toBe(4);
  });

  it('Worker 失败转为 failed 状态，不抛出到队列外', async () => {
    const runner = createBackgroundRunner<void, void>();
    runner.submit('1', undefined);
    await expect(runner.runNext(() => Promise.reject(new Error('worker failed')))).resolves.toMatchObject({ status: 'failed', error: 'worker failed' });
    expect(await runner.runNext(() => Promise.resolve(undefined))).toBeUndefined();
  });
});
