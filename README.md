# D062 · 长期记忆写入策略

D062 增加长期记忆写入器：只接受 D061 定义的稳定用户记忆候选，拒绝普通会话和工具事实，并按稳定 key 去重、更新，返回每次写入的 accepted/rejected/updated 证据。

## 产出

- `src/memory/writer.ts`：`MemoryWriter`、候选和写入结果模型。
- `test/d062-memory-writer.test.ts`：准入、拒绝、更新测试。
- `scripts/d062-memory-writer.ts`：可复现验收脚本。

## 复现

```bash
npm run lint
npm run typecheck
npm test
npm run demo:d062
```

## 边界

当前是内存写入器，不是持久化存储；key 由调用方提供，尚未实现冲突版本、过期和跨进程恢复。
