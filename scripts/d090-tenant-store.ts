import { TenantStore } from '../src/runtime/tenant-store.ts';

const store = new TenantStore();
store.createTenant('tenant-a', 30);
store.createTenant('tenant-b', 30);
store.put({ tenantId: 'tenant-a', id: 'run-1', createdAt: new Date().toISOString(), value: { status: 'completed' } });
const visible = store.get('tenant-a', 'run-1');
const isolated = store.get('tenant-b', 'run-1');
process.stdout.write(`${JSON.stringify({ visible, isolated }, null, 2)}\n`);
if (visible?.tenantId !== 'tenant-a' || isolated !== undefined) {
  process.stderr.write('D090 TENANT STORE FAIL\n'); process.exitCode = 1;
} else process.stdout.write('D090 TENANT STORE PASS\n');
