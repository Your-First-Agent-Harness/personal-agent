export type QueueTaskStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface QueueTask<T = unknown> {
  readonly id: string;
  readonly payload: T;
  readonly status: QueueTaskStatus;
  readonly attempts: number;
  readonly result?: unknown;
  readonly error?: string;
}

export class TaskQueue<T = unknown> {
  private readonly tasks = new Map<string, QueueTask<T>>();

  enqueue(id: string, payload: T): QueueTask<T> {
    if (this.tasks.has(id)) throw new Error(`任务已存在：${id}`);
    const task = { id, payload, status: 'queued' as const, attempts: 0 };
    this.tasks.set(id, task);
    return task;
  }

  claim(): QueueTask<T> | undefined {
    const task = [...this.tasks.values()].find(({ status }) => status === 'queued');
    if (task === undefined) return undefined;
    const claimed = { ...task, status: 'running' as const, attempts: task.attempts + 1 };
    this.tasks.set(task.id, claimed);
    return claimed;
  }

  complete(id: string, result: unknown): QueueTask<T> {
    return this.update(id, 'completed', { result });
  }

  fail(id: string, error: string): QueueTask<T> {
    return this.update(id, 'failed', { error });
  }

  get(id: string): QueueTask<T> | undefined { return this.tasks.get(id); }
  list(): readonly QueueTask<T>[] { return [...this.tasks.values()]; }

  private update(id: string, status: 'completed' | 'failed', extra: { result?: unknown; error?: string }): QueueTask<T> {
    const task = this.tasks.get(id);
    if (task === undefined) throw new Error(`未知任务：${id}`);
    if (task.status !== 'running') throw new Error(`任务 ${id} 当前不能进入 ${status}`);
    const updated = { ...task, status, ...extra } as QueueTask<T>;
    this.tasks.set(id, updated);
    return updated;
  }
}
