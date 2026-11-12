# Personal Agent · 第 38 天

> 进度：D038 / D100 · v0.1.0
>
> 主题：复盘「文档、示例、issue 处理」——把 D034–D037 的 MCP 协议、Client、Server 与文件双后端整理成可安全复现的使用文档
>
> 今日交付：完整 MCP 中文使用文档、可运行示例索引与故障排查表、本周复盘、真实 GitHub issue 快照，以及 D035/D036/D037 的本轮复验。没有新增运行时行为，没有提前制作 D039/D040 内容。

## 先读这份文档

**[docs/mcp.md](docs/mcp.md)** 是面向使用者的主文档，覆盖：

- 当前唯一支持的协议范围：`2025-11-25`、stdio、tools。
- Client 连接外部 Server、自有 Server 启动与官方 Inspector 验收。
- local/MCP 文件后端的真实代码配置、命令、名称与路径映射。
- API、生命周期、错误码、超时、取消、关闭。
- stdout/stderr、权限、凭证、npx 供应链和路径边界。
- 常见误用与故障排查表、本轮真实验证结果和已知限制。

配套材料：

- [2026-W51 本周复盘](docs/weekly/2026-w51.md)：D034–D037 的设计取舍与限制。
- [D038 真实 issue 快照](docs/feedback/d038-v0.1-issues.json)：日期、查询命令、数量和空 issues 数组。
- [D034 协议说明](docs/d034-mcp-protocol.md) 与 [生命周期时序](docs/d034-mcp-sequence.md)。
- [D035 历史外部 Client transcript](docs/d035-external-transcript.txt)。
- [D036 历史官方 Inspector transcript](docs/d036-inspector-transcript.txt)。
- [D037 历史双后端 transcript](evidence/d037-transcript.txt)。

历史 transcript 只用于对照，不冒充 D038 本轮运行；本轮结果见下文和 `docs/mcp.md` 第 11 节。

## 环境与快速验证

要求 Node 24、npm。项目仍是原生 TypeScript ESM，零新增 MCP 运行时依赖：

```bash
npm install
npm run check
npm run test:coverage
```

外部 Server 与 Inspector 通过固定版本的 `npx --yes` 临时执行，首次或缓存失效时需要 npm 网络。issue 查询另外需要 GitHub 网络和已登录的 `gh`。环境失败不能写成协议验证成功。

## 四条可运行路径

### 1. Client 连接真实外部 Server

```bash
npm run demo:d035
```

实际启动 `@modelcontextprotocol/server-everything@2025.11.25`，完成 initialize、tools/list、echo tools/call 与子进程关闭。完整代码是 `scripts/d035-external.ts`，没有使用虚拟 Client 替代外部进程。

### 2. 启动自有只读 MCP Server

```bash
npm run mcp:server
```

该命令等待 stdio Client，不会自行结束。`src/demo/d036-mcp-server.ts` 创建安全临时工作区，只暴露 `read_file/list_dir`；stdout 只写协议，日志写 stderr，关闭后删除临时目录。

### 3. 用独立官方 Inspector 调用自有 Server

```bash
npx --yes @modelcontextprotocol/inspector@2.15.0 \
  --cli --transport stdio --format json --method tools/list \
  -- node src/demo/d036-mcp-server.ts

npx --yes @modelcontextprotocol/inspector@2.15.0 \
  --cli --transport stdio --format json --method tools/call \
  --tool-name read_file --tool-args-json '{"path":"README.txt"}' \
  -- node src/demo/d036-mcp-server.ts
```

initialize 命令、参数细节和预期结果见主文档。当前没有 `demo:d036:inspector` npm script；Inspector 会自己启动 Server，不要再手工启动一份 `mcp:server`。

### 4. 同一任务比较 local / MCP 文件后端

```bash
npm run demo:d037
```

脚本在同一临时工作区中依次执行 local 和 MCP 半程。它使用确定性假模型，不访问真实模型 API；MCP 半程连接固定版本 `@modelcontextprotocol/server-filesystem@2025.11.25`。

后端选择是代码配置，不是环境变量：

