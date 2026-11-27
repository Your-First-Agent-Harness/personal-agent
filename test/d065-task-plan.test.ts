import { describe, expect, it } from 'vitest';

import { createTaskPlan, updatePlanStep } from '../src/runtime/task-plan.ts';

describe('D065 任务计划与检查点', () => {
  it('创建步骤并记录状态与尝试次数', () => {
    const plan = createTaskPlan('release', ['检查', '构建', '发布']);
    const running = updatePlanStep(plan, 'release-1', 'running');
    const done = updatePlanStep(running, 'release-1', 'completed');
    expect(done.steps[0]).toMatchObject({ id: 'release-1', status: 'completed', attempts: 2 });
    expect(done.steps[1]?.status).toBe('pending');
  });

  it('拒绝空计划和未知步骤', () => {
    expect(() => createTaskPlan('', ['x'])).toThrow('必须有 id');
    expect(() => createTaskPlan('x', [])).toThrow('必须有 id');
    expect(() => updatePlanStep(createTaskPlan('x', ['a']), 'bad', 'running')).toThrow('未知');
  });
});
