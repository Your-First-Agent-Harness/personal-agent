import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { ToolError, type Tool, type ToolResult } from '../core/tool.ts';

interface KnowledgeDocument {
  readonly path: string;
  readonly lines: readonly string[];
}

interface KnowledgeMatch {
  readonly path: string;
  readonly line: number;
  readonly score: number;
  readonly snippet: string;
}

const ranking = 'score:desc,path:asc,line:asc';

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

function indexDirectory(root: string, directory: string, documents: Map<string, KnowledgeDocument>): void {
  const entries = readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => compareText(left.name, right.name));
  for (const entry of entries) {
    // 不跟随任何符号链接：它既可能指向库外，也会破坏快照路径的稳定性。
    if (entry.isSymbolicLink()) continue;
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      indexDirectory(root, absolutePath, documents);
      continue;
    }
    if (!entry.isFile() || extname(entry.name) !== '.md') continue;
    const path = relative(root, absolutePath).split(sep).join('/');
    documents.set(path, { path, lines: splitLines(readFileSync(absolutePath, 'utf8')) });
  }
}

function createSnapshot(rootInput: string): ReadonlyMap<string, KnowledgeDocument> {
  const root = realpathSync(rootInput);
  if (!statSync(root).isDirectory()) {
    throw new ToolError('NOT_A_DIRECTORY', '知识库根路径必须是目录', false);
  }
  const documents = new Map<string, KnowledgeDocument>();
  indexDirectory(root, root, documents);
  return documents;
}

function invalidArguments(message: string, hint: string): ToolError {
  return new ToolError('INVALID_ARGUMENTS', message, true, hint);
}

function normalizeMarkdownPath(root: string, input: unknown): string {
  if (typeof input !== 'string' || input.trim() === '') {
    throw invalidArguments('path 必须是非空字符串', '请提供知识库内的相对 .md 路径');
  }
  const path = input.trim();
  if (isAbsolute(path) || /^[A-Za-z]:[\\/]/.test(path) || path.includes('\0')) {
    throw new ToolError('PATH_OUTSIDE_WORKSPACE', '知识库只接受相对路径', true, '请改用知识库内的相对路径');
  }
  const target = resolve(root, path);
  const relativePath = relative(root, target);
  if (
    relativePath === '..'
    || relativePath.startsWith(`..${sep}`)
    || isAbsolute(relativePath)
  ) {
    throw new ToolError(
      'PATH_OUTSIDE_WORKSPACE',
      `路径越出知识库：${path}`,
      true,
      '请改用知识库根目录内的相对路径',
    );
  }
  const normalized = relativePath.split(sep).join('/');
  if (extname(normalized) !== '.md') {
    throw invalidArguments(`只支持读取 Markdown 文件：${path}`, 'path 必须以 .md 结尾');
  }
  return normalized;
}

function countOccurrences(line: string, query: string): number {
  let count = 0;
  let offset = 0;
  while (offset <= line.length - query.length) {
    const index = line.indexOf(query, offset);
    if (index === -1) break;
    count += 1;
    offset = index + query.length;
  }
  return count;
}

function snippet(line: string): string {
  const compact = line.trim();
  return compact.length <= 160 ? compact : `${compact.slice(0, 157)}...`;
}

function executeSearch(documents: ReadonlyMap<string, KnowledgeDocument>, args: unknown): ToolResult {
  const input = (args ?? {}) as Record<string, unknown>;
  const rawQuery = input['query'];
  if (typeof rawQuery !== 'string' || rawQuery.trim() === '') {
    throw invalidArguments('query 必须是非空白字符串', '请输入要查找的原始子串');
  }
  const query = rawQuery.trim();
  const foldedQuery = query.toLowerCase();
  const matches: KnowledgeMatch[] = [];
  for (const document of documents.values()) {
    for (const [index, line] of document.lines.entries()) {
      const score = countOccurrences(line.toLowerCase(), foldedQuery);
      if (score === 0) continue;
      matches.push({ path: document.path, line: index + 1, score, snippet: snippet(line) });
    }
  }
  matches.sort((left, right) => (
    right.score - left.score
    || compareText(left.path, right.path)
    || left.line - right.line
  ));
  return {
    content: JSON.stringify({
      query,
      matchType: 'case-insensitive-substring',
      ranking,
      total: matches.length,
      results: matches,
    }),
  };
}

