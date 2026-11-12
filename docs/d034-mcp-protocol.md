# D034 · MCP 协议走读

> 配套时序图：[D034 MCP 调用时序图](./d034-mcp-sequence.md)
> 官方资料实际访问日期：**2026-11-12**（Asia/Shanghai）
> 主读协议版本：**2025-11-25**；基础消息格式：**JSON-RPC 2.0**

## 1. 版本范围：先分清两代协议

本日任务要求走读 `initialize → notifications/initialized → 正常调用 → 关闭`，因此选择官方 **2025-11-25** 规范及其同版本 TypeScript/JSON Schema 作为主读版本。该版本是有状态会话、初始化握手和能力协商模型。

访问官方资料时，站点显示当前 latest 为 **2026-07-28**。这一版把 2025-11-25 及更早版本称为 *legacy*，改为逐请求携带版本、身份和能力元数据，**没有 `initialize` 协商握手**。因此：

- **规范事实**：本文除本节的版本边界说明外，所有 `initialize`、会话和能力示例均只属于 **2025-11-25**，不能当作 2026-07-28 的报文。
- **本项目取舍**：D034 只走读；D035 的最小客户端契约冻结为 **2025-11-25 / stdio / tools**，不宣称兼容 2026-07-28。
- **后续工作**：若要支持 2026-07-28，应另立任务实现 `server/discover`、逐请求 `_meta` 与新旧时代探测，不能把两套生命周期拼在一起。

