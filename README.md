# D072 · 后台任务运行与状态查询

D072 在任务队列之上增加后台 Runner：提交任务后由 Worker 领取执行，成功结果和失败原因都写回任务状态，并可按任务 ID 查询。

## 产出

- `src/runtime/background-runner.ts`：后台任务 Runner。
- `test/d072-background-runner.test.ts`：成功、失败和空队列测试。
- `scripts/d072-background-runner.ts`：可复现验收脚本。

## 复现

```bash
npm run lint
npm run typecheck
npm test
npm run demo:d072
```

## 边界

当前 Runner 是进程内单 Worker 调度，不是守护进程或分布式队列；进程重启恢复和 CLI 状态查询留到后续分支。
