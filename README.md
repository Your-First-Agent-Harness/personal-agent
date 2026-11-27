# D058 · 100 轮任务状态机

D058 增加长任务状态记录：每轮记录进度标识和状态，支持最大轮次保险丝与连续无进展检测，避免 Agent 在重复动作中无限循环。

## 产出

- `src/runtime/task-state.ts`：任务状态机和轮次快照。
- `test/d058-task-state.test.ts`：最大轮次、无进展和完成优先级测试。
- `scripts/d058-task-state.ts`：可复现验收脚本。

## 复现

```bash
npm run lint
npm run typecheck
npm test
npm run demo:d058
```

## 边界

本日状态机是独立运行时组件，尚未改变既有 Agent Loop 的停止语义；`progressKey` 由编排层提供，不自动判断自然语言任务是否真的有进展。
