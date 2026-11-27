import { evaluateReplay } from '../src/observability/eval.ts';

const passed = evaluateReplay({ id: 'd084-pass', expected: ['task:ok', 'tool:ok'] }, ['task:ok', 'tool:ok']);
const failed = evaluateReplay({ id: 'd084-fail', expected: ['task:ok', 'tool:ok'] }, ['task:ok', 'tool:error']);
process.stdout.write(`${JSON.stringify({ passed, failed }, null, 2)}\n`);
if (!passed.passed || failed.passed || failed.mismatches.length !== 1) {
  process.stderr.write('D084 EVAL FAIL\n'); process.exitCode = 1;
} else process.stdout.write('D084 EVAL PASS\n');
