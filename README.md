# D055 · 会话摘要与任务状态摘要

D055 将长会话中的目标、已完成步骤、失败步骤、待办和系统约束转换为结构化 `TaskSummary`，并提供稳定文本格式，供后续压缩、恢复和长任务状态机使用。

## 产出

- `src/context/task-summary.ts`：任务摘要模型、提取器和格式化器。
- `test/d055-task-summary.test.ts`：成功、失败和待办状态测试。
- `scripts/d055-task-summary.ts`：可复现验收脚本。

## 复现

```bash
npm run lint
npm run typecheck
npm test
npm run demo:d055
```

## 边界

当前通过结构化工具结果文本识别失败状态，不替代正式 Run 状态机；尚未持久化，也不声称可以理解任意自然语言中的全部任务状态。
