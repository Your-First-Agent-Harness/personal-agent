# D018 · 真实仓库回归修复回放

> 课程日期：2026-11-28

## 今天的目标

今天交付一个可以反复运行的真实缺陷修复 Demo：从 D017 在仓库中发现并修复的取消优先级缺陷出发，在系统临时目录重建“旧代码 → 回归测试失败 → 精确修复 → 回归测试通过”的完整过程。

这不是另造一个玩具函数，也不是把 D017 已修复的生产源码重新改坏。Demo 只在临时副本中注入旧缺陷，当前仓库的 `src/runtime/loop.ts` 始终保持已修复状态。

交付物包括：

- `scripts/d018-real-repair.ts`：无模型、无公网、可重复运行的仓库修复回放；
- `test/d018-real-repair.test.ts`：调用同一个 Demo 并检查全部机器可读证据；
- `package.json` 的 `demo:d018`：一条命令运行 Demo；
- 本页完整的缺陷背景、运行时序、实测结果和边界说明。

**事实边界：这个缺陷来自本仓库 D017 的真实 RED，不是来自 GitHub issue。本日没有创建或伪造 GitHub issue，没有制作视频，也没有调用真实 ARK 或声称真实模型修复成功。**

## 回放的真实缺陷是什么

D017 的 FP-07 发现：外部取消发生在 `run_command` 执行期间时，工具会正常返回一个结构化诊断结果：

```text
ToolResult.isError = true
ToolResult.error.code = COMMAND_CANCELLED
content.cancelled = true
```

旧 Loop 在工具消息后立刻累加连续错误。如果 `maxConsecutiveToolErrors: 1`，这个 `COMMAND_CANCELLED` 会先触发错误保险丝，使整个 run 返回 `tool_errors`，覆盖调用方已经发出的取消意图。

D017 的最小修复是在工具消息写入历史之后、连续错误计数之前增加三行：

```ts
if (options.signal?.aborted) {
  return cancelled(turn);
}
```

修复后的优先级是：

```text
工具 execute 返回
  → tool_call_finished
  → role: tool 诊断消息进入历史
  → signal.aborted？
      ├─ 是：run_cancelled，返回 cancelled
      └─ 否：更新连续错误计数，再判断 tool_errors
```

因此，单次命令仍然可以报告 `COMMAND_CANCELLED`，但整个 run 的停止原因必须是 `cancelled`。D018 没有再次修改这段生产逻辑，而是把它作为修复回放的终点。

## 与 D015 有什么不同

D015 已经证明 `read_file → 失败测试 → edit_file → 成功测试` 的工具闭环。D018 保留这条易懂的修复路径，但把被修复对象、缺陷来源和回归测试都推进到真实项目层级。

| 维度 | D015 | D018 |
| --- | --- | --- |
| 被修复文件 | 临时创建的 `math.js` | 当前仓库真实 `src/runtime/loop.ts` 的临时副本 |
| 缺陷来源 | 演示用 `a - b` | D017 实际发现过的取消优先级旧缺陷 |
| 缺陷注入 | 写入玩具源码 | 从真实源码精确移除 D017 的三行取消检查 |
| 回归测试 | 测试 `add(2, 2)` | 运行复制版生产 Loop、Registry 与 `run_command`，真实取消子进程 |
| 修复内容 | 改成 `a + b` | 用 `edit_file` 精确补回取消检查，最终文件逐字等于当前生产版本 |
| 额外证据 | 工作区修复历史与 Session | 内外两层停止原因、真实子进程取消、修复前后 TAP、生产源码不变与临时目录清理 |

D015 回答“Agent 能不能通过工具完成修复闭环”；D018 回答“同一个闭环能不能回放一个真实仓库回归，并证明修复的确切内容”。

## 两层 Loop：修复者与缺陷现场彼此隔离

Demo 有两层 Loop，职责不能混淆：

```text
外层：当前仓库已修复的生产 Loop
  Provider：scripted-d018，五个确定性响应
  Tools：真实 read_file / run_command / edit_file / ToolRegistry
  工作区：系统临时目录中的仓库副本
    │
    ├─ 内层回归测试：副本里的旧 Loop 或修复后 Loop
    │    Provider：scripted-d018-regression
    │    Tool：副本里的真实 run_command
    │    动作：启动 Node 子进程 → 等 started 标记 → AbortController.abort()
    │    断言：副本 run 必须 cancelled，而不是 tool_errors
    │
    └─ 外层继续根据失败反馈精确编辑并复测
```

