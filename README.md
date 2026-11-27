# D079 · 运行时恢复与幂等增强

D079 增加工具调用幂等记录：重复调用可以返回已完成结果，未知副作用状态被标记为 unknown 并冻结，避免在证据不足时自动重放。

## 产出

- `src/runtime/idempotency.ts`：幂等记录和重复完成短路。
- `test/d079-idempotency.test.ts`：重复 begin、重复完成和 unknown 状态测试。
- `scripts/d079-idempotency.ts`：可复现验收脚本。

## 复现

```bash
npm run lint
npm run typecheck
npm test
npm run demo:d079
```

## 边界

当前幂等存储是内存实现，尚未与 Run Store/SQLite 自动绑定；unknown 状态不会自动查询外部权威系统，避免把未知当成功。
