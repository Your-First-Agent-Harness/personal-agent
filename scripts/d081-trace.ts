import { TraceRecorder } from '../src/observability/trace.ts';

const trace = new TraceRecorder('trace-d081');
const root = trace.start('background_task', undefined, { taskId: 'task-1' });
const child = trace.start('worker', root.id, { worker: 'default' });
trace.end(child.id, { status: 'completed' });
trace.end(root.id, { status: 'completed' });
const spans = trace.list();
process.stdout.write(`${JSON.stringify(spans, null, 2)}\n`);
if (spans.length !== 2 || spans.some((span) => span.endedAt === undefined)) {
  process.stderr.write('D081 TRACE FAIL\n'); process.exitCode = 1;
} else process.stdout.write('D081 TRACE PASS\n');
