# D100 · v1.0.0 正式发布

D100 将版本从 RC 升级到 `1.0.0`，执行最终发布审计和 RC 回归，生成正式发布说明。

## 产出

- `src/demo/d100.ts`：最终审计 → RC 回归验收链路。
- `test/d100-release.test.ts`：v1.0.0 正式发布回归测试。
- `scripts/d100-release-acceptance.ts`：可复现最终验收脚本。
- `docs/releases/v1.0.0.md`：正式发布说明和能力边界。

## 复现

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run demo:d100
```

成功时必须看到：

```text
D100 V1.0.0 RELEASE ACCEPTANCE PASS
```

## 边界

v1.0.0 的证据来自确定性本地测试和脚本，不冒充真实用户规模、真实模型长任务成功率、真实成本下降、分布式故障恢复或线上 SLO 证据。