官方来源：[2025-11-25 生命周期](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle)、[2026-07-28 版本与兼容性](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning)、[2025-11-25 TypeScript Schema](https://github.com/modelcontextprotocol/specification/blob/main/schema/2025-11-25/schema.ts)。

文中使用三类标记：

| 标记 | 含义 |
| --- | --- |
| **规范要求** | 官方规范或 Schema 定义的报文、MUST/MUST NOT 等约束 |
| **实现建议** | 官方 SHOULD/MAY 或实现注意事项，不伪装成强制要求 |
| **本项目取舍** | 本仓库 D034/D035 的范围决定，不是 MCP 官方要求 |

---

## 2. Host、Client、Server 与消息边界

来源：[2025-11-25 Architecture](https://modelcontextprotocol.io/specification/2025-11-25/architecture)、[Base Protocol](https://modelcontextprotocol.io/specification/2025-11-25/basic)。

### 2.1 三个角色

| 角色 | 规范职责 | 本项目的对应位置 |
| --- | --- | --- |
| **Host** | 发起连接的 LLM 应用；创建和管理多个 Client，控制权限、用户授权、上下文聚合和 LLM 协调 | `Agent`、Runtime 和未来宿主 UI 的协作层；不等于某个 MCP 方法 |
| **Client** | Host 内的连接器；与一个 Server 建立一条有状态会话，完成协商、路由消息、订阅和通知 | **D035 才计划实现，本日尚未实现** |
| **Server** | 暴露 tools/resources/prompts，也可通过 Client 请求 roots/sampling/elicitation；可为本地子进程或远程服务 | D034 没有内置或连接任何 MCP Server |

**规范要求**：该版本架构中，一个 Host 可创建多个 Client，每个 Client 与特定 Server 为 **1:1** 关系。Server 不应能读取整个对话或看到其他 Server，隔离由 Host 实施。

### 2.2 JSON-RPC 2.0 三类消息

来源：[MCP Base Protocol · Messages](https://modelcontextprotocol.io/specification/2025-11-25/basic#messages)、[MCP 2025-11-25 Schema Reference](https://modelcontextprotocol.io/specification/2025-11-25/schema)、[JSON-RPC 2.0 Specification](https://www.jsonrpc.org/specification)。

| 类型 | 必要字段 | 是否有响应 | 要点 |
| --- | --- | --- | --- |
| Request | `jsonrpc: "2.0"`、`id`、`method`，可选 `params` | 有且只有成功或错误响应 | MCP 的 `id` 只能是 string 或 number，不能为 `null` |
| Result Response | `jsonrpc`、同一个 `id`、`result` | 本身就是响应 | 不同时携带 `error` |
| Error Response | `jsonrpc`、对应的 `id`、`error` | 本身就是响应 | `error` 含 `code: number`、`message: string`，可选 `data` |
| Notification | `jsonrpc`、`method`，可选 `params`；**无 `id`** | **无响应** | `notifications/initialized`、日志和列表变化通知都属于此类 |

正常响应通过 `id` 与请求对应；HTTP 多连接或 stdio 并发下都不能只按到达顺序配对。2025-11-25 还要求同一 Session 内 request ID 永不复用，包括已经收到响应之后。

无法读出请求 ID 的畸形报文是正常对应的例外：基础 JSON-RPC 对未知 ID 使用 `null`，而 MCP 的 `JSONRPCErrorResponse.id` 在 Schema 中为可选。**本项目取舍**：D035 只把带已知 ID 的响应交给等待中的请求；无法匹配的响应按协议异常处理，绝不猜测归给另一个请求。

常见协议错误码：

| code | JSON-RPC 含义 | 例子 |
| --- | --- | --- |
| `-32700` | Parse error | 不是合法 JSON |
| `-32600` | Invalid Request | 不是合法 Request 对象 |
| `-32601` | Method not found | 调用了不存在或未提供的方法 |
| `-32602` | Invalid params | 缺少 `name`、cursor 无效、prompt 参数无效 |
| `-32603` | Internal error | Server 内部协议处理失败 |
| `-32000` 至 `-32099` | 保留给实现定义的 Server error | 具体含义须看对应方法或实现，不自行猜测 |

### 2.3 Batch 不在本版 MCP 消息联合中

基础 JSON-RPC 2.0 规范定义了 Batch；但是 MCP 2025-11-25 的权威 TypeScript Schema 将 `JSONRPCMessage` 定义为：

```ts
type JSONRPCMessage = JSONRPCRequest | JSONRPCNotification | JSONRPCResponse;
```

联合中没有消息数组或 Batch 类型。**规范要求按 Schema 边界理解**：不能因为底层 JSON-RPC 2.0 有 Batch，就推断 MCP 2025-11-25 支持 Batch。**本项目取舍**：D035 不发送、不拼接、不解析 MCP Batch；逐条发送消息。

来源：[官方 schema.ts 的 JSONRPCMessage](https://github.com/modelcontextprotocol/specification/blob/main/schema/2025-11-25/schema.ts)、[官方 schema.json](https://github.com/modelcontextprotocol/specification/blob/main/schema/2025-11-25/schema.json)、[JSON-RPC Batch](https://www.jsonrpc.org/specification#batch)。

---

## 3. 生命周期：初始化、运行、关闭

来源：[2025-11-25 Lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle)。

### 3.1 `initialize` 请求与响应

**规范要求**：初始化必须是 Client 与 Server 的第一次交互，Client 首先发送：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-11-25",
    "capabilities": {},
    "clientInfo": { "name": "personal-agent", "version": "0.1.0" }
  }
}
```

- `protocolVersion`：Client 支持的版本，应为其支持的最新版本。
- `capabilities`：Client 能提供给 Server 调用的能力；空对象表示不声明 roots/sampling/elicitation 等可选能力。
- `clientInfo`：Client 实现信息，核心为 `name`、`version`，`title` 等展示字段可选。

Server 成功响应必须与请求 `id` 对应，并返回：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2025-11-25",
    "capabilities": {
      "tools": { "listChanged": true },
      "resources": { "listChanged": true },
      "prompts": {},
      "logging": {}
    },
    "serverInfo": { "name": "example-server", "version": "1.0.0" },
    "instructions": "可选的使用说明"
  }
}
```

`serverInfo` 和 `instructions` 是 Server 返回的实现信息与使用提示；`capabilities` 决定后续允许使用什么，不是装饰性元数据。

版本协商规则：

1. Server 支持请求版本时，必须返回同一版本。
2. 不支持时，Server 返回它支持的另一个版本，建议为其支持的最新版本。
3. Client 不支持响应版本时，生命周期页面使用 **SHOULD disconnect**；同版本 Schema 注释要求断开。**本项目取舍**：直接关闭，不发送 `initialized`，不尝试正常调用。

### 3.2 `notifications/initialized`

Client 收到可接受的成功初始化结果后，必须发送：

```json
{ "jsonrpc": "2.0", "method": "notifications/initialized" }
```

它没有 `id`，Server 不应回复。初始化完成前：

- Client 除 ping 外不应发送其他请求，且应等收到 `initialize` 响应。
- Server 在收到 `initialized` 前，除 ping 和 logging 外不应发送其他请求。

之后进入 Operation：双方必须遵守协商出的版本，只使用成功协商的能力。

### 3.3 没有 `shutdown` RPC

**规范要求**：2025-11-25 没有定义专门的 `shutdown` 或 `exit` MCP 消息，关闭使用底层传输机制：

- **stdio**：Client 先关闭子进程 stdin；等待退出，必要时先 `SIGTERM`，再等待后 `SIGKILL`。Server 可关闭 stdout 并退出。
- **HTTP**：关闭关联的 HTTP 连接。若 Server 在初始化时分配了 `Mcp-Session-Id`，Client 不再需要该 Session 时应发送 `DELETE`；Server 可以返回 `405 Method Not Allowed`，表示不允许该终止方式。DELETE 不是另一个 `shutdown` JSON-RPC 方法。

**实现建议**：为请求设置超时；超时后发送 `notifications/cancelled` 并停止等待，同时保留最终最大超时。Cancellation 只表示发起方不再等待，不保证远端副作用已经回滚。

---

## 4. stdio 与 Streamable HTTP

来源：[2025-11-25 Transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)、[Lifecycle · Shutdown](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle#shutdown)。

| 主题 | stdio | Streamable HTTP |
| --- | --- | --- |
| 进程/端点 | Client 启动 Server 子进程 | Client 连接一个 HTTP(S) MCP endpoint |
| 帧 | UTF-8、换行分隔；单条消息不能内嵌换行 | 每个消息由 HTTP POST 携带；JSON-RPC 本身仍为 UTF-8 |
| Server 回包 | 只写合法 MCP 消息到 stdout | 对 Request 可返回 `application/json` 或 `text/event-stream` |
| 日志 | Server 可写 stderr；**stdout 不能混入日志** | 协议日志使用 logging 通知；HTTP 实现日志不能冒充 MCP 响应 |
| 反向消息 | 同一双向流 | Server 可在 POST 的 SSE 流或 Client 的 GET SSE 流中发消息 |
| 会话 | 子进程与流的生命周期 | 可由 `Mcp-Session-Id` 标识；还可能跨多个 HTTP 连接 |
| 关闭 | 关 stdin，等待/终止子进程 | 关闭连接；可选 DELETE 终止 Session |

### 4.1 Streamable HTTP 的明确约束

**规范要求**：

1. **Accept**：Client 每个 POST 必须包含 `Accept: application/json, text/event-stream`。输入合法时：
   - Notification 或 Response 被接受，Server 返回 `202 Accepted`，无响应体。
   - Request 可得到 `application/json` 单 JSON 响应，或 `text/event-stream` SSE 流。
   - 无效输入可返回 HTTP `400 Bad Request`，这不等于 JSON-RPC `error`。
2. **GET 监听**：Client 可发 `GET`，且 `Accept: text/event-stream`。Server 可打开 SSE 流，也可返回 `405 Method Not Allowed` 表示不提供该监听通道。
3. **SSE 数据**：每个 SSE `message` 事件的 `data` 是一条完整 JSON-RPC 消息。若 POST 流包含 Request 的 Response，Server 最终应结束该 SSE 流。
4. **Session**：Server 可在 `initialize` 结果中返回 `Mcp-Session-Id`；一旦分配，Client 后续所有 HTTP 请求都必须带该头。没有分配时不能自行编造。
5. **Session 失效**：带 Session ID 的请求得到 HTTP `404` 时，表示 Session 已终止；Client 必须重新 `initialize` 获取新 Session，不能无限沿用旧 ID。
6. **协议版本头**：初始化后，后续 HTTP 请求必须包含 `MCP-Protocol-Version: 2025-11-25`。无该头时，Server 按 2025-11-25 规范必须假定 `2025-03-26`；因此本版 Client 不能省略。
7. **并发配对**：不同 POST 的响应顺序不受保证，必须用 JSON-RPC `id` 配对。

### 4.2 SSE 重连与重投，不等于“自动恢复”

- Server **可以**给 SSE 事件分配 ID；若要支持恢复，ID 必须在 Session 内唯一。
- Client 断线后**可以**在同一 MCP endpoint 的 GET 中带 `Last-Event-ID`，请求重投断点后的消息。
- Server 可在原 POST 对应的流上重投；若重投会违反“Request 最终收到 Response”的要求，应在重连 GET 流上补发。
- **实现建议**：重连次数、退避、缓冲上限和过期时间需要实现自行设计；规范没有承诺所有 Server 都支持事件 ID、重放或自动重连。
- **本项目取舍**：D035 不做 HTTP，因而不实现 SSE、`Last-Event-ID` 或自动重连，也不声称验证过这些行为。

### 4.3 旧 HTTP+SSE 只作历史标注

[2024-11-05 Transports](https://modelcontextprotocol.io/specification/2024-11-05/basic/transports) 中的旧 **HTTP with SSE** 使用两个端点：先打开 SSE endpoint，Server 发送 `endpoint` 事件，再向该 URI POST。它不是本文 2025-11-25 的单 endpoint Streamable HTTP。后者在 [2025-03-26 Transports](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports) 中已定义；本日不实现旧传输。

---

## 5. 能力协商：谁声明，谁使用

来源：[Lifecycle · Capability Negotiation](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle#capability-negotiation)、[官方 Schema · ClientCapabilities/ServerCapabilities](https://modelcontextprotocol.io/specification/2025-11-25/schema)。

能力不是双方无差别取“同名交集”：Server 声明它向 Client 提供什么，Client 声明它允许 Server 反向使用什么。

| 声明方 | 字段 | 解锁的主要行为 | 子能力/通知 |
| --- | --- | --- | --- |
| Server | `tools` | `tools/list`、`tools/call` | `listChanged: true` 时列表变化应发送 `notifications/tools/list_changed` |
| Server | `resources` | `resources/list`、`resources/read`、模板列表 | `listChanged` 对应资源列表变化；`subscribe: true` 才允许订阅单资源更新 |
| Server | `prompts` | `prompts/list`、`prompts/get` | `listChanged` 对应 `notifications/prompts/list_changed` |
| Server | `logging` | `notifications/message`；Client 可请求 `logging/setLevel` | 没有 `listChanged`；日志是 Server 能力 |
| Client | `roots` | Server 请求 `roots/list` | `listChanged: true` 时 Client 必须发送 `notifications/roots/list_changed` |
| Client | `sampling` | Server 请求 `sampling/createMessage` | `context` 表示支持 `includeContext`；`tools` 表示支持采样中的工具使用 |
| Client | `elicitation` | Server 请求 `elicitation/create` | 2025-11-25 区分 `form` 与 `url`；空 `{}` 只声明 form mode，不能暗示支持 URL mode |

专项来源：[Tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)、[Resources](https://modelcontextprotocol.io/specification/2025-11-25/server/resources)、[Prompts](https://modelcontextprotocol.io/specification/2025-11-25/server/prompts)、[Logging](https://modelcontextprotocol.io/specification/2025-11-25/server/utilities/logging)、[Roots](https://modelcontextprotocol.io/specification/2025-11-25/client/roots)、[Sampling](https://modelcontextprotocol.io/specification/2025-11-25/client/sampling)、[Elicitation](https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation)。

2025-11-25 Schema 还包含 Server/Client 的 `tasks`、`experimental`，以及 Server 的 `completions`。它们是独立能力，不因声明 `tools` 自动获得；本日不展开 Tasks 扩展流程。

**规范要求**：Operation 阶段只能使用成功协商的能力。例如 Server 没声明 `tools`，Client 不应发 `tools/call`；Client 没声明 `sampling`，Server 不应发 `sampling/createMessage`。列表变化通知也受对应 `listChanged` 约束，资源单条订阅还要求 `subscribe`。

**本项目取舍**：D035 在本地先检查能力，未声明就不发请求并返回明确的本项目不支持错误；若远端仍返回 `-32601` 等错误，则保留为协议错误，不伪装成空调用成功。D035 的 Client capabilities 为 `{}`，所以 roots/sampling/elicitation 都不在最小客户端范围内。

---

## 6. 工具、资源、提示：核心请求与响应

以下来源分别为官方 [Tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)、[Resources](https://modelcontextprotocol.io/specification/2025-11-25/server/resources)、[Prompts](https://modelcontextprotocol.io/specification/2025-11-25/server/prompts) 与同版本 [Pagination](https://modelcontextprotocol.io/specification/2025-11-25/server/utilities/pagination)。示例只展示核心字段，不表示省略其他可选元数据。

### 6.1 分页是 opaque cursor，不是页码

`tools/list`、`resources/list`、`resources/templates/list`、`prompts/list` 支持分页：

```json
{ "jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": { "cursor": "opaque-token" } }
```

- 首页可省略 `params.cursor`；后续请求原样带回 Server 给出的 cursor。
- 响应数组旁的 `nextCursor` 表示还有下一页；缺失表示结束。
- Server 决定页大小，Client 不能假定固定大小。
- **规范要求**：Client 必须把 cursor 当不透明 token，不解析、不修改，也不跨 Session 持久化。
- 无效 cursor 应得到 `-32602`。

### 6.2 Tools

#### `tools/list`

- 请求：`method: "tools/list"`，可选 `params.cursor`。
- 响应：`result.tools: Tool[]`，可选 `result.nextCursor`。
- `Tool` 核心字段：必需 `name`、`inputSchema`；可选 `title`、`description`、`outputSchema`、`annotations`、`icons` 等。
- `inputSchema` 是 JSON Schema；`outputSchema` 若存在，必须是根为 `type: "object"` 的 JSON Schema，用于校验 `structuredContent`。
- `annotations` 只是来自可能不可信 Server 的提示，不是安全边界或权限证明。

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "tools": [{
      "name": "get_forecast",
      "description": "Get weather forecast",
      "inputSchema": {
        "type": "object",
        "properties": { "city": { "type": "string" } },
        "required": ["city"]
      }
    }]
  }
}
```

#### `tools/call`

- 请求：`params.name` 为工具名，`params.arguments` 为符合该工具输入 Schema 的对象。
- 响应：`result.content` 为内容数组；可选 `structuredContent` 对象、`isError` 布尔值。
- `content` 可为 `text`、`image`、`audio`、`resource_link`、`resource`（嵌入资源）。图片和音频使用 base64 `data` 与 `mimeType`；资源链接至少有 `uri`、`name`；嵌入资源包含 `uri` 及 `text` 或 base64 `blob`。
- 若 Server 提供 `structuredContent`，规范要求同时提供序列化后的 `content`，以兼容不识别结构化结果的 Client；提供 `outputSchema` 时，Client 应严格校验结构化结果。

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": { "name": "get_forecast", "arguments": { "city": "上海" } }
}
```

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "content": [{ "type": "text", "text": "上海：晴" }],
    "structuredContent": { "city": "上海", "condition": "晴" },
    "isError": false
  }
}
```

### 6.3 Resources

#### `resources/list`

- 请求：可选 `params.cursor`。
- 响应：`result.resources: Resource[]`，可选 `nextCursor`。
- `Resource` 必需 `uri`、`name`；可选 `title`、`description`、`mimeType`、`size`、`annotations`、`icons`。
- `size` 若存在，表示原始资源内容的字节数，不是 base64 字符串长度。

#### `resources/read`

- 请求：`params.uri` 必需。
- 响应：`result.contents` 数组；每项包含 `uri`，可选 `mimeType`，并包含 `text` 或 base64 `blob` 之一。

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "resources/read",
  "params": { "uri": "file:///workspace/README.md" }
}
```

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "result": {
    "contents": [{ "uri": "file:///workspace/README.md", "mimeType": "text/plain", "text": "# README" }]
  }
}
```

注意：`resources/read` 的内容项不是 `tools/call` 的 Content Block，不要求 `{ "type": "text" }` 包装。无效 URI/参数应使用 `-32602`；资源未找到可使用 `-32002`。

### 6.4 Prompts

#### `prompts/list`

- 请求：可选 `params.cursor`。
- 响应：`result.prompts: Prompt[]`，可选 `nextCursor`。
- `Prompt` 必需 `name`；可选 `title`、`description`、`arguments`、`icons`。
- 每个 `arguments[]` 项包含 `name`，可选 `description`、`required`。

#### `prompts/get`

- 请求：`params.name` 必需；`params.arguments` 为字符串键值对象，用于实例化模板。
- 响应：可选 `description`，必需 `messages: PromptMessage[]`。
- `PromptMessage.role` 为 `user` 或 `assistant`；`content` 可为 `text`、`image`、`audio`、`resource`（嵌入资源）。本页 PromptMessage 的联合中没有把 `resource_link` 单列为一种 Prompt content。

```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "method": "prompts/get",
  "params": { "name": "code_review", "arguments": { "code": "const x = 1;" } }
}
```

```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "result": {
    "description": "Code review prompt",
    "messages": [{ "role": "user", "content": { "type": "text", "text": "Review: const x = 1;" } }]
  }
}
```

无效 prompt 名、缺少必需参数应使用 `-32602`；内部错误使用 `-32603`。

### 6.5 工具执行失败不等于协议失败

来源：[Tools · Error Handling](https://modelcontextprotocol.io/specification/2025-11-25/server/tools#error-handling)。

| 情况 | 外层 JSON-RPC | 业务/调用方如何处理 |
| --- | --- | --- |
| 未知工具、参数不符合方法约定 | `error`，如 `-32602` | Request 失败，不能读取成 Tool Result |
| 工具已开始执行但运行失败 | 成功响应中的 `result.isError: true`，错误说明放在 `content` | RPC 传输成功，但工具结果必须按失败展示/处理 |
| 工具执行成功 | `result`，可含 `content`、`structuredContent`，`isError` 可省略或为 `false` | 再按内容类型与 outputSchema 校验 |
| HTTP 401/403、400、404 Session | HTTP 层结果，可能没有对应 JSON-RPC Result | 处理认证、输入或 Session 生命周期，不伪造成 `isError` |

**本项目取舍**：D035 的 `callTool` 必须把 JSON-RPC `error` 与 `result.isError` 分开；前者使对应 RPC 以协议错误拒绝，后者返回带失败标记的 Tool Result，传输失败与超时另走本地错误通道，禁止把任何一类静默改写为成功。

---

## 7. 安全边界：MCP 不会自动替你完成

来源：[2025-11-25 Specification · Security and Trust & Safety](https://modelcontextprotocol.io/specification/2025-11-25#security-and-trust--safety)、[Transports · Security Warning](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#security-warning)、[Authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)、[Security Best Practices](https://modelcontextprotocol.io/specification/2025-11-25/basic/security_best_practices)。

| 边界 | 官方说明 | 本项目取舍 |
| --- | --- | --- |
| 入参与出参校验 | Server 必须按工具 inputSchema 校验参数、执行前校验 arguments；有 outputSchema 时 Client 应严格校验 structuredContent；Prompt 输入输出也须仔细校验 | D035 校验外层消息、ID、必要字段与返回结构；完整 JSON Schema 校验器不偷偷宣称为零依赖已实现 |
| 用户同意与权限 | Host 必须让用户理解并同意数据访问和操作；调用任何工具前必须获得明确用户同意 | 模型请求工具不等于用户已批准；D035 只提供连接能力，不绕过 Runtime/宿主审批 |
| 不可信描述 | 工具描述和 annotations 默认不可信，除非来自可信 Server；readOnly/destructive 等提示不是权限凭证 | 不因 `readOnlyHint: true` 自动放行，不将图标、description 当指令执行 |
| 敏感数据 | Host 向 Server 暴露用户数据前必须取得同意，不得擅自转发资源数据；日志不得包含凭证、秘密、PII 或有助于攻击的内部细节 | stderr、错误和日志必须脱敏；不把 token、完整环境变量或敏感资源正文写入测试快照 |
| 传输认证/授权 | HTTP 授权是可选框架，不是每次 MCP 连接自动出现；stdio 可从环境取得凭证；授权规范本身不提供会话管理 | D034 没实现 OAuth；D035 stdio 最小版不暗示已有 HTTP 认证，环境变量采用显式最小传递 |
| 本地 HTTP 防护 | Server 必须验证 `Origin`，本地应只绑定 localhost，应实现适当认证 | 若以后增加 HTTP，先满足这些约束，不能只检查 URL 是否存在 |
| 会话与 Token | 安全最佳实践要求禁止 token passthrough、验证 Session ID 绑定、避免把 Session ID 放进 URL，并防止 confused deputy | 不把 Session ID 当认证凭证，不记录到日志；D035 不实现 HTTP Session |

官方安全最佳实践还覆盖 confused deputy、session hijacking、本地 MCP Server 妥协和 scope 最小化。它们是补充安全指南，不应被误写成“声明 capabilities 就已获得安全保证”。

---

## 8. 与现有 Tool Schema 的关系：不能混称官方 Schema

本仓库已有：

- `src/core/tool.ts`：本项目 `Tool` 契约，含 `name`、`description`、`inputSchema`、`categories?`、`execute`。
- `src/tools/schema.ts`：只验证本项目工具元数据，不做 JSON Schema 参数验证。
- `src/tools/registry.ts`：本地注册与执行；`ToolRuntimeError` 是本项目执行边界。

**本项目事实**：这些都不是 MCP 官方 Schema。尤其是 `categories`、`execute` 和字符串返回值不属于 MCP 2025-11-25 的 `Tool`/`CallToolResult` 线格式，`execute` 函数也不可能序列化为 MCP JSON。

未来若做适配，只能显式映射：

| 本项目 | MCP 2025-11-25 | 边界 |
| --- | --- | --- |
| `name`、`description`、`inputSchema` | 同名字段 | 概念相近，仍要按 MCP 官方 Schema 校验 |
| `categories` | 无对应核心字段 | 保持本地，不冒充官方字段 |
| `execute` | 不存在于 MCP Tool 描述 | 留在 Server/Runtime 内部 |
| `Promise<string>` | `CallToolResult.content` 等 | 需要适配层；本日未实现 |

---

## 9. 给 D035 的最小客户端契约（**尚未实现**）

> 本节只是下一日接口与验收清单，不是已存在的 TypeScript API。D034 没有启动 MCP Client，也没有连接任何外部 Server。

### 9.1 建议接口

```ts
// 仅为 D035 文档契约；D034 未创建这些类型或实现。
interface MinimalMcpClient {
  connect(): Promise<InitializeResult>;
  listTools(cursor?: string): Promise<ListToolsResult>;
  callTool(
    name: string,
    args?: Record<string, unknown>,
  ): Promise<CallToolResult>;
  close(): Promise<void>;
}

