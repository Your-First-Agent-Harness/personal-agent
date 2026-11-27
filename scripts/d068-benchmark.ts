import { summarizeBenchmark } from '../src/runtime/benchmark.ts';

const summary = summarizeBenchmark([
  { turns: 10, completed: true, toolErrors: 0, totalUnits: 10 },
  { turns: 30, completed: true, toolErrors: 1, totalUnits: 20 },
  { turns: 50, completed: true, toolErrors: 1, totalUnits: 30 },
  { turns: 100, completed: false, toolErrors: 3, totalUnits: 60 },
]);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
if (summary.cases.length !== 4 || summary.completionRate !== 0.75) {
  process.stderr.write('D068 BENCHMARK FAIL\n'); process.exitCode = 1;
} else process.stdout.write('D068 BENCHMARK PASS\n');
