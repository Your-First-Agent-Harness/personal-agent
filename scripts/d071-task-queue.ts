import { TaskQueue } from '../src/runtime/task-queue.ts';

const queue = new TaskQueue<{ action: string }>();
queue.enqueue('task-1', { action: 'benchmark' });
const claimed = queue.claim();
const completed = queue.complete('task-1', { ok: true });
process.stdout.write(`${JSON.stringify({ claimed, completed, all: queue.list() }, null, 2)}\n`);
if (claimed?.status !== 'running' || completed.status !== 'completed') {
  process.stderr.write('D071 TASK QUEUE FAIL\n'); process.exitCode = 1;
} else process.stdout.write('D071 TASK QUEUE PASS\n');
