import { describe, expect, it } from 'vitest';

import { TaskQueue } from '../src/runtime/task-queue.ts';

describe('D071 任务队列抽象', () => {
  it('创建、领取、完成和查询任务', () => {
    const queue = new TaskQueue<{ name: string }>();
    expect(queue.enqueue('1', { name: 'build' }).status).toBe('queued');
    expect(queue.claim()).toMatchObject({ id: '1', status: 'running', attempts: 1 });
    expect(queue.complete('1', 'ok')).toMatchObject({ status: 'completed', result: 'ok' });
    expect(queue.get('1')?.status).toBe('completed');
  });

  it('幂等拒绝重复任务，非法状态转换明确失败', () => {
    const queue = new TaskQueue();
    queue.enqueue('1', {});
    expect(() => queue.enqueue('1', {})).toThrow('已存在');
    expect(() => queue.complete('1', 'bad')).toThrow('当前不能');
    expect(() => queue.complete('missing', 'bad')).toThrow('未知任务');
  });

  it('失败任务保留错误原因', () => {
    const queue = new TaskQueue();
    queue.enqueue('1', {});
    queue.claim();
    expect(queue.fail('1', 'worker crashed')).toMatchObject({ status: 'failed', error: 'worker crashed' });
  });
});
