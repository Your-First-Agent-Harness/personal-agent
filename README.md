# D082 · Trace 持久化与 Replay 输入

D082 增加内存 Trace Store：保存不可变的 trace 快照，并从 span 序列生成确定性的 Replay 输入，作为后续 Replay 执行器的输入契约。

## 产出

- `src/observability/trace-store.ts`：Trace 快照存储和 Replay 输入生成。
- `test/d082-trace-store.test.ts`：保存、查询、复制边界和 Replay 输入测试。
- `scripts/d082-trace-store.ts`：可复现验收脚本。

## 复现

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run demo:d082
```

## 边界

当前快照只存在内存，不写文件或数据库；Replay 输入只描述 span 名称和属性，不执行真实模型或工具调用。
