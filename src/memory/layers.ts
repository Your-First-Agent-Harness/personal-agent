export type MemoryLayer = 'session' | 'task_summary' | 'long_term';

export interface MemoryEntry {
  readonly layer: MemoryLayer;
  readonly content: string;
  readonly stable: boolean;
  readonly source: 'user' | 'agent' | 'tool';
}

export function acceptsLongTermMemory(entry: MemoryEntry): boolean {
  return entry.layer === 'long_term' && entry.stable && entry.source === 'user' && entry.content.trim() !== '';
}

export function classifyMemory(content: string, source: MemoryEntry['source']): MemoryEntry {
  const stable = source === 'user' && /偏好|长期|以后|始终|记住|永久/i.test(content);
  return {
    layer: stable ? 'long_term' : 'session',
    content,
    stable,
    source,
  };
}
