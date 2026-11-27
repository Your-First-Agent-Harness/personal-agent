import { describe, expect, it } from 'vitest';

import { runFinalAudit } from '../src/release/final-audit.ts';

describe('D099 最终发布审计', () => {
  it('RC 的产品化和 API 审计全部通过', () => {
    const audit = runFinalAudit(process.cwd());
    expect(audit.version).toBe('1.0.0');
    expect(audit.passed).toBe(true);
    expect(audit.items).toHaveLength(3);
  });
});
