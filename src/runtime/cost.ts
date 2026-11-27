export interface CostEvent {
  readonly kind: 'model' | 'tool' | 'retry' | 'compaction' | 'wait';
  readonly units: number;
  readonly durationMs?: number;
}

export interface CostReport {
  readonly totalUnits: number;
  readonly totalDurationMs: number;
  readonly byKind: Readonly<Record<CostEvent['kind'], number>>;
}

export function calculateCost(events: readonly CostEvent[]): CostReport {
  const byKind: Record<CostEvent['kind'], number> = {
    model: 0, tool: 0, retry: 0, compaction: 0, wait: 0,
  };
  let totalUnits = 0;
  let totalDurationMs = 0;
  for (const event of events) {
    if (!Number.isFinite(event.units) || event.units < 0) throw new Error('成本 units 必须是非负数');
    byKind[event.kind] += event.units;
    totalUnits += event.units;
    totalDurationMs += event.durationMs ?? 0;
  }
  return { totalUnits, totalDurationMs, byKind };
}
