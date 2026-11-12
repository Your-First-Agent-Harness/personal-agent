# Personal Agent · D024 可靠性修复与复审

> 计划日期：2026-12-04
> 日分支：`D024`
> 基线：`D023` / `ef0cad7`
> 任务：D24「可靠性修复：对齐任务卡的可靠性要求」

本日只做可靠性审计、可证明的最小修复、进程测试加固和安装文档。没有合并 `main`，没有执行 D025，也没有发布 npm / GitHub release。

## 1. 从安装到验证

第一次接触仓库时，先读 **[安装与本地打包验证](docs/install.md)**。文档包含：

- Node.js 24 准备、克隆与分支切换、按锁文件执行 `npm ci`；
- 仅含占位符的配置示例，以及不需要模型密钥的检查方式；
- `npm run check`、`npm run test:coverage`；
- `npm pack`、干净临时目录安装 tarball、包元数据与原生 SQLite 冒烟；
- 旧 Node.js 的 `node:sqlite` 模块、实验开关和路径问题。

源码开发的最小命令：

```bash
npm ci
cp .env.example .env
npm run check
npm run test:coverage
```

只有真实调用模型时才需要在本地 `.env` 填写有效密钥。本日测试和打包验证没有读取或打印真实 `.env`，也没有请求真实模型服务。

## 2. 可靠性审计清单

审计范围是 D021–D023 新增的持久化与进程恢复路径，而不是泛化重构整个项目。

| 检查项 | 证据与结论 | 本日处理 |
| --- | --- | --- |
| D021 Message 数据边界 | `session-store.ts` 已校验角色、内容、ToolCall 及位置；非法 JSON、非法结构、位置错误均显式报错 | 保留现有行为，无需修改 |
| D021 Session 保存事务 | `save` 在同一事务内校验身份、替换消息并提交；异常路径回滚 | 回归测试通过，无需修改 |
| D022 Run 状态与 tool-log | `addIfAbsent` 事务保护 Run 与工具日志；`start` 原子幂等；`finish` 校验状态 | 回归测试通过，无需修改 |
| D022/D023 迁移 | D022 旧表补列测试与 D023 旧 `runs` 表补 `result_json` 测试均存在，迁移 SQL 由生产构造函数执行 | 补列迁移测试通过，无另建迁移框架 |
| D023 `result_json` 反序列化 | 原实现只做 `JSON.parse` 后类型强转；合法 JSON 的 `null`、缺字段对象、坏 ToolCall 等会伪装成 `AgentLoopResult` | **确认缺陷并最小修复** |
| 事务与关闭 | 定向复审 `begin/commit/rollback`、Store/Service `close`、测试临时目录清理；未发现可稳定证明的新问题 | 不为假想问题改生产代码 |
| 进程 `error` / `exit` / `close` | 生产 `run-command.ts` 用 `close` 汇总 stdio，`finish` 只完成一次，并清理 timeout 与 abort listener | 生产行为不变，加固测试握手 |
| D022/D023 子进程夹具 | 复用 PID ready、存活定时器、进程退出及 `stopChild` 清理；SIGKILL 后不能残留只写工具日志的进程 | 沿用现有夹具，不复制新框架 |

### 本日修复的持久化边界

`src/memory/run-store.ts` 现在只有完成 Run 的 `result` 非空时才解析 `result_json`，并在返回前验证：

- 顶层必须是对象，`messages` 必须是合法 Message 数组；
- Message 的角色、文本、ToolCall `id/name/arguments`、可选工具字段必须符合类型；
- `text` 必须是字符串，`turns` 必须是非负整数；
- `stopReason` 必须属于既有停止原因；
- `usage.inputTokens/outputTokens` 必须是非负整数。

语法损坏或结构损坏都抛出 `RunStoreError('Run 完成结果数据损坏')`。本日只拒绝坏数据，不自动修复、丢弃或改写历史 Run。

## 3. RED → GREEN 证据

### RED：先证明反序列化缺陷

在未修改生产代码时，先向 `test/d023-idempotency.test.ts` 加入 7 类“JSON 合法、结构非法”的 `result_json`：

1. 顶层 `null`；
2. 缺少 `usage`；
3. `messages` 不是数组；
4. ToolCall 缺少 `arguments`；
5. `turns` 为小数；
6. 非法 `stopReason`；
7. `usage` 缺少字段。

执行：

```bash
npm test -- test/d023-idempotency.test.ts
```

7 个新增用例全部按预期 RED：测试期望 `RunStoreError`，原实现却没有抛错并返回了损坏记录。这证明测试击中了缺陷，而不是拼写或夹具错误。

另补的“JSON 语法损坏”用例覆盖原有 catch 防线；它属于现有行为的回归测试，首次通过，不人为制造 RED。

### GREEN：只修改必要的生产文件

增加结构类型守卫后，定向执行持久化与恢复测试，再执行全量测试：

```bash
npm test -- test/d023-idempotency.test.ts \
  test/d022-persistent-runner.test.ts \
  test/d022-run-store.test.ts test/d021-session-store.test.ts
```

损坏数据用例转为 GREEN，D021–D023 原有幂等、迁移、恢复、事务和消息校验测试保持通过。没有为覆盖率增加生产分支，也没有改动 `src/tools/run-command.ts`。

## 4. 50ms 超时竞态：根因与确定性修复

### 根因

旧测试让生产代码在 `spawn` 时启动 50ms timeout，同时依赖子进程启动后写入 `child.pid`。并行或高负载下，Node 子进程可能尚未完成初始化，timeout 已触发；此时读取 PID、假设 ready 或期待已经产生的 stdout 都处于竞态窗口中。