内层测试是被修复项目的回归测试；外层测试是驱动修复动作的 Harness。即使副本里的旧 Loop 返回错误的 `tool_errors`，它也只是内层 `node:test` 的失败原因，不会把外层修复流程直接中断。

外层将 `maxConsecutiveToolErrors` 设为 3，所以第一次测试失败的 `COMMAND_FAILED` 会作为反馈进入历史，模型脚本下一轮可以继续编辑。内层则刻意设为 1，准确重建 D017 的缺陷触发条件。

## 完整运行时序

### 0. 建立一次性缺陷现场

脚本在 `tmpdir()` 下创建 `pa-d018-real-repair-*` 目录，只做以下写入：

- 递归复制当前真实的 `src/`；
- 写入只有 `{ "type": "module" }` 的最小 `package.json`；
- 写入一个最小 `node:test` 回归测试；
- 仅在副本 `src/runtime/loop.ts` 中，把唯一匹配的修复块替换为旧块。

它不复制仓库根目录，因此不会递归带入 `.git`、`node_modules`、`.env` 或凭证；不运行 `npm install`，不发起网络请求。

### 1. 读取真实缺陷源码

外层第 1 轮调用：

```text
read-loop → read_file({ path: "src/runtime/loop.ts" })
```

读取的是临时副本中的真实旧 Loop，不是测试里伪造的一段文本。

### 2. 修复前运行回归测试

外层第 2 轮通过真实 `run_command` 执行：

```bash
node --test regression.test.ts
```

内层命令先写入 `started`，测试确认子进程已经启动后再取消。旧副本的实际结果是：

```text
exitCode: 1
actual:   'tool_errors'
expected: 'cancelled'
pass: 0
fail: 1
```

这次失败被外层保存为 `tool:test-before:run_command`，错误码为 `COMMAND_FAILED`。它是修复依据，不是被隐藏的 Demo 故障。

### 3. 精确补回取消检查

外层第 3 轮调用真实 `edit_file`：

```text
oldText = 工具消息后的旧连续错误计数块
newText = 工具消息后的取消检查 + 原连续错误计数块
```

`edit_file` 要求唯一匹配并返回 unified diff。没有重写整个文件，没有用正则模糊替换，也没有修改当前仓库的生产文件。

### 4. 修复后运行同一回归测试

外层第 4 轮用完全相同的命令再次运行测试。这次内层同时验证：

- `stopReason === "cancelled"`；
- 只发生一次 Provider 请求；
- 工具结果为 `COMMAND_CANCELLED`；
- 最后一条历史是保留取消诊断的 tool 消息；
- 最后事件是 `run_cancelled`；
- 没有 `run_completed(tool_errors)`。

实测修复后 `exitCode: 0`、`pass: 1`、`fail: 0`。

### 5. 最终回答与证据落点

外层第 5 轮不再调用工具，返回：

```text
仓库回归修复完成：缺陷版测试失败，补回取消检查后测试通过。
```

外层新增历史严格为：

```text
assistant:read-loop
tool:read-loop:read_file
assistant:test-before
tool:test-before:run_command
assistant:repair-loop
tool:repair-loop:edit_file
assistant:test-after
tool:test-after:run_command
assistant:final
```

最后事件为 `run_completed:5:completed`，外层停止原因是 `completed`、共 5 轮、Provider 请求恰好 5 次。内层的 `cancelled` 与外层修复流程的 `completed` 分别描述两个层级，不互相矛盾。

## Demo 与自动化测试共用一份逻辑

`test/d018-real-repair.test.ts` 直接启动 `scripts/d018-real-repair.ts`，不复制一套手工修复步骤。脚本输出 JSON 证据，测试逐项断言：

| 证据 | 必须满足的条件 |
| --- | --- |
| 缺陷注入 | 临时副本与生产源码不同，且命中唯一旧代码块 |
| 修复前测试 | 退出码 1，输出同时包含实际 `tool_errors` 与期望 `cancelled` |
| 修复后测试 | 退出码 0，`pass: 1`，stderr 为空 |
| 最终文件 | 完整内容逐字等于当前生产 `src/runtime/loop.ts` |
| 生产文件安全 | Demo 前后生产源码保持不变 |
| 外层历史 | 上述 9 条 assistant/tool/final 记录顺序完全一致 |
| 工具结果 | read 成功；首次测试 `COMMAND_FAILED`；edit 成功；复测成功 |
| 停止原因 | 外层 `completed`、5 turns、5 次请求，最后事件正确 |
| 清理 | `finally` 删除临时根目录，测试再次确认路径不存在 |

