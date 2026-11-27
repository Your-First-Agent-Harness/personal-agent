# D076 · 子 Agent 权限与资源隔离

D076 为子 Agent 增加最大派生深度、最大子任务数量和单子任务预算限制，所有越界行为在启动前拒绝，防止无限派生和资源失控。

## 产出

- `src/runtime/sub-agent-policy.ts`：子 Agent 策略校验。
- `test/d076-sub-agent-policy.test.ts`：允许和三类越界测试。
- `scripts/d076-sub-agent-policy.ts`：可复现验收脚本。

## 复现

```bash
npm run lint
npm run typecheck
npm test
npm run demo:d076
```

## 边界

本日只执行启动前策略校验，不实现运行中动态资源回收或跨进程隔离；这些能力需要后续任务调度和托管运行支持。
