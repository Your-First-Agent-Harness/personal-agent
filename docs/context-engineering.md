# Context Engineering 基线（D060）

D051–D060 建立了 PA 的第一版上下文工程基础：预算计量、优先级裁剪、工具结果截断、确定性压缩、任务摘要、Schema 分组、压力测试、长任务状态和恢复决策。

## 当前可验证能力

| 能力 | 证据 |
|---|---|
| 消息与工具 Schema 统一预算 | `measureContextBudget` 与 D051 测试 |
| system/latest user 优先级 | `buildPrioritizedContext` 与 D052 测试 |
| 超长结果可见截断 | D053 截断测试和 Demo |
| 可替换压缩接口 | `ContextCompactor` 与 D054 测试 |
| 任务状态摘要 | `TaskSummary` 与 D055 测试 |
| Schema 分组展开 | D056 测试和 Demo |
| 压力用例 | D057/D060 baseline |
| 100 轮保险丝 | `TaskStateMachine` 与 D058 测试 |
| 恢复决策 | `decideRecovery` 与 D059 测试 |

## 基线边界

当前预算使用字符数而非 tokenizer token；压缩是确定性文本摘要，不是语义等价的模型摘要；恢复组件尚未接入持久化 Run Store；因此本文件是可复跑的工程基线，不宣称已经完成 G3 的 100 轮成功率或成本下降 40% 验收。

## 复现

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run demo:d060
```
