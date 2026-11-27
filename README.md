# D091 · 数据版本迁移与兼容

D091 增加通用版本化记录迁移器：从当前版本按连续步骤迁移到目标版本，缺少迁移步骤或尝试降级时明确失败。

## 产出

- `src/runtime/migration.ts`：版本记录、迁移函数和连续迁移器。
- `test/d091-migration.test.ts`：正常迁移、降级和缺失迁移测试。
- `scripts/d091-migration.ts`：可复现验收脚本。

## 复现

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run demo:d091
```

## 边界

当前迁移器只处理内存对象，不自动扫描数据库、不提供回滚事务或跨版本备份；生产迁移仍需要持久化层配合。
