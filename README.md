# D098 · v1.0.0-rc.1 发布

D098 将产品化版本升级到 `1.0.0-rc.1`，并执行 RC 版本、产品化结构和发布审计的综合验收。

## 产出

- `src/demo/d098.ts`：RC 验收链路。
- `test/d098-rc.test.ts`：RC 回归测试。
- `scripts/d098-rc-acceptance.ts`：可复现 RC 脚本。
- `docs/releases/v1.0.0-rc.1.md`：RC 发布说明。

## 复现

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run demo:d098
```

## 边界

RC 仍不宣称完成真实用户规模、分布式部署或线上模型质量目标；这些证据不能由本地确定性 Demo 替代。
