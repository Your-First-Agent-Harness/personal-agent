# D065 · 任务计划与检查点

D065 增加结构化任务计划：复杂任务可以拆成有 id 的步骤，每步记录 pending/running/completed/failed 状态和尝试次数，为后续恢复和成本统计提供检查点。

## 产出

- `src/runtime/task-plan.ts`：任务计划、步骤状态和更新函数。
- `test/d065-task-plan.test.ts`：状态、尝试次数和非法步骤测试。
- `scripts/d065-task-plan.ts`：可复现验收脚本。

## 复现

```bash
npm run lint
npm run typecheck
npm test
npm run demo:d065
```

## 边界

当前计划是内存不可变数据结构，尚未持久化或自动调度步骤；步骤依赖关系和 DAG 调度留到后续阶段。
