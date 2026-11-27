import { RunStore } from '../src/runtime/run-store.ts';

const store = new RunStore();
store.start('run-1', 'task-1');
store.append('run-1', 'turn_started');
const completed = store.complete('run-1', { answer: 'done' });
process.stdout.write(`${JSON.stringify({ completed, all: store.list() }, null, 2)}\n`);
if (completed.status !== 'completed' || completed.events.length !== 1) {
  process.stderr.write('D078 RUN STORE FAIL\n'); process.exitCode = 1;
} else process.stdout.write('D078 RUN STORE PASS\n');
