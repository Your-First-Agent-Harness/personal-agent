# Personal Agent · 第 36 天

> 进度：D036 / D100 · v0.1.0
>
> 主题：MCP Server 实现「把自有工具暴露出去」——自己的 Server 可被别的客户端调用
>
> 今日交付：Node 24 原生 TypeScript ESM、零新增运行时依赖的手写 JSON-RPC 2.0 ndjson stdio Server；复用真实 ToolRegistry；安全临时工作区示例；单元/跨进程测试；官方 Inspector 独立客户端 transcript。

## 先跑起来

环境：Node 24、npm。项目运行时依赖仍为零。

```bash
npm install
npm run check
npm run test:coverage
```

启动安全示例 Server（stdout 只用于 MCP 消息，日志只写 stderr）：

```bash
npm run mcp:server
```

该命令等待 stdio 客户端，不是一个会自行打印 Demo 结果然后退出的命令。用下面的官方 CLI 连接它，即可完成可复现演示。

## 独立官方客户端验收

实际使用：**`@modelcontextprotocol/inspector@2.15.0`**，通过 `npx` 临时执行，没有加入 `dependencies`、`devDependencies` 或 lockfile。原始输出、包版本、Node/npm 版本和退出码见：

- `docs/d036-inspector-transcript.txt`

在仓库根目录逐条复现：

```bash
# initialize：确认协议版本、serverInfo、capabilities
npx --yes @modelcontextprotocol/inspector@2.15.0 \
  --cli --transport stdio --format json --method initialize \
  -- node src/demo/d036-mcp-server.ts

# tools/list：官方 Client 发现两个自有工具
npx --yes @modelcontextprotocol/inspector@2.15.0 \
  --cli --transport stdio --format json --method tools/list \
  -- node src/demo/d036-mcp-server.ts

# tools/call：通过真实 Registry/read_file 读取临时工作区文件
npx --yes @modelcontextprotocol/inspector@2.15.0 \
  --cli --transport stdio --format json --method tools/call \
  --tool-name read_file --tool-args-json '{"path":"README.txt"}' \
  -- node src/demo/d036-mcp-server.ts
```

真实结果摘要：

- `initialize` 返回 `protocolVersion: "2025-11-25"`、`serverInfo.name: "personal-agent-safe-demo"` 与 `capabilities.tools`。
- `tools/list` 返回 `read_file`、`list_dir`，保留 Registry 中的描述和 JSON Schema。
- `tools/call read_file {"path":"README.txt"}` 返回临时工作区的真实文本，`isError: false`。
- 三次 CLI 退出码均为 0；每次 CLI 都启动一个全新的 Server 子进程并自行完成握手，所以 transcript 中临时目录随机后缀不同。

`test/d036-stdio-integration.test.ts` 还用 D035 的 `StdioMcpClient` 做互通回归，但**自有 Client 不被当作独立客户端证据**；独立证据只认上面的官方 Inspector 实际执行。

## 代码入口

- `src/adapters/mcp-stdio-server.ts`：stdio Server、生命周期、JSON-RPC、Registry 适配、并发/取消/关闭。
- `src/demo/d036-mcp-server.ts`：临时工作区和明确双工具白名单示例。
- `test/d036-mcp-server.test.ts`：协议、错误、真实 Registry、并发、取消和关闭测试。
- `test/d036-stdio-integration.test.ts`：真实子进程互通，读取文件并验证文件错误和路径边界。
- `docs/d036-inspector-transcript.txt`：官方独立客户端真实证据。

## Server 生命周期

```text
Client                         Server
  | initialize(request)          |
  |----------------------------->| 校验 params，协商版本
  | initialize(result)           |
  |<-----------------------------| 只声明本日支持的 2025-11-25
  | notifications/initialized    |
  |----------------------------->| 进入 ready；通知不回复
  | ping / tools/list/call       |
  |<============================>| 业务请求可并发完成
  | notifications/cancelled      |
  |----------------------------->| 真实 AbortSignal；通知不回复
  | 关闭 stdin                   |
  |----------------------------->| abort 在途调用、清理、停止写响应
```

规则：

