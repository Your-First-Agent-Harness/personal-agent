# D064 · 记忆冲突、版本与过期

D064 增加长期记忆版本模型：保留版本号、active 状态和过期时间；同一 key 存在不同有效内容时报告冲突，不静默选择旧值或新值。

## 产出

- `src/memory/conflicts.ts`：版本过滤和冲突检测。
- `test/d064-memory-conflicts.test.ts`：冲突、过期、失活测试。
- `scripts/d064-memory-conflicts.ts`：可复现验收脚本。

## 复现

```bash
npm run lint
npm run typecheck
npm test
npm run demo:d064
```

## 边界

本日只检测和报告冲突，不替用户做不可逆的偏好选择；版本尚未持久化，后续需要接入存储和审批策略。
