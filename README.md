# D093 · 部署文档与运行时健康检查

D093 增加健康报告 API 和部署/诊断文档，统一说明本地构建、配置优先级、工具发现和当前内存组件的生产边界。

## 产出

- `src/runtime/health.ts`：健康检查报告。
- `test/d093-health.test.ts`：ok/degraded 状态测试。
- `scripts/d093-health.ts`：可复现诊断脚本。
- `docs/deployment.md`：部署和运行时诊断说明。

## 复现

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run demo:d093
```

## 边界

健康报告是进程内基础检查，不等同于线上探针、外部依赖可用性或生产 SLO；部署文档明确列出持久化、认证、锁和观测仍需替换/接入的部分。
