import { createTaskPlan, updatePlanStep } from '../src/runtime/task-plan.ts';

const initial = createTaskPlan('g3', ['建立计划', '执行步骤', '验证结果']);
const running = updatePlanStep(initial, 'g3-1', 'running');
const completed = updatePlanStep(running, 'g3-1', 'completed');
process.stdout.write(`${JSON.stringify(completed, null, 2)}\n`);
if (completed.steps[0]?.status !== 'completed' || completed.steps[0].attempts !== 2) {
  process.stderr.write('D065 TASK PLAN FAIL\n'); process.exitCode = 1;
} else process.stdout.write('D065 TASK PLAN PASS\n');
