# D073 · 任务取消、暂停和恢复

D073 增加任务控制状态机，支持 queued/running/paused/cancelled/completed 状态，取消只能发生在未完成任务上，暂停后可以恢复，非法状态转换明确失败。

## 产出

- `src/runtime/task-control.ts`：任务控制器。
- `test/d073-task-control.test.ts`：正常状态流、取消优先和非法转换测试。
- `scripts/d073-task-control.ts`：可复现验收脚本。

## 复现

```bash
npm run lint
npm run typecheck
npm test
npm run demo:d073
```

## 边界

当前控制器只管理状态，不会主动终止 Worker 进程或持久化状态；真实取消信号和恢复检查点需要后续接入运行器。
