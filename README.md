# D017 · 失败路径测试矩阵：工具错误、模型故障与外部取消

> 课程日期：2026-11-27

## 今天的目标

今天把“出错时系统应该怎样表现”整理成一张可执行、可追踪的矩阵，而不是继续堆重复的错误单元测试。矩阵回答五个问题：

1. 工具可恢复失败是否变成 `ToolResult` 回喂，而不是抛穿 Loop？
2. 连续工具错误达到上限后，是否以 `tool_errors` 正常返回？
3. Provider 的 HTTP、协议和内部超时失败是否保持 `ModelError`，而不是伪装成工具结果？
4. 外部取消是否以 `cancelled` 正常停止，并且不会被工具错误保险丝覆盖？
5. 文件/命令失败是否保留结构化 code，未知工具异常是否脱敏后再进入 Provider 历史？

交付物包括：

- `test/d017-failure-paths.test.ts`：7 项新增集成证据；
- `docs/adr/0001-failure-semantics.md`：失败语义边界决策；
- `src/runtime/loop.ts`：一个由失败测试驱动的取消优先级最小修复；
- 本页完整教学内容。

## 先复用证据，再补真正的空白

D009、D014 和 D016 已经覆盖大量基础行为。本日没有把这些测试复制一遍，而是让矩阵同时引用“既有证据”和“新增集成证据”。

| 矩阵行                     | 注入方式                                     | 必须保持的边界                                                                          | 可执行证据                                                                   | 本日动作                                   |
| -------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------ |
| F01 工具可恢复失败         | 文件不存在、命令退出 7、工具抛未知异常       | Registry 返回 `ToolResult`；错误 content 回喂；下一轮可正常 `completed`                 | D017 FP-01、FP-02、FP-03                                                     | 补 Loop 集成证据                           |
| F02 非法参数恢复与连续错误 | 非法 JSON、Schema 错误、连续失败、成功后失败 | 错误回喂；成功清零；达到上限正常返回 `tool_errors`                                      | `d016-invalid-arguments.test.ts` 4 项；`tool-errors.test.ts` 连续保险丝 2 项 | 复用 D014/D016，不重复新增                 |
| F03 Provider HTTP 失败     | mock fetch 返回 HTTP 503                     | 带 `status: 503` 的 `ModelError` 抛穿；无工具消息、无取消/完成事件                      | D017 FP-04；Provider 单元测试                                                | 补真实 Provider → Loop 证据                |
| F04 Provider 协议失败      | mock fetch 返回非法 JSON                     | `ModelError` 抛穿，不变成 `ToolResult` 或 `tool_errors`                                 | D017 FP-05；Provider 单元测试                                                | 补真实 Provider → Loop 证据                |
| F05 Provider 内部超时      | mock fetch 挂起，内部 timeout 触发           | 带 cause 的 `ModelError`，不是 `cancelled`                                              | D017 FP-06；D009 Provider 单元测试                                           | 补真实 Provider → Loop 证据                |
| F06 外部取消               | 模型等待中取消；命令执行中取消且错误上限为 1 | 正常返回 `cancelled`，不发 `run_completed`，不被 `COMMAND_CANCELLED` 改判               | D009 `cancellation.test.ts`；D017 FP-07                                      | 补工具执行期间交叉场景并修复缺陷           |
| F07 文件/命令 code 与脱敏  | 真实临时工作区、真实本地命令、伪造敏感值     | `FILE_NOT_FOUND` / `COMMAND_FAILED` 保留；未知异常为 `INTERNAL_ERROR`，原文不进后续请求 | D014 `tool-errors.test.ts` / `errors.test.ts`；D017 FP-01～03                | 只补跨 Registry、Loop、Provider 请求的证据 |

矩阵不是另一份静态清单：FP 编号直接对应测试名，既有行也能用下文的 Vitest 命令执行。未来修改失败语义时，可以按行定位应运行的测试。

## 两条输出通道：Provider 看到的与 Harness 看到的不同

`ToolResult` 同时包含模型反馈和机器可读详情：

