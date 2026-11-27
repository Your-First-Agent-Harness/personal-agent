import { createHealthReport } from '../src/runtime/health.ts';

const report = createHealthReport('0.4.0', { config: true, taskQueue: true, trace: true });
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (report.status !== 'ok') {
  process.stderr.write('D093 HEALTH FAIL\n'); process.exitCode = 1;
} else process.stdout.write('D093 HEALTH PASS\n');
