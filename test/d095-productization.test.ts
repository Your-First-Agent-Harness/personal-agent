import { describe, expect, it } from 'vitest';

import { inspectProductization } from '../src/release/productization.ts';

describe('D095 产品化清单', () => {
  it('识别当前包的发布入口和部署文件', () => {
    const report = inspectProductization(process.cwd());
    expect(report.passed).toBe(true);
    expect(Object.values(report.checks).every(Boolean)).toBe(true);
  });
});
