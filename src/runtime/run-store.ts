export interface RunRecord {
  readonly id: string;
  readonly taskId: string;
  readonly status: 'running' | 'completed' | 'failed';
  readonly events: readonly string[];
  readonly result?: unknown;
  readonly error?: string;
}

export class RunStore {
  private readonly runs = new Map<string, RunRecord>();

  start(id: string, taskId: string): RunRecord {
    if (this.runs.has(id)) throw new Error(`运行记录已存在：${id}`);
    const run = { id, taskId, status: 'running' as const, events: [] as string[] };
    this.runs.set(id, run); return run;
  }
  append(id: string, event: string): RunRecord {
    const run = this.require(id);
    if (run.status !== 'running') throw new Error('已结束的运行不能追加事件');
    const next = { ...run, events: [...run.events, event] };
    this.runs.set(id, next); return next;
  }
  complete(id: string, result: unknown): RunRecord { return this.finish(id, 'completed', { result }); }
  fail(id: string, error: string): RunRecord { return this.finish(id, 'failed', { error }); }
  get(id: string): RunRecord | undefined { return this.runs.get(id); }
  list(): readonly RunRecord[] { return [...this.runs.values()]; }

  private require(id: string): RunRecord {
    const run = this.runs.get(id);
    if (run === undefined) throw new Error(`未知运行记录：${id}`);
    return run;
  }
  private finish(id: string, status: 'completed' | 'failed', extra: { result?: unknown; error?: string }): RunRecord {
    const run = this.require(id);
    if (run.status !== 'running') throw new Error('运行记录已结束');
    const next = { ...run, status, ...extra } as RunRecord;
    this.runs.set(id, next); return next;
  }
}
