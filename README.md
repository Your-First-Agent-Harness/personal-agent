# personal-agent

> 进度：**D035 / D100 · v0.1.0**
> 当日目标：实现 MCP 2025-11-25 / stdio Client 的连接、列工具、调用与错误处理，并真实连接一个独立外部 MCP Server。
> 本日只做 D035，**不实现 D036 Server，不修改 main 索引**。

## 今日交付

| 交付物                                                                     | 内容                                                       |
| -------------------------------------------------------------------------- | ---------------------------------------------------------- |
| [`src/adapters/mcp-stdio-client.ts`](./src/adapters/mcp-stdio-client.ts)   | 零新增运行时依赖的 Node.js stdio MCP Client                |
| [`test/d035-mcp-client.test.ts`](./test/d035-mcp-client.test.ts)           | 初始化、并发、分页、错误、取消、退出和清理测试             |
| [`test/fixtures/mcp-stdio-server.ts`](./test/fixtures/mcp-stdio-server.ts) | 确定性的本地单测 fixture；**不是外部 Server 证据**         |
| [`scripts/d035-external.ts`](./scripts/d035-external.ts)                   | 通过 `npx` 启动官方外部 Server，执行真实握手、列工具和调用 |
| [`docs/d035-external-transcript.txt`](./docs/d035-external-transcript.txt) | 实际终端命令与输出，未把 fixture 冒充外部服务              |
| [`docs/d034-mcp-protocol.md`](./docs/d034-mcp-protocol.md)                 | D034 协议笔记，本实现以其第 9 节最小契约为边界             |

## 1. 版本与范围

- 协议固定为 **MCP `2025-11-25`**，基础消息为 **JSON-RPC 2.0**。
- 传输只有 **stdio 换行分帧**；操作只有 `initialize`、`tools/list`、`tools/call` 与关闭。
- 不声明支持 `2026-07-28`，不实现 HTTP、SSE、Batch、Server、Resources、Prompts、Tasks、OAuth 或自动重连。
- 使用 Node.js 24 原生 TypeScript ESM 与 `node:child_process`，**没有把 MCP SDK 添加为项目依赖**。
- 保留 MCP Tool Schema 和工具结果，不强行改写成本项目 `Tool.execute(): Promise<string>`；main Loop/Registry 索引未改。

## 2. 快速运行

```bash
# 确定性单测：不访问网络，不启动外部 npm 包
npx vitest run test/d035-mcp-client.test.ts

# 真实外部互操作：npx 缓存未命中时需要网络
npm run demo:d035

# 完整质量检查
npm run check
npm run test:coverage
```

`demo:d035` 在内部启动的独立进程等价于：

```bash
npx --yes @modelcontextprotocol/server-everything@2025.11.25 stdio
```

直接执行上面这条命令只会启动并等待 stdio 输入；要完成握手与调用，应运行 `npm run demo:d035`。

## 3. stdio 帧：每行恰好一个 JSON 消息

Client 向子进程 `stdin` 写入一条 JSON 和 `\n`，从 `stdout` 按换行组帧。 stdout 只允许协议消息；诊断日志单独进入 `stderr`，默认只保留最后 **65,536 字符**，可用 `maxStderrChars` 调整。

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

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2025-11-25",
    "capabilities": { "tools": { "listChanged": true } },
    "serverInfo": { "name": "example", "version": "1.0.0" }
  }
}
```

```json
{ "jsonrpc": "2.0", "method": "notifications/initialized" }
```

随后才能发送操作：

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": { "name": "echo", "arguments": { "message": "hello" } }
}
```

实现不会把 stderr 文本拼进 JSON 解析器，也不会给 Notification 回复 Response。

## 4. 生命周期

```text
spawn(command, args, { stdio: pipes, env })
  → initialize(protocolVersion / capabilities / clientInfo)
  → 校验 result、必要字段与精确的 2025-11-25 版本
  → notifications/initialized
  → ready：tools/list、tools/call，可并发
  → close：stdin.end()
  → 等待子进程 exit；超时先 SIGTERM，再 SIGKILL
  → 清理 stdout/stderr/process 监听器与 pending 状态
```

关键约束：

1. `connect()` 每个实例只执行一次；版本不符或初始化结果缺字段时不会发送 `initialized`。
2. `capabilities: {}` 是 Client 不声明反向能力；Server 未声明 `capabilities.tools` 时，列工具和调用均在本地以 `CAPABILITY_MISSING` 拒绝。
3. 关闭没有 MCP `shutdown` RPC；stdio 生命周期就是关闭通道和进程。
4. `close()` 可重复、可并发调用，共用同一个关闭 Promise。
5. 子进程提前退出、stdin 不可写、畸形帧和未知响应 id 都会明确结束相关 Promise，不留静默 pending。