1. `initialize` 要求字符串 `protocolVersion`、对象 `capabilities`，以及含字符串 `name/version` 的 `clientInfo`。
2. 客户端版本正好是 `2025-11-25` 时回显该版本；其他字符串版本仍返回 Server 支持的 `2025-11-25`，由 Client 决定是否继续。本日不实现 `2026-07-28`。
3. `ping` 在初始化前也可用；`tools/*` 必须等 `notifications/initialized`，否则返回 `-32000 Server not initialized`。
4. 重复 `initialize` 返回 `-32600`。未知方法返回 `-32601`。
5. MCP stdio 没有另造 `shutdown/exit` RPC；本实现按 D034 的真实边界以 stdio 关闭作为关闭信号。
6. 所有通知都不回复，包括未知通知、未知取消 id、初始化完成通知。收到没有对应 Server 请求的 JSON-RPC response（未知 id）也只忽略，不再生成第二个响应。

### ndjson 与日志

- 每条消息恰好一行；使用 `JSON.stringify(message) + "\n"` 写出，不使用 Content-Length 或字符串拼接构造 JSON。
- 使用 readline 分帧，支持 CRLF、跨 chunk 消息和多消息连续到达。
- 畸形 JSON 返回 `id:null`、`code:-32700`，诊断写 `errorOutput`；示例把它接到 `process.stderr`。
- stdout 只写协议帧。启动、临时目录、停止日志全部写 stderr。

## Registry 适配，而不是复制工具逻辑

Server 构造时同时接收 `registry` 和显式 `toolNames`：

```ts
const registry = new ToolRegistry();
registry.register(readFileTool);
registry.register(listDirTool);

const server = new McpStdioServer({
  registry,
  toolNames: ['read_file', 'list_dir'],
  workspaceRoot,
  input: process.stdin,
  output: process.stdout,
  errorOutput: process.stderr,
  serverInfo: { name: 'personal-agent-safe-demo', version: '0.1.0' },
});
await server.start();
```

### tools/list

对每个被明确选择的名称调用 `registry.describe(name)`，直接投影：

```text
Tool.name        → MCP tool.name
Tool.description → MCP tool.description
Tool.parameters  → MCP tool.inputSchema
```

未注册或 Registry 策略不可见的工具不会列出。没有伪造 `outputSchema`，本日也不发布 `listChanged` 通知，因此声明 `{ tools: { listChanged: false } }`。

### tools/call 与 JSON 字符串参数

1. MCP 外层 `params.name` 必须是字符串，`params.arguments` 省略时按 `{}`，提供时必须是 JSON object。
2. 调用前检查显式 `toolNames` 和 Registry 可见性；未选择、未知或不可见工具按协议返回 `-32602 Unknown tool`。
3. 用 `JSON.stringify(arguments)` 生成 **Registry ToolCall.arguments 的 JSON 字符串**，同时生成带 MCP id 类型的 ToolCall id。
4. 真正调用 `registry.execute(toolCall, { workspaceRoot, signal })`。没有第二份文件工具、权限或 Schema 逻辑。
5. Registry 自己完成 JSON 解析、Schema 校验、策略和 Tool 执行；Tool 最终收到的是 Registry 校验后的参数值。

因此，MCP 调用者传对象；Registry 边界仍保持 D027/D035 已验证的 JSON 字符串契约。

## ToolResult 与错误映射

| 场景 | 对外结果 |
|---|---|
| 工具成功 | `content:[{type:"text",text:result.content}]`，`isError:false` |
| Registry Schema 失败，如 `INVALID_ARGUMENTS` | 工具结果 `isError:true`，不是 JSON-RPC transport error |
| 文件不存在、路径越界等 ToolError | 工具结果 `isError:true`，保留原 content 和错误元数据 |
| 敏感工具未确认，如 `TOOL_CONFIRMATION_REQUIRED` | 工具结果 `isError:true`；示例不会自动批准 |
| MCP 外层 name/arguments 形状错误 | JSON-RPC `-32602 Invalid params` |
| 未知、未选择或策略不可见工具 | JSON-RPC `-32602 Unknown tool`，不泄露隐藏工具 |
| 未知方法 | JSON-RPC `-32601 Method not found` |
| 非法信封 / 重复 initialize | JSON-RPC `-32600 Invalid Request` |
| 畸形 JSON | JSON-RPC `-32700 Parse error`，`id:null` |
| Registry 意外抛异常 | JSON-RPC `-32603 Internal error`，不把内部异常文本发给 Client |

带 `ToolResult.error` 时，额外返回：

