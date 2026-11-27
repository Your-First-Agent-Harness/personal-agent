export interface TraceSpan {
  readonly id: string;
  readonly traceId: string;
  readonly parentId?: string;
  readonly name: string;
  readonly startedAt: number;
  readonly endedAt?: number;
  readonly attributes: Readonly<Record<string, unknown>>;
}

export class TraceRecorder {
  private readonly spans: TraceSpan[] = [];
  private sequence = 0;
  private readonly traceId: string;

  constructor(traceId: string) {
    this.traceId = traceId;
  }

  start(name: string, parentId?: string, attributes: Readonly<Record<string, unknown>> = {}): TraceSpan {
    const span = { id: `${this.traceId}-${++this.sequence}`, traceId: this.traceId, ...(parentId === undefined ? {} : { parentId }), name, startedAt: Date.now(), attributes };
    this.spans.push(span); return span;
  }
  end(id: string, attributes: Readonly<Record<string, unknown>> = {}): TraceSpan {
    const index = this.spans.findIndex((span) => span.id === id);
    if (index < 0) throw new Error(`未知 span：${id}`);
    const span = this.spans[index]!;
    const ended = { ...span, endedAt: Date.now(), attributes: { ...span.attributes, ...attributes } };
    this.spans[index] = ended; return ended;
  }
  list(): readonly TraceSpan[] { return this.spans.slice(); }
}
