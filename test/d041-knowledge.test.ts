import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createKnowledgeTools } from '../src/tools/knowledge.ts';
import { ToolRegistry } from '../src/tools/registry.ts';

interface SearchMatch {
  readonly path: string;
  readonly line: number;
  readonly score: number;
  readonly snippet: string;
}

interface SearchResult {
  readonly query: string;
  readonly matchType: string;
  readonly ranking: string;
  readonly total: number;
  readonly results: readonly SearchMatch[];
}

interface ReadLine {
  readonly line: number;
  readonly text: string;
}

interface ReadResult {
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly totalLines: number;
  readonly lines: readonly ReadLine[];
}

let root: string;
let outside: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'personal-agent-d041-kb-'));
  outside = mkdtempSync(join(tmpdir(), 'personal-agent-d041-outside-'));
  mkdirSync(join(root, 'nested'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

function registryFor(knowledgeRoot = root, allowedTools?: readonly string[]): ToolRegistry {
  const registry = new ToolRegistry(allowedTools === undefined ? {} : { allowedTools });
  for (const tool of createKnowledgeTools(knowledgeRoot)) registry.register(tool);
  return registry;
}

async function execute(
  registry: ToolRegistry,
  name: string,
  args: unknown,
  workspaceRoot = root,
) {
  return registry.execute(
    { id: `call-${name}`, name, arguments: JSON.stringify(args) },
    { workspaceRoot },
  );
}

describe('D041 knowledge_search', () => {
  it('通过 Registry 暴露两个 Schema，按行内子串次数、路径和行号确定性排序', async () => {
    writeFileSync(join(root, 'guide.md'), [
      '# Agent 指南',
      '知识库只读。',
      'AgentLoop 先 search，再 read。',
      '来源必须包含路径和行号。',
      '',
    ].join('\n'));
    writeFileSync(join(root, 'nested', 'ranking.md'), [
      'agent agent 出现在同一行两次',
      '其他内容',
      '',
    ].join('\n'));
    const registry = registryFor();

    expect(registry.list().map((tool) => tool.name)).toEqual([
      'knowledge_search',
      'knowledge_read',
    ]);
    const result = await execute(registry, 'knowledge_search', { query: 'AgEnT' });

    expect(result.isError).toBeUndefined();
    const search = JSON.parse(result.content) as SearchResult;
    expect(search).toMatchObject({
      query: 'AgEnT',
      matchType: 'case-insensitive-substring',
      total: 3,
    });
    expect(search.ranking).toContain('score');
    expect(search.results).toEqual([
      {
        path: 'nested/ranking.md',
        line: 1,
        score: 2,
        snippet: 'agent agent 出现在同一行两次',
      },
      { path: 'guide.md', line: 1, score: 1, snippet: '# Agent 指南' },
      {
        path: 'guide.md',
        line: 3,
        score: 1,
        snippet: 'AgentLoop 先 search，再 read。',
      },
    ]);
  });

  it('空查询由 Schema 或工具拒绝，无结果则返回可回喂的空集合', async () => {
    writeFileSync(join(root, 'guide.md'), '只读知识库\n');
    const registry = registryFor();

    const empty = await execute(registry, 'knowledge_search', { query: '' });
    const whitespace = await execute(registry, 'knowledge_search', { query: '   ' });
    const missing = await execute(registry, 'knowledge_search', { query: '不存在' });

    expect(empty.error?.code).toBe('INVALID_ARGUMENTS');
    expect(whitespace.error?.code).toBe('INVALID_ARGUMENTS');
    expect(missing.isError).toBeUndefined();
    expect(JSON.parse(missing.content)).toMatchObject({ total: 0, results: [] });
  });

  it('沿用 Registry 白名单权限，不允许绕过策略读取', async () => {
    writeFileSync(join(root, 'guide.md'), '只读知识库\n');
    const registry = registryFor(root, ['knowledge_search']);

    expect(registry.list().map((tool) => tool.name)).toEqual(['knowledge_search']);
    const denied = await execute(registry, 'knowledge_read', { path: 'guide.md' });
    expect(denied).toMatchObject({
      isError: true,
      error: { code: 'TOOL_NOT_ALLOWED', retryable: false },
    });
  });
});

describe('D041 knowledge_read', () => {
  it('按一基行号返回可选闭区间，并保留全文行数供引用', async () => {
    writeFileSync(join(root, 'guide.md'), '第一行\n第二行\n第三行\n第四行\n');
    const registry = registryFor();

    const result = await execute(registry, 'knowledge_read', {
      path: 'guide.md',
      startLine: 2,
      endLine: 3,
    });

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content)).toEqual({
      path: 'guide.md',
      startLine: 2,
      endLine: 3,
      totalLines: 4,
      lines: [
        { line: 2, text: '第二行' },
        { line: 3, text: '第三行' },
      ],
    } satisfies ReadResult);

    const full = await execute(registry, 'knowledge_read', { path: 'guide.md' });
    expect(JSON.parse(full.content)).toMatchObject({ startLine: 1, endLine: 4, totalLines: 4 });
  });

  it('未知文件、非 Markdown 和越界行范围均返回明确 ToolResult 错误', async () => {
    writeFileSync(join(root, 'guide.md'), '第一行\n第二行\n');
    writeFileSync(join(root, 'notes.txt'), '不能读取的非 Markdown 文件\n');
    const registry = registryFor();

    const unknown = await execute(registry, 'knowledge_read', { path: 'missing.md' });
    const nonMarkdown = await execute(registry, 'knowledge_read', { path: 'notes.txt' });
    const reversed = await execute(registry, 'knowledge_read', {
      path: 'guide.md', startLine: 2, endLine: 1,
    });
    const beyond = await execute(registry, 'knowledge_read', {
      path: 'guide.md', startLine: 1, endLine: 3,
    });
    const zero = await execute(registry, 'knowledge_read', { path: 'guide.md', startLine: 0 });

    expect(unknown.error?.code).toBe('FILE_NOT_FOUND');
    expect(nonMarkdown.error?.code).toBe('INVALID_ARGUMENTS');
    expect(reversed.error?.code).toBe('INVALID_ARGUMENTS');
    expect(beyond.error?.code).toBe('INVALID_ARGUMENTS');
    expect(beyond.content).toContain('总行数');
    expect(zero.error?.code).toBe('INVALID_ARGUMENTS');
  });

  it('拒绝路径穿越和绝对路径，即使 ToolContext 指向其他工作区也不能换根', async () => {
    writeFileSync(join(root, 'guide.md'), '知识库内\n');
    writeFileSync(join(outside, 'secret.md'), '知识库外秘密\n');
    const registry = registryFor();

    for (const path of ['../outside.md', 'nested/../../outside.md', join(outside, 'secret.md')]) {
      const result = await execute(registry, 'knowledge_read', { path }, outside);
      expect(result.isError).toBe(true);
      expect(result.error?.code).toBe('PATH_OUTSIDE_WORKSPACE');
      expect(result.content).not.toContain('知识库外秘密');
    }

    const inside = await execute(registry, 'knowledge_read', { path: 'guide.md' }, outside);
    expect(inside.isError).toBeUndefined();
    expect(inside.content).toContain('知识库内');
  });

  it('快照跳过指向库外的符号链接，搜索和读取都接触不到秘密内容', async () => {
    writeFileSync(join(outside, 'secret.md'), '绝密 Agent 内容\n');
    mkdirSync(join(outside, 'private'));
    writeFileSync(join(outside, 'private', 'hidden.md'), '隐藏 Agent 内容\n');
    symlinkSync(join(outside, 'secret.md'), join(root, 'escape.md'));
    symlinkSync(join(outside, 'private'), join(root, 'linked-dir'));
    const registry = registryFor();

    const search = await execute(registry, 'knowledge_search', { query: 'Agent' });
    const linkedFile = await execute(registry, 'knowledge_read', { path: 'escape.md' });
    const linkedDirectory = await execute(registry, 'knowledge_read', { path: 'linked-dir/hidden.md' });

    expect(JSON.parse(search.content)).toMatchObject({ total: 0, results: [] });
    expect(linkedFile.isError).toBe(true);
    expect(linkedDirectory.isError).toBe(true);
    expect(JSON.stringify([search, linkedFile, linkedDirectory])).not.toContain('绝密');
    expect(JSON.stringify([search, linkedFile, linkedDirectory])).not.toContain('隐藏 Agent');
  });
});

