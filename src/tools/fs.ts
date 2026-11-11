import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';

import type { Tool, ToolContext } from '../core/tool.ts';

const MAX_FILE_CHARS = 8000;

/** 路径越狱检查：解析后的绝对路径必须仍在 workspace 内 */
function resolveInWorkspace(context: ToolContext, input: unknown): string {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new Error('path 必须是非空字符串');
  }
  const root = resolve(context.workspaceRoot);
  const target = resolve(root, input);
  if (target !== root && !target.startsWith(root + sep)) {
    throw new Error(`路径越出工作区：${input}`);
  }
  return target;
}

export const readFileTool: Tool = {
  name: 'read_file',
  description: '读取工作区内某个文件的文本内容，超过长度会被截断',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '相对工作区的文件路径，例如 src/cli/main.ts' },
    },
    required: ['path'],
    additionalProperties: false,
  },

  execute(args, context) {
    return Promise.resolve().then(() => {
      const record = (args ?? {}) as Record<string, unknown>;
      const target = resolveInWorkspace(context, record['path']);
      const stat = statSync(target, { throwIfNoEntry: false });
      if (stat === undefined) {
        return { content: `文件不存在：${String(record['path'])}`, isError: true };
      }
      if (!stat.isFile()) {
        return { content: `不是普通文件：${String(record['path'])}`, isError: true };
      }
      const text = readFileSync(target, 'utf8');
      const truncated = text.length > MAX_FILE_CHARS;
      return {
        content: truncated ? `${text.slice(0, MAX_FILE_CHARS)}\n…[已截断，原长 ${text.length} 字符]` : text,
      };
    });
  },
};

export const listDirTool: Tool = {
  name: 'list_dir',
  description: '列出工作区内某个目录下的文件与子目录',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '相对工作区的目录路径，默认为 .' },
    },
    required: [],
    additionalProperties: false,
  },

  execute(args, context) {
    return Promise.resolve().then(() => {
      const record = (args ?? {}) as Record<string, unknown>;
      const target = resolveInWorkspace(context, record['path'] ?? '.');
      const entries = readdirSync(target, { withFileTypes: true })
        .filter((entry) => entry.name !== 'node_modules' && entry.name !== '.git')
        .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
        .sort();
      return { content: entries.join('\n') };
    });
  },
};

export function createBuiltinTools(): Tool[] {
  return [readFileTool, listDirTool];
}
