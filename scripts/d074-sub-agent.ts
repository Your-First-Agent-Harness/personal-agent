import { canUseSubAgentTool, createSubAgentSpec } from '../src/runtime/sub-agent.ts';

const spec = createSubAgentSpec({ id: 'child-1', parentId: 'task-1', task: '只读检查', allowedTools: ['read_file'], budget: 25, depth: 1 });
process.stdout.write(`${JSON.stringify({ spec, allowed: canUseSubAgentTool(spec, 'read_file'), denied: canUseSubAgentTool(spec, 'edit_file') }, null, 2)}\n`);
if (!canUseSubAgentTool(spec, 'read_file') || canUseSubAgentTool(spec, 'edit_file')) {
  process.stderr.write('D074 SUB AGENT FAIL\n'); process.exitCode = 1;
} else process.stdout.write('D074 SUB AGENT PASS\n');
