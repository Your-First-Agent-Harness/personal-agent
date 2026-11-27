# D097 · RC 发布审计

D097 增加发布审计模型，把 lint、typecheck、测试和产品化验收绑定为带证据的审计项，为 `v1.0.0-rc.1` 做准备。

## 产出

- `src/release/audit.ts`：发布审计聚合器。
- `test/d097-release-audit.test.ts`：全通过和失败阻断测试。
- `scripts/d097-release-audit.ts`：可复现审计脚本。
- `docs/release-audit.md`：审计边界和证据说明。

## 复现

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run demo:d097
```

## 边界

审计只聚合仓库内可复核证据，不冒充真实用户流量、外部模型质量或跨平台生产演练。
