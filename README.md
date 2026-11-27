# D049 · 动态工具检索生产化

> 本分支承接 D048：把“按需加载工具”从可运行 Demo 推进为可审计的运行时能力。

## 今天解决的问题

D048 能够按用户查询裁剪工具 Schema，但检索结果只有工具子集，无法解释“为什么命中这些工具”。D049 为工具增加可选标签元数据、确定性相关性分数和 `tools_retrieved` 事件，同时保持 lazy factory 不会在检索阶段被实例化。

## 新增能力

- 工具标签参与检索评分，名称、描述、标签按固定权重计算。
- `searchToolMatches` 返回工具与稳定分数；同分仍保持注册顺序。
- `DynamicToolRegistry.search()` 暴露检索结果，`list()` 仍只向模型返回纯 Schema。
- Agent Loop 对动态 Registry 发出 `tools_retrieved` 事件，记录查询、工具名和分数。
- 新增 D049 离线 Demo 和回归测试。

## 复现

```bash
npm run demo:d049
npm run lint
npm run typecheck
npm test
```

Demo 会证明：客户/外部系统查询命中 `crm_lookup`，检索阶段不会加载任何 lazy 工具，并输出可审计的命中分数。

## 边界

- 当前是确定性词法检索，不是向量检索，也不声称理解语义同义词。
- 分数是排序用的相对指标，不是概率或质量分数。
- `tools_retrieved` 只对 `DynamicToolRegistry` 发出，普通 `ToolRegistry` 保持既有事件序列兼容。
- Demo 使用脚本 Provider，不证明真实模型的检索质量。

## 下一天

D050：完成 G2 阶段验收，验证工具可插拔、MCP 双向通信、外部系统接入和动态工具检索的联合闭环。
