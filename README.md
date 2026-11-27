# D051 · 统一上下文预算模型

D051 为长任务建立统一的字符预算测量能力，分别统计消息、工具 Schema 和总上下文占用。Agent Loop 在构造请求后执行预算检查，超预算会明确失败，不静默把工具 Schema 排除在预算之外。

## 产出

- `src/context/budget.ts`：`measureContextBudget`、`toolSchemaChars`、`ContextBudgetReport`。
- Agent Loop 在每轮请求前校验消息与工具 Schema 的合计预算。
- `test/d051-budget.test.ts`：正常、超预算和非法预算测试。
- `scripts/d051-context-budget.ts`：可复现验收脚本。

## 复现

```bash
npm run lint
npm run typecheck
npm test
npm run demo:d051
```

## 边界

当前使用字符数作为可解释的代理指标，不等同于模型 tokenizer 的真实 token 数；本日不做压缩、摘要或语义裁剪。