function optionalLine(input: Record<string, unknown>, key: 'startLine' | 'endLine'): number | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw invalidArguments(`${key} 必须是大于等于 1 的整数`, `请修正 ${key}`);
  }
  return value;
}

function executeRead(
  root: string,
  documents: ReadonlyMap<string, KnowledgeDocument>,
  args: unknown,
): ToolResult {
  const input = (args ?? {}) as Record<string, unknown>;
  const path = normalizeMarkdownPath(root, input['path']);
  const document = documents.get(path);
  if (document === undefined) {
    throw new ToolError(
      'FILE_NOT_FOUND',
      `知识库快照中不存在文档：${path}`,
      true,
      '请先用 knowledge_search 查找；新增文件需重建工具快照',
    );
  }
  const totalLines = document.lines.length;
  const requestedStart = optionalLine(input, 'startLine');
  const requestedEnd = optionalLine(input, 'endLine');
  if (totalLines === 0) {
    if (requestedStart !== undefined || requestedEnd !== undefined) {
      throw invalidArguments(`空文档不接受行范围，总行数为 0`, '请省略 startLine 和 endLine');
    }
    return { content: JSON.stringify({ path, startLine: 0, endLine: 0, totalLines, lines: [] }) };
  }
  const startLine = requestedStart ?? 1;
  const endLine = requestedEnd ?? totalLines;
  if (startLine > totalLines || endLine > totalLines) {
    throw invalidArguments(
      `行范围越界：${startLine}-${endLine}，文档总行数为 ${totalLines}`,
      '请使用文档总行数以内的闭区间',
    );
  }
  if (endLine < startLine) {
    throw invalidArguments(`endLine ${endLine} 不能小于 startLine ${startLine}`, '请修正行范围');
  }
  const lines = document.lines.slice(startLine - 1, endLine)
    .map((text, index) => ({ line: startLine + index, text }));
  return { content: JSON.stringify({ path, startLine, endLine, totalLines, lines }) };
}

/**
 * 创建共享同一不可变文档快照的两个只读工具。
 * 工厂调用时递归读取根目录内的普通 .md 文件；之后磁盘变化不会隐式刷新，
 * 需要重新调用本工厂并替换 Registry 注册项。
 */
export function createKnowledgeTools(rootInput: string): Tool[] {
  const root = realpathSync(rootInput);
  const documents = createSnapshot(root);
  return [
    {
      name: 'knowledge_search',
      description: '在本地 Markdown 快照中做大小写不敏感的逐行子串搜索；按行内匹配次数、路径、行号排序，不是语义检索',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', minLength: 1, description: '要查找的非空白原始子串' },
        },
        required: ['query'],
        additionalProperties: false,
      },
      execute(args) {
        return Promise.resolve().then(() => executeSearch(documents, args));
      },
    },
    {
      name: 'knowledge_read',
      description: '从同一 Markdown 快照按相对路径读取全文或一基行号闭区间，返回带来源行号的内容',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', minLength: 1, description: '知识库内的相对 .md 路径' },
          startLine: { type: 'integer', minimum: 1, description: '可选起始行，包含该行，默认为 1' },
          endLine: { type: 'integer', minimum: 1, description: '可选结束行，包含该行，默认为最后一行' },
        },
        required: ['path'],
        additionalProperties: false,
      },
      execute(args) {
        return Promise.resolve().then(() => executeRead(root, documents, args));
      },
    },
  ];
}
