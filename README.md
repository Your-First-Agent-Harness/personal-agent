# D075 · 并行子 Agent 编排与结果聚合

D075 增加独立子任务的并行执行器和结果聚合器：成功结果继续汇总，单个子 Agent 失败被隔离并带任务 id 返回，不拖垮其他独立任务。

## 产出

- `src/runtime/parallel-agents.ts`：并行执行和聚合 API。
- `test/d075-parallel-agents.test.ts`：全成功和部分失败测试。
- `scripts/d075-parallel-agents.ts`：可复现验收脚本。

## 复现

```bash
npm run lint
npm run typecheck
npm test
npm run demo:d075
```

## 边界

当前并行器不自动限制并发数、不持久化子任务、不接入父 Agent 预算；这些资源隔离和调度约束留到 D076/D077。
