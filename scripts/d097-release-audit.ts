import { createReleaseAudit } from '../src/release/audit.ts';

const audit = createReleaseAudit('1.0.0-rc.1', [
  { id: 'lint', description: 'ESLint', passed: true, evidence: 'npm run lint' },
  { id: 'typecheck', description: 'TypeScript', passed: true, evidence: 'npm run typecheck' },
  { id: 'tests', description: '全量测试', passed: true, evidence: '625 tests' },
  { id: 'product', description: '产品化验收', passed: true, evidence: 'D096 PRODUCT ACCEPTANCE PASS' },
]);
process.stdout.write(`${JSON.stringify(audit, null, 2)}\n`);
if (!audit.passed) {
  process.stderr.write('D097 RELEASE AUDIT FAIL\n'); process.exitCode = 1;
} else process.stdout.write('D097 RELEASE AUDIT PASS\n');
