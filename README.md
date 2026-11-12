# Personal Agent · 第 39 天

> 本文件是 D039 的完整教学文档，不是 `main` 索引。目标是亲手运行一次真实跨进程 MCP 故障演示，看清“传输断开”和“工具业务错误”的边界，以及为什么必须用新 Client 恢复、不能自动重放失败调用。

## 1. 今日任务

任务卡要求：**Demo：跨进程 MCP 调用完整演示；录屏（含失败重连）**。

本日交付一条离线、确定性、可重复的真实 stdio 调用链：

1. Client 启动独立 OS 进程中的 MCP Server。
2. 完成 `initialize`、能力校验、`notifications/initialized`、`tools/list`。
3. 通过 D037 的 MCP Tool 适配层和本地 `ToolRegistry` 完成第一次 `tools/call`。
4. 专用测试 Server 在响应 `disconnect` 前以退出码 `42` 终止，制造真实传输断开。
5. 旧 Client 的 pending Promise 以 `McpClientError(code="TRANSPORT_ERROR")` 拒绝；旧 Client 被显式关闭。
6. Client factory 创建**另一个** `StdioMcpClient`，启动新 Server 进程并重新完成握手与工具发现。
7. 用不同 call id、不同参数发起独立的新调用并成功。
8. 关闭全部子进程后才输出 `D039 PASS`，入口退出码为 `0`。

当前仓库没有录屏交付链，因此本日不伪造视频、外部反馈或公开课，保留本轮真实终端记录：[`evidence/d039-transcript.txt`](evidence/d039-transcript.txt)。

## 2. 先运行，再看原理

### 2.1 环境

- macOS 26.5（本轮实测环境）
- Node.js `v24.19.0`
- npm `13.8.0`
- TypeScript、Vitest 均使用仓库既有开发依赖
- 不需要 API Key，不访问外部服务，不新增运行时依赖

### 2.2 运行 Demo

在 `personal-agent` 根目录执行：

```bash
npm run demo:d039
```

也可以直接执行入口：

```bash
node scripts/d039-reconnect.ts
```

本轮 transcript 中的真实进程关系是：

| 角色 | PID | 结果 |
| --- | ---: | --- |
| Demo Client / 父进程 | 21992 | 编排两次连接并清理资源 |
| 第一次 Server | 21993 | 首次 echo 成功，随后按测试设计以 42 退出 |
| 第二次 Server | 21994 | 重新握手并完成恢复后的独立 echo |

PID 每次运行都会变化；应检查两个 `serverPid` 不同，而不是期待固定数字。关键输出如下，完整原文以 transcript 为准：

```text
connection=1 initialize=ok protocol=2025-11-25
connection=1 notifications/initialized=sent
connection=1 tools/list=ok names=echo,disconnect
tools/call id=d039-first-echo result=ok serverPid=21993
failureCode=TRANSPORT_ERROR message="MCP Server 提前退出（code=42, signal=null）"
connection=1 oldClientClosed=true failedCallReplayed=false
connection=2 initialize=ok protocol=2025-11-25
connection=2 notifications/initialized=sent
connection=2 tools/list=ok names=echo,disconnect
tools/call id=d039-recovered-echo result=ok serverPid=21994
cleanup clients=2 closed=true
D039 PASS ... failedCallReplayed=false
exitCode=0
```

若握手、失败类型、恢复调用或清理不符合要求，脚本会输出 `D039 FAIL` 并非零退出，不会输出 `D039 PASS`。

## 3. 架构：复用 D035～D037，不重写 MCP

### 3.1 文件职责

| 文件 | 职责 |
| --- | --- |
| `src/adapters/mcp-stdio-client.ts` | D035 既有 Client：进程、ndjson 帧、请求配对、握手、取消、超时、关闭；本日未修改 |
| `src/adapters/mcp-stdio-server.ts` | D036 既有 Server：initialize 闸门、tools/list、tools/call；本日未修改 |
| `src/adapters/mcp-tool.ts` | D037 既有适配层：远端 Tool 投影为本地 Tool；本日未修改 |
| `src/tools/registry.ts` | 复用本地工具注册、参数校验与执行入口 |
| `src/demo/d039-mcp-server.ts` | 本日新增的仓库内确定性测试 Server，提供 `echo` 与 `disconnect` |
| `src/demo/d039.ts` | 演示编排、精确错误分类、新 Client 恢复和最终清理 |
| `scripts/d039-reconnect.ts` | 可运行入口；成功输出 PASS，失败设置非零退出码 |
| `test/d039-reconnect-demo.test.ts` | 真实跨进程集成测试及不可重连错误边界测试 |
| `evidence/d039-transcript.txt` | 本轮实际终端输出与真实退出码 |

`d039-deterministic-test-server` 只是明确命名的仓库内测试 Server，**不是官方或外部 MCP Server**。它没有网络依赖，也不冒充第三方实现。

