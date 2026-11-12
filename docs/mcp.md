# MCP 使用文档

> 适用版本：Personal Agent `v0.1.0` · D038
>
> 实现范围：MCP **`2025-11-25`**、**stdio**、**tools**。本文只描述仓库当前真实代码、脚本和已复跑命令。

## 1. 先确认边界

本仓库同时提供四种能力：

| 能力 | 当前入口 | 用途 |
|---|---|---|
| 外部 MCP Client | `src/adapters/mcp-stdio-client.ts` | 启动并连接外部 stdio Server，完成握手、发现与调用工具 |
| 自有 MCP Server | `src/adapters/mcp-stdio-server.ts` | 把现有 `ToolRegistry` 中明确选择的工具暴露给外部 Client |
| MCP 工具投影 | `src/adapters/mcp-tool.ts` | 把远端 MCP 工具变成 Agent 可执行的本地 `Tool` |
| 文件双后端 | `src/tools/filesystem-backend.ts` | 在 local 与官方 filesystem MCP Server 之间复用同一 Registry 契约 |

当前**不支持** HTTP、WebSocket、其他 MCP 协议版本，以及 resources、prompts、sampling、roots、elicitation、logging、动态 `listChanged`。自有 Server 的 `tools/list` 不分页；Client 可以读取外部 Server 的游标分页，但有页数上限。

MCP 类目前不是包根导出。仓库内示例使用上述源文件的相对路径；不要从 `personal-agent` 包根导入 `StdioMcpClient`、`McpStdioServer` 或 `createFilesystemBackend`，因为 `src/index.ts` 和 package exports 当前没有导出这些名称。

## 2. 环境与安装

要求 Node 24 与 npm。项目本身没有新增 MCP 运行时依赖，示例直接用 Node 24 原生 TypeScript ESM：

```bash
npm install
node --version
npm run check
```

外部 Server 和官方 Inspector 通过 `npx --yes <精确版本>` 临时执行。首次运行或缓存失效时需要访问 npm 网络；它们没有写入本项目的 `dependencies`、`devDependencies` 或 lockfile。离线环境必须先准备可信缓存，不能把网络失败误判为协议失败。

## 3. 可运行示例索引

在仓库根目录执行：

| 示例 | 命令 | 实际验证内容 | 外部网络 |
|---|---|---|---|
| D035 外部 Client | `npm run demo:d035` | 连接 `@modelcontextprotocol/server-everything@2025.11.25`，握手、列出工具、调用 `echo`、关闭子进程 | 需要 npx 包或缓存 |
| D036 自有 Server | `npm run mcp:server` | 在 stdio 上等待 Client；只暴露 `read_file`、`list_dir` | 启动本身不需要 |
| D036 官方 Inspector | 下节三条 `npx ... inspector@2.15.0` 命令 | 独立 Client 完成 initialize、tools/list、tools/call | 需要 Inspector 包或缓存 |
| D037 双后端 | `npm run demo:d037` | 同一临时工作区、同一确定性任务分别跑 local/MCP，比较调用并关闭后端 | MCP 半程需要 npx 包或缓存 |
| D038 issue 快照 | `npm run feedback:archive -- docs/feedback/d038-v0.1-issues.json` | 用 `gh` 查询全部真实 issue 并写入 JSON | 需要 GitHub 访问与 gh 登录 |

`npm run mcp:server` 是长驻进程，不会自行打印“演示成功”后退出。官方 Inspector CLI 命令会通过 `-- node src/demo/d036-mcp-server.ts` 自行启动一个全新的 Server，因此不要再手工启动一份 `npm run mcp:server` 与它搭配。

完整实现可直接阅读：

- `scripts/d035-external.ts`
- `src/demo/d036-mcp-server.ts`
- `scripts/d037-compare.ts` 与 `src/demo/d037.ts`
- `scripts/archive-feedback.ts`

## 4. 作为 Client 连接外部 Server

### 4.1 最短的已验证路径

```bash
npm run demo:d035
```

该脚本固定启动：

```text
npx --yes @modelcontextprotocol/server-everything@2025.11.25 stdio
```

