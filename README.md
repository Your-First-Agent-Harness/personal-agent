# D061 · 短期记忆与长期记忆边界

D061 明确 Session、Task Summary 和 Long-term Memory 的边界：普通对话、工具事实和 Agent 推断只保留在短期层；只有用户明确表达稳定偏好或长期指令时，才允许进入长期记忆候选。

## 产出

- `src/memory/layers.ts`：记忆层分类和长期记忆准入判断。
- `test/d061-memory-layers.test.ts`：用户、工具、Agent 来源边界测试。
- `scripts/d061-memory-layers.ts`：可复现验收脚本。

## 复现

```bash
npm run lint
npm run typecheck
npm test
npm run demo:d061
```

## 边界

当前只定义分类和准入规则，不执行持久化写入；关键词分类不是完整自然语言理解，后续 D062 再实现写入策略和去重。
