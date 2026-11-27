import { describe, expect, it } from 'vitest';

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

describe('D096 产品化全链路验收', () => {
  it('构建产物存在并能执行综合 CLI 验收脚本', () => {
    expect(existsSync('dist/cli/main.js')).toBe(true);
    const output = execFileSync('node', ['scripts/d096-product-acceptance.ts'], { encoding: 'utf8' });
    expect(output).toContain('D096 PRODUCT ACCEPTANCE PASS');
  });
});
