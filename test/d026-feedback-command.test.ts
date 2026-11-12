import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { archiveFeedback } from '../scripts/archive-feedback.ts';

describe('D026 GitHub issue 查询命令', () => {
  it('查询 open/closed issue 的完整归档字段并写入 JSON 快照', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'personal-agent-d026-archive-'));
    const outputPath = join(tempRoot, 'nested', 'issues.json');
    let receivedArgs: readonly string[] | undefined;
    try {
      const archive = archiveFeedback({
        outputPath,
        capturedAt: '2026-12-06T00:00:00.000Z',
        executeGh: (args) => {
          receivedArgs = args;
          return '[]';
        },
      });

      const fields = 'number,title,state,author,url,labels,createdAt,updatedAt,closedAt,body,comments';
      expect(receivedArgs).toEqual([
        'issue',
        'list',
        '--repo',
        'Your-First-Agent-Harness/personal-agent',
        '--state',
        'all',
        '--limit',
        '1000',
        '--json',
        fields,
      ]);
      expect(archive.repository).toBe('Your-First-Agent-Harness/personal-agent');
      expect(archive.capturedAt).toBe('2026-12-06T00:00:00.000Z');
      expect(archive.query.command).toBe(
        `gh issue list --repo Your-First-Agent-Harness/personal-agent --state all --limit 1000 --json ${fields}`,
      );
      expect(archive.summary.total).toBe(0);
      expect(JSON.parse(readFileSync(outputPath, 'utf8'))).toEqual(archive);
      expect(readFileSync(outputPath, 'utf8').endsWith('\n')).toBe(true);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
