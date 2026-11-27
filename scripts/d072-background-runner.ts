import { createBackgroundRunner } from '../src/runtime/background-runner.ts';

const runner = createBackgroundRunner<{ job: string }, string>();
runner.submit('task-1', { job: 'compile' });
const result = await runner.runNext(({ job }) => Promise.resolve(`${job}:done`));
process.stdout.write(`${JSON.stringify({ result, status: runner.status('task-1') }, null, 2)}\n`);
if (result?.status !== 'completed' || result.result !== 'compile:done') {
  process.stderr.write('D072 BACKGROUND RUNNER FAIL\n'); process.exitCode = 1;
} else process.stdout.write('D072 BACKGROUND RUNNER PASS\n');
