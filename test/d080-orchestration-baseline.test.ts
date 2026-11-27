import { describe, expect, it } from 'vitest';

import { IdempotencyStore } from '../src/runtime/idempotency.ts';
import { RunStore } from '../src/runtime/run-store.ts';
import { TaskQueue } from '../src/runtime/task-queue.ts';

describe('D080 任务编排阶段基线', () => {
  it('队列、运行记录和幂等记录形成一致的最小链路', () => {
    const queue = new TaskQueue();
    queue.enqueue('task', {});
    expect(queue.claim()?.status).toBe('running');
    const runs = new RunStore();
    runs.start('run', 'task');
    runs.append('run', 'claimed');
    const idempotency = new IdempotencyStore<string>();
    idempotency.begin('call');
    idempotency.complete('call', 'ok');
    expect(runs.get('run')?.events).toEqual(['claimed']);
    expect(idempotency.get('call')?.result).toBe('ok');
  });
});
