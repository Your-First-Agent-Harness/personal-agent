# D067 · 成本预算与降级策略

D067 为任务成本增加 continue/degrade/stop 三段式决策：低于阈值继续，接近预算时降级模型或工具策略，达到上限时停止，避免成本无界增长。

## 产出

- `src/runtime/cost-budget.ts`：成本预算决策。
- `test/d067-cost-budget.test.ts`：三种决策和非法参数测试。
- `scripts/d067-cost-budget.ts`：可复现验收脚本。

## 复现

```bash
npm run lint
npm run typecheck
npm test
npm run demo:d067
```

## 边界

当前只返回决策，不自动切换模型或修改工具清单；预算单位仍是内部计量单位，不等同于实际货币成本。
