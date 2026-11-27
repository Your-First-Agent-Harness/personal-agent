# D071 · 任务队列抽象

D071 增加任务队列核心抽象，支持任务创建、领取、完成、失败和查询，并对重复任务、未知任务和非法状态转换显式失败。

## 产出

- `src/runtime/task-queue.ts`：内存任务队列和状态模型。
- `test/d071-task-queue.test.ts`：正常流、幂等和失败路径测试。
- `scripts/d071-task-queue.ts`：可复现验收脚本。

## 复现

```bash
npm run lint
npm run typecheck
npm test
npm run demo:d071
```

## 边界

当前队列是内存实现，尚未接入 SQLite 或后台 Worker；D071 只固定状态语义，持久化和后台执行留到后续分支。
