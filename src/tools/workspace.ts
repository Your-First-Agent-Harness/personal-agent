import { resolve, sep } from 'node:path';

import { ToolError, type ToolContext } from '../core/tool.ts';

/** 路径越狱检查：解析后的绝对路径必须仍在 workspace 内 */
export function resolveInWorkspace(context: ToolContext, input: unknown): string {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new ToolError('INVALID_ARGUMENTS', 'path 必须是非空字符串', true, '请提供工作区内的相对路径');
  }
  const root = resolve(context.workspaceRoot);
  const target = resolve(root, input);
  if (target !== root && !target.startsWith(root + sep)) {
    throw new ToolError(
      'PATH_OUTSIDE_WORKSPACE',
      `路径越出工作区：${input}`,
      true,
      '请改用工作区内的路径',
    );
  }
  return target;
}
