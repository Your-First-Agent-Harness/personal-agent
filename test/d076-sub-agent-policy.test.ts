import { describe, expect, it } from 'vitest';

import { createSubAgentSpec } from '../src/runtime/sub-agent.ts';
import { validateSubAgentPolicy } from '../src/runtime/sub-agent-policy.ts';

describe('D076 子 Agent 权限和资源隔离', () => {
  const policy = { maxDepth: 2, maxChildren: 3, maxBudget: 100 };

  it('允许策略内的子 Agent', () => {
    const spec = createSubAgentSpec({ id: 'c', parentId: 'p', task: 'x', allowedTools: [], budget: 50, depth: 1 });
    expect(() => validateSubAgentPolicy(spec, policy, 2)).not.toThrow();
  });

  it('拒绝深度、数量和预算越界', () => {
    const checks = [
      [createSubAgentSpec({ id: 'c', parentId: 'p', task: 'x', allowedTools: [], budget: 1, depth: 3 }), 1, '深度'],
      [createSubAgentSpec({ id: 'c', parentId: 'p', task: 'x', allowedTools: [], budget: 1 }), 4, '数量'],
      [createSubAgentSpec({ id: 'c', parentId: 'p', task: 'x', allowedTools: [], budget: 101 }), 1, '预算'],
    ] as const;
    for (const [spec, count, message] of checks) expect(() => validateSubAgentPolicy(spec, policy, count)).toThrow(message);
  });
});
