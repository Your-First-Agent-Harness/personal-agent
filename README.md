# D054 · 上下文压缩接口

D054 建立可替换的 `ContextCompactor` 接口，并提供不依赖模型的确定性实现。压缩结果保留系统约束和最新用户目标，把可压缩的用户/工具历史转换为可审计摘要；如果目标预算无法满足，显式失败。

## 产出

- `src/context/compactor.ts`：`ContextCompactor` 与 `DeterministicContextCompactor`。
- `test/d054-compactor.test.ts`：压缩成功和目标不可满足测试。
- `scripts/d054-compaction.ts`：可复现验收脚本。

## 复现

```bash
npm run lint
npm run typecheck
npm test
npm run demo:d054
```

## 边界

当前摘要是确定性文本摘要，不是模型生成摘要；尚未自动接入 Agent Loop，也不声称具备语义等价性。压缩失败会停止，不静默丢弃安全约束。
