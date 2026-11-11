import { readFileSync, writeFileSync } from 'node:fs';

import type { Tool } from '../core/tool.ts';
import { createUnifiedDiff } from './diff.ts';
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
      if (typeof oldText !== 'string') throw new Error('oldText 必须是字符串');
      if (typeof newText !== 'string') throw new Error('newText 必须是字符串');

      const inputPath = record['path'];
      const target = resolveInWorkspace(context, inputPath);
      const before = readFileSync(target, 'utf8');
      if (oldText === '') {
        return { content: 'oldText 不能为空，请提供要精确匹配的原文', isError: true };
      }
      const matches = before.split(oldText).length - 1;
      if (matches !== 1) {
        return {
          content: `没有找到唯一匹配：${matches} 处，请读取文件后提供更长 oldText`,
          isError: true,
        };
      }
      const after = before.replace(oldText, () => newText);
      const beforeLines = before.split(/\r?\n/).length;
      const afterLines = after.split(/\r?\n/).length;
      if (beforeLines > MAX_DIFF_LINES || afterLines > MAX_DIFF_LINES) {
        return {
          content: `编辑前后文件超过 2000 行上限（编辑前 ${beforeLines} 行，编辑后 ${afterLines} 行）`,
          isError: true,
        };
      }
      const writeTarget = resolveInWorkspace(context, inputPath);
      writeFileSync(writeTarget, after, 'utf8');
      return { content: createUnifiedDiff(String(inputPath), before, after) };
    });
  },
};
