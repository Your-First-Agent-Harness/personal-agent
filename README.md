# Personal Agent · D034 MCP 协议走读

> 进度：**D034 / D100 · v0.1.0**
> 当日目标：走读 MCP 的传输、握手、能力协商、工具/资源/提示，交付中文协议笔记与可渲染调用时序图。
> 本日只做 D034，**不实现 D035 Client**，不修改 main 索引。

## 今日交付

| 交付物 | 内容 |
| --- | --- |
| [MCP 中文协议笔记](./docs/d034-mcp-protocol.md) | 角色、JSON-RPC、生命周期、stdio/Streamable HTTP、能力、六个核心方法、错误、安全、D035 验收契约 |
| [MCP 调用时序图](./docs/d034-mcp-sequence.md) | 两张内联 Mermaid：stdio 初始化到 `tools/call`；Streamable HTTP 的 Session、资源/提示、错误与 SSE 重连 |

两份文档中的版本、请求 ID、`protocolVersion`、能力字段、工具名、资源 URI、content 和错误语义互相对照。图是依据规范绘制的教学示例，不是实际抓包。

## 版本范围（先读）

- **主读版本：MCP 2025-11-25**。它定义有状态会话、`initialize` 请求、`notifications/initialized`、初始能力协商和本文的 Session 规则。
- **基础消息：JSON-RPC 2.0**。MCP 2025-11-25 Schema 的 `JSONRPCMessage` 联合不含 Batch，不能从 JSON-RPC 自身支持 Batch 推断 MCP 也支持。
- **当前 latest 边界：MCP 2026-07-28**。本次访问官方站点时，该版已改成逐请求元数据模型，没有 `initialize` 协商握手。本文没有把两代报文混写，D035 也不宣称兼容这一版。
- **历史传输：2024-11-05 HTTP+SSE** 只在笔记中作为旧双 endpoint 模型标注，不与 2025-11-25 Streamable HTTP 混用。
- 官方资料实际访问日期：**2026-11-12**。