成功时应看到 `EXTERNAL MCP RESULT: PASS`。它实际执行 `connect()`、`listTools()`、`callTool("echo", ...)`，最后在 `finally` 中关闭连接。

### 4.2 Client API 与最小调用顺序

仓库内代码可以这样导入真实类：

```ts
import { StdioMcpClient } from './src/adapters/mcp-stdio-client.ts';

const client = new StdioMcpClient({
  command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
  args: ['--yes', '@modelcontextprotocol/server-everything@2025.11.25', 'stdio'],
  env: {
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
  },
  requestTimeoutMs: 30_000,
  closeTimeoutMs: 2_000,
});

try {
  const initialized = await client.connect();
  const tools = await client.listAllTools();
  const result = await client.callTool('echo', { message: 'hello' });

  if (result.isError === true) {
    // 这是工具结果中的业务失败，不是 JSON-RPC transport error。
    console.error(result.content);
  }
  console.log(initialized.serverInfo, tools.length, result.content);
} finally {
  await client.close();
}
```

完整环境白名单与结果校验以 `scripts/d035-external.ts` 为准。`connect()` 自动完成：

```text
initialize(request)
  → initialize(result)，核对 protocolVersion/capabilities/serverInfo
  → notifications/initialized（不等待响应）
  → ready
```

Client 会在每次 `tools/list`、`tools/call` 前检查：状态必须是 `ready`，且 Server 必须声明 `capabilities.tools`。同一实例不能重复 `connect()`；关闭后要新建实例，不能复用旧连接。

### 4.3 工具分页

- `listTools()` 只取一页；第二页起传上一页的 `nextCursor`。
- `listAllTools()` 自动跟随游标，默认最多 100 页。
- 超过上限会抛出 `PAGINATION_LIMIT`，防止循环游标造成死循环。
- 自有 `McpStdioServer` 不生成 `nextCursor`，只返回显式选择的小工具集合。

### 4.4 Client 构造选项

| 选项 | 默认值 | 说明 |
|---|---|---|
| `command` | 必填 | 要启动的可执行文件；Windows 的 npx 通常使用 `npx.cmd` |
| `args` | `[]` | 子进程参数；外部包应固定可信版本 |
| `env` | `{}` | 子进程环境，不自动继承整个 `process.env` |
| `requestTimeoutMs` | `10000` | 每个 initialize/list/call 请求的本地超时 |
| `closeTimeoutMs` | `2000` | 关闭时等待退出、SIGTERM 后等待 SIGKILL 的每阶段时长 |
| `maxToolListPages` | `100` | `listAllTools()` 页数上限 |
| `maxStderrChars` | `65536` | 保留的 Server stderr 尾部上限 |
| `onNotification` | 无 | 观察 Server 通知；通知 observer 抛错会被视为协议错误 |

主要方法：`connect()`、`listTools(cursor?, options?)`、`listAllTools(options?)`、`callTool(name, arguments?, options?)`、`getStderr()`、`close()`。`options.signal` 是可选 `AbortSignal`。

## 5. 启动自有 Server

### 5.1 安全示例

```bash
npm run mcp:server
```

等价入口是 `node src/demo/d036-mcp-server.ts`。每次启动都会：

1. 在系统临时目录创建独立工作区，写入固定 `README.txt`、`hello.txt`。
2. 注册现有 `readFileTool`、`listDirTool`。
3. 用 `toolNames: ['read_file', 'list_dir']` 再设一层显式白名单。
4. 把协议输出接到 stdout，把启动/停止诊断接到 stderr。
5. stdio 结束后停止 Server 并递归删除临时工作区。

不要把启动日志写到 stdout；stdio Client 会把 stdout 的每一行当 JSON-RPC 帧解析。

### 5.2 用官方 Inspector 独立验收

以下命令与 D036 实际命令一致，固定在仓库根目录执行。每条命令都会启动一个全新的 Server 子进程，临时目录后缀不同是正常的。

initialize：

```bash
npx --yes @modelcontextprotocol/inspector@2.15.0 \
  --cli --transport stdio --format json --method initialize \
  -- node src/demo/d036-mcp-server.ts
```

tools/list：