interface StdioMcpClientOptions {
  command: string;
  args?: readonly string[];
  env?: Readonly<Record<string, string>>;
  requestTimeoutMs?: number;
}
```

`InitializeResult`、`ListToolsResult`、`CallToolResult` 指 2025-11-25 官方结构的最小本地结构类型，不从本项目的 `src/core/tool.ts` 冒充导入。`connect()` 负责启动子进程并完成初始化；其他方法在 `connect()` 成功前不可用作正常调用。

### 9.2 D035 验收清单

- [ ] Node 24、原生 TypeScript、ESM、零运行时依赖；每个新增可执行行为先写测试并观察预期 RED，再最小实现到 GREEN。
- [ ] stdio 严格换行分帧；stdout 只解析合法 MCP 消息，stderr 单独收集并脱敏，不污染协议流。
- [ ] 首条请求为 `initialize`，携带 `protocolVersion: "2025-11-25"`、`capabilities: {}` 和真实 `clientInfo`。
- [ ] 校验响应版本；不支持就关闭，不发送 `initialized`，不进入工具调用。
- [ ] 初始化成功后发送无 `id` 的 `notifications/initialized`，且不等待该通知的响应。
- [ ] Request ID 只使用 string/number，在 Session 内不复用；并发、乱序响应按 ID 配对，未知 ID 不串单。
- [ ] Server 未声明 `tools` 时，本地拒绝 `tools/list` 与 `tools/call`；`listChanged` 不被误当成工具是否存在。
- [ ] `listTools(cursor)` 原样传递 opaque cursor，不解析、不跨 Session 保存；`nextCursor` 缺失才视为末页。
- [ ] `callTool` 区分 JSON-RPC `error`、HTTP/传输错误（本版 stdio 无 HTTP）和 `result.isError`；不吞错、不伪造成功。
- [ ] Notification 不回复；未支持的 Server Request 返回 `-32601`，不能误当成本地请求的 Response。
- [ ] 请求有上限明确的超时；超时发送 `notifications/cancelled` 并停止等待，不宣称远端副作用已撤销。
- [ ] `close()` 不发送虚构的 `shutdown` RPC；按“关闭 stdin → 等待 → 必要时终止子进程”执行且可重复清理。
- [ ] 测试使用明确的本地确定性 Server fixture 验证握手、分页、乱序响应、通知、工具失败、协议错误、超时和关闭；fixture 不被描述成已连接真实外部服务。
- [ ] 不实现 Batch、Streamable HTTP、SSE 重连、OAuth、resources/prompts、roots/sampling/elicitation、Tasks；超出范围时显式报错或留待后续，而不是悄悄半支持。

---

## 10. 本日结论与限制

1. 已按官方资料梳理 2025-11-25 的消息、握手、能力、传输、工具/资源/提示和安全边界。
2. 已提供 [stdio 与 Streamable HTTP 两张 Mermaid 时序图](./d034-mcp-sequence.md)，字段与本文示例一致。
3. **没有新增运行时代码、MCP Client、Server、依赖或外部连接**；因此本日文档交付不制造无意义的 RED。
4. 本文是协议学习笔记，不替代同版本官方规范与 Schema；遇到冲突以官方同版本 Schema 和规范为准。
