# D050 · G2 阶段验收与 v0.2.0 发布

> 本分支完成第二阶段关卡 G2：验证工具可插拔、动态检索、MCP 双向通信和外部系统接入能够组成一个可复现的联合闭环。

## 今天解决的问题

D049 已经把动态工具检索生产化，但 G2 还需要证明它能与既有 MCP 和第三方 API 能力一起工作，而不是三个彼此孤立的 Demo。D050 将这些能力放进同一个确定性验收入口，并生成 v0.2.0 发布说明。

## 新增产出

- `src/demo/d050.ts`：G2 联合验收 Demo。
- `scripts/d050-g2-acceptance.ts`：可直接运行的验收脚本。
- `test/d050-g2-acceptance.test.ts`：G2 阶段回归测试。
- `docs/releases/v0.2.0.md`：发布说明与边界声明。
- `npm run demo:d050`：一条命令验证动态工具、外部 API 和 MCP 双后端。

## 复现

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run demo:d050
```

成功时必须看到：

```text
D050 G2 ACCEPTANCE PASS
```

## G2 验收内容

1. 动态工具检索返回稳定匹配和评分，lazy factory 不在检索阶段实例化。
2. 外部 API Tool 完成结构化响应闭环；验收采用显式注入的离线 transport，不伪装在线网络证据。
3. MCP Client 完成握手、工具发现和调用；local 与 MCP 后端对同一工作区完成同一任务，并验证关闭和清理。
4. 原有 G1–G2 失败路径和回归测试继续通过。

## 边界

- 检索是确定性词法/标签匹配，不是语义向量检索。
- D050 Demo 使用脚本 Provider 和离线天气 transport，证明的是 Harness 的组合行为与契约边界，不是模型智能或外部网络稳定性。
- MCP 当前限定 stdio、tools 和 `2025-11-25` 协议版本；不包含 HTTP、resources、prompts、sampling 或动态工具列表通知。

## 下一天

G2 已完成。下一阶段进入 D051：统一上下文预算模型，为 100 轮长任务和 G3 成本目标建立可度量基础。
