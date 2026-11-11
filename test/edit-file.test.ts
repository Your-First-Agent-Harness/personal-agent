import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createUnifiedDiff } from '../src/tools/diff.ts';
import { editFileTool } from '../src/tools/edit-file.ts';

const dirs: string[] = [];

function workspace(): string {
  const base = mkdtempSync(join(tmpdir(), 'pa-edit-'));
  dirs.push(base);
  const root = join(base, 'workspace', 'root');
  mkdirSync(root, { recursive: true });
  return root;
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('createUnifiedDiff', () => {
  it('精确输出单行修改的全文件单 hunk', () => {
    expect(createUnifiedDiff('x.txt', 'a\nb\n', 'a\nc\n')).toBe(
      '--- a/x.txt\n' +
        '+++ b/x.txt\n' +
        '@@ -1,3 +1,3 @@\n' +
        ' a\n' +
        '-b\n' +
        '+c\n' +
        ' \n',
    );
  });

  it('精确输出末尾插入', () => {
    expect(createUnifiedDiff('x.txt', 'a\n', 'a\nb\n')).toBe(
      '--- a/x.txt\n' +
        '+++ b/x.txt\n' +
        '@@ -1,2 +1,3 @@\n' +
        ' a\n' +
        '+b\n' +
        ' \n',
    );
  });

  it('精确输出删除一行', () => {
    expect(createUnifiedDiff('x.txt', 'a\nb\n', 'a\n')).toBe(
      '--- a/x.txt\n' +
        '+++ b/x.txt\n' +
        '@@ -1,3 +1,2 @@\n' +
        ' a\n' +
        '-b\n' +
        ' \n',
    );
  });
});

describe('edit_file', () => {
  it('Schema 声明三个必填参数且不接受额外字段', () => {
    expect(editFileTool.parameters).toMatchObject({
      type: 'object',
      properties: {
        path: { type: 'string' },
        oldText: { type: 'string' },
        newText: { type: 'string' },
      },
      required: ['path', 'oldText', 'newText'],
      additionalProperties: false,
    });
  });

  it('唯一匹配替换成功并返回 unified diff', async () => {
    const root = workspace();
    writeFileSync(join(root, 'a.ts'), 'const n = 1;\nconsole.log(n);\n');

    const result = await editFileTool.execute(
      { path: 'a.ts', oldText: 'const n = 1;', newText: 'const n = 2;' },
      { workspaceRoot: root },
    );

    expect(result.isError).toBeUndefined();
    expect(readFileSync(join(root, 'a.ts'), 'utf8')).toBe('const n = 2;\nconsole.log(n);\n');
    expect(result.content).toContain('--- a/a.ts');
    expect(result.content).toContain('+++ b/a.ts');
    expect(result.content).toContain('@@ -1,3 +1,3 @@');
    expect(result.content).toContain('-const n = 1;');
    expect(result.content).toContain('+const n = 2;');
  });

  it('在末尾插入一行并返回新增行', async () => {
    const root = workspace();
    writeFileSync(join(root, 'a.txt'), 'first\n');

    const result = await editFileTool.execute(
      { path: 'a.txt', oldText: 'first\n', newText: 'first\nsecond\n' },
      { workspaceRoot: root },
    );

    expect(result.isError).toBeUndefined();
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('first\nsecond\n');
    expect(result.content).toContain('+second');
  });

  it('删除一行并返回删除行', async () => {
    const root = workspace();
    writeFileSync(join(root, 'a.txt'), 'first\nsecond\n');

    const result = await editFileTool.execute(
      { path: 'a.txt', oldText: 'second\n', newText: '' },
      { workspaceRoot: root },
    );

    expect(result.isError).toBeUndefined();
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('first\n');
    expect(result.content).toContain('-second');
  });

  it('零匹配返回修复提示且原文件不变', async () => {
    const root = workspace();
    writeFileSync(join(root, 'a.txt'), 'actual\n');

    const result = await editFileTool.execute(
      { path: 'a.txt', oldText: 'missing', newText: 'new' },
      { workspaceRoot: root },
    );

    expect(result.isError).toBe(true);
    expect(result.content).toBe('没有找到唯一匹配：0 处，请读取文件后提供更长 oldText');
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('actual\n');
  });

  it('多处匹配返回实际处数且原文件不变', async () => {
    const root = workspace();
    writeFileSync(join(root, 'a.txt'), 'same\nsame\n');

    const result = await editFileTool.execute(
      { path: 'a.txt', oldText: 'same', newText: 'changed' },
      { workspaceRoot: root },
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain('没有找到唯一匹配：2 处');
    expect(result.content).toContain('请读取文件后提供更长 oldText');
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('same\nsame\n');
  });

  it('拒绝路径越狱且不改工作区外文件', async () => {
    const root = workspace();
    const outside = resolve(root, '../../outside.txt');
    writeFileSync(outside, 'outside\n');

    await expect(
      editFileTool.execute(
        { path: '../../outside.txt', oldText: 'outside', newText: 'changed' },
        { workspaceRoot: root },
      ),
    ).rejects.toThrow('越出工作区');
    expect(readFileSync(outside, 'utf8')).toBe('outside\n');
  });

  it('oldText 非字符串时在路径解析前拒绝', async () => {
    const root = workspace();
    const outside = resolve(root, '../../outside.txt');
    writeFileSync(outside, 'outside\n');

    await expect(
      editFileTool.execute(
        { path: '../../outside.txt', oldText: 42, newText: 'changed' },
        { workspaceRoot: root },
      ),
    ).rejects.toThrow('oldText 必须是字符串');
    expect(readFileSync(outside, 'utf8')).toBe('outside\n');
  });

  it('newText 非字符串时拒绝且原文件不变', async () => {
    const root = workspace();
    writeFileSync(join(root, 'a.txt'), 'old\n');

    await expect(
      editFileTool.execute(
        { path: 'a.txt', oldText: 'old', newText: 42 },
        { workspaceRoot: root },
      ),
    ).rejects.toThrow('newText 必须是字符串');
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('old\n');
  });

  it('oldText 为空时返回明确错误且原文件不变', async () => {
    const root = workspace();
    writeFileSync(join(root, 'a.txt'), 'old\n');

    const result = await editFileTool.execute(
      { path: 'a.txt', oldText: '', newText: 'new' },
      { workspaceRoot: root },
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain('oldText 不能为空');
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('old\n');
  });

  it('编辑前 2001 行时明确超限且原文件不变', async () => {
    const root = workspace();
    const before = Array.from({ length: 2001 }, (_, index) => `line${index}`).join('\n');
    writeFileSync(join(root, 'a.txt'), before);

    const result = await editFileTool.execute(
      { path: 'a.txt', oldText: before, newText: 'new' },
      { workspaceRoot: root },
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain('超过 2000 行上限');
    expect(result.content).toContain('2001');
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe(before);
  });

  it('编辑后 2001 行时明确超限且原文件不变', async () => {
    const root = workspace();
    const after = Array.from({ length: 2001 }, (_, index) => `line${index}`).join('\n');
    writeFileSync(join(root, 'a.txt'), 'old');

    const result = await editFileTool.execute(
      { path: 'a.txt', oldText: 'old', newText: after },
      { workspaceRoot: root },
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain('超过 2000 行上限');
    expect(result.content).toContain('2001');
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('old');
  });
});
