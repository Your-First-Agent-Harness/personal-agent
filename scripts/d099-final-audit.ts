import { runFinalAudit } from '../src/release/final-audit.ts';

const audit = runFinalAudit(process.cwd());
process.stdout.write(`${JSON.stringify(audit, null, 2)}\n`);
if (!audit.passed) {
  process.stderr.write('D099 FINAL AUDIT FAIL\n'); process.exitCode = 1;
} else process.stdout.write('D099 FINAL AUDIT PASS\n');
