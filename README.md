# D085 · G4 综合验收与 v0.4.0

D085 将 D081–D084 的 Trace、Trace Store、Replay 和 Eval 串成 G4 全链路验收，并发布 `v0.4.0`。

## 产出

- `src/demo/d085.ts`：Trace → Store → Replay → Eval 验收链路。
- `test/d085-g4-acceptance.test.ts`：G4 回归测试。
- `scripts/d085-g4-acceptance.ts`：可复现验收脚本。
- `docs/releases/v0.4.0.md`：发布说明和证据边界。

## 复现

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run demo:d085
```

成功时必须看到：

```text
D085 G4 ACCEPTANCE PASS
```

## 边界

v0.4.0 证明组件级 Trace/Replay/Eval 链路，不宣称真实模型质量、在线稳定性或生产级分布式观测能力。
