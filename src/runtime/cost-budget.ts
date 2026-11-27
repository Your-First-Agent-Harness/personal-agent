import type { CostReport } from './cost.ts';

export type CostAction = 'continue' | 'degrade' | 'stop';

export interface CostDecision {
  readonly action: CostAction;
  readonly reason: string;
}

export function decideCostAction(report: CostReport, budget: number, degradeAt = 0.8): CostDecision {
  if (!Number.isFinite(budget) || budget <= 0) throw new Error('预算必须是正数');
  if (!Number.isFinite(degradeAt) || degradeAt <= 0 || degradeAt > 1) throw new Error('degradeAt 必须在 0 和 1 之间');
  if (report.totalUnits >= budget) return { action: 'stop', reason: `已达到成本上限 ${budget}` };
  if (report.totalUnits >= budget * degradeAt) return { action: 'degrade', reason: '接近成本上限，启用降级策略' };
  return { action: 'continue', reason: '成本仍在预算内' };
}
