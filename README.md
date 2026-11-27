# D096 · 产品化全链路验收

D096 将 CLI 任务、配置展示和工具能力清单串成可复现的本地产品化验收，确认构建产物可执行且敏感配置不会进入输出。

## 产出

- `scripts/d096-product-acceptance.ts`：综合 CLI 验收脚本。
- `test/d096-product-acceptance.test.ts`：构建产物和验收回归测试。
- `docs/product-acceptance.md`：验收步骤与能力边界。

## 复现

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run demo:d096
```

## 边界

D096 是本地构建产物验收，不证明真实模型、跨机器部署、持久化队列或生产身份系统。
