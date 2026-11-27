import { createReleaseAudit } from '../release/audit.ts';
import { inspectProductization } from '../release/productization.ts';

export function runD098RcAcceptance(root: string): string {
  const product = inspectProductization(root);
  const audit = createReleaseAudit('1.0.0-rc.1', [
    { id: 'productization', description: '产品化结构', passed: product.passed, evidence: 'D095 PRODUCTIZATION PASS' },
    { id: 'version', description: 'RC 版本', passed: product.version === '1.0.0-rc.1', evidence: product.version },
  ]);
  if (!audit.passed) throw new Error('D098 RC 验收失败');
  return 'D098 RC ACCEPTANCE PASS';
}