### 3.2 进程与模块关系

```text
scripts/d039-reconnect.ts
  └─ runD039Demo                         [父进程]
      ├─ Client factory #1
      │   └─ StdioMcpClient #1 ── stdio ndjson ── Server 进程 #1
      │       ├─ McpStdioServer
      │       ├─ echo
      │       └─ disconnect → exit(42)
      ├─ close(Client #1)
      ├─ Client factory #2
      │   └─ StdioMcpClient #2 ── stdio ndjson ── Server 进程 #2
      │       └─ echo（新的独立调用）
      └─ finally close(所有 Client)
```

Client 与 Server 不是同一进程内直接调用函数。`echo` 返回值中的 `serverPid` 来自 Server 进程的 `process.pid`，测试还断言它既不同于父进程 PID，也不同于恢复后的 Server PID。

### 3.3 完整时序

```text
父进程                  Client #1              Server #1
  │ initialize            │                       │
  │──────────────────────>│──────────────────────>│
  │                       │<────── result ────────│
  │                       │── initialized ───────>│
  │ tools/list            │──────────────────────>│
  │<──── echo tools ──────│<────── result ────────│
  │ tools/call echo       │──────────────────────>│
  │<──── success/PID ─────│<────── result ────────│
  │ tools/call disconnect │──────────────────────>│
  │                       │        进程退出 42 <──│
  │<── TRANSPORT_ERROR ───│                       │
  │ close(Client #1)      │                       │
  │                       │                       │
  │                  Client #2              Server #2
  │ initialize            │                       │
  │──────────────────────>│──────────────────────>│
  │                       │── initialized ───────>│
  │ tools/list            │──────────────────────>│
  │ tools/call echo       │──────────────────────>│
  │<──── success/PID ─────│<────── result ────────│
  │ finally close         │                       │
```

两次 `openSession` 都执行完整握手和工具发现，不存在“沿用第一次 initialized 状态”的捷径。

## 4. 失败与重连语义

### 4.1 只有一种情况进入本 Demo 的恢复路径

```ts
try {
  await first.client.callTool("disconnect", {});
} catch (error) {
  if (!(error instanceof McpClientError) || error.code !== "TRANSPORT_ERROR") {
    throw error;
  }
  // 关闭旧 Client，再由 factory 创建新 Client。
}
```

| 结果或错误 | 是否进入演示性重连 | 原因 |
| --- | --- | --- |
| `McpClientError(code="TRANSPORT_ERROR")` | 是，仅本 Demo 的一次 | 已明确观察到 stdio 子进程退出等传输故障 |
| MCP `CallToolResult.isError=true` | 否 | 这是已完成响应中的业务工具失败，不是断线 |
| `McpRpcError` / `RPC_ERROR` | 否 | Server 已返回 JSON-RPC error，传输仍可能正常 |
| `TIMEOUT` | 否 | 无法据此断定调用未执行，不能擅自重放 |
| `ABORTED` | 否 | 调用方主动取消，不是重连信号 |
| `PROTOCOL_ERROR` / `VERSION_UNSUPPORTED` | 否 | 应修复协议或版本，而不是重连碰运气 |

正常 echo 通过 `createMcpTool + ToolRegistry` 调用；故障探测直接使用原始 Client，是为了保留 `McpClientError.code` 与 `McpRpcError` 的精确区别，避免只看适配后的 `ToolResult.isError` 而扩大重连范围。

本日没有给 D035 Client 添加隐式重连，也没有做通用 retry/backoff 框架。单次 Client 仍不可复用重连；恢复动作只属于 Demo 编排层。

### 4.2 为什么不重放失败的 `tools/call`

传输断开只说明响应没有正常回来，**不证明 Server 没有收到或执行请求**。本日的 `disconnect` 甚至已经产生了“终止进程”这一副作用。若自动重放一个有写文件、扣款或创建订单副作用的工具，可能执行两次。

因此恢复后的调用是：

- 新 call id：`d039-recovered-echo`；
- 新参数：`after-reconnect-independent-call`；
- 新 Client、新 Server 进程、新初始化会话；
- 不是 `d039-disconnect` 的再次发送。

集成测试记录真实 Client 调用顺序，并断言只有：

```text
Client #1 echo → Client #1 disconnect（一次）→ Client #2 echo
```

### 4.3 清理和证据边界

- 旧 Client 在第二次 factory 调用之前关闭。
- 外层 `finally` 对创建过的 Client 再执行幂等清理，覆盖中途失败路径。
- `close()` 复用 D035 的 stdin EOF、SIGTERM、SIGKILL 升级机制。
- 子进程环境只有 `NO_COLOR=1`，使用绝对 `process.execPath`，不继承父进程凭证。
- 只有全部步骤和清理成功才输出 PASS；transcript 末尾记录实际 `exitCode=0`。

## 5. TDD：先看 RED，再写实现

### 5.1 RED

