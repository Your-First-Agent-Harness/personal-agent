# Personal Agent Harness

> **进度：D037 / D100 · v0.1.0** · Node.js 24 原生 TypeScript ESM

D037 把官方 filesystem MCP Server 接入现有 `Tool` / `ToolRegistry`，同时保留本地自研 `read_file`、`list_dir`。调用方通过工厂选择 `local` 或 `mcp`；`AgentLoop`、模型请求格式和 Registry 调度逻辑不变。外部官方 Server 只由独立 `npx` 子进程启动，**没有新增项目运行时依赖**。

## 快速验证

```bash
npm install
npm run check
npm run test:coverage

# 启动真实官方 Server，比较 local / MCP；首次运行需要网络下载 npx 包
npm run demo:d037
```

真实官方验证 transcript：[`evidence/d037-transcript.txt`](./evidence/d037-transcript.txt)。本次实际使用：

- npm 包：`@modelcontextprotocol/server-filesystem@2025.11.25`（精确版本，不使用 `latest`）。
- Server 自报：`secure-filesystem-server@0.2.0`。
- Client 请求并协商：MCP `2025-11-25`，stdio + NDJSON。
- 两种后端均完成真实 `AgentLoop` 三轮：列目录、读文件、最终回答；Server 关闭、临时目录删除，进程退出码 `0`。

## 为什么做适配，而不是重写 AgentLoop

`AgentLoop` 的依赖应当只是稳定的 Tool 契约，而不是某个进程通信协议：

```text
模型/脚本
   │  始终调用 read_file / list_dir
   ▼
AgentLoop → ToolRegistry → Tool.execute(args, context)
                              │
                ┌─────────────┴──────────────┐
                ▼                            ▼
          本地 fs Tool                 MCP Tool 适配层
                                          │  StdioMcpClient
                                          ▼
                         npx @modelcontextprotocol/server-filesystem
```

适配层负责协议差异，Loop 不需要判断后端：

1. 把 MCP `tools/list` 的 `inputSchema` 投影为 Tool `parameters`。
2. 把 Registry 已解析的对象参数交给 `tools/call`，继续传递 `AbortSignal`。
3. 把 MCP `content`、`isError`、`structuredContent.error` 和 JSON-RPC/传输异常转换成 `ToolResult`。
4. 在工厂中完成连接、能力发现、必要工具校验与关闭，失败不会留下无人管理的子进程。

核心入口：

- `src/adapters/mcp-tool.ts`：通用远端 Tool 投影、显式别名/参数映射、结果与错误转换。
- `src/tools/filesystem-backend.ts`：`local` / `mcp` 工厂和 filesystem 专用安全投影。
- `src/adapters/mcp-stdio-client.ts`：复用 D035 Client；本日没有另写一套 JSON-RPC Client。
- `src/demo/d037.ts`：真实 Loop 双后端对比。

## 如何切换后端

### local：现有自研文件工具

```ts
import { createFilesystemBackend } from './src/tools/filesystem-backend.ts';

const backend = await createFilesystemBackend({ backend: 'local' });
try {
  // 把 backend.registry 注入现有 runAgentLoop。
  const tools = backend.registry.list(); // read_file, list_dir
} finally {
  await backend.close();
}
```

`local` 直接注册现有 `readFileTool`、`listDirTool`，没有复制实现。

### mcp：官方 filesystem Server

```ts
import { StdioMcpClient } from './src/adapters/mcp-stdio-client.ts';
import { createFilesystemBackend } from './src/tools/filesystem-backend.ts';

const client = new StdioMcpClient({
  command: 'npx',
  args: [
    '--yes',
    '@modelcontextprotocol/server-filesystem@2025.11.25',
    '/显式/允许的/workspace',
  ],
  requestTimeoutMs: 30_000,
  closeTimeoutMs: 2_000,
});
const backend = await createFilesystemBackend({ backend: 'mcp', client });
try {
  // 与 local 完全相同的 Registry 注入点。
} finally {
  await backend.close(); // 幂等；D035 Client 负责 EOF/SIGTERM 与超时兜底。
}
```

工厂执行 `connect → listAllTools → 校验 read_file/list_directory → 注册投影`。缺少必要工具或握手失败时会主动 `close()`。Demo 还给官方进程只传递 `PATH`、`HOME` 等启动所需环境，不读取模型、Git 或云服务凭证。