权威入口：[2025-11-25 Specification](https://modelcontextprotocol.io/specification/2025-11-25)、[同版本 Schema](https://github.com/modelcontextprotocol/specification/blob/main/schema/2025-11-25/schema.ts)、[2026-07-28 Versioning and Compatibility](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning)。

## 学习路线

### 1. 先建立角色与消息模型

阅读[协议笔记第 2 节](./docs/d034-mcp-protocol.md#2-hostclientserver-与消息边界)，分清：

- Host 是管理连接、权限、用户同意和 LLM 协调的应用。
- Client 是 Host 内与一个 Server 连接的连接器；D035 才计划实现。
- Server 暴露 tools/resources/prompts，也可能反向请求 roots/sampling/elicitation。
- Request 有 `id`，Response 以同一个 `id` 返回 `result` 或 `error`，Notification 无 `id` 且无响应。

### 2. 再走完整生命周期

阅读[协议笔记第 3 节](./docs/d034-mcp-protocol.md#3-生命周期初始化运行关闭)和[stdio 时序图](./docs/d034-mcp-sequence.md#图-1--stdio初始化到-toolscall)：

```text
initialize request
  → initialize result（检查版本与 Server capabilities）
  → notifications/initialized（无 id）
  → tools/list / tools/call
  → 关闭传输（没有 shutdown RPC）
```

注意 `capabilities: {}` 是 Client 不声明可选反向能力，不是 Server 能力查询结果。

### 3. 对照两种标准传输

阅读[协议笔记第 4 节](./docs/d034-mcp-protocol.md#4-stdio-与-streamable-http)和[HTTP 时序图](./docs/d034-mcp-sequence.md#图-2--streamable-httpsession资源提示错误与-sse-重连)，重点检查：

- stdio 的换行分帧与 stdout/stderr 分离。
- POST 的 `Accept: application/json, text/event-stream`。
- JSON 与 SSE 两种 Response 通道、GET SSE 的可选性。
- `Mcp-Session-Id`、`MCP-Protocol-Version`、404 后重新初始化。
- `Last-Event-ID` 只是可选恢复机制，不是自动重连承诺。

### 4. 能力先于方法调用

阅读[能力协商表](./docs/d034-mcp-protocol.md#5-能力协商谁声明谁使用)：

- Server 声明 `tools/resources/prompts/logging`，Client 声明 `roots/sampling/elicitation`。
- `listChanged` 只表示列表变化通知能力；资源的 `subscribe` 是另一个子能力。
- 2025-11-25 的 elicitation 要区分 `form` 与 `url`，空对象只声明 form mode。
- 未声明的能力不能按“先调用看看”处理；D035 选择本地先拒绝，远端协议错误仍如实保留。

### 5. 最后比较三类原语和错误通道

阅读[核心方法](./docs/d034-mcp-protocol.md#6-工具资源提示核心请求与响应)：

| 方法 | 请求关键字段 | 响应关键字段 |
| --- | --- | --- |
| `tools/list` | 可选 `cursor` | `tools[]`、可选 `nextCursor` |
| `tools/call` | `name`、`arguments` | `content[]`、可选 `structuredContent`、`isError` |
| `resources/list` | 可选 `cursor` | `resources[]`、可选 `nextCursor` |
| `resources/read` | `uri` | `contents[]`，每项为 `text` 或 `blob` |
| `prompts/list` | 可选 `cursor` | `prompts[]`、可选 `nextCursor` |
| `prompts/get` | `name`、可选字符串 `arguments` | `messages[]`，含 `role` 与 `content` |

必须分开：`result.isError=true` 是工具执行结果中的失败；外层 `error` 是 JSON-RPC 协议失败；HTTP 状态又是传输层结果。三者不能互相改写。

## 与现有项目代码的边界

本仓库已有 `src/core/tool.ts`、`src/tools/schema.ts` 和 `src/tools/registry.ts`，但它们只定义本项目的 Tool/Registry 契约：

- `categories`、`execute`、`Promise<string>` 不是 MCP 官方线格式。
- 本地 `inputSchema` 相似不代表已经实现 MCP 官方 Tool Schema。
- 本日没有新增 MCP 适配器、Client、Server、请求解析器或校验脚本。
- D035 的接口和验收清单仅在[协议笔记第 9 节](./docs/d034-mcp-protocol.md#9-给-d035-的最小客户端契约尚未实现)中定义，明确标注“尚未实现”。

因此本日纯文档交付没有新增可执行行为，不制造无意义 RED；D035 一旦增加运行时代码，必须先 RED→GREEN。

## 安全阅读清单

阅读[协议笔记安全边界](./docs/d034-mcp-protocol.md#7-安全边界mcp-不会自动替你完成)，至少记住：

1. 工具描述、annotations 和模型意图都不是用户授权。
2. 入参、出参、Prompt 输入输出仍需实现方校验。
3. 用户数据、资源内容和 roots 不能未经同意暴露；日志必须脱敏。
4. MCP 不会自动提供传输认证、授权、权限审批或完整安全边界。
5. HTTP 要验证 `Origin`、限制本地绑定并实施适当认证；Session ID 不是认证凭证。
6. Token passthrough、confused deputy、session hijacking 等风险须看官方安全最佳实践，而不是只看方法 Schema。

官方来源：[Security and Trust & Safety](https://modelcontextprotocol.io/specification/2025-11-25#security-and-trust--safety)、[Authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)、[Security Best Practices](https://modelcontextprotocol.io/specification/2025-11-25/basic/security_best_practices)。

## 图源与渲染

- 图源为 `docs/d034-mcp-sequence.md` 内两段 `mermaid` 代码，无外链图片、无生成媒体。
- 内容依据官方 2025-11-25 Lifecycle、Transports、Tools、Resources、Prompts；每个图后附具体锚点链接。
- 支持 Mermaid 的 Markdown 预览器可直接渲染；也可用 Mermaid CLI 将提取出的图代码渲染为 SVG。
- 图内 `s-123`、`evt-41`、`evt-42` 都是教学示例值，不是真实会话或网络记录。

## 验证方法

在仓库根目录执行：

```bash
npm run check
npm run test:coverage
git diff --check
```

另做两类文档验证：

1. **Mermaid**：提取两段 `mermaid` 代码，用 Mermaid 解析/渲染工具检查语法；工具验证只证明语法可处理，不等同于人工确认所有浏览器布局。
2. **链接**：检查相对链接目标存在，并对官方 HTTPS 链接执行实际 HTTP 请求，记录状态与重定向；网络可达性不等于内容永远不变，所以版本和访问日期必须保留。

### 本次实际验证结果（2026-11-12）

- 运行环境：Node.js `v24.19.0`，npm `11.17.0`。
- `npm run check`：ESLint、TypeScript `tsc --noEmit` 与 Vitest 均通过；共 **37 个测试文件、340 个测试通过**。
- `npm run test:coverage`：共 **37 个测试文件、340 个测试通过**；总覆盖率为 **Statements 93.61% / Branches 89.41% / Functions 99.59% / Lines 95.22%**。本日未改运行时代码，这些结果用于确认既有项目未被破坏，不代表 MCP Client 已有测试。
- **Mermaid**：使用临时调用的 **Mermaid CLI 11.12.0** 和本机 Chrome，将两段图源实际渲染为 SVG，**2/2 成功**，且两个 SVG 均通过 XML 解析。临时文件位于 `/tmp/personal-agent-d034-mermaid/`，未向仓库添加依赖、生成媒体或校验脚本。初次检查发现 Prompt 示例中的分号会触发 Mermaid parse error，修正图源后已重跑通过。
- **相对链接**：检查三份文档中的 **15 个相对链接出现位置**，目标文件均存在，带锚点的链接均匹配目标标题。
- **HTTPS 链接**：对 **36 个唯一 URL** 实际发起请求，均返回 **HTTP 200**。两个 GitHub Schema URL 重定向到 `modelcontextprotocol/modelcontextprotocol`，Security Best Practices URL 重定向到官方 `docs/2025-11-25/...` 路径；外部页面的片段锚点不由 HTTP 请求验证。
- 以上网络结果只代表本日可访问状态；Mermaid 验证证明图源可被该版本工具解析并生成 SVG，不等同于所有 Markdown 预览器或浏览器中的像素级版式保证。

## 限制与下一步

- 本日只完成 D034 文档，不提前实现 D035。
- 没有连接真实外部 MCP Server，没有 OAuth、SSE 抓包或互操作性结论。
- 没有实现 2026-07-28 modern 模型、HTTP Client、Batch、Tasks、roots/sampling/elicitation。
- Mermaid 图是规范示例；真实 Server 的可选能力、分页、错误和重连行为必须按协商与实际响应处理。
- D035 范围建议固定为 **2025-11-25 / stdio / tools 最小客户端**，严格按验收清单测试，不将本地 fixture 说成外部服务。

---

**D034 / D100 · v0.1.0**
