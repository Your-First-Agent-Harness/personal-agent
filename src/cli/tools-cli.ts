import { createBuiltinTools } from '../tools/builtin.ts';
import { ToolRegistry } from '../tools/registry.ts';

export function discoverTools(): ReturnType<ToolRegistry['discover']> {
  const registry = new ToolRegistry();
  for (const tool of createBuiltinTools()) registry.register(tool);
  return registry.discover();
}

export function runToolsCli(args: readonly string[]): string {
  if (args[0] !== 'list') throw new Error('用法：personal-agent tools list [--json]');
  const tools = discoverTools();
  return args.includes('--json') ? JSON.stringify(tools, null, 2) : tools.map(({ name, version, description }) => `${name}@${version} - ${description}`).join('\n');
}
