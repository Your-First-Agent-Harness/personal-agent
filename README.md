# D063 · 长期记忆检索与来源解释

D063 增加长期记忆关键词检索，返回稳定排序、匹配分数、记忆 key 和来源，确保 PA 使用记忆时可以解释“这条信息从哪里来”。

## 产出

- `src/memory/retriever.ts`：确定性记忆检索器和来源元数据。
- `test/d063-memory-retriever.test.ts`：匹配、无匹配和非法 limit 测试。
- `scripts/d063-memory-retriever.ts`：可复现验收脚本。

## 复现

```bash
npm run lint
npm run typecheck
npm test
npm run demo:d063
```

## 边界

当前为内存关键词检索，不是向量检索；没有自动把结果注入模型上下文，调用方必须显式选择和展示来源。
