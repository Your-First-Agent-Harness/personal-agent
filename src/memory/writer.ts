import type { MemoryEntry } from './layers.ts';
import { acceptsLongTermMemory } from './layers.ts';

export interface MemoryCandidate {
  readonly key: string;
  readonly entry: MemoryEntry;
}

export interface MemoryWriteResult {
  readonly accepted: readonly MemoryCandidate[];
  readonly rejected: readonly MemoryCandidate[];
  readonly updated: readonly MemoryCandidate[];
}

export class MemoryWriter {
  private readonly entries = new Map<string, MemoryCandidate>();

  write(candidates: readonly MemoryCandidate[]): MemoryWriteResult {
    const accepted: MemoryCandidate[] = [];
    const rejected: MemoryCandidate[] = [];
    const updated: MemoryCandidate[] = [];
    for (const candidate of candidates) {
      if (!acceptsLongTermMemory(candidate.entry)) {
        rejected.push(candidate);
        continue;
      }
      const previous = this.entries.get(candidate.key);
      this.entries.set(candidate.key, candidate);
      if (previous === undefined) accepted.push(candidate);
      else updated.push(candidate);
    }
    return { accepted, rejected, updated };
  }

  list(): readonly MemoryCandidate[] { return [...this.entries.values()]; }
}
