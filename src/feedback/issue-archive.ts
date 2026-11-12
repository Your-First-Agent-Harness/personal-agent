export const ISSUE_QUERY_LIMIT = 1000;

export const FEEDBACK_CATEGORIES = [
  'bug',
  'documentation',
  'enhancement',
  'question',
  'other',
] as const;

export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];
export type IssueState = 'OPEN' | 'CLOSED';

export interface GitHubActor {
  readonly login: string;
}

export interface GitHubLabel {
  readonly name: string;
}

export interface GitHubComment {
  readonly author: GitHubActor | null;
  readonly body: string | null;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
  readonly url: string;
}

export interface GitHubIssue {
  readonly number: number;
  readonly title: string;
  readonly state: IssueState;
  readonly author: GitHubActor | null;
  readonly url: string;
  readonly labels: readonly GitHubLabel[];
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
  readonly closedAt: string | null;
  readonly body: string | null;
  readonly comments: readonly GitHubComment[];
}

export interface IssueArchiveInput {
  readonly repository: string;
  readonly capturedAt: string;
  readonly queryCommand: string;
  readonly issues: readonly GitHubIssue[];
}

export interface IssueClassification {
  readonly category: FeedbackCategory;
  readonly evidence: string;
}

export interface ReproductionInfo {
  readonly status: 'provided' | 'unknown';
  readonly text: string;
}

export interface ArchivedIssue {
  readonly number: number;
  readonly title: string;
  readonly state: IssueState;
  readonly author: string;
  readonly url: string;
  readonly labels: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly closedAt: string | null;
  readonly body: string;
  readonly comments: readonly {
    readonly author: string;
    readonly body: string;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly url: string;
  }[];
  readonly classification: IssueClassification;
  readonly reproduction: ReproductionInfo;
}

export interface IssueArchive {
  readonly schemaVersion: 1;
  readonly repository: string;
  readonly capturedAt: string;
  readonly query: {
    readonly command: string;
    readonly state: 'all';
    readonly limit: number;
  };
  readonly summary: {
    readonly total: number;
    readonly open: number;
    readonly closed: number;
    readonly byCategory: Record<FeedbackCategory, number>;
  };
  readonly issues: readonly ArchivedIssue[];
}

interface ClassificationRule {
  readonly category: FeedbackCategory;
  readonly labels: readonly string[];
  readonly titleKeywords: readonly string[];
}

const CLASSIFICATION_RULES: readonly ClassificationRule[] = [
  {
    category: 'bug',
    labels: ['bug', 'defect'],
    titleKeywords: ['bug', 'error', 'crash', 'failure', 'failed', '缺陷', '错误', '崩溃', '失败'],
  },
  {
    category: 'documentation',
    labels: ['documentation', 'docs'],
    titleKeywords: ['documentation', 'docs', 'document', '文档', '教程'],
  },
  {
    category: 'enhancement',
    labels: ['enhancement', 'feature', 'feature request'],
    titleKeywords: ['enhancement', 'feature', 'improvement', '功能请求', '增强', '优化建议'],
  },
  {
    category: 'question',
    labels: ['question', 'support'],
    titleKeywords: ['question', 'how to', 'support', '疑问', '如何', '怎么'],
  },
];

function classifyIssue(issue: GitHubIssue): IssueClassification {
  for (const rule of CLASSIFICATION_RULES) {
    for (const label of issue.labels) {
      if (rule.labels.includes(label.name.toLowerCase())) {
        return { category: rule.category, evidence: `label "${label.name}"` };
      }
    }
  }

  const title = issue.title.toLowerCase();
  for (const rule of CLASSIFICATION_RULES) {
    const keyword = rule.titleKeywords.find((candidate) => title.includes(candidate));
    if (keyword !== undefined) {
      return { category: rule.category, evidence: `title keyword "${keyword}"` };
    }
  }

  return { category: 'other', evidence: 'no recognized label or title keyword' };
}

function extractReproduction(body: string | null): ReproductionInfo {
  if (body === null) {
    return { status: 'unknown', text: 'unknown' };
  }
  const match = /(?:^|\n)#{1,6}[ \t]*(?:steps to reproduce|reproduction steps|reproduction|repro steps|复现步骤|如何复现)[ \t]*\r?\n([\s\S]*?)(?=\r?\n#{1,6}[ \t]|$)/i.exec(body);
  const text = match?.[1]?.trim();
  return text ? { status: 'provided', text } : { status: 'unknown', text: 'unknown' };
}

function archiveIssue(issue: GitHubIssue): ArchivedIssue {
  return {
    number: issue.number,
    title: issue.title,
    state: issue.state,
    author: issue.author?.login || 'unknown',
    url: issue.url,
    labels: issue.labels.map((label) => label.name),
    createdAt: issue.createdAt ?? 'unknown',
    updatedAt: issue.updatedAt ?? 'unknown',
    closedAt: issue.state === 'OPEN' ? null : (issue.closedAt ?? 'unknown'),
    body: issue.body ?? 'unknown',
    comments: issue.comments.map((comment) => ({
      author: comment.author?.login || 'unknown',
      body: comment.body ?? 'unknown',
      createdAt: comment.createdAt ?? 'unknown',
      updatedAt: comment.updatedAt ?? 'unknown',
      url: comment.url,
    })),
    classification: classifyIssue(issue),
    reproduction: extractReproduction(issue.body),
  };
}

export function createIssueArchive(input: IssueArchiveInput): IssueArchive {
  const issues = input.issues.map(archiveIssue);
  const byCategory: Record<FeedbackCategory, number> = {
    bug: 0,
    documentation: 0,
    enhancement: 0,
    question: 0,
    other: 0,
  };
  for (const issue of issues) {
    byCategory[issue.classification.category] += 1;
  }

  return {
    schemaVersion: 1,
    repository: input.repository,
    capturedAt: input.capturedAt,
    query: { command: input.queryCommand, state: 'all', limit: ISSUE_QUERY_LIMIT },
    summary: {
      total: issues.length,
      open: issues.filter((issue) => issue.state === 'OPEN').length,
      closed: issues.filter((issue) => issue.state === 'CLOSED').length,
      byCategory,
    },
    issues,
  };
}
