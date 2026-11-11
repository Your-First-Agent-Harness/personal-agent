# D015 · 综合修复 Demo：从失败测试到可验证修复

## 今天要做出的东西

用一个临时项目把 D006–D014 串成完整闭环：模型读取有错误的 `math.js`，运行 Node 原生测试并看到失败，精确编辑源码，再次运行测试成功，最后才声明完成。

这里有两条验证路径，结论不能互相替代：

- **确定性集成测试**：脚本化 Provider 固定返回五步响应，真实执行内置工具、Session、Loop 和事件收集器，每次结果都可重复。
- **真实 ARK 验证**：复用同一条生产 Loop，但模型行为不可预设；脚本最后独立复跑测试，不能只相信模型说“已修复”。真实模型结果不进入 CI。

## 一条消息如何走完整个 Harness

```text
Session 完整历史
  → buildContext 生成本次请求窗口
  → Provider 返回文本或 tool_calls
  → AgentEvent 记录模型与工具事实
  → ToolRegistry 解析并校验参数
  → 工具执行，得到 ToolResult
  → content 回喂模型；isError 驱动错误语义
  → 成功继续 / 错误修正 / 连续错误保险丝停止
  → Session 保存本轮完整新增历史
```

### 1. Session 保存完整历史，buildContext 只决定本次发什么

`Session` 是跨轮真源。每次运行前取快照，Loop 返回后只追加 `result.messages.slice(before.length)`，因此用户消息、每次 assistant 工具调用、对应 tool 结果和最终回答都按原顺序保留。D015 集成测试最后直接断言：

```ts
expect(session.snapshot()).toEqual(result.messages);
```

Loop 每轮不会无界发送全部历史，而是调用 `buildContext(messages, maxContextChars)` 得到裁剪副本。请求窗口可以省略旧内容，Session 完整历史不因此被截断；assistant 的 `toolCalls` 与其 tool 消息作为一组处理，避免给模型半次调用。

### 2. AgentEvent 观测事实，但不替代消息历史

模型响应后，Loop 先写入 assistant 消息并发出 `assistant_responded`。每个工具调用再依次产生：

```text
tool_call_started → 执行工具 → tool_call_finished
```

`tool_call_finished` 带有 `toolCallId`、`toolName` 和 `isError`。事件适合日志、UI 和测试观测；真正交给下一轮模型的是历史里的 assistant/tool 配对，而不是事件数组。

### 3. Registry 在执行前把坏消息变成可修正结果

Registry 固定完成名称查找、JSON 解析和 Schema 子集校验，再调用工具。未知工具、非法 JSON 或参数错误不会进入工具实现，也不会直接炸掉 Loop，而是形成带 `isError: true` 的 `ToolResult`。

`ToolResult` 有两条通道：

- `content` 写入 `role: "tool"` 消息，是 Provider 能看到的模型线格式；
- `error` 保留内部 `code/message/retryable/hint`，Provider 不需要理解这些内部错误码。

`run_command` 非零退出时，`content` 仍保留命令、`exitCode`、stdout、stderr 等 JSON 字段，同时以 `isError: true` 和内部 `COMMAND_FAILED` 表示失败。

### 4. 错误回喂让模型修正，成功会继续并清零

工具失败不等于整次运行失败。未达到连续错误上限时，tool 消息进入历史，下一次 Provider 请求能看到失败详情并选择下一步。成功工具继续同样的回喂流程，同时把连续错误计数清零。

保险丝属于整个 run：

```text
工具失败：consecutive += 1
工具成功：consecutive = 0
consecutive >= maxConsecutiveToolErrors：以 tool_errors 停止
```

D015 默认配置为 3。第一次测试失败只计数到 1，所以仍有机会编辑；编辑成功把计数清零，复测成功后最终请求能看到 `exitCode: 0`，模型才给出完成文本并以 `completed` 停止。

## 确定性五步修复闭环

测试在系统临时目录写入：

```js
// math.js
export function add(a, b) { return a - b; }

// math.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { add } from './math.js';
test('add', () => { assert.equal(add(2, 2), 4); });
```

