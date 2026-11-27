export type ControlledTaskStatus = 'queued' | 'running' | 'paused' | 'cancelled' | 'completed';

export interface ControlledTask {
  readonly id: string;
  readonly status: ControlledTaskStatus;
}

export class TaskController {
  private readonly tasks = new Map<string, ControlledTask>();

  create(id: string): ControlledTask {
    if (this.tasks.has(id)) throw new Error(`任务已存在：${id}`);
    const task = { id, status: 'queued' as const };
    this.tasks.set(id, task); return task;
  }
  start(id: string): ControlledTask { return this.transition(id, 'running', ['queued', 'paused']); }
  pause(id: string): ControlledTask { return this.transition(id, 'paused', ['running']); }
  cancel(id: string): ControlledTask { return this.transition(id, 'cancelled', ['queued', 'running', 'paused']); }
  complete(id: string): ControlledTask { return this.transition(id, 'completed', ['running']); }
  get(id: string): ControlledTask | undefined { return this.tasks.get(id); }

  private transition(id: string, status: ControlledTaskStatus, from: readonly ControlledTaskStatus[]): ControlledTask {
    const task = this.tasks.get(id);
    if (task === undefined) throw new Error(`未知任务：${id}`);
    if (!from.includes(task.status)) throw new Error(`任务 ${id} 不能从 ${task.status} 进入 ${status}`);
    const next = { id, status };
    this.tasks.set(id, next); return next;
  }
}
