# D066 · 成本核算

D066 增加统一成本事件和报告，分别统计模型、工具、重试、上下文压缩和等待的单位消耗及耗时，为 G3 的成本预算和降级策略提供输入。

## 产出

- `src/runtime/cost.ts`：成本事件、汇总和按类型报告。
- `test/d066-cost.test.ts`：汇总与非法成本测试。
- `scripts/d066-cost.ts`：可复现验收脚本。

## 复现

```bash
npm run lint
npm run typecheck
npm test
npm run demo:d066
```

## 边界

`units` 是统一计量占位符，不直接等同于供应商账单金额；当前只计算显式事件，不自动采集真实 Provider 价格。
