export interface TenantRecord {
  readonly tenantId: string;
  readonly createdAt: string;
  readonly retentionDays: number;
}

export interface TenantItem {
  readonly tenantId: string;
  readonly id: string;
  readonly createdAt: string;
  readonly value: unknown;
}

export class TenantStore {
  private readonly tenants = new Map<string, TenantRecord>();
  private readonly items = new Map<string, TenantItem>();

  createTenant(tenantId: string, retentionDays: number): TenantRecord {
    if (tenantId.trim() === '') throw new Error('tenantId 不能为空');
    if (!Number.isSafeInteger(retentionDays) || retentionDays <= 0) throw new Error('retentionDays 必须是正整数');
    if (this.tenants.has(tenantId)) throw new Error(`租户已存在：${tenantId}`);
    const tenant = { tenantId, createdAt: new Date().toISOString(), retentionDays };
    this.tenants.set(tenantId, tenant); return tenant;
  }
  put(item: TenantItem): TenantItem {
    if (!this.tenants.has(item.tenantId)) throw new Error(`未知租户：${item.tenantId}`);
    this.items.set(this.key(item.tenantId, item.id), item); return item;
  }
  get(tenantId: string, id: string): TenantItem | undefined { return this.items.get(this.key(tenantId, id)); }
  purgeBefore(cutoff: Date): number {
    let count = 0;
    for (const [key, item] of this.items) if (new Date(item.createdAt) < cutoff) { this.items.delete(key); count += 1; }
    return count;
  }
  private key(tenantId: string, id: string): string { return `${tenantId}:${id}`; }
}
