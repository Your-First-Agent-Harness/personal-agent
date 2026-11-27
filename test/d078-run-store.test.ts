import { describe, expect, it } from 'vitest';

import { RunStore } from '../src/runtime/run-store.ts';

describe('D078 托管运行记录', () => {
  it('创建、追加事件、完成并查询运行记录', () => {
    const store = new RunStore();
    store.start('run-1', 'task-1');
    store.append('run-1', 'turn_started');
    const result = store.complete('run-1', { ok: true });
    expect(result).toMatchObject({ status: 'completed', events: ['turn_started'], result: { ok: true } });
  });

  it('结束后禁止追加或重复结束，未知记录明确失败', () => {
    const store = new RunStore();
    store.start('run-1', 'task-1');
    store.fail('run-1', 'boom');
    expect(() => store.append('run-1', 'late')).toThrow('已结束');
    expect(() => store.complete('run-1', 'again')).toThrow('已结束');
    expect(() => store.get('missing')).not.toThrow();
    expect(() => store.append('missing', 'x')).toThrow('未知');
  });
});