```text
ToolResult
├─ content             → Loop 写入 role: tool，下一次 Provider 请求可见
├─ isError             → Loop 用于连续错误计数
└─ error
   ├─ code             → Harness / 调用方判断失败类别
   ├─ message
   ├─ retryable
   └─ hint             → 修复建议，同时拼入 content
```

D017 使用 `RecordingToolRegistry` 只记录真实 `super.execute()` 的返回值，不替换 Registry 行为。这样可以同时证明：

- FP-01 的内部结果是 `FILE_NOT_FOUND`，而下一轮 Provider 收到“文件不存在”和修复 hint；
- FP-02 的内部结果是 `COMMAND_FAILED`，Provider 收到原 JSON content，其中仍有 `exitCode: 7`、stdout、`timedOut: false` 和 `cancelled: false`；
- FP-03 的内部结果是 `INTERNAL_ERROR`，后续请求只含通用错误文本，不含伪造密钥或原始 `stack trace`。

内部 `error` 对象没有被塞进 Provider 消息。测试观察的是实际第二次请求，而不只是直接调用工具后的返回值。

## Provider 故障为什么不能回喂成工具错误

工具错误发生在“模型已经正常返回一次工具调用”之后；Provider 故障则意味着本轮连有效 assistant 响应都没有得到。二者的恢复主体不同：

```text
工具失败
Provider assistant(tool_call)
  → Registry / Tool 返回失败 ToolResult
  → Loop 保存 assistant + tool
  → 下一次 Provider 请求可根据反馈修正

Provider 失败
Loop 请求 chat
  → HTTP / 协议 / 内部超时 ModelError
  → 没有有效 assistant，没有对应 tool_call_id
  → 不伪造 assistant/tool 历史，错误交给上层
```

FP-04～06 使用真实 `createOpenAICompatibleProvider` 和真实 `runAgentLoop`，只替换 `fetchImpl`。除了检查错误实例外，还检查事件流只有 `turn_started`：没有 `assistant_responded`、`tool_call_finished`、`run_cancelled` 或 `run_completed`。这能防止实现为了“让 Loop 更健壮”而把模型故障吞成正常结束。

HTTP 错误保留 `status`，协议错误说明非法 JSON，内部超时保留底层 `cause`。这些测试不访问 `provider.invalid`，因为所有请求都由 mock fetch 接管。

## 外部取消与工具错误保险丝的优先级

### 首次 RED 发现的真实缺陷

`run_command` 收到外部取消时会返回：

```text
ToolResult.isError = true
ToolResult.error.code = COMMAND_CANCELLED
content.cancelled = true
```

原 Loop 在工具返回后直接累加连续错误并判断上限。如果设置 `maxConsecutiveToolErrors: 1`，这个诊断结果会立刻触发 `tool_errors`，即使 `AbortSignal` 已经明确表达外部取消。

FP-07 用真实本地 Node 子进程复现：命令先写入 `started` 标记，再保持运行；测试确认进程启动后调用 `controller.abort()`。首次运行的实际结果是：

```text
7 项测试：6 通过，1 失败
FP-07 期望 stopReason = cancelled
实际 stopReason = tool_errors
```

### 最小 GREEN 修复

Loop 仍保存工具结果和 `tool_call_finished`，便于诊断；但在更新连续错误计数之前检查一次外部取消：

```text
工具 execute 返回
  → 发出 tool_call_finished
  → 保存 role: tool 诊断消息
  → signal.aborted？
      ├─ 是：run_cancelled，返回 cancelled
      └─ 否：更新连续错误计数，再判断 tool_errors
```

修复只增加这一个边界检查，没有修改工具错误码、Provider 或命令实现。同一矩阵随后 **7/7 通过**。FP-07 还证明没有第二次 Provider 请求，最后事件是 `run_cancelled`，而不是 `run_completed(tool_errors)`。

这里不矛盾：单次命令可以结构化地报告 `COMMAND_CANCELLED`，但整个 run 的终止原因必须由外部取消决定。

## 连续错误与取消不是同一种“正常返回”

`tool_errors` 和 `cancelled` 都会返回 `AgentLoopResult`，但语义不同：

