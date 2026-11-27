import { calculateCost } from '../src/runtime/cost.ts';

const report = calculateCost([
  { kind: 'model', units: 120, durationMs: 900 },
  { kind: 'tool', units: 3, durationMs: 120 },
  { kind: 'retry', units: 1, durationMs: 40 },
  { kind: 'compaction', units: 8, durationMs: 20 },
]);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (report.totalUnits !== 132 || report.totalDurationMs !== 1080) {
  process.stderr.write('D066 COST FAIL\n'); process.exitCode = 1;
} else process.stdout.write('D066 COST PASS\n');
