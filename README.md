# D090 · 多租户隔离与数据保留

D090 增加进程内租户存储边界：每条数据绑定 `tenantId`，跨租户读取不可见；租户创建时声明正整数保留天数，并提供按时间清理接口。

## 产出

- `src/runtime/tenant-store.ts`：租户、隔离数据和清理策略。
- `test/d090-tenant-store.test.ts`：跨租户隔离、非法租户/保留期和清理测试。
- `scripts/d090-tenant-store.ts`：可复现验收脚本。

## 复现

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run demo:d090
```

## 边界

当前是进程内内存策略，不提供数据库级行权限、加密、跨进程租户认证或自动定时清理；保留天数是契约字段，调用方负责传入清理时间。
