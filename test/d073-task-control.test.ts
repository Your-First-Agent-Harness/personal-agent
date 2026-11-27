import { describe, expect, it } from 'vitest';

import { TaskController } from '../src/runtime/task-control.ts';

describe('D073 任务取消暂停恢复', () => {
  it('支持 start/pause/resume/complete 状态流', () => {
    const controller = new TaskController();
    controller.create('1');
    expect(controller.start('1').status).toBe('running');
    expect(controller.pause('1').status).toBe('paused');
    expect(controller.start('1').status).toBe('running');
    expect(controller.complete('1').status).toBe('completed');
  });

  it('取消优先，完成后的任务不能再次取消', () => {
    const controller = new TaskController();
    controller.create('1');
    expect(controller.cancel('1').status).toBe('cancelled');
    expect(() => controller.start('1')).toThrow('不能');
    expect(() => controller.cancel('missing')).toThrow('未知');
  });
});
