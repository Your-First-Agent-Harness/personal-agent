import { describe, expect, it } from 'vitest';

import { createIssueArchive } from '../src/feedback/issue-archive.ts';

const queryCommand = 'gh issue list --repo owner/repo --state all';

describe('D026 issue 分类归档', () => {
  it('空结果也生成包含查询元数据和零计数的快照', () => {
    const archive = createIssueArchive({
      repository: 'owner/repo',
      capturedAt: '2026-12-06T00:00:00.000Z',
      queryCommand,
      issues: [],
    });

    expect(archive).toEqual({
      schemaVersion: 1,
      repository: 'owner/repo',
      capturedAt: '2026-12-06T00:00:00.000Z',
      query: { command: queryCommand, state: 'all', limit: 1000 },
      summary: {
        total: 0,
        open: 0,
        closed: 0,
        byCategory: {
          bug: 0,
          documentation: 0,
          enhancement: 0,
          question: 0,
          other: 0,
        },
      },
      issues: [],
    });
  });

  it('忠实保留 issue、评论和复现步骤，并记录 bug 分类依据', () => {
    const archive = createIssueArchive({
      repository: 'owner/repo',
      capturedAt: '2026-12-06T00:00:00.000Z',
      queryCommand,
      issues: [
        {
          number: 7,
          title: 'Demo fails after install',
          state: 'CLOSED',
          author: { login: 'octocat' },
          url: 'https://github.com/owner/repo/issues/7',
          labels: [{ name: 'bug' }],
          createdAt: '2026-12-05T10:00:00Z',
          updatedAt: '2026-12-05T12:00:00Z',
          closedAt: '2026-12-05T12:00:00Z',
          body: 'The demo exits early.\n\n## Steps to reproduce\n1. Install the tarball\n2. Run the demo\n\n## Expected\nThe demo passes.',
          comments: [
            {
              author: { login: 'maintainer' },
              body: 'Fixed in the next build.',
              createdAt: '2026-12-05T11:00:00Z',
              updatedAt: '2026-12-05T11:00:00Z',
              url: 'https://github.com/owner/repo/issues/7#issuecomment-1',
            },
          ],
        },
      ],
    });

    expect(archive.issues).toEqual([
      {
        number: 7,
        title: 'Demo fails after install',
        state: 'CLOSED',
        author: 'octocat',
        url: 'https://github.com/owner/repo/issues/7',
        labels: ['bug'],
        createdAt: '2026-12-05T10:00:00Z',
        updatedAt: '2026-12-05T12:00:00Z',
        closedAt: '2026-12-05T12:00:00Z',
        body: 'The demo exits early.\n\n## Steps to reproduce\n1. Install the tarball\n2. Run the demo\n\n## Expected\nThe demo passes.',
        comments: [
          {
            author: 'maintainer',
            body: 'Fixed in the next build.',
            createdAt: '2026-12-05T11:00:00Z',
            updatedAt: '2026-12-05T11:00:00Z',
            url: 'https://github.com/owner/repo/issues/7#issuecomment-1',
          },
        ],
        classification: { category: 'bug', evidence: 'label "bug"' },
        reproduction: {
          status: 'provided',
          text: '1. Install the tarball\n2. Run the demo',
        },
      },
    ]);
    expect(archive.summary).toMatchObject({ total: 1, open: 0, closed: 1 });
    expect(archive.summary.byCategory.bug).toBe(1);
  });

  it('缺失的作者、正文和时间标为 unknown，开放 issue 的关闭时间保留 null', () => {
    const archive = createIssueArchive({
      repository: 'owner/repo',
      capturedAt: '2026-12-06T00:00:00.000Z',
      queryCommand,
      issues: [
        {
          number: 8,
          title: 'How to configure a model?',
          state: 'OPEN',
          author: null,
          url: 'https://github.com/owner/repo/issues/8',
          labels: [],
          createdAt: null,
          updatedAt: null,
          closedAt: null,
          body: null,
          comments: [],
        },
      ],
    });

    expect(archive.issues[0]).toMatchObject({
      author: 'unknown',
      createdAt: 'unknown',
      updatedAt: 'unknown',
      closedAt: null,
      body: 'unknown',
      classification: { category: 'question', evidence: 'title keyword "how to"' },
      reproduction: { status: 'unknown', text: 'unknown' },
    });
    expect(archive.summary).toMatchObject({ total: 1, open: 1, closed: 0 });
  });

  it('识别文档、增强和其他分类，且已识别标签优先于标题关键词', () => {
    const base = {
      author: null,
      createdAt: null,
      updatedAt: null,
      closedAt: null,
      body: null,
      comments: [],
      url: 'https://github.com/owner/repo/issues/9',
    };
    const archive = createIssueArchive({
      repository: 'owner/repo',
      capturedAt: '2026-12-06T00:00:00.000Z',
      queryCommand,
      issues: [
        { ...base, number: 9, title: 'Bug in the installation guide', state: 'OPEN', labels: [{ name: 'Documentation' }] },
        { ...base, number: 10, title: 'Add a feature for retries', state: 'OPEN', labels: [] },
        { ...base, number: 11, title: 'Weekly release notes', state: 'OPEN', labels: [] },
      ],
    });

    expect(archive.issues.map((issue) => issue.classification)).toEqual([
      { category: 'documentation', evidence: 'label "Documentation"' },
      { category: 'enhancement', evidence: 'title keyword "feature"' },
      { category: 'other', evidence: 'no recognized label or title keyword' },
    ]);
    expect(archive.summary.byCategory).toEqual({
      bug: 0,
      documentation: 1,
      enhancement: 1,
      question: 0,
      other: 1,
    });
  });
});
