import type { MemoryCandidate } from './writer.ts';

export interface MemoryVersion extends MemoryCandidate {
  readonly version: number;
  readonly expiresAt?: number;
  readonly active: boolean;
}

export interface MemoryConflict {
  readonly key: string;
  readonly values: readonly string[];
}

export function resolveMemoryVersions(versions: readonly MemoryVersion[], now = Date.now()): {
  readonly active: readonly MemoryVersion[];
  readonly conflicts: readonly MemoryConflict[];
} {
  const active = versions.filter((version) => version.active && (version.expiresAt === undefined || version.expiresAt > now));
  const byKey = new Map<string, MemoryVersion[]>();
  for (const version of active) byKey.set(version.key, [...(byKey.get(version.key) ?? []), version]);
  const conflicts = [...byKey.entries()].filter(([, values]) => new Set(values.map(({ entry }) => entry.content)).size > 1)
    .map(([key, values]) => ({ key, values: values.map(({ entry }) => entry.content) }));
  return { active, conflicts };
}
