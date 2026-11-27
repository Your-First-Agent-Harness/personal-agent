import { createSubAgentSpec } from '../src/runtime/sub-agent.ts';
import { validateSubAgentPolicy } from '../src/runtime/sub-agent-policy.ts';

const spec = createSubAgentSpec({ id: 'child', parentId: 'parent', task: 'bounded', allowedTools: ['read_file'], budget: 50, depth: 1 });
validateSubAgentPolicy(spec, { maxDepth: 2, maxChildren: 3, maxBudget: 100 }, 1);
process.stdout.write(`${JSON.stringify({ spec, policy: { maxDepth: 2, maxChildren: 3, maxBudget: 100 } }, null, 2)}\nD076 SUB AGENT POLICY PASS\n`);
