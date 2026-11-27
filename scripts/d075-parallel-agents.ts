import { aggregateParallelResults, runParallelAgents } from '../src/runtime/parallel-agents.ts';

const results = await runParallelAgents([
  { id: 'scan', run: () => Promise.resolve('scan:ok') },
  { id: 'test', run: () => Promise.resolve('test:ok') },
  { id: 'docs', run: () => Promise.reject(new Error('docs unavailable')) },
]);
const aggregate = aggregateParallelResults(results);
process.stdout.write(`${JSON.stringify({ results, aggregate }, null, 2)}\n`);
if (aggregate.succeeded.length !== 2 || aggregate.failed.length !== 1) {
  process.stderr.write('D075 PARALLEL AGENTS FAIL\n'); process.exitCode = 1;
} else process.stdout.write('D075 PARALLEL AGENTS PASS\n');
