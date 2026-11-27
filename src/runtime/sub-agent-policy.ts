import type { SubAgentSpec } from './sub-agent.ts';

export interface SubAgentPolicy {
  readonly maxDepth: number;
  readonly maxChildren: number;
  readonly maxBudget: number;
}

export function validateSubAgentPolicy(spec: SubAgentSpec, policy: SubAgentPolicy, childCount: number): void {
  if (spec.depth > policy.maxDepth) throw new Error('子 Agent 超过最大派生深度');
  if (childCount > policy.maxChildren) throw new Error('子 Agent 超过最大数量');
  if (spec.budget > policy.maxBudget) throw new Error('子 Agent 超过资源预算');
}