```bash
npx --yes @modelcontextprotocol/inspector@2.15.0 \
  --cli --transport stdio --format json --method tools/list \
  -- node src/demo/d036-mcp-server.ts
```

tools/call：

```bash
npx --yes @modelcontextprotocol/inspector@2.15.0 \
  --cli --transport stdio --format json --method tools/call \
  --tool-name read_file --tool-args-json '{"path":"README.txt"}' \
  -- node src/demo/d036-mcp-server.ts
```

预期分别看到：协议 `2025-11-25` 与 `personal-agent-safe-demo`、两个工具及其 `inputSchema`、临时工作区 README 内容和 `isError:false`。当前没有名为 `demo:d036:inspector` 的 npm script，不要臆造该命令。

### 5.3 Server API 与生命周期

```ts
import { McpStdioServer } from './src/adapters/mcp-stdio-server.ts';
import { listDirTool, readFileTool } from './src/tools/fs.ts';
import { ToolRegistry } from './src/tools/registry.ts';

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

`start()` 只能调用一次，返回的 Promise 在输入关闭/`close()` 后完成。`close()` 幂等；通常由 stdin 结束触发。当前没有另造非标准 `shutdown` 或 `exit` RPC。

Server 对 initialize 中的其他字符串版本仍返回自己支持的 `2025-11-25`，由 Client 决定是否继续。本仓库 Client 要求响应版本精确相等，所以混用版本会以 `VERSION_UNSUPPORTED` 失败，不会静默降级。

`ping` 可在 initialized 前使用；`tools/list`、`tools/call` 必须等 `notifications/initialized`。工具调用可以并发完成，响应通过原 JSON-RPC id 配对，不保证按请求发送顺序返回。

## 6. local / MCP 文件后端

### 6.1 配置方式

双后端是**代码配置**，不是 `.env` 或 CLI 开关。当前没有 `MCP_BACKEND`、没有 `--backend`，根包也没有导出 `createFilesystemBackend`。

```ts
import { createFilesystemBackend } from './src/tools/filesystem-backend.ts';

const local = await createFilesystemBackend({ backend: 'local' });
await local.close();
```

MCP 后端需要先传入真实 Client：

```ts
const client = new StdioMcpClient({
  command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
  args: ['--yes', '@modelcontextprotocol/server-filesystem@2025.11.25', workspaceRoot],
  env: {
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
  },
  requestTimeoutMs: 30_000,
  closeTimeoutMs: 2_000,
});