| 结果              | 含义                                    | 最后事件                     | 是否表示模型故障 |
| ----------------- | --------------------------------------- | ---------------------------- | ---------------- |
| `completed`       | 最后一轮 assistant 不再请求工具         | `run_completed(completed)`   | 否               |
| `tool_errors`     | 连续工具失败达到保险丝，任务未收敛      | `run_completed(tool_errors)` | 否               |
| `cancelled`       | 调用方主动中止                          | `run_cancelled`              | 否               |
| 抛出 `ModelError` | Provider HTTP、协议、网络或内部超时失败 | 本例只有 `turn_started`      | 是               |

D014/D016 已证明连续三次错误和成功清零，因此本日不再新增一组相同测试。D009 已证明模型等待期间取消，本日只补工具执行期间与保险丝相交的空白。

## 脱敏承诺的边界

本日验证的是 D014 已有约定：**未知工具异常**统一变成通用 `INTERNAL_ERROR`，原始异常 message 和 stack 不进入后续 Provider 请求。测试使用显式伪造的 `sk-fake-D017-*` 字符串，不读取任何真实凭证。

这不是“所有文本自动脱敏”的承诺：

- 已知 `ToolError` 的 message/hint 是刻意保留的可操作反馈；
- `run_command` 的 stdout/stderr 和 command 是工具协议明确返回的数据；
- 本日没有新增通用密钥识别器，也没有改写命令输出。

因此 ADR-001 和矩阵都只说未知异常脱敏，不夸大成完整数据防泄漏系统。

## 怎么运行

```bash
git switch D017
npm install
npx vitest run test/d017-failure-paths.test.ts
```

执行矩阵引用的既有证据：

```bash
npx vitest run \
  test/cancellation.test.ts \
  test/errors.test.ts \
  test/tool-errors.test.ts \
  test/openai-compatible.test.ts \
  test/d016-invalid-arguments.test.ts
```

完整验证：

```bash
npm run check
npm run test:coverage
```

测试不需要模型密钥，不读取 `.env`，不访问公网。Provider 网络全部 mock；文件使用临时工作区；命令使用本机 Node 子进程并由测试终止；敏感值均为伪造字符串。

## TDD 与实际结果

- 首次运行 `test/d017-failure-paths.test.ts`：**6 项通过、1 项失败**。FP-01～06 描述已有行为，首次通过并作为回归测试保留；FP-07 暴露取消优先级缺陷，构成真实 RED。
- 最小修改 Loop 后再次运行：**1 个文件、7 项测试全部通过**，完成 GREEN。
- 没有为了制造 RED 反转已有行为断言，也没有为覆盖率复制 D009/D014/D016 的单元测试。

最终实际验证结果：

| 验证                       | 结果                                        |
| -------------------------- | ------------------------------------------- |
| 失败语义与 Loop 针对性回归 | **7 个文件、76 项测试通过**                 |
| `npm run check`            | ESLint、`tsc --noEmit` 和全量 Vitest 均通过 |
| 全量测试                   | **18 个文件、170 项测试通过，0 失败**       |
| `npm run test:coverage`    | 同样 **18/18 文件、170/170 测试通过**       |

V8 覆盖率实测：

| Statements | Branches | Functions | Lines  | `src/runtime/loop.ts`    |
| ---------- | -------- | --------- | ------ | ------------------------ |
| 96.61%     | 91.72%   | 98.07%    | 97.89% | 语句/分支/函数/行均 100% |

命令仅有本机 npm 关于未知 `home` 配置的既有 warning，没有测试失败、类型错误或 ESLint 错误。

## 今天不做什么

- 不新增 Provider 自动重试、退避或熔断策略；上层需要根据 `ModelError` 另行决定。
- 不实现并行工具；但未来并行化必须保留外部取消优先级。
- 不扩展 JSON Schema，不改变 D016 的非法参数恢复闭环。
- 不实现命令沙箱或通用输出脱敏。
- 不做真实模型或公网验证，不根据脚本化 Provider 推断模型一定会修复错误。
