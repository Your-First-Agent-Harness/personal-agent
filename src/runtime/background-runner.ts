import { TaskQueue, type QueueTask } from './task-queue.ts';

export interface BackgroundRunner<T, R> {
  submit(id: string, payload: T): QueueTask<T>;
  runNext(worker: (payload: T) => Promise<R>): Promise<QueueTask<T> | undefined>;
  status(id: string): QueueTask<T> | undefined;
}

export function createBackgroundRunner<T, R>(): BackgroundRunner<T, R> {
  const queue = new TaskQueue<T>();
  return {
    submit: (id, payload) => queue.enqueue(id, payload),
    status: (id) => queue.get(id),
    async runNext(worker) {
      const task = queue.claim();
      if (task === undefined) return undefined;
      try {
        return queue.complete(task.id, await worker(task.payload));
      } catch (error) {
        return queue.fail(task.id, error instanceof Error ? error.message : String(error));
      }
    },
  };
}
