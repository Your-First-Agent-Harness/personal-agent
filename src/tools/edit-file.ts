import { readFileSync, statSync, writeFileSync } from 'node:fs';

import type { Tool } from '../core/tool.ts';
import { createUnifiedDiff } from './diff.ts';
import { toolError } from './errors.ts';
import { resolveInWorkspace } from './workspace.ts';

const MAX_DIFF_LINES = 2000;

export const editFileTool: Tool = {
  name: 'edit_file',
  description: '精确替换工作区内文本文件中的唯一匹配，并返回 unified diff',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '相对工作区的文件路径' },
      oldText: { type: 'string', description: '必须唯一匹配的原文，不支持正则' },
      newText: { type: 'string', description: '替换后的文本，可以为空字符串' },
    },
    required: ['path', 'oldText', 'newText'],
    additionalProperties: false,
  },

  execute(args, context) {
    return Promise.resolve().then(() => {
      const record = (args ?? {}) as Record<string, unknown>;
      const oldText = record['oldText'];
      const newText = record['newText'];
      if (typeof oldText !== 'string') {
        return toolError('INVALID_ARGUMENTS', 'oldText 必须是字符串', true, '请提供精确匹配的原文');
      }
      if (typeof newText !== 'string') {
        return toolError('INVALID_ARGUMENTS', 'newText 必须是字符串', true, '请提供替换后的文本');
      }

      const inputPath = record['path'];
      const target = resolveInWorkspace(context, inputPath);
      const stat = statSync(target, { throwIfNoEntry: false });
      if (stat === undefined) {
        return toolError('FILE_NOT_FOUND', `文件不存在：${String(inputPath)}`, true, '请检查文件路径');
      }
      if (!stat.isFile()) {
        return toolError('NOT_A_FILE', `不是普通文件：${String(inputPath)}`, true, '请改为普通文件路径');
      }
      const before = readFileSync(target, 'utf8');
      if (oldText === '') {
        return toolError(
          'INVALID_ARGUMENTS',
          'oldText 不能为空',
          true,
          '请提供要精确匹配的原文',
        );
      }
      const matches = before.split(oldText).length - 1;
      if (matches !== 1) {
        return toolError(
          matches === 0 ? 'EDIT_NO_MATCH' : 'EDIT_MULTIPLE_MATCHES',
          `没有找到唯一匹配：${matches} 处`,
          true,
          '请读取文件后提供更长 oldText',
        );
      }
      const after = before.replace(oldText, () => newText);
      const beforeLines = before.split(/\r?\n/).length;
      const afterLines = after.split(/\r?\n/).length;
      if (beforeLines > MAX_DIFF_LINES || afterLines > MAX_DIFF_LINES) {
        return toolError(
          'DIFF_TOO_LARGE',
          `编辑前后文件超过 2000 行上限（编辑前 ${beforeLines} 行，编辑后 ${afterLines} 行）`,
          false,
          '请分段编辑，确保编辑前后均不超过 2000 行',
        );
      }
      const writeTarget = resolveInWorkspace(context, inputPath);
      writeFileSync(writeTarget, after, 'utf8');
      return { content: createUnifiedDiff(String(inputPath), before, after) };
    });
  },
};
