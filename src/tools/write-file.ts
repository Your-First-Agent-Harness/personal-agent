import { statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { Tool } from '../core/tool.ts';
import { toolError } from './errors.ts';
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
      if (typeof content !== 'string') {
        return toolError('INVALID_ARGUMENTS', 'content 必须是字符串', true, '请传入文本 content');
      }
      if (typeof overwrite !== 'boolean') {
        return toolError('INVALID_ARGUMENTS', 'overwrite 必须是布尔值', true, '请传入 true 或 false');
      }

      const target = resolveInWorkspace(context, record['path']);
      if (statSync(target, { throwIfNoEntry: false }) !== undefined && !overwrite) {
        return toolError(
          'FILE_EXISTS',
          `文件已存在，默认不覆盖：${String(record['path'])}`,
          true,
          '确认后设置 overwrite: true',
        );
      }
      const parent = statSync(dirname(target), { throwIfNoEntry: false });
      if (parent === undefined || !parent.isDirectory()) {
        return toolError(
          'PARENT_NOT_FOUND',
          `父目录不存在或不是目录：${String(record['path'])}`,
          true,
          '请先创建父目录，或改用已有目录',
        );
      }
      writeFileSync(target, content, { encoding: 'utf8', flag: overwrite ? 'w' : 'wx' });
      return { content: `已写入 ${String(record['path'])}（${content.length} 字符）` };
    });
  },
};
