import { replayTrace } from '../src/observability/replay.ts';

const result = await replayTrace([
  { name: 'task', attributes: { id: 'task-1' } },
  { name: 'tool', attributes: { tool: 'read_file' } },
], (step) => Promise.resolve(`${step.name}:replayed`));
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.matched || result.steps.length !== 2) {
  process.stderr.write('D083 REPLAY FAIL\n'); process.exitCode = 1;
} else process.stdout.write('D083 REPLAY PASS\n');
