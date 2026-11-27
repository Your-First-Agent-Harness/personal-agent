import { describe, expect, it } from 'vitest';

import { createReleaseAudit } from '../src/release/audit.ts';

describe('D097 发布审计', () => {
  it('所有验收证据通过时生成通过审计', () => {
    const audit = createReleaseAudit('1.0.0-rc.1', [
      { id: 'tests', description: '全量测试', passed: true, evidence: '625 tests' },
      { id: 'acceptance', description: '产品验收', passed: true, evidence: 'D096 PASS' },
    ]);
    expect(audit.passed).toBe(true);
  });

  it('任一失败证据会阻断发布', () => {
    expect(createReleaseAudit('1.0.0-rc.1', [{ id: 'build', description: 'build', passed: false, evidence: 'failed' }]).passed).toBe(false);
  });
});
