# D034 · MCP 调用时序图

> 协议笔记：[D034 MCP 协议走读](./d034-mcp-protocol.md)
> 主读版本：**2025-11-25**；资料访问日期：**2026-11-12**
> 图源：作者依据官方 [Lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle)、[Transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)、[Tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)、[Resources](https://modelcontextprotocol.io/specification/2025-11-25/server/resources) 与 [Prompts](https://modelcontextprotocol.io/specification/2025-11-25/server/prompts) 绘制；无外链图片。

## 图 1 · stdio：初始化到 `tools/call`

下图使用与协议笔记相同的 `protocolVersion`、`clientInfo`、工具名和参数。`id = 1…3` 仅是一次 Session 内的示例；Notification 没有 `id`，也不存在对它的 Response。

```mermaid
sequenceDiagram
    autonumber
    participant H as Host
    participant C as MCP Client
    participant S as MCP Server 子进程

    H->>C: connect(command, args)
    C->>S: 启动子进程
    Note over C,S: stdin / stdout 只承载换行分隔的 MCP 消息；日志走 stderr

    C->>S: initialize request<br/>jsonrpc=2.0, id=1<br/>protocolVersion=2025-11-25<br/>capabilities={}, clientInfo={name: personal-agent, version: 0.1.0}
    S-->>C: initialize result, id=1<br/>protocolVersion=2025-11-25<br/>serverInfo={name: example-server, version: 1.0.0}<br/>capabilities.tools.listChanged=true

    alt Client 接受返回的协议版本
        C->>S: notifications/initialized<br/>jsonrpc=2.0，无 id，无 params
        Note over C,S: 此后才进入正常 Operation

        C->>S: tools/list request, id=2<br/>params={}
        S-->>C: tools/list result, id=2<br/>tools=[{name: get_forecast, inputSchema: ...}]

        H->>C: 用户已确认调用 get_forecast
        C->>S: tools/call request, id=3<br/>name=get_forecast<br/>arguments={city: 上海}
        S-->>C: tools/call result, id=3<br/>content=[{type: text, text: 上海：晴}]<br/>structuredContent={city: 上海, condition: 晴}<br/>isError=false

        H->>C: close()
        C->>S: 关闭 stdin（没有 shutdown RPC）
        S-->>C: 正常退出
        Note over C,S: 超时未退出才依次考虑 SIGTERM、SIGKILL
    else Client 不支持返回版本
        C->>S: 关闭 stdin，不发送 initialized，不进入正常调用
        S-->>C: 子进程退出
    end
```

### 读图检查

- `initialize` 是第一次交互；Client 等成功响应后才发送 `notifications/initialized`。
- `tools/list` 和 `tools/call` 的 Response 都通过 `id` 配对，而不是靠“下一条消息”猜测。
- 图中的 `isError=false` 位于 `result` 内；若是 JSON-RPC `error`，外层就不是 Tool Result。
- `close()` 是传输关闭，不是发送一个名为 `shutdown` 的 MCP Request。

官方依据：[Lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle)、[stdio framing](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#stdio)、[Tools · Message Flow](https://modelcontextprotocol.io/specification/2025-11-25/server/tools#message-flow)。

---

## 图 2 · Streamable HTTP：Session、资源/提示、错误与 SSE 重连

本图假设 Server 在初始化时分配 `Mcp-Session-Id: s-123`，支持 GET SSE，并给可恢复事件分配 ID。后两项是 Server 可选择提供的能力，不能据此推断所有 Server 都支持。每个 POST 仍带 `Accept: application/json, text/event-stream`；为突出协议字段，图中将该重复头简写为 `Accept=json+sse`。

```mermaid
sequenceDiagram
    autonumber
    participant H as Host
    participant C as MCP Client
    participant S as Streamable HTTP Server

    C->>S: POST /mcp, Accept=json+sse<br/>initialize, id=1<br/>protocolVersion=2025-11-25, capabilities={}<br/>clientInfo={name: personal-agent, version: 0.1.0}
    S-->>C: 200 application/json<br/>Mcp-Session-Id: s-123<br/>result id=1, protocolVersion=2025-11-25<br/>capabilities: tools, resources, prompts, logging

    C->>S: POST /mcp, Accept=json+sse<br/>Mcp-Session-Id: s-123<br/>MCP-Protocol-Version: 2025-11-25<br/>notifications/initialized，无 id
    S-->>C: 202 Accepted，无响应体

    C->>S: GET /mcp, Accept=text/event-stream<br/>Mcp-Session-Id: s-123<br/>MCP-Protocol-Version: 2025-11-25
    S-->>C: 打开 GET SSE 流

    C->>S: POST /mcp, 所需 Accept/Session/Version 头<br/>resources/list, id=2, params={}
    S-->>C: 200 application/json<br/>result id=2<br/>resources=[{uri: file:///workspace/README.md, name: README}]

    C->>S: POST /mcp, 所需 Accept/Session/Version 头<br/>resources/read, id=3<br/>params.uri=file:///workspace/README.md
    S-->>C: 200 application/json<br/>result id=3<br/>contents=[{uri: file:///workspace/README.md,<br/>mimeType: text/plain, text: # README}]

    C->>S: POST /mcp, 所需 Accept/Session/Version 头<br/>prompts/get, id=4<br/>name=code_review, arguments={code: const x = 1}
    S-->>C: 200 application/json<br/>result id=4<br/>messages=[{role: user, content: {type: text, ...}}]

    C->>S: POST /mcp, 所需 Accept/Session/Version 头<br/>tools/call, id=5<br/>name=get_forecast, arguments={city: 上海}
    S-->>C: 200 text/event-stream<br/>event: message, id: evt-41<br/>data: result id=5, isError=true,<br/>content=[{type: text, text: provider unavailable}]
    Note over C,S: id=5 是 RPC 成功响应；isError=true 才是工具执行失败

    C->>S: POST /mcp, 所需 Accept/Session/Version 头<br/>prompts/get, id=6, name=missing
    S-->>C: 200 application/json<br/>error id=6, code=-32602, message=Unknown prompt
    Note over C,S: 这是协议错误响应，不是 result.isError

    S-->>C: GET SSE: event=message, id=evt-42<br/>data: notifications/tools/list_changed
    Note over C,S: 网络断开；evt-42 是否可重投放取决于 Server
    C->>S: GET /mcp, Accept=text/event-stream<br/>Mcp-Session-Id: s-123, Last-Event-ID: evt-42<br/>MCP-Protocol-Version: 2025-11-25
    alt Server 支持从该事件恢复
        S-->>C: 打开 SSE 流，重投 evt-42 之后符合条件的消息
    else Session 已不存在，HTTP 404
        S-->>C: 404 Session terminated
        C->>S: 重新 POST initialize（新 id）<br/>Accept=json+sse
        S-->>C: 新 initialize result 与新 Session
    else Server 不支持恢复
        Note over C,S: 实现必须显式处理；规范不保证自动重连或无限重投
    end

    H->>C: close()
    C->>S: 关闭关联 HTTP 连接
    opt 原 s-123 Session 仍有效、Client 不再需要它，且 Server 支持 DELETE
        C->>S: DELETE /mcp<br/>Mcp-Session-Id: s-123, MCP-Protocol-Version: 2025-11-25
        S-->>C: Session 终止响应（也可能由 Server 返回 405）
    end
    Note over C,S: 若 404 后已建立新 Session，关闭与 DELETE 应改用新 Session ID
```

### 读图检查

- `initialized` 是 Notification，所以 HTTP `202 Accepted` 后没有 JSON-RPC Response。
- `resources/read` 返回 `contents[].text`，不是工具 Content Block 的 `type: "text"`。
- `tools/call` 的 `result.isError=true` 与 `prompts/get` 的外层 `error.code=-32602` 是两条不同错误通道。
- `Last-Event-ID` 只用于可恢复 SSE 流；HTTP 404 Session 失效要求重新初始化。
- 旧 2024-11-05 HTTP+SSE 的 `endpoint` 事件不属于此图；本图始终是单 MCP endpoint 的 Streamable HTTP。

官方依据：[Sending Messages](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#sending-messages-to-the-server)、[Listening](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#listening-for-messages-from-the-server)、[Resumability and Redelivery](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#resumability-and-redelivery)、[Session Management](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#session-management)、[Protocol Version Header](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#protocol-version-header)。

---

## 图示边界

这些图是依据规范绘制的教学示例，**不是抓包记录**。D034 没有运行 Client、没有连接外部 Server、没有观察到真实 `s-123` 或 `evt-42`；这些值都是明确标注的示例。最新 2026-07-28 的逐请求、无初始化握手模型不在图中，版本差异见[协议笔记第 1 节](./d034-mcp-protocol.md#1-版本范围先分清两代协议)。