const backend = await createFilesystemBackend({ backend: 'mcp', client });
try {
  // backend.registry.list() / backend.registry.execute(...) 与 local 使用同一入口。
} finally {
  await backend.close();
}
```

`workspaceRoot` 必须是允许官方 filesystem Server 访问的绝对目录。完整可运行配置、临时目录创建和清理见 `src/demo/d037.ts`。

### 6.2 一键跑同一任务

```bash
npm run demo:d037
```

脚本使用确定性假模型，不调用真实模型 API，也不需要模型凭证。它依次跑 local 和 MCP，不是通过命令行选择其中一个后端。成功时两边都为 `turns=3`、`stopReason=completed`，并显示 `closed=true`、`workspaceRemoved=true`。

### 6.3 适配层做了什么

| Agent 看到的契约 | local | MCP |
|---|---|---|
| `read_file` | 直接执行现有文件 Tool | 调用远端 `read_file` |
| `list_dir` | 直接执行现有目录 Tool | 显式改名为远端 `list_directory` |
| `path` 省略 | `list_dir` 默认为 `.` | 同样先补为 workspace 根绝对路径 |
| 相对路径 | 在 workspace 内解析 | 先经同一边界检查，再把绝对路径发给 Server |
| 工具集合 | 只有 `read_file/list_dir` | 即使远端有写工具，也只投影这两个 |

`createFilesystemBackend({backend:'mcp'})` 会先握手和读取全部工具；缺少 `read_file` 或 `list_directory` 会关闭 Client 并拒绝创建不完整后端。`backend.close()` 幂等，关闭后继续调用会得到可观察的工具错误。

两种后端保证的是 Registry 工具名称、参数边界和任务流程一致，不保证远端文本格式、错误细节或内容块逐字节一致。例如官方 `list_directory` 会返回 `[DIR]`/`[FILE]` 标记，local 则返回本地排序后的名称。

## 7. 错误码：分清三层

### 7.1 JSON-RPC / MCP 协议错误

自有 Server 当前映射：

| code | 场景 |
|---|---|
| `-32700` | 单行 JSON 无法解析，`id:null` |
| `-32600` | 非法 JSON-RPC 信封、重复 initialize |
| `-32601` | 未知方法 |
| `-32602` | 非法 initialize/tools 参数；未知、未选择或不可见工具 |
| `-32603` | Registry 意外抛异常；不向 Client 泄露内部异常文本 |
| `-32000` | initialized 之前调用 tools，Server not initialized |

通知没有响应，包括 `notifications/initialized`、未知通知和未知取消 id。

### 7.2 Client 抛出的本地错误

| `McpClientError.code` | 含义与处理 |
|---|---|
| `INVALID_STATE` | 未 connect、重复 connect 或状态不允许；修正生命周期 |
| `VERSION_UNSUPPORTED` | Server 响应不是 `2025-11-25`；固定兼容版本，不要忽略检查 |
| `PROTOCOL_ERROR` | 非 JSON stdout、非法帧/响应或结果形状错误；检查 Server 日志与实现 |
| `TRANSPORT_ERROR` | 子进程、stdin、提前退出或关闭错误；检查 command/env/stderr |
| `RPC_ERROR` | Server 返回 JSON-RPC error；读取 `McpRpcError.rpcCode/data` |
| `CAPABILITY_MISSING` | Server 没声明 tools capability；不要继续调用工具 |
| `PAGINATION_LIMIT` | tools 游标超过页数上限；检查循环游标或提高有界上限 |
| `TIMEOUT` | 请求超过 `requestTimeoutMs`；本地 reject 并发送取消通知 |
| `ABORTED` | AbortSignal 在发送前或在途取消；按取消流程处理 |

### 7.3 `isError` 与 Registry 工具错误

`tools/call` 的 JSON-RPC 请求可以成功，同时工具业务失败：

```json
{
  "result": {
    "content": [{ "type": "text", "text": "文件不存在：missing.txt" }],
    "isError": true,
    "structuredContent": {
      "error": { "code": "FILE_NOT_FOUND", "message": "...", "retryable": true }
    }
  }
}
```

所以调用方必须同时处理：

1. Promise reject：协议、连接、超时、取消等。
2. Promise resolve 后的 `result.isError === true`：工具业务失败。

`createMcpTool()` 把远端结果重新变成 Agent 的 `ToolResult`：

| 远端情况 | 本地错误码 |
|---|---|
| `isError:true`，带可识别 `structuredContent.error` | 保留原 ToolErrorCode，例如 `PATH_OUTSIDE_WORKSPACE` |
| `isError:true`，无可靠结构化错误 | `MCP_TOOL_ERROR` |
| JSON-RPC error | `MCP_RPC_ERROR` |
| Client `TIMEOUT` | `TOOL_TIMEOUT` |
| Client `ABORTED` | `TOOL_CANCELLED` |
| 其他 Client/传输/协议错误 | `MCP_TRANSPORT_ERROR` |

未知工具、Schema 失败、文件不存在、路径越界、敏感工具未确认不是同一种错误。不要用“所有失败都 retry”掩盖它们。

## 8. 超时、取消与关闭

- Client 的每个请求都有独立计时器；默认 10 秒，可用 `requestTimeoutMs` 调整。
- 在途超时或 abort 会发送 `notifications/cancelled`，reason 分别为 `timeout`、`aborted`；发送前已 abort 则不会发出请求。
- 超时/取消只保证本地 Promise 结束，不保证外部 Server 已停止工作。超时后的迟到响应没有 pending id，当前 Client 会按未知响应 id 视为协议错误并关闭传输。
- Server 收到取消通知后，把真实 `AbortSignal` 传给 Registry/Tool，并抑制该调用的迟到响应。
- Tool 必须监听 `context.signal`、清理自己的子进程和定时器；协议层无法强制结束一个不合作的 Promise。
- Client `close()` 先结束子进程 stdin；不退出时经过 `closeTimeoutMs` 发 SIGTERM，再经过相同时长发 SIGKILL。`close()` 可重复等待同一结果。
- Server 在 stdio 关闭时 abort 所有在途调用、清空活动表并停止写响应。
- 最佳模式仍是 `try/finally` 关闭后端或 Client；不要依赖进程崩溃清理。

## 9. 权限、凭证与路径安全

### 9.1 工具权限

- 自有 Server 不要默认暴露整个生产 Registry；同时审查 Registry 策略与 `toolNames` 白名单。
- 文件示例只读，不暴露 shell、写文件、编辑、网络或凭证工具。
- 敏感工具仍需 Registry 确认；示例不会自动批准，未确认会返回 `TOOL_CONFIRMATION_REQUIRED`。
- stdio 没有网络认证、加密或多租户授权。它依赖本机进程隔离和工具策略，不能直接改成公网服务。

### 9.2 子进程与凭证

- `env` 默认不是完整父环境。只传运行必需的 `PATH`、`HOME`、npm cache 等，避免把 API Key、Token、云凭证无差别交给外部 Server。
- 不要为了“让 npx 能跑”直接传整个 `process.env`；先确认 Server 发布者、精确版本和所需权限。
- `getStderr()` 只用于诊断，可能包含路径或 Server 打出的敏感信息；分享 transcript 前先脱敏。
- npx 首次下载是供应链与网络边界；生产环境应使用审核过的固定制品和缓存，而不是每次隐式取最新版。

### 9.3 路径边界

`resolveInWorkspace()` 会拒绝空路径以及 `../`、绝对路径等解析后越出 workspace 的输入。MCP 后端在发远端请求前也执行该检查，因此明显的路径逃逸不会到达外部 Server。

这不是完整 OS 沙箱：当前字符串/绝对路径检查不等于对所有符号链接、硬链接、竞态和 Server 自身权限的防护。生产环境还要限制子进程 OS 用户、真实路径、挂载和文件系统权限，并确认官方 Server 的 allowed directory。不要把示例临时目录当作多租户隔离方案。

## 10. 常见误用与故障排查表

| 症状 | 最可能原因 | 正确处理 |
|---|---|---|
| `PROTOCOL_ERROR: stdout 含非 JSON 帧` | Server 把 `console.log`、启动横幅写进 stdout | stdout 只写一行一个 JSON-RPC 帧；日志改 stderr/errorOutput |
| `Server not initialized` / `-32000` | initialize 后漏发 `notifications/initialized` | 按握手顺序执行；使用 `StdioMcpClient.connect()` 自动完成 |
| `INVALID_STATE` | 未 connect 就调用、重复 connect、关闭后复用 | 每会话创建新 Client，遵守 idle→ready→closed |
| `VERSION_UNSUPPORTED` | Server 协商到别的日期版本 | 固定兼容 Server；当前只接受 `2025-11-25`，不要混用 2024/2026 版本 |
| `CAPABILITY_MISSING` | Server 没有 tools 能力 | 换有 tools 的 Server 或修正 capability，不要强行 call |
| JSON-RPC `-32602 Unknown tool` | 工具未注册、未进 `toolNames`、策略不可见或名字写错 | 先看 tools/list；filesystem 远端目录名是 `list_directory`，本地才是 `list_dir` |
| 工具返回 `isError:true`，但请求看似成功 | 把业务失败当成传输失败，或完全没检查 isError | 读取 content 与 structuredContent.error；按业务码处理 |
| 文件路径在 local 可用、MCP 失败 | 把相对路径直接交给远端，或 allowed directory 不一致 | 使用 D037 适配层；统一 workspace 绝对路径与 Server 允许目录 |
| `PATH_OUTSIDE_WORKSPACE` | `../`、绝对路径或解析结果越界 | 改用工作区内相对路径；不要关闭边界检查 |
| `spawn npx ENOENT` / 命令无法启动 | command 不对、env 缺少 PATH、Node/npm 未安装 | 检查 Node 24/npm；Windows 用 `npx.cmd`；显式传最小 PATH |
| npx 下载或 `gh` 查询失败 | 无网络、代理、认证或缓存不可用 | 将其记为环境失败，不伪称协议通过；准备缓存或完成 `gh auth login` |
| 工具列表一直翻页 | 外部 Server 返回循环 nextCursor | 保留 `maxToolListPages` 上限并检查 Server 游标 |
| 调用超时后 Server 仍在忙 | Tool 没监听 AbortSignal | 在 Tool 内响应 signal 并清理资源；必要时关闭整个子进程 |
| 进程不退出 | 没 close，或子进程忽略 stdin/SIGTERM | `finally await close()`；保留有界 SIGTERM/SIGKILL 兜底 |
| `npm run demo:d036:inspector` 提示 Missing script | 使用了不存在的脚本名 | 使用本文真实 Inspector `npx` 命令；自有 Server 脚本名是 `mcp:server` |
| issue 归档写到名为 `--output` 的文件 | archive 脚本把第一个参数当输出路径，不支持该选项 | 使用 `npm run feedback:archive -- docs/feedback/<name>.json` |

## 11. D038 本轮真实复验

复验日期：**2026-11-13（Asia/Shanghai）**；Node `v24.19.0`，npm `11.17.0`；基线 `e1ad63b9d51218c9ad47448a097739848b238569`。以下不是复制旧 transcript：

| 本轮命令 | 退出码 | 真实结果 |
|---|---:|---|
| `npm run demo:d035` | 0 | 协商 `2025-11-25`；外部 everything Server 返回 11 个工具；`echo` 返回本轮文字；`EXTERNAL MCP RESULT: PASS`；子进程关闭 |
| Inspector `--method initialize` | 0 | 返回 `personal-agent-safe-demo`、`capabilities.tools.listChanged:false`、`2025-11-25` |
| Inspector `--method tools/list` | 0 | 返回真实 `read_file/list_dir` 描述和 inputSchema |
| Inspector `--method tools/call ... read_file` | 0 | 返回 `D036 safe MCP workspace...`，`isError:false`；临时目录删除 |
| `npm run demo:d037` | 0 | local/MCP 都执行 list→read，均 3 turns、completed、closed；MCP 映射 `list_directory` 和绝对路径；临时工作区删除 |
| `npm run feedback:archive -- docs/feedback/d038-v0.1-issues.json` | 0 | GitHub 全部 issue：total 0、open 0、closed 0；无 issue 被修改或关闭 |

本轮 npm 输出本机已有的 `Unknown user config "home"` warning，不影响上述退出码，也不是 MCP Server 的协议输出。历史原始记录仍可对照 [D035 transcript](d035-external-transcript.txt)、[D036 transcript](d036-inspector-transcript.txt) 和 [D037 transcript](../evidence/d037-transcript.txt)；它们不替代本轮结果。

真实 issue 快照见 [d038-v0.1-issues.json](feedback/d038-v0.1-issues.json)，其中保留 UTC 时间、完整 gh 查询命令、数量和空 issues 数组。没有真实 issue 可处理，因此本日只做文档/API/命令/链接自查，没有虚构用户反馈或关闭记录。

## 12. 已知限制

- 仅 `2025-11-25`、stdio、tools；没有其他传输、版本或 MCP 能力。
- Client 的 stdio 是单 Server 子进程会话，不支持重连；自有 Server 是单 Client 会话。
- 自有 Server 不分页、不发布 `listChanged`；Client 分页最多 100 页。
- 自有 Server 成功结果只投影文本 content 与 `isError:false`，不声明 outputSchema，不伪造成功 structuredContent。
- `createMcpTool()` 会把非文本 content block JSON 序列化后用换行拼接；双后端不是内容格式完全等价。
- 取消依赖 Tool 合作；本地超时不等于远端工作已停止。
- 当前文件路径检查不是完整 OS 沙箱；外部 Server 仍是需要信任和限制权限的本地子进程。
- 示例外部包依赖 npx 网络或缓存，D037 不依赖真实模型，D036 Inspector 是独立 Client 证据。

本周设计取舍与 D034–D037 复盘见 [2026-W51](weekly/2026-w51.md)。
