import { decideRecovery } from '../src/runtime/recovery.ts';

const decisions = [
  decideRecovery({ retryable: true, interrupted: false, attempts: 1, maxAttempts: 3 }),
  decideRecovery({ retryable: true, interrupted: true, attempts: 1, maxAttempts: 3 }),
  decideRecovery({ retryable: false, interrupted: false, attempts: 1, maxAttempts: 3 }),
];
process.stdout.write(`${JSON.stringify(decisions, null, 2)}\n`);
if (decisions.map(({ action }) => action).join(',') !== 'retry,resume,stop') {
  process.stderr.write('D059 RECOVERY FAIL\n'); process.exitCode = 1;
} else process.stdout.write('D059 RECOVERY PASS\n');
