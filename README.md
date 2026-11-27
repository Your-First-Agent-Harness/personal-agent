# D053 · 工具结果分层截断

D053 为超长工具结果建立显式截断边界：工具结果保留开头以保留标题、字段和错误上下文；assistant 文本保留尾部以保留最新结论；两者都带有可识别的截断标记并严格受消息预算限制。

## 产出

- `src/context/truncate.ts`：工具结果和 assistant 文本截断器。
- `test/d053-truncation.test.ts`：正常、角色错误和非法预算测试。
- `scripts/d053-truncation.ts`：可复现验收脚本。

## 复现

```bash
npm run lint
npm run typecheck
npm test
npm run demo:d053
```

## 边界

当前截断按字符数执行；工具结果只保留头部，未实现字段级 JSON 摘要、引用抽取或模型摘要。截断是可见的，不把截断结果伪装成完整输出。