```json
{
  "structuredContent": {
    "error": {
      "code": "FILE_NOT_FOUND",
      "message": "...",
      "hint": "...",
      "details": {}
    }
  }
}
```

实际字段按原对象保留，未出现的可选字段不会凭空补出。成功结果没有可靠的结构化业务数据，所以只返回文本 content 和 `isError:false`，不假装解析出 `structuredContent`。

## 并发、取消与关闭

- 读循环不 `await` 长工具；每次 `tools/call` 都独立执行，响应按完成顺序写出。
- id 以 `类型 + 值` 建立内部键，避免 JSON-RPC 的 `1` 与 `"1"` 碰撞；响应始终使用原始 id。
- 慢调用不阻塞后续快调用、ping 或取消通知；测试断言慢请求先发送、快请求先完成且 id 配对正确。
- `notifications/cancelled` 找到在途 id 后调用真实 `AbortController.abort()`，同一 signal 已传给 Registry/Tool；取消后的迟到结果不会再写回。
- 工具必须监听 `context.signal` 才能真正中止自身工作。对不合作、永不完成的 Tool，协议层不能强制收回其 Promise；未知取消 id 不产生错误响应。
- stdio 关闭时 abort 所有在途调用、清空活动表、停止后续写响应。清理不依赖再收到一个非标准 shutdown 方法。

## 安全示例边界

`src/demo/d036-mcp-server.ts` 每次启动：

1. 在系统临时目录创建独立工作区。
2. 只写入固定 `README.txt` 和 `hello.txt` 示例内容。
3. 只注册并允许 `read_file`、`list_dir`。
4. 不暴露 `shell`、任意命令、写文件、编辑文件、网络、进程环境变量或凭证工具。
5. 继续沿用现有工作区路径逃逸防护；stdio 关闭后递归删除临时目录。

测试中的 `shell` 调用得到 `Unknown tool`，不是把命令转交给 run_command。不要把本示例改成默认暴露整个生产 Registry；暴露新工具需要显式加入 `toolNames` 并单独评估权限。

## TDD 实录

新行为先写测试并观察预期失败，再补实现：

1. **握手 RED**：`npx vitest run test/d036-mcp-server.test.ts` 首先因 `mcp-stdio-server.ts` 不存在而失败；最小实现后 initialize/版本/ping **2 项通过**。
2. **Registry/协议 RED**：重复 initialize 仍返回成功、tools/list/call 无响应、未知方法无错误响应；补 Registry 投影和错误映射后转绿。测试还校正了两个历史契约理解：Registry 在 Tool 执行前解析 JSON；敏感标记使用 `{sensitive:true}` 注册选项。
3. **并发/关闭 RED**：实际观察到畸形 JSON `SyntaxError`、非法 tools/list 参数返回工具列表、取消/关闭时 `aborted=false`；补 Parse error、参数校验、活动调用表和 AbortSignal 后 **15 项通过**。并发乱序测试验证了已有的非阻塞设计，未为通过测试而串行化。
4. **示例 RED**：跨进程测试首次因子进程入口不存在报 `spawn ENOENT`；加入安全示例后，握手、真实 read_file、错误与关闭测试转绿。

最终完整验证：

```bash
npm run check
npm run test:coverage
```

本次覆盖率实跑：**40 个测试文件、376 项测试全部通过**；全项目 statements **92.08%**、branches **87.90%**、functions **99.33%**、lines **93.76%**，达到现有阈值。新增 Server 文件 statements **90.90%**、lines **94.95%**。

## 限制

- 只实现 MCP `2025-11-25` 的 stdio、initialize/ping/tools 生命周期；不实现 HTTP、WebSocket、2026-07-28。
- 不实现 resources、prompts、sampling、roots、elicitation、logging、pagination 或动态 listChanged。
- tools/list 一次返回显式选择的小集合；不提供游标分页。
- 成功 ToolResult 只有文本 content；本日不声明 outputSchema，不推导成功 structuredContent。
- stdio 是单 Client 会话；没有网络监听和传输层认证。安全边界来自本机进程隔离、显式工具集合和 Registry/工作区策略，而不是把 stdio 当成多租户服务。
- 取消与关闭传递真实 AbortSignal，但强制终止非合作工具不是 JSON-RPC 能做到的；生产工具应检查 signal 并清理自己的子进程/定时器。
