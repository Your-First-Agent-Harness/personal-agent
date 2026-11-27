# D078 · 托管运行记录与 Run Store

D078 增加内存 Run Store，为后台任务保存运行 id、任务 id、事件、结果和错误，支持查询并禁止结束后继续追加或重复结束。

## 产出

- `src/runtime/run-store.ts`：运行记录存储。
- `test/d078-run-store.test.ts`：正常生命周期和非法操作测试。
- `scripts/d078-run-store.ts`：可复现验收脚本。

## 复现

```bash
npm run lint
npm run typecheck
npm test
npm run demo:d078
```

## 边界

当前 Run Store 是内存实现，尚未接入 SQLite、清理策略或重启恢复；本日固定托管运行记录语义。
