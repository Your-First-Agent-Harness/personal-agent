export interface IdempotencyRecord<R> {
  readonly key: string;
  readonly status: 'running' | 'completed' | 'unknown';
  readonly result?: R;
}

export class IdempotencyStore<R> {
  private readonly records = new Map<string, IdempotencyRecord<R>>();

  begin(key: string): IdempotencyRecord<R> {
    const existing = this.records.get(key);
    if (existing !== undefined) return existing;
    const record = { key, status: 'running' as const };
    this.records.set(key, record); return record;
  }
  complete(key: string, result: R): IdempotencyRecord<R> {
    const current = this.records.get(key);
    if (current?.status === 'completed') return current;
    const record = { key, status: 'completed' as const, result };
    this.records.set(key, record); return record;
  }
  markUnknown(key: string): IdempotencyRecord<R> {
    const record = { key, status: 'unknown' as const };
    this.records.set(key, record); return record;
  }
  get(key: string): IdempotencyRecord<R> | undefined { return this.records.get(key); }
}