```ts
await createFilesystemBackend({ backend: 'local' });
await createFilesystemBackend({ backend: 'mcp', client });
```

当前没有 `MCP_BACKEND` 或 `--backend` 开关。完整 Client 配置、Registry 执行与关闭方式见 `src/demo/d037.ts` 和主文档。

## 本周教学主线：协议 → Client → Server → 适配层

### D034：先把协议子集说准确

先固定 `2025-11-25`、JSON-RPC 2.0、ndjson stdio 和 tools，再定义 initialize→initialized→list/call、ping、取消和 stdio 关闭。stdout 不能混日志，通知不能回复，不能用自造 shutdown 代替传输关闭。

**取舍**：用明确的小子集换可实现、可测试、可审查，而不是泛称“完整 MCP”。

### D035：Client 的主体是状态与资源管理

`StdioMcpClient` 不仅发送请求，还负责状态机、request id、pending、capabilities、分页上限、stderr 上限、超时/AbortSignal 和子进程退出。外部 Server 版本必须精确协商到 `2025-11-25`。

**取舍**：零新增运行时依赖意味着自己维护协议边界；收益是错误和清理可控，限制是不重连、不支持其他传输和完整 MCP 能力。

### D036：Server 复用 Registry，不复制工具逻辑

`McpStdioServer` 把 Registry 的 name/description/parameters 投影为 MCP 工具，把 arguments object 序列化为 Registry 的 JSON 字符串，并复用原 Schema、权限和 ToolResult。

**取舍**：`toolNames` 显式白名单减少暴露；协议错误与工具 `isError` 分层；并发响应按 id 配对；取消传真实 AbortSignal，但不能强制结束不合作 Tool。

### D037：切换后端不等于无差异透传

文件适配层始终只给 Agent 两个只读工具：

| 本地契约 | MCP 远端 |
|---|---|
| `read_file` | `read_file` |
| `list_dir` | `list_directory` |
| 工作区相对路径 | 先做越界检查，再映射为绝对路径 |

远端写工具不会自动进入 Registry。两种后端共享调用入口和任务流程，但目录文本格式、内容块和错误细节不保证逐字节一致。

**取舍**：显式映射增加少量维护成本，换来稳定模型契约和最小权限；不把“都是文件工具”误认为零适配。

完整复盘见 [docs/weekly/2026-w51.md](docs/weekly/2026-w51.md)。

## 示例与排障索引

| 需求 | 入口 | 网络/凭证 |
|---|---|---|
| 外部 everything Server 的 echo | `npm run demo:d035` | npm 网络或缓存；不需要模型 Key |
| 自有 Server 长驻 stdio | `npm run mcp:server` | 无外部网络 |
| 独立官方 Client 验收 | `docs/mcp.md` 第 5.2 节三条 Inspector 命令 | npm 网络或缓存 |
| local/MCP 同一任务 | `npm run demo:d037` | MCP 半程需要 npm 网络或缓存；无模型 Key |
| stdout 非 JSON、未初始化、版本混用 | `docs/mcp.md` 第 10 节排障表 | 按真实错误码定位 |
| `isError` 与 JSON-RPC error | `docs/mcp.md` 第 7 节 | 同时处理 Promise reject 和 resolved isError |
| 超时、取消、关闭 | `docs/mcp.md` 第 8 节 | Tool 必须配合 AbortSignal |
| local/MCP 路径和工具名 | `docs/mcp.md` 第 6 节 | `list_dir→list_directory`，相对→绝对 |
| 权限、凭证、路径边界 | `docs/mcp.md` 第 9 节 | 最小 env、工具白名单、非完整 OS 沙箱 |

## D038 本轮真实示例复验

实际执行日期：**2026-11-13（Asia/Shanghai）**。环境：Node `v24.19.0`、npm `11.17.0`。基线：`e1ad63b9d51218c9ad47448a097739848b238569`。

