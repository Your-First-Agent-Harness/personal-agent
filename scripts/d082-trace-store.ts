import { createReplayInput, TraceStore } from '../src/observability/trace-store.ts';

const store = new TraceStore();
const snapshot = store.save('trace-d082', [
  { id: 's1', traceId: 'trace-d082', name: 'task', startedAt: 1, endedAt: 2, attributes: { taskId: 'task-1' } },
  { id: 's2', traceId: 'trace-d082', parentId: 's1', name: 'tool', startedAt: 2, endedAt: 3, attributes: { tool: 'read_file' } },
]);
const replay = createReplayInput(snapshot);
process.stdout.write(`${JSON.stringify({ snapshot, replay }, null, 2)}\n`);
if (replay.length !== 2 || replay[1]?.name !== 'tool') {
  process.stderr.write('D082 TRACE STORE FAIL\n'); process.exitCode = 1;
} else process.stdout.write('D082 TRACE STORE PASS\n');