## 5. API

```ts
import { StdioMcpClient } from "./src/adapters/mcp-stdio-client.ts";

const client = new StdioMcpClient({
  command: process.execPath,
  args: ["/absolute/path/to/server.ts"],
  env: {}, // 默认不继承父进程环境；只显式传必要变量
  requestTimeoutMs: 10_000,
  closeTimeoutMs: 2_000,
  maxToolListPages: 100,
  maxStderrChars: 65_536,
  onNotification: (notification) => {
    console.info(notification.method, notification.params);
  },
});

const initialized = await client.connect();
console.info(initialized.serverInfo);

const firstPage = await client.listTools();
const secondPage = firstPage.nextCursor
  ? await client.listTools(firstPage.nextCursor)
  : undefined;
const allTools = await client.listAllTools();

const result = await client.callTool("echo", { message: "hello" });
console.info(result.content, result.structuredContent, result.isError);

await client.close();
```

### 请求 ID、并发与取消

- 请求 ID 从 1 开始单调递增，本实例内不复用。
- Response 只按 `id` 配对，不按到达顺序；`Promise.all` 中慢响应不会覆盖快响应。
- `listTools`、`listAllTools`、`callTool` 接受 `{ signal }`。
- 超时以 `TIMEOUT` 拒绝，AbortSignal 以 `ABORTED` 拒绝；两者都会移除 pending、计时器和 abort 监听器。
- 传输仍打开时，超时/取消会发送 `notifications/cancelled`，参数为 `{ requestId, reason }`；取消通知本身没有响应。
- 已取消的 Promise 不会由后续响应重新“成功”。迟到的未知 id 按协议异常处理，不会配给其他请求。

### 分页策略

`listTools(cursor)` 只取一页，cursor 原样视为不透明字符串。`listAllTools()` 循环跟随 `nextCursor`，直到字段消失；默认最多 **100 页**，可用 `maxToolListPages` 调整。达到上限抛出 `PAGINATION_LIMIT`，防止重复游标造成死循环。

## 6. 三层错误不能混写

| 层                     | 示例                                                      | Client 行为                                              |
| ---------------------- | --------------------------------------------------------- | -------------------------------------------------------- |
| 本地状态 / 能力 / 传输 | 未连接、未声明 tools、坏帧、未知 id、进程退出、超时、取消 | 以 `McpClientError` 拒绝，保留 `code` 与 `cause`         |
| JSON-RPC / MCP 协议    | `-32602`、`-32601`、Server 返回的外层 `error`             | 以 `McpRpcError` 拒绝，保留 `rpcCode`、`message`、`data` |
| 工具执行结果           | `result.isError=true`、`result.content` 含失败说明        | **正常返回** `McpCallToolResult`，不抛成 RPC 错误        |

因此下面的 `fail` 结果是工具已经执行后的业务结果，不是连接失败：

```json
{
  "content": [{ "type": "text", "text": "tool execution failed" }],
  "isError": true
}
```

`content`、`structuredContent`、`isError` 均保持各自语义。分页、Tool Schema 或 result 的 JSON 形状与 MCP 线格式一致，不转成纯字符串。

## 7. Server 主动消息的最小安全处理

- 对 Server 的 `ping` 请求返回同 id 的 `result: {}`。
- 对未实现的反向请求（例如 `sampling/createMessage`）返回 `-32601 Method not found`，绝不伪造成功。
- `notifications/cancelled`、`notifications/tools/list_changed` 等 Notification 通过 `onNotification` 暴露，不回复、不暗中声称已完成刷新。
- 本日没有缓存工具列表；收到 `list_changed` 后是否重新列工具由调用方决定。
- 畸形 JSON、非 JSON-RPC 2.0 消息、同时或都不含 `result/error` 的响应均按协议错误处理并关闭传输。

## 8. TDD：先看到正确失败，再最小实现

本日实际按 RED→GREEN 执行，而不是先写 Client 再补测试：

1. **握手 RED**：先写 fixture 和 `test/d035-mcp-client.test.ts`，运行
   `npx vitest run test/d035-mcp-client.test.ts`，因 `src/adapters/mcp-stdio-client.ts` 不存在而失败；随后只实现握手、单页列工具和关闭，转为 1/1 GREEN。
