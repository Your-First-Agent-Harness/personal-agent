import { statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { Tool } from '../core/tool.ts';
import { resolveInWorkspace } from './workspace.ts';

export const writeFileTool: Tool = {
  name: 'write_file',
  description: '写入工作区内文本文件；默认不覆盖，父目录必须存在',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '相对工作区的文件路径' },
      content: { type: 'string', description: '要写入的完整文本' },
      overwrite: { type: 'boolean', description: '已存在时是否覆盖，默认 false' },
    },
    required: ['path', 'content'],
    additionalProperties: false,
  },

  execute(args, context) {
    return Promise.resolve().then(() => {
      const record = (args ?? {}) as Record<string, unknown>;
      const content = record['content'];
      const overwrite = record['overwrite'] ?? false;
      if (typeof content !== 'string') throw new Error('content 必须是字符串');
      if (typeof overwrite !== 'boolean') throw new Error('overwrite 必须是布尔值');

      const target = resolveInWorkspace(context, record['path']);
      if (statSync(target, { throwIfNoEntry: false }) !== undefined && !overwrite) {
        return {
          content: `文件已存在，默认不覆盖：${String(record['path'])}。确认后设置 overwrite: true`,
          isError: true,
        };
      }
      const parent = statSync(dirname(target), { throwIfNoEntry: false });
      if (parent === undefined || !parent.isDirectory()) {
        return { content: `父目录不存在或不是目录：${String(record['path'])}`, isError: true };
      }
      writeFileSync(target, content, { encoding: 'utf8', flag: overwrite ? 'w' : 'wx' });
      return { content: `已写入 ${String(record['path'])}（${content.length} 字符）` };
    });
  },
};