## 显式别名与路径映射

官方读工具叫 `read_file`，列目录工具叫 `list_directory`，且都要求绝对路径；本项目既有模型契约使用 `read_file` / `list_dir` 和工作区相对路径。filesystem 投影因此是显式的，而不是按名称猜测：

| Registry 暴露 | MCP 实际调用 | 参数转换 |
| --- | --- | --- |
| `read_file` | `read_file` | `{path:'note.txt'}` → `{path:'/allowed/workspace/note.txt'}` |
| `list_dir` | `list_directory` | `{}` → `{path:'/allowed/workspace'}` |

转换前复用 `resolveInWorkspace`，所以 `../secret` 在本地边界得到 `PATH_OUTSIDE_WORKSPACE`，请求不会到达外部 Server。官方 Server 的 allowed directory 同时被限制为同一个临时/显式工作区，形成第二层防护。

通用适配器默认保留远端名称、description 和 `inputSchema`；filesystem 工厂为了维持既有 Agent 契约，**有意覆盖**公开名称、description 和 Schema，并在上述调用边界转换参数。这不是暗中改变语义。

即使官方 Server 还列出 `write_file` 等工具，工厂也只挑选这两个只读能力。未知 `write_file`、`shell` 等调用由 Registry 返回 `UNKNOWN_TOOL`，不会转发。

## 哪些语义保持一致，哪些天然不同

### 保持一致

- Loop/模型看到相同的 `read_file`、`list_dir` 名称、description、公开 JSON Schema 和相对路径约定。
- Registry 继续负责 JSON 解析、Schema 校验、未知工具和权限边界；非法 JSON/参数不会进入 MCP。
- 两种后端都返回 `ToolResult`，Loop 的消费方式不变。
- 本地 `ToolError`（例如路径逃逸）保留原错误码；远端结构化错误若使用本项目已知错误码，会保留 code/message/hint/retryable。
- 正常文本 content、`isError` 和结构化错误都有受测转换。

### 不假装完全一致

- **列目录格式不同**：local 使用 `nested/`、`note.txt`；官方使用 `[DIR] nested`、`[FILE] note.txt`。
- **读取限制/提示不同**：local 保留自身的行数、字节和超长截断提示；官方 Server 可能有自己的大文件策略和文案。
- **错误文案和细分码不同**：本地文件错误来自自研 Tool；官方普通失败常是 `isError + text`，映射为 `MCP_TOOL_ERROR`，不会伪装成完全相同的本地异常。
- MCP 非文本 content block 以 JSON 文本拼入 `ToolResult.content`；当前 Tool 契约没有二进制内容通道。
- 成功结果的 `structuredContent` 不被伪造为额外 Tool 字段；本日结构化转换重点是 `structuredContent.error`。
- 协议和进程故障有额外的稳定错误码：`MCP_RPC_ERROR`、`MCP_TRANSPORT_ERROR`；请求超时/取消沿用 `TOOL_TIMEOUT` / `TOOL_CANCELLED`。

因此，切换保证的是**工具入口和 Loop 契约一致**，不是输出字节或所有错误细节完全一致。

## 对比 Demo

```bash
npm run demo:d037
```

`src/demo/d037.ts` 创建一个临时工作区，写入相同的 `note.txt` 和 `nested/`，然后用同一个确定性脚本 ModelProvider 分别运行两个真实 `AgentLoop`。它不是直接调用脚本函数冒充 Harness 集成，也不需要模型 API Key。

每次调用输出：

- `backend=local|mcp`；
- Loop 看到的 `exposed` 工具名与原始 `args`；
- 实际远端 `remote` 工具名与 `remoteArgs`；
- 结果摘要和 `isError`；
- 协商协议、Server 名称/版本和 `closed=true`。

本次官方结果：两种后端读取到相同 `D037 shared workspace\n`，列目录格式如上述表格不同；MCP 记录明确显示 `list_dir {} → list_directory {path:<临时绝对路径>}`。最后删除临时目录并输出 `workspaceRemoved=true`。

默认测试通过依赖注入使用本地 stdio fixture，保持离线确定；官方 Demo 是另外实际执行过的验收，**没有用自研 D036 Server 替代官方验证**。