脚本本身也检查先红、后绿、最终文件一致和生产源码不变；不满足时以非零状态退出，而不是打印一份看似成功的报告。

## 怎么运行

需要 Node.js 22 或更高版本，并已安装仓库开发依赖。Demo 和测试自身都不安装依赖、不读取 `.env`。

运行可重复 Demo：

```bash
git switch D018
npm run demo:d018
```

命令输出完整 JSON，包括两次测试的 stdout/stderr、最终 `loop.ts` 内容、历史、工具结果和清理状态。完整源码字段是为了让调用方直接核验最终文件，而不是只相信一个 `success: true`。

运行本日针对性测试：

```bash
npx vitest run test/d018-real-repair.test.ts
```

运行完整验证：

```bash
npm run check
npm run test:coverage
```

## TDD 与实际 RED/GREEN

本日先写 `test/d018-real-repair.test.ts`，固定 Demo 必须提供的退出码、最终文件、历史和停止原因，再实现脚本。

1. **首次 RED**：针对性测试 1 项失败，Demo 进程实际退出码为 1、期望为 0，因为 `scripts/d018-real-repair.ts` 尚未实现。这证明测试不是写完脚本后补出的永久 GREEN。
2. **缺陷现场 RED**：最小实现运行后，内层旧副本真实输出 `actual: 'tool_errors'`、`expected: 'cancelled'`，修复前退出码为 1。这是 D017 旧缺陷的再次实证，不是反转断言伪造的失败。
3. **输出契约校正**：Node 24 默认使用 `spec` 测试报告格式，因此把外层对 `not ok 1` / `# pass 1` 的脆弱匹配改成实际 `ℹ fail 1` / `ℹ pass 1`；没有改变任何行为断言。
4. **GREEN**：同一针对性测试 1 个文件、1 项测试通过；随后完整检查和覆盖率全部通过。

## 最终实测结果

| 验证 | 实际结果 |
| --- | --- |
| `npm run demo:d018` | 修复前退出码 **1**，修复后退出码 **0**；外层 **completed / 5 turns / 5 requests** |
| Demo 工具序列 | read 成功 → `COMMAND_FAILED` → edit 成功 → 复测成功 |
| 最终文件与生产安全 | 副本逐字等于已修复生产版；生产文件未变化 |
| 临时目录 | `tempRemoved: true`，测试确认路径已不存在 |
| D018 针对性测试 | **1 个文件、1 项测试通过** |
| `npm run check` | ESLint、`tsc --noEmit` 和全量 Vitest 均通过 |
| 全量测试 | **19 个文件、171 项测试通过，0 失败** |
| `npm run test:coverage` | 同样 **19/19 文件、171/171 测试通过** |

V8 覆盖率实测：

| Statements | Branches | Functions | Lines | `src/runtime/loop.ts` |
| --- | --- | --- | --- | --- |
| 96.61% | 91.72% | 98.07% | 97.89% | 语句/分支/函数/行均 100% |

本日没有修改生产 `src/`，所以覆盖率与 D017 基线一致。命令只有本机 npm 关于未知 `home` 配置的既有 warning，没有测试失败、类型错误或 ESLint 错误。

## 边界与不做的事情

- Provider 是确定性脚本，不是自主规划模型；本日证明的是 Harness 与真实工具的可重复修复回放，不证明真实 ARK 一定能选择同样动作。
- 不创建或引用虚假的 GitHub issue，不声称制作视频，不伪造外部链接或模型调用记录。
- 不访问公网，不执行 `npm install`，不读取或复制 `.env`、`.git`、`node_modules` 和凭证。
- `run_command` 是真实本地 shell 工具，不是安全沙箱；本 Demo 的命令固定为本机 Node 回归测试和可取消的 Node 子进程，不执行任意外部输入。
- 旧缺陷只注入临时副本；生产 Loop 始终保持 D017 的已修复状态。Demo 失败时也会通过 `finally` 清理临时目录。
- 本日不新增并行工具、命令沙箱、自动重试或通用修复策略，也不把单次回归扩大解释为所有取消路径都已覆盖；完整失败语义仍由 D017 矩阵及既有测试共同保证。
