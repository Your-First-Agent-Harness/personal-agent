import { randomUUID } from 'node:crypto';

import { TaskQueue } from './runtime/task-queue.ts';

export interface TaskSubmission<T> { readonly id?: string; readonly payload: T; }
export interface TaskHandle<T> { readonly id: string; readonly get: () => ReturnType<TaskQueue<T>['get']>; }

export class PersonalAgentClient<T = unknown> {
  private readonly queue = new TaskQueue<T>();

  submit(input: TaskSubmission<T>): TaskHandle<T> {
    const id = input.id ?? randomUUID();
    this.queue.enqueue(id, input.payload);
    return { id, get: () => this.queue.get(id) };
  }
  list(): readonly ReturnType<TaskQueue<T>['get']>[] { return this.queue.list().map((task) => task); }
}
