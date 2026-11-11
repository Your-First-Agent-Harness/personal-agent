import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ToolRegistry } from '../src/tools/registry.ts';
import { listDirTool, readFileTool } from '../src/tools/fs.ts';

const dirs: string[] = [];

function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pa-tools-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('ToolRegistry', () => {
  it('重复注册同名工具直接报错', () => {
    const registry = new ToolRegistry();
    registry.register(readFileTool);

    expect(() => registry.register(readFileTool)).toThrow('重复注册');
  });

  it('list 只暴露 Schema，不暴露 execute', () => {
    const registry = new ToolRegistry();
    registry.register(readFileTool);
    registry.register(listDirTool);

    const schemas = registry.list();
    expect(schemas.map((s) => s.name)).toEqual(['read_file', 'list_dir']);
    expect(schemas[0]).not.toHaveProperty('execute');
  });
});

describe('read_file', () => {
  it('读取工作区内的文件', async () => {
    const root = workspace();
    writeFileSync(join(root, 'a.txt'), '你好');

    const result = await readFileTool.execute({ path: 'a.txt' }, { workspaceRoot: root });

    expect(result.content).toBe('你好');
    expect(result.isError).toBeUndefined();
  });

  it('文件不存在时返回错误结果', async () => {
    const root = workspace();

    const result = await readFileTool.execute({ path: 'none.txt' }, { workspaceRoot: root });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('不存在');
  });

  it('拒绝越出工作区的路径', async () => {
    const root = workspace();

    // 直接调用会抛错；经过 registry 时才会被转成 isError 结果回喂模型
    await expect(
      readFileTool.execute({ path: '../../etc/hosts' }, { workspaceRoot: root }),
    ).rejects.toThrow('越出工作区');

    const registry = new ToolRegistry();
    registry.register(readFileTool);
    const fedBack = await registry.execute(
      { id: 'c1', name: 'read_file', arguments: '{"path":"../../etc/hosts"}' },
      { workspaceRoot: root },
    );
    expect(fedBack.isError).toBe(true);
    expect(fedBack.content).toContain('越出工作区');
  });

  it('超长文件被截断并标注原长', async () => {
    const root = workspace();
    writeFileSync(join(root, 'big.txt'), 'x'.repeat(9000));

    const result = await readFileTool.execute({ path: 'big.txt' }, { workspaceRoot: root });

    expect(result.content).toContain('已截断');
    expect(result.content).toContain('9000');
  });
});

describe('list_dir', () => {
  it('目录项带斜杠区分，且不含 node_modules 与 .git', async () => {
    const root = workspace();
    writeFileSync(join(root, 'a.txt'), '1');
    writeFileSync(join(root, '.git'), 'fake');
    writeFileSync(join(root, 'node_modules'), 'fake');

    const result = await listDirTool.execute({}, { workspaceRoot: root });

    expect(result.content).toContain('a.txt');
    expect(result.content).not.toContain('node_modules');
    expect(result.content).not.toContain('.git');
  });
});
