import type { ToolSchema } from '../core/tool.ts';

export const DEFAULT_TOOL_SEARCH_LIMIT = 5;

export function validateToolSearchLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 0) {
    throw new RangeError('工具检索 limit 必须是非负整数');
  }
}

function tokenize(value: string): string[] {
  const normalized = value.normalize('NFKC').toLowerCase();
  const tokens = new Set<string>();
  const segments = normalized.match(/[a-z0-9]+|\p{Script=Han}+/gu) ?? [];

  for (const segment of segments) {
    if (!/^\p{Script=Han}+$/u.test(segment) || segment.length <= 2) {
      tokens.add(segment);
      continue;
    }
    for (let index = 0; index < segment.length - 1; index += 1) {
      tokens.add(segment.slice(index, index + 2));
    }
  }

  return [...tokens];
}

function searchableText(value: string): string {
  return value.normalize('NFKC').toLowerCase();
}

function scoreSchema(schema: ToolSchema, queryTokens: readonly string[]): number {
  const nameTokens = new Set(tokenize(schema.name));
  const descriptionTokens = new Set(tokenize(schema.description));
  const normalizedName = searchableText(schema.name);
  const normalizedDescription = searchableText(schema.description);
  let score = 0;

  for (const token of queryTokens) {
    if (nameTokens.has(token)) score += 12;
    else if (normalizedName.includes(token)) score += 6;

    if (descriptionTokens.has(token)) score += 4;
    else if (normalizedDescription.includes(token)) score += 2;
  }

  return score;
}

export function searchToolSchemas(
  catalog: readonly ToolSchema[],
  query: string,
  limit = DEFAULT_TOOL_SEARCH_LIMIT,
): ToolSchema[] {
  validateToolSearchLimit(limit);
  if (limit === 0) return [];

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  return catalog
    .map((schema, index) => ({ schema, index, score: scoreSchema(schema, queryTokens) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .map((entry) => entry.schema);
}
