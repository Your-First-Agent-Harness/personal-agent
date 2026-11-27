import type { MemoryCandidate } from './writer.ts';

export interface MemoryMatch {
  readonly key: string;
  readonly content: string;
  readonly score: number;
  readonly source: string;
}

export function searchMemory(
  entries: readonly MemoryCandidate[],
  query: string,
  limit = 5,
): MemoryMatch[] {
  if (!Number.isSafeInteger(limit) || limit < 0) throw new Error('limit 必须是非负整数');
  const tokens = query.toLowerCase().split(/\s+/u).filter(Boolean);
  return entries.map((candidate, index) => {
    const content = candidate.entry.content.toLowerCase();
    const score = tokens.reduce((sum, token) => sum + (content.includes(token) ? 1 : 0), 0);
    return { key: candidate.key, content: candidate.entry.content, score, source: candidate.entry.source, index };
  }).filter((match) => match.score > 0).sort((a, b) => b.score - a.score || a.index - b.index).slice(0, limit)
    .map(({ index: _index, ...match }) => match);
}
