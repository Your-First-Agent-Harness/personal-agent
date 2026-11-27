# D069 · G3 综合验收

D069 将 D058、D066、D067、D068 的组件组合为 G3 验收入口，验证 100 轮状态、成本预算、Benchmark 完成率和恢复准备状态能够形成一致报告。

## 产出

- `src/demo/d069.ts`：G3 综合验收函数。
- `scripts/d069-g3-acceptance.ts`：验收脚本。
- `test/d069-g3-acceptance.test.ts`：综合回归测试。

## 复现

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run demo:d069
```

## 边界

这是组件级 G3 验收，不伪造真实模型成本下降 40% 或真实用户长任务成功率；这些指标必须由后续可复跑的真实运行证据支撑。