脚本化 Provider 只返回以下五次结果，不多走一步：

| Turn | assistant 动作 | 真实工具结果 | 下一次请求可见的信息 |
| --- | --- | --- | --- |
| 1 | `read_file("math.js")` | 读到 `return a - b` | 源码内容 |
| 2 | `run_command(node --test math.test.js)` | `exitCode: 1`，输出含 `failing`，完成事件 `isError: true` | 失败命令与测试输出 |
| 3 | `edit_file`，把 `return a - b` 精确替换为 `return a + b` | 返回 unified diff，成功清零连续错误计数 | 编辑结果 |
| 4 | 再次运行同一测试命令 | `exitCode: 0`，完成事件 `isError: false` | 成功测试输出 |
| 5 | 返回“修复完成，测试已通过” | 不再调用工具 | `run_completed`，`stopReason: completed` |

集成测试使用真实 `createBuiltinTools()`、`ToolRegistry`、`Session` 和 `runAgentLoop`，配置 `maxTurns: 8`、`maxContextChars: 24000`、`maxConsecutiveToolErrors: 3`。除上述结果外，还检查：

- 五轮请求的完整 assistant/tool 配对和精确事件顺序；
- 第一次失败出现在第三次 Provider 请求，第二次成功出现在最终 Provider 请求；
- `math.js` 最终逐字等于修复后的源码；
- 最终 `turns: 5`、`stopReason: completed`；
- Session 快照等于 `result.messages`；
- 无论断言成败都在 `finally` 删除临时项目。

## 怎么复现

### 确定性验证

```bash
git switch D015
npm install
npx vitest run test/d015-integration.test.ts
npm run check
npm run test:coverage
```

这些测试不需要真实模型或凭据。2026-11-12 实测：D015 集成测试首次运行直接通过，这是既有实现上的 **characterization/integration test 首次通过**，没有人为制造 RED；全量检查为 **16 个测试文件、159 项测试全部通过**。

同次覆盖率实测：

| 指标 | 覆盖率 |
| --- | ---: |
| Statements | 96.60% |
| Branches | 91.68% |
| Functions | 98.07% |
| Lines | 97.88% |

### 真实 ARK 验证

先在本地 `.env` 配置可访问的 ARK 模型名和密钥，再执行：

```bash
PA_MODEL_BASE_URL=https://ark.cn-beijing.volces.com/api/v3 npm run demo:d015
```

`demo:d015` 通过现有 `loadConfig()` 间接读取配置，不打印密钥。脚本只创建系统临时工作区，组合生产 Provider、Registry、内置工具和 Loop；模型返回后，再用独立进程执行：

```bash
node --test math.test.js
```

最终摘要包含 `model`、`turns`、`stopReason`、模型文本和 `verificationExitCode`。只要 Loop 未完成或独立复测非零，脚本就以非零退出；临时目录始终在 `finally` 清理。真实模型不收敛不会被改写成成功。

### 2026-11-12 真实 ARK 实测记录

- 配置模型名：`ark-code-latest`。
- 已观察事件：`turn_started`，`turn: 1`，`messageCount: 2`。
- 第一次 Provider 请求返回 HTTP 404，错误码 `InvalidEndpointOrModel.NotFound`；服务报告该模型或 Endpoint 不存在，或当前账号无权访问。
- 因异常发生在第一次模型响应之前，Loop 未返回 `turns`，也没有产生 `run_completed` / `stopReason`；读取、首次失败、编辑和复测事件均未发生，独立复测因此未启动。
- 命令实际退出码为 **1**，临时目录由 `finally` 清理。该失败是模型配置/访问问题，不作为确定性 CI 用例，也不据此宣称真实 ARK 修复成功。

更换为账号实际可访问的模型后可原命令重跑；应以事件流和独立 `verificationExitCode: 0` 共同判断结果。

## 今天的边界

本日不复制 Loop，不引入并行工具、命令沙箱、磁盘 Session 或 Replay，也不把真实 ARK 调用加入 CI。确定性测试证明 Harness 的失败回喂与修复机制；真实脚本提供同构验证入口，其实际结果必须按当次事件和退出码如实记录。
