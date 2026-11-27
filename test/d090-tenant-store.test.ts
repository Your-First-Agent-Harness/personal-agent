import { describe, expect, it } from 'vitest';

import { TenantStore } from '../src/runtime/tenant-store.ts';

describe('D090 多租户隔离与保留', () => {
  it('租户只能读取自己的数据', () => {
    const store = new TenantStore();
    store.createTenant('a', 7);
    store.createTenant('b', 7);
    store.put({ tenantId: 'a', id: 'item-1', createdAt: '2020-01-01T00:00:00.000Z', value: 'A' });
    expect(store.get('a', 'item-1')?.value).toBe('A');
    expect(store.get('b', 'item-1')).toBeUndefined();
  });

  it('拒绝未知租户和非法保留期，支持按时间清理', () => {
    const store = new TenantStore();
    expect(() => store.createTenant('a', 0)).toThrow('retentionDays');
    store.createTenant('a', 7);
    expect(() => store.put({ tenantId: 'missing', id: '1', createdAt: new Date().toISOString(), value: null })).toThrow('未知租户');
    store.put({ tenantId: 'a', id: 'old', createdAt: '2020-01-01T00:00:00.000Z', value: 'old' });
    expect(store.purgeBefore(new Date('2021-01-01T00:00:00.000Z'))).toBe(1);
  });
});
