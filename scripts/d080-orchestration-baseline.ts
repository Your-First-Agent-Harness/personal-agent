import { TaskQueue } from '../src/runtime/task-queue.ts';
import { RunStore } from '../src/runtime/run-store.ts';
import { IdempotencyStore } from '../src/runtime/idempotency.ts';

const queue = new TaskQueue();
queue.enqueue('task-1', { action: 'run' });
const claimed = queue.claim();
const runs = new RunStore();
runs.start('run-1', 'task-1');
runs.append('run-1', 'claimed');
const idempotency = new IdempotencyStore<string>();
idempotency.begin('call-1');
idempotency.complete('call-1', 'ok');
const report = { taskStatus: claimed?.status, runEvents: runs.get('run-1')?.events, idempotentResult: idempotency.get('call-1')?.result };
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (report.taskStatus !== 'running' || report.runEvents?.[0] !== 'claimed' || report.idempotentResult !== 'ok') {
  process.stderr.write('D080 ORCHESTRATION BASELINE FAIL\n'); process.exitCode = 1;
} else process.stdout.write('D080 ORCHESTRATION BASELINE PASS\n');
