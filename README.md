# D070 · G3 发布与 v0.3.0

D070 发布 G3 阶段版本，打包上下文工程、记忆、长任务状态、恢复、成本和 Benchmark 能力，并保留真实证据边界。

## 产出

- `docs/releases/v0.3.0.md`：G3 发布说明。
- `CHANGELOG.md`：v0.3.0 变更记录。
- `package.json` 与 `src/index.ts`：版本升级至 `0.3.0`。
- `v0.3.0` Git tag：在 main 合并后创建。

## 验证

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run demo:d069
```

## 边界

v0.3.0 的 G3 证据是组件级和确定性基线；真实模型的 100 轮成功率、成本下降 40% 和外部用户数据仍未被伪造为已完成。
