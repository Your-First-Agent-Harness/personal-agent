import { runFinalAudit } from '../release/final-audit.ts';
import { runD098RcAcceptance } from './d098.ts';

export function runD100ReleaseAcceptance(root: string): string {
  const audit = runFinalAudit(root);
  if (!audit.passed) throw new Error('D100 最终审计失败');
  if (runD098RcAcceptance(root) !== 'D098 RC ACCEPTANCE PASS') throw new Error('D100 RC 回归失败');
  return 'D100 V1.0.0 RELEASE ACCEPTANCE PASS';
}