| 本轮执行 | 退出码 | 真实观察 |
|---|---:|---|
| `npm run demo:d035` | 0 | everything Server 协商 `2025-11-25`；发现 11 个工具；echo 返回 `D035 real external MCP stdio call`；PASS 并关闭 |
| Inspector initialize | 0 | 返回 `personal-agent-safe-demo`、tools capability、`2025-11-25` |
| Inspector tools/list | 0 | 返回两个真实 Registry 工具及 inputSchema |
| Inspector tools/call read_file | 0 | 返回临时 README 真实内容，`isError:false`；Server 停止并清理 |
| `npm run demo:d037` | 0 | local/MCP 都 list→read、3 turns、completed、closed；MCP 使用 `list_directory` 与绝对路径；`workspaceRemoved=true` |

本轮出现的 npm `Unknown user config "home"` warning 来自本机 npm 配置，不影响退出码。自查时还确认了两个容易写错的命令：自有 Server 的真实脚本名是 `mcp:server`，issue archive 的输出路径是位置参数而不是 `--output`。文档只保留已验证的正确形式。

## issue 处理：真实查询，零也不编造

本轮先执行：

```bash
npm run feedback:archive -- docs/feedback/d038-v0.1-issues.json
```

归档结果：

```text
ISSUE_ARCHIVE_PASS total=0 open=0 closed=0
```

随后用以下命令独立复核，真实输出为 `[]`：

```bash
gh issue list --state all --limit 100 --json number,title,state,createdAt,closedAt,url
```

快照文件保留：

- repository：`Your-First-Agent-Harness/personal-agent`
- capturedAt：`2026-11-12T21:44:37.687Z`（UTC）
- 完整 `gh issue list --repo ... --state all --limit 1000 ...` 命令
- total/open/closed：均为 0
- issues：空数组

因此本日**没有可处理的真实 issue**，没有创建虚构用户、虚构文档反馈或关闭记录，也没有修改任何真实 issue。替代性自查限于：核对真实导出与脚本、复跑三组示例、检查文档相对链接、写明网络依赖和已知限制。

## TDD 与本日改动边界

本日任务是文档、示例复验和复盘，没有新增函数、API 或运行时行为，因此不制造无意义 RED。复跑没有发现需要修复的可复现实现 bug；没有顺手重构 Client、Server、Registry 或适配层。

实际新增/修改仅为：

- `README.md`：D038 教学、复验、issue 与复盘入口。
- `docs/mcp.md`：完整 MCP 中文使用文档、示例索引和排障表。
- `docs/weekly/2026-w51.md`：D034–D037 本周复盘。
- `docs/feedback/d038-v0.1-issues.json`：当前真实空 issue 快照。

没有改 main 索引，没有新增依赖，没有制作 D039 录屏或 D040 公开课。

## 最终回归与文档检查

以下命令均在本轮实际执行，退出码为 0：

```text
npm run check          → ESLint、TypeScript 通过；44 个测试文件、393 项测试通过
npm run test:coverage  → 44 个测试文件、393 项测试通过，覆盖率门禁通过
```

全项目覆盖率：statements **92.37%**、branches **87.59%**、functions **99.09%**、lines **94.02%**。项目门禁为 statements/lines/functions 80%、branches 75%，本轮全部达标。

另外实际检查了 README、主文档和 weekly 中 20 个相对链接，全部指向存在的文件；`git diff --check` 通过。npm 仍有本机 `home` 配置 warning，但检查、测试和覆盖率命令均成功。

## 已知限制

- 仅支持 MCP `2025-11-25`、stdio、tools；不支持 HTTP、其他日期版本、resources/prompts 等能力。
- MCP 类不是包根导出；仓库内按源文件相对路径导入。
- Client 不可重连；自有 Server 是单 Client stdio，不分页、不发布 listChanged。
- 自有 Server 不声明 outputSchema；双后端内容格式不保证完全一致。
- 超时/取消不保证不合作 Tool 已停止；Client 对超时后的未知迟到响应按协议错误处理。
- 路径越界检查不是完整 OS 沙箱；外部 Server、npx 包、环境变量与 stderr 都需最小权限和脱敏。
- D035/D036/D037 的外部包需要网络或可信缓存；D037 的确定性模型不证明真实模型表现。
