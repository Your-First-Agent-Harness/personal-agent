# D077 · 任务依赖图与 DAG 调度

D077 增加任务依赖图校验和 ready 节点计算：依赖完成后才允许进入下一步，并对未知依赖和循环依赖明确拒绝。

## 产出

- `src/runtime/task-dag.ts`：DAG 校验和 ready 节点选择。
- `test/d077-task-dag.test.ts`：正常、未知依赖和循环依赖测试。
- `scripts/d077-task-dag.ts`：可复现验收脚本。

## 复现

```bash
npm run lint
npm run typecheck
npm test
npm run demo:d077
```

## 边界

当前只计算依赖就绪状态，不执行实际调度或持久化；并行度、失败传播和重试策略由后续托管运行层处理。
