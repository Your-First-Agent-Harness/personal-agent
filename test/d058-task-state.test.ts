import { describe, expect, it } from 'vitest';

import { TaskStateMachine } from '../src/runtime/task-state.ts';

describe('D058 100 轮任务状态机', () => {
  it('记录进度并在达到最大轮次时停止', () => {
    const machine = new TaskStateMachine({ maxTurns: 3 });
    expect(machine.record(1, 'a').status).toBe('running');
    expect(machine.record(2, 'b').status).toBe('running');
    expect(machine.record(3, 'c').status).toBe('max_turns');
    expect(machine.snapshot()).toHaveLength(3);
  });

  it('连续无进展达到阈值时标记 stalled', () => {
    const machine = new TaskStateMachine({ maxTurns: 100, maxNoProgressTurns: 2 });
    expect(machine.record(1, 'same').status).toBe('running');
    expect(machine.record(2, 'same').status).toBe('running');
    expect(machine.record(3, 'same').status).toBe('stalled');
  });

  it('完成状态优先于轮次限制', () => {
    const machine = new TaskStateMachine({ maxTurns: 1 });
    expect(machine.record(1, 'done', true).status).toBe('completed');
  });
});
