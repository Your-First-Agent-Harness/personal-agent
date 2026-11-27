import { inspectProductization } from '../src/release/productization.ts';

const report = inspectProductization(process.cwd());
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) {
  process.stderr.write('D095 PRODUCTIZATION FAIL\n'); process.exitCode = 1;
} else process.stdout.write('D095 PRODUCTIZATION PASS\n');
