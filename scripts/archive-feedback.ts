import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  createIssueArchive,
  ISSUE_QUERY_LIMIT,
} from '../src/feedback/issue-archive.ts';
import type { GitHubIssue, IssueArchive } from '../src/feedback/issue-archive.ts';

const REPOSITORY = 'Your-First-Agent-Harness/personal-agent';
const ISSUE_FIELDS = [
  'number',
  'title',
  'state',
  'author',
  'url',
  'labels',
  'createdAt',
  'updatedAt',
  'closedAt',
  'body',
  'comments',
] as const;

export interface ArchiveFeedbackOptions {
  readonly outputPath: string;
  readonly capturedAt?: string;
  readonly executeGh?: (args: readonly string[]) => string;
}

export function archiveFeedback(options: ArchiveFeedbackOptions): IssueArchive {
  const args = [
    'issue',
    'list',
    '--repo',
    REPOSITORY,
    '--state',
    'all',
    '--limit',
    String(ISSUE_QUERY_LIMIT),
    '--json',
    ISSUE_FIELDS.join(','),
  ];
  const executeGh = options.executeGh ?? ((commandArgs: readonly string[]) => {
    const result = spawnSync('gh', commandArgs, {
      encoding: 'utf8',
      env: process.env,
      maxBuffer: 50 * 1024 * 1024,
      timeout: 60_000,
    });
    if (result.error !== undefined) {
      throw result.error;
    }
    if (result.status !== 0) {
      throw new Error(`gh issue list 失败（exit ${result.status}）：${result.stderr.trim()}`);
    }
    return result.stdout;
  });
  const parsed = JSON.parse(executeGh(args)) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error('gh issue list 返回值不是 JSON 数组');
  }

  const archive = createIssueArchive({
    repository: REPOSITORY,
    capturedAt: options.capturedAt ?? new Date().toISOString(),
    queryCommand: ['gh', ...args].join(' '),
    issues: parsed as GitHubIssue[],
  });
  mkdirSync(dirname(options.outputPath), { recursive: true });
  writeFileSync(options.outputPath, `${JSON.stringify(archive, null, 2)}\n`, 'utf8');
  return archive;
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(resolve(entryPoint)).href) {
  try {
    const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
    const outputPath = resolve(
      process.argv[2] ?? join(repositoryRoot, 'docs/feedback/d026-v0.1-issues.json'),
    );
    const archive = archiveFeedback({ outputPath });
    process.stdout.write(
      `ISSUE_ARCHIVE_PASS total=${archive.summary.total} open=${archive.summary.open} closed=${archive.summary.closed} output=${outputPath}\n`,
    );
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