describe('D041 文档快照', () => {
  it('工厂创建时真实读取一次；磁盘变化只有重建工具后才进入新快照', async () => {
    writeFileSync(join(root, 'guide.md'), '旧快照内容\n');
    const original = registryFor();
    writeFileSync(join(root, 'guide.md'), '新快照内容\n');
    writeFileSync(join(root, 'new.md'), '新增文档\n');

    const staleSearch = await execute(original, 'knowledge_search', { query: '旧快照' });
    const staleRead = await execute(original, 'knowledge_read', { path: 'guide.md' });
    const implicitRefresh = await execute(original, 'knowledge_search', { query: '新快照' });
    const newDocument = await execute(original, 'knowledge_read', { path: 'new.md' });

    expect(JSON.parse(staleSearch.content)).toMatchObject({ total: 1 });
    expect(staleRead.content).toContain('旧快照内容');
    expect(JSON.parse(implicitRefresh.content)).toMatchObject({ total: 0 });
    expect(newDocument.error?.code).toBe('FILE_NOT_FOUND');

    const refreshed = registryFor();
    const freshSearch = await execute(refreshed, 'knowledge_search', { query: '新快照' });
    const freshDocument = await execute(refreshed, 'knowledge_read', { path: 'new.md' });
    expect(JSON.parse(freshSearch.content)).toMatchObject({ total: 1 });
    expect(freshDocument.content).toContain('新增文档');
  });
});
