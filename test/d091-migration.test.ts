import { describe, expect, it } from 'vitest';

import { migrateRecord } from '../src/runtime/migration.ts';

describe('D091 数据迁移', () => {
  it('按连续版本迁移记录', () => {
    const migrations = new Map([
      [1, (data: { value: number }) => ({ value: data.value + 1 })],
      [2, (data: { value: number }) => ({ value: data.value * 2 })],
    ]);
    expect(migrateRecord({ version: 1, data: { value: 2 } }, 3, migrations)).toEqual({ version: 3, data: { value: 6 } });
  });

  it('拒绝降级和缺失迁移', () => {
    expect(() => migrateRecord({ version: 2, data: {} }, 1, new Map())).toThrow('不低于');
    expect(() => migrateRecord({ version: 1, data: {} }, 3, new Map())).toThrow('缺少版本');
  });
});
