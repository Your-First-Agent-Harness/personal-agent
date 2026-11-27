export type PlanStepStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface PlanStep {
  readonly id: string;
  readonly description: string;
  readonly status: PlanStepStatus;
  readonly attempts: number;
}

export interface TaskPlan {
  readonly id: string;
  readonly steps: readonly PlanStep[];
}

export function createTaskPlan(id: string, descriptions: readonly string[]): TaskPlan {
  if (id.trim() === '' || descriptions.length === 0) throw new Error('任务计划必须有 id 和步骤');
  return { id, steps: descriptions.map((description, index) => ({ id: `${id}-${index + 1}`, description, status: 'pending', attempts: 0 })) };
}

export function updatePlanStep(plan: TaskPlan, stepId: string, status: PlanStepStatus): TaskPlan {
  let found = false;
  const steps = plan.steps.map((step) => {
    if (step.id !== stepId) return step;
    found = true;
    return { ...step, status, attempts: step.attempts + 1 };
  });
  if (!found) throw new Error(`未知计划步骤：${stepId}`);
  return { ...plan, steps };
}
