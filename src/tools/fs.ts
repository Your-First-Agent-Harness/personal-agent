import { readdirSync, readFileSync, statSync } from 'node:fs';

import type { Tool } from '../core/tool.ts';
import { toolError } from './errors.ts';
import { resolveInWorkspace } from './workspace.ts';

const MAX_FILE_CHARS = 8000;

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
        return toolError(
          'FILE_NOT_FOUND',
          `文件不存在：${String(record['path'])}`,
          true,
          '请检查路径，或先用 list_dir 查看可用文件',
        );
      }
      if (!stat.isFile()) {
        return toolError(
          'NOT_A_FILE',
          `不是普通文件：${String(record['path'])}`,
          true,
          '请改为普通文件路径',
        );
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
      const rawPath = record['path'] ?? '.';
      const target = resolveInWorkspace(context, rawPath);
      const displayPath = typeof rawPath === 'string' ? rawPath : '.';
      const stat = statSync(target, { throwIfNoEntry: false });
      if (stat === undefined) {
        return toolError(
          'DIRECTORY_NOT_FOUND',
          `目录不存在：${displayPath}`,
          true,
          '请检查目录路径',
        );
      }
      if (!stat.isDirectory()) {
        return toolError(
          'NOT_A_DIRECTORY',
          `不是目录：${displayPath}`,
          true,
          '请改为目录路径',
        );
      }
      const entries = readdirSync(target, { withFileTypes: true })
        .filter((entry) => entry.name !== 'node_modules' && entry.name !== '.git')
        .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
        .sort();
      return { content: entries.join('\n') };
    });
  },
};
