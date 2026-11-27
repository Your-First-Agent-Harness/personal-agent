import type { TraceSpan } from './trace.ts';

export interface TraceSnapshot {
  readonly traceId: string;
  readonly spans: readonly TraceSpan[];
}

export class TraceStore {
  private readonly traces = new Map<string, TraceSnapshot>();

  save(traceId: string, spans: readonly TraceSpan[]): TraceSnapshot {
    const snapshot = { traceId, spans: spans.map((span) => ({ ...span, attributes: { ...span.attributes } })) };
    this.traces.set(traceId, snapshot); return snapshot;
  }
  get(traceId: string): TraceSnapshot | undefined { return this.traces.get(traceId); }
  list(): readonly TraceSnapshot[] { return [...this.traces.values()]; }
}

export function createReplayInput(snapshot: TraceSnapshot): readonly { name: string; attributes: Readonly<Record<string, unknown>> }[] {
  return snapshot.spans.map(({ name, attributes }) => ({ name, attributes }));
}
