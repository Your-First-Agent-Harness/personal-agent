# D084 · Eval 断言与回放对比

D084 增加 Replay Eval：将期望输出与实际回放结果逐项比较，报告长度差异、步骤索引和缺失值，形成可用于 CI 的确定性通过/失败断言。

## 产出

- `src/observability/eval.ts`：EvalCase、EvalResult 和回放比较函数。
- `test/d084-eval.test.ts`：完全匹配与多项差异测试。
- `scripts/d084-eval.ts`：可复现验收脚本。

## 复现

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run demo:d084
```

## 边界

当前 Eval 只比较字符串步骤结果，不包含语义相似度、真实模型质量或线上成功率；它是可重复的组件级回归门禁。