先新增 `test/d039-reconnect-demo.test.ts`，在实现文件不存在时执行：

```bash
npm test -- test/d039-reconnect-demo.test.ts
```

最终 RED 观察为 **4 项失败、0 项通过**：

- 入口测试：`scripts/d039-reconnect.ts` 不存在，`MODULE_NOT_FOUND`；
- 跨进程恢复测试：`src/demo/d039.ts` 不存在，`ERR_MODULE_NOT_FOUND`；
- `isError` 边界测试：同样因 Demo 模块不存在而失败；
- JSON-RPC 错误边界测试：同样因 Demo 模块不存在而失败。

这证明测试覆盖了尚未交付的新行为，而不是在实现后补一条天然通过的断言。

### 5.2 GREEN

随后只新增 Demo、专用 Server、入口和 `demo:d039` 脚本，复跑同一命令：

```text
Test Files  1 passed (1)
Tests       4 passed (4)
Duration    476ms
```

真实 Demo 观察到第一次 Server `19448`、第二次 Server `19449`；随后录制 transcript 时又独立复现为 `21993 → 21994`，说明结果不依赖固定 PID 或预先写好的输出。

## 6. 测试与全量验证

### 6.1 本日聚焦测试

```bash
npm test -- test/d039-reconnect-demo.test.ts
```

4 项测试分别验证：

1. 真实可运行入口使用默认 Client factory，清理后输出 PASS。
2. 两个真实 Server 进程完成成功、断开、新 Client 恢复；disconnect 只调用一次，且旧 Client 先关闭。
3. MCP `isError` 不创建第二个 Client、不重放，并清理已有 Client。
4. JSON-RPC error 不创建第二个 Client、不重放，并保留 `RPC_ERROR` 与 `rpcCode`。

### 6.2 全项目检查

实际执行：

```bash
npm run check
```

结果：**45 个测试文件、397 项测试全部通过**，lint 与 TypeScript 类型检查通过。

### 6.3 覆盖率与实测数据

完整覆盖率命令：

```bash
npm run test:coverage
```

排查期间，既有 D035 用例“请求超时会清理 pending”曾在并行执行全量任务及默认高并发下，两次于 `initialize` 的既有 100ms 限时处失败；单独运行该文件在覆盖率下 20/20 通过，限 4 个 worker 的全量复跑也通过。最终按要求串行执行 `npm run check && npm run test:coverage`，**不带额外参数的原始覆盖率命令退出 0**。

最终结果为 **45/45 文件、397/397 测试通过**，没有修改旧测试、放宽请求超时或降低覆盖率门槛。真实汇总：

| 指标 | 覆盖率 | 配置门槛 |
| --- | ---: | ---: |
| Statements | 91.66% | 80% |
| Branches | 87.45% | 75% |
| Functions | 97.95% | 80% |
| Lines | 93.29% | 80% |

D039 编排文件 `src/demo/d039.ts` 的实测覆盖率为 Statements 92.15%、Branches 73.33%、Functions 85.71%、Lines 93.61%。独立 Server 文件在子进程中运行，其父进程 V8 coverage 不聚合该子进程计数，所以报告显示 0%，但它确实被入口测试和跨进程集成测试执行；0% 不代表本次 Demo 使用了模拟 Server。

## 7. 如何审查证据

1. 打开 [`evidence/d039-transcript.txt`](evidence/d039-transcript.txt)，先确认 Node 版本与命令。
2. 找两段 `initialize=ok` 和两段 `notifications/initialized=sent`，确认不是复用旧会话。
3. 找第一次 echo 的 PID、`code=42` 和 `TRANSPORT_ERROR`，确认是真实进程退出。
4. 找 `oldClientClosed=true`，确认它出现在第二次 factory 之前。
5. 比较恢复后的 call id、参数和 PID，确认不是失败调用重放。
6. 确认 `cleanup clients=2 closed=true`、`D039 PASS` 和 `exitCode=0`。
7. 如需重新生成，可在 zsh 中使用 `setopt pipefail` 后将真实命令输出通过 `tee` 写入该文件；失败时必须保留非零退出，不能把旧 PASS 当作新证据。

## 8. 已知限制

- 这是 D039 的定点故障演示，不是生产级通用重连器，没有指数退避、多次重试或自动请求重放。
- 故障由仓库内测试 Server 确定性产生，尚未证明任意第三方 Server 的恢复行为；外部 SDK 能力仍以 D035 文档边界为准。
- stdio Client 与 Server 子进程一一对应；旧 Client 永远不在原进程上“复活”。
- 只有明确 `TRANSPORT_ERROR` 才进入本演示恢复路径；超时是否安全重试必须由具体工具的幂等性另行决定。
- 本轮只在 macOS + Node 24 实测，没有声明 Windows 或其他 Node 版本兼容结果。
- 本日交付真实终端 transcript，不声称已生成视频、公开课程或获得外部反馈。