2. **工具/协商 RED**：加入工具结果、RPC error、乱序并发、分页、能力和版本测试，观察到 **7 项按预期失败**（缺少 `listAllTools`、能力检查等）；最小实现后转为 9/9 GREEN。
3. **健壮性 RED**：加入超时、AbortSignal、坏帧、未知 id、退出和双向消息测试，观察到 **4 项失败**：超时/取消 pending 悬挂，Server 请求/通知被误判；实现后转为 19/19 GREEN。
4. **顽固进程关闭 RED**：fixture 忽略 EOF 和 SIGTERM，旧 `close()` 在 200ms 观察窗内仍未结束，测试按预期失败；加入有界 SIGKILL 升级与监听器清理后转为 20/20 GREEN。

测试过程中出现过两个测试设施问题：30ms 连 Node fixture 启动握手也计入导致初始化先超时，以及 `inspect` 在 Server 请求响应到达前读取状态。它们分别通过合理时限和 fixture 同步修正，没有放宽协议断言。

## 9. 单测覆盖的确定性场景

本地 fixture 通过真实 Node 子进程、真实 stdin/stdout ndjson 运行，覆盖：

- 完整初始化与协议版本/结果校验；
- 并发乱序响应、ID 配对；
- 多页游标和循环游标上限；
- 工具文本/结构化结果、`isError=true`；
- JSON-RPC error 的 code/data；
- 未声明 tools 的本地拒绝；
- 超时、取消及取消通知；
- 非 JSON 帧、未知响应 id、初始化前/操作中进程退出；
- ping、未支持反向请求、取消/list_changed 通知；
- stderr 有界保留、重复关闭、缺失可执行文件、SIGTERM 后的 SIGKILL 清理。

默认 `npm test` 不访问网络。`test/fixtures` 只是测试工具，**不能作为“连接外部 Server”的证据**。

### 最终全仓验收

- `npm run check`：ESLint、TypeScript 和 Vitest 全部通过，**38 个测试文件、360 项测试通过**。
- `npm run test:coverage`：同样 **38 个测试文件、360 项测试通过**。
- 总覆盖率：**Statements 92.84% / Branches 88.65% / Functions 99.64% / Lines 94.40%**，通过项目覆盖率门禁。
- 其中 D035 新增 20 项测试；上述总数也包含既有回归测试，不把 fixture 数量当作外部互操作次数。

## 10. 真实外部 Server 验证

### 包与版本核实

实际通过 npm registry 核实：

```bash
npm view @modelcontextprotocol/server-everything@2025.11.25 \
  version bin dependencies.@modelcontextprotocol/sdk --json
```

结果要点：

- npm 包：`@modelcontextprotocol/server-everything@2025.11.25`；
- 独立可执行文件：`mcp-server-everything`；
- 其 MCP SDK 依赖声明：`^1.19.1`；
- 该包版本的发布时间线与 `2025-11-25` 协议一致，因此本日固定此版本，而非猜测 latest 的兼容性。

### 可复现命令与实际结果

```bash
npm run demo:d035
```

2026-11-12 在本机 Node.js `v24.19.0`、npm `11.17.0` 实际执行成功：

1. `initialize` 协商到 `protocolVersion: "2025-11-25"`；
2. Server `serverInfo` 为 `example-servers/everything` / `1.0.0`（这是 Server 自报版本，不等于 npm 包版本）；
3. `tools/list` 返回 **11 个工具**；
4. 真实 `tools/call`，工具为 `echo`，参数为 `{ "message": "D035 real external MCP stdio call" }`；
5. 返回 `content[0].text = "Echo: D035 real external MCP stdio call"`，外层没有 JSON-RPC error，`isError` 未标记失败；
6. 关闭 stdin 后，外部 npx/Server 进程退出。

完整命令与原始输出见 [`docs/d035-external-transcript.txt`](./docs/d035-external-transcript.txt)。日志未记录环境变量或凭证，HOME 如出现在诊断中会替换为 `<HOME>`。npm 缓存位于仓库外，未加入依赖或提交到项目。

## 11. 限制与下一步边界

- 只支持一个 Client 实例对应一个独立 stdio Server 子进程，不做连接池。
- 不做 HTTP/Streamable HTTP、SSE、Session 重连、Batch、MCP Server 或 D036 工作。
- 不实现 resources/prompts 读写、订阅、logging、roots、sampling、elicitation；相关反向请求明确 `-32601`。
- 不自动把远程 Tool 注册进本项目 Registry，也不替用户做工具授权或入参安全审查。
- 不自动重试请求、不自动重连；请求 ID 不复用。
- `onNotification` 只是可观察入口，不代表已执行资源/工具刷新。
- 真实外部 demo 需要可用的 `npx`；缓存未命中时需要网络。网络失败应如实报错，不会回退成 fixture 冒充成功。
