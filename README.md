# D074 · 子 Agent 接口与边界

D074 定义子 Agent 的父任务关系、任务描述、工具白名单、独立预算和深度，禁止自引用，并提供执行前的工具权限判断。

## 产出

- `src/runtime/sub-agent.ts`：子 Agent 规格和工具准入函数。
- `test/d074-sub-agent.test.ts`：父子关系、预算、深度和工具白名单测试。
- `scripts/d074-sub-agent.ts`：可复现验收脚本。

## 复现

```bash
npm run lint
npm run typecheck
npm test
npm run demo:d074
```

## 边界

本日只定义子 Agent 契约和边界，不启动真实子 Agent、不并行调度，也不允许子 Agent 绕过父任务权限；并行编排留到 D075。
