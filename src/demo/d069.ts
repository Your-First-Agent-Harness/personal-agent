import { summarizeBenchmark } from '../runtime/benchmark.ts';
import { calculateCost } from '../runtime/cost.ts';
import { decideCostAction } from '../runtime/cost-budget.ts';
import { TaskStateMachine } from '../runtime/task-state.ts';

export interface D069G3Report {
  readonly completionRate: number;
  readonly budgetAction: string;
  readonly maxTurnStatus: string;
  readonly recoveryReady: boolean;
}

export function runD069G3Acceptance(output: (line: string) => void): D069G3Report {
  const benchmark = summarizeBenchmark([
    { turns: 10, completed: true, toolErrors: 0, totalUnits: 10 },
    { turns: 30, completed: true, toolErrors: 1, totalUnits: 20 },
    { turns: 50, completed: true, toolErrors: 1, totalUnits: 30 },
    { turns: 100, completed: true, toolErrors: 2, totalUnits: 40 },
  ]);
  const costAction = decideCostAction(calculateCost([{ kind: 'model', units: 40 }]), 100);
  const state = new TaskStateMachine({ maxTurns: 100 });
  const maxTurnStatus = state.record(100, 'completed').status;
  const report = {
    completionRate: benchmark.completionRate,
    budgetAction: costAction.action,
    maxTurnStatus,
    recoveryReady: true,
  } as const;
  output(`G3 completionRate=${report.completionRate}`);
  output(`G3 budgetAction=${report.budgetAction} maxTurnStatus=${report.maxTurnStatus}`);
  output('G3 仍是组件级验收：真实模型成本下降和真实用户任务留到后续证据收集。');
  if (report.completionRate !== 1 || report.budgetAction !== 'continue' || report.maxTurnStatus !== 'max_turns') {
    throw new Error('D069 G3 acceptance failed');
  }
  output('D069 G3 ACCEPTANCE PASS');
  return report;
}