生产实现已经在子进程 `close` 时收集 stdio，并统一清理 timeout。证据指向测试的启动时序假设，因此只修 `test/run-command.test.ts`。

### 确定性握手

新测试按以下顺序执行：

1. 仅对 `setTimeout` 使用 Vitest 假计时器；
2. 启动真实子进程，等待有效的 `child.pid` ready 握手；
3. PID 等待用单调时钟截止时间和 `setImmediate` 让出事件循环，不再固定 sleep 10ms 碰运气；
4. 确认 ready 后，显式推进假计时器 50ms；
5. 等待真实进程关闭，断言进程已退出、`timedOut: true` 且 `stdout === 'ready'`；
6. `afterEach` 恢复真实计时器。

验证结果：

```text
定向测试：22/22 通过
同一文件连续重复 10 轮：220/220 通过
全量 check 与 coverage 并行运行：该文件均 22/22 通过
```

## 5. 10 次真实 SIGKILL 加固

`test/d023-crash-idempotency.test.ts` 保留原文件名以清晰展示 D023 夹具演进，测试组更新为 D024，并由 5 轮扩为 **10 轮独立真实进程测试**。

每轮都使用全新临时数据库，并完成以下链路：

1. 进程 1 初始化 Session；
2. 进程 2 只写 `tool-log` 并靠存活定时器保持运行；
3. 对进程 2 执行真实 `kill(child.pid, 'SIGKILL')`，断言退出 `signal === 'SIGKILL'`；
4. 进程 3 恢复，断言没有 tool-result 残留，输出恢复前快照；
5. 进程 4 使用同一 `runId` 重放，断言输出完全相同；
6. 每轮分别验证 Messages、Run、`tool-log`、业务工具实际只执行一次，以及进程存活定时器已清理。

不是只循环 `spawn`：每一轮都独立断言 signal、恢复状态、消息快照、Run 终态和工具日志一致性，也不靠固定短暂 sleep 判断 ready。

```text
npm test -- test/d023-crash-idempotency.test.ts
Test Files  1 passed
Tests       10 passed（第 1–10 次全部通过）
```

该 10 轮文件随后又在全量 `check` 和全量 `coverage` 中各执行一次；本日这三轮自动化共完成 30 次真实 SIGKILL，全部通过。

## 6. 覆盖率逐文件复审

全局阈值保持 **statements 80 / lines 80 / functions 80 / branches 75**，未降低任何阈值。逐文件复审按任务要求使用 statements / functions / lines ≥ 80、branches ≥ 75。

实际全量报告：

| 范围 | Statements | Functions | Lines | Branches | 结论 |
| --- | ---: | ---: | ---: | ---: | --- |
| 全部生产文件 | 94.13% | 98.74% | 94.84% | 89.84% | 过全局下限 |
| `src/memory/run-store.ts`（本日修改） | 91.54%（65/71） | 100%（24/24） | 91.42%（64/70） | 94.38%（84/89） | 过逐文件下限 |

**本日无新增生产文件。** 唯一修改的生产文件是 `src/memory/run-store.ts`，其 statements / functions / lines 均高于 80，branches 高于 75。数据来自 `coverage/memory/run-store.ts.html` 与本次终端覆盖率汇总；未为凑数字修改生产代码。

## 7. 真实全量验证结果

本机环境：Node.js `v24.19.0`，npm `11.17.0`。

| 命令 | 真实结果 |
| --- | --- |
| `npm run check` | ESLint、TypeScript、全量测试通过；28 个测试文件、230 项测试 |
| `npm run test:coverage` | 28 个测试文件、230 项测试通过；全局及上述逐文件指标过线 |
| 连续 10 轮 `test/run-command.test.ts` | 每轮 22 项，累计 220 项通过 |
| `npm test -- test/d023-crash-idempotency.test.ts` | 10 次真实 SIGKILL 全部通过 |

### 实际打包安装验证

本日实际执行了 `npm pack --pack-destination <clean-temp-dir>`，随后在另一个干净临时目录执行 `npm install --prefix <clean-install-dir> <tarball>`，安装成功。随后从该安装目录读取包元数据并用 `DatabaseSync(':memory:')` 执行 `SELECT 1`，输出：

```text
personal-agent tarball install/sqlite smoke: ok
```

也实际探测了安装后的 TypeScript 运行时导入：Node.js 24 对 `node_modules` 内 `.ts` 文件抛出 `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`，即使加 `--experimental-transform-types` 也相同。因此没有声称 tarball 已是可导入的 JavaScript 运行时；这一限制和冒烟的准确边界已写入 [docs/install.md](docs/install.md)。可运行开发方式仍是仓库内 `npm ci` 后 `npm run dev`。

## 8. 本日文件与边界

- `src/memory/run-store.ts`：完成结果结构校验。
- `test/d023-idempotency.test.ts`：损坏 `result_json` RED/GREEN 与回归测试。
- `test/run-command.test.ts`：ready 后触发 timeout 的确定性测试。
- `test/d023-crash-idempotency.test.ts`：5 轮扩为 10 轮真实 SIGKILL。
- `docs/install.md`：陌生开发者安装与本地 tarball 验证。
- `README.md`：本教学记录。

边界：未合并 `main`，未做 D025，未发布 npm 或 GitHub release，未制作视频，未声称任何外部用户反馈。SIGKILL 验证环境为 macOS / Node.js 24；Windows 的 POSIX signal 语义不在本次实测范围内。当前 `private` 源码开发包的公开运行时发布形态仍属后续发布工作。