## 错误与生命周期验收

- MCP `isError`：保留文本；识别并保留结构化 ToolError，否则得到 `MCP_TOOL_ERROR`。
- JSON-RPC error：转换成 `MCP_RPC_ERROR`，不悬挂 Loop。
- 请求超时：D035 Client 有界等待，适配为 `TOOL_TIMEOUT`。
- 子进程退出：在途请求被拒绝并适配为 `MCP_TRANSPORT_ERROR`，之后仍能关闭。
- 未知工具、路径逃逸：在外部调用前拦截。
- 初始化能力不完整：关闭 Client 并拒绝构造不完整后端。
- 后端 `close()` 幂等；Demo 每个后端都在 `finally` 中关闭，工作区也在 `finally` 中删除。

## TDD 实录

本日新行为遵循 RED → GREEN：

1. **通用适配 RED**：先写 `test/d037-mcp-tool.test.ts`，因 `mcp-tool.ts` 不存在而失败。最小实现后覆盖 Schema、对象参数、文本/非文本 content、`isError`、结构化错误、JSON-RPC、超时、取消和传输错误。
2. **别名 RED**：新增显式投影测试时实际出现 `1 failed / 4 passed`；补 `McpToolProjection` 后，确认 Registry 只看到本地名称/Schema，而 Client 收到远端名称/映射参数。
3. **filesystem 后端 RED**：`test/d037-filesystem-backend.test.ts` 首先因工厂模块不存在失败；最小实现后，路径逃逸测试进一步促成 `ToolError` 原样转换。最终覆盖只读工具集合、绝对路径、切换、缺失能力和幂等关闭。
4. **stdio 组合验收**：真实本地 fixture 跑通握手、Registry 调用、超时和进程退出。全套高并发检查曾让 100ms 的握手先于目标超时路径失败，因此将 fixture 请求超时调为 1 秒；仍断言工具超时 2 秒内返回。
5. **Demo RED**：`test/d037-demo.test.ts` 首先因 `src/demo/d037.ts` 不存在失败；实现后双后端真实 Loop、实际远端参数、关闭和清理测试转绿。测试中的 stop reason 按既有 Loop 契约使用 `completed`，没有为本日改写 Loop。

最终验证：

```text
npm run check          → 44 个测试文件，393 项测试全部通过
npm run test:coverage  → 44 个测试文件，393 项测试全部通过
```

全项目覆盖率：statements **92.37%**、branches **87.59%**、functions **99.09%**、lines **94.02%**。新增 `mcp-tool.ts` statements/lines 均 **100%**，`filesystem-backend.ts` statements/lines 均 **100%**，`d037.ts` statements **93.93%**、lines **96.55%**。

## 文件清单

- `src/adapters/mcp-tool.ts`
- `src/tools/filesystem-backend.ts`
- `src/demo/d037.ts`
- `scripts/d037-compare.ts`
- `test/d037-mcp-tool.test.ts`
- `test/d037-filesystem-backend.test.ts`
- `test/d037-stdio-integration.test.ts`
- `test/d037-demo.test.ts`
- `test/fixtures/d037-filesystem-server.ts`
- `evidence/d037-transcript.txt`

`src/core/tool.ts` 只增加 MCP 错误码，`package.json` 只增加 `demo:d037`。主 `src/index.ts` 和既有 CLI 默认后端未改；切换由本日工厂显式注入。

## 限制

- 只接 filesystem 的 `read_file` / `list_directory`，不开放写、移动、删除、搜索或 shell 工具。
- 只验证 MCP `2025-11-25` stdio；没有 HTTP/WebSocket 传输，也没有扩展其他协议版本。
- 官方包精确固定为 `2025.11.25`；升级时需重新核对工具 Schema、allowed-directory 行为和协议兼容性。
- `npx` 首次执行需要网络；离线 CI 使用本地 fixture，正式官方验收仍需显式运行 Demo。
- 本日交付的是 filesystem Registry 工厂，不是全局配置迁移；现有 CLI 和其他内置工具保持原行为。
- stdio 本机进程隔离不等于多租户安全边界。生产接入仍需审计外部包、工作区权限、输出内容和资源限制。
