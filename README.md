# D052 · 消息优先级与确定性裁剪

D052 在已有上下文预算上建立可解释的消息优先级：system 约束和最新用户目标优先，工具调用组保持配对，普通历史在预算不足时裁剪。每条输入消息都会生成保留/裁剪决策及原因。

## 产出

- `src/context/priority.ts`：优先级分类、裁剪决策和 `buildPrioritizedContext`。
- `test/d052-priority.test.ts`：system/latest user 保留和工具组完整性测试。
- `scripts/d052-context-priority.ts`：可复现验收脚本。

## 复现

```bash
npm run lint
npm run typecheck
npm test
npm run demo:d052
```

## 边界

当前优先级是确定性规则，不使用模型摘要；工具组只有完整容纳时才保留，单独的工具消息不会被拼入请求。
