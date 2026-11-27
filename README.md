# D068 · 长任务质量基准

D068 建立 10/30/50/100 轮任务的统一 Benchmark 结果和汇总模型，记录完成率、工具错误数和成本，为 G3 阶段验收提供可重复的指标入口。

## 产出

- `src/runtime/benchmark.ts`：Benchmark 结果与汇总器。
- `test/d068-benchmark.test.ts`：完成率、成本和空集测试。
- `scripts/d068-benchmark.ts`：10/30/50/100 轮基线脚本。

## 复现

```bash
npm run lint
npm run typecheck
npm test
npm run demo:d068
```

## 边界

当前脚本使用确定性结果样本验证指标计算，不代表真实模型长任务表现；G3 的 40% 成本目标必须基于真实可复跑基线，不由本日样本直接推断。
