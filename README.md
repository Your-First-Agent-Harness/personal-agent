# D005 · 工具调用循环：让模型读懂工作区

> 本文件是 D005 分支的教学内容说明。分支索引见 [main](../../tree/main)。

## 今天要做出的东西

- `Tool` 契约：把名称、参数 Schema 和执行函数放在同一个对象里
- `ToolRegistry`：注册工具、向模型暴露 Schema、解析参数并执行
- 两个内建工具：`read_file` 和 `list_dir`
- OpenAI-compatible 工具协议：下发 `tools`，解析 `tool_calls`，回传 `tool` 消息
- `runAgentLoop`：模型 → 工具 → 模型，直到回答完成或触发 `maxTurns`
- 工作区路径保护：文件工具不能通过 `../../` 越出项目目录

## 今天讲什么

### 1. Agent Loop 到底循环什么

一次模型调用只能得到一段响应。模型要求调用工具时，这轮工作还没有结束：Harness 必须执行工具，再把结果作为新消息喂回模型。

```text
user
  ↓
model ── 不需要工具 ──→ 最终回答
  ↓ 需要工具
assistant(tool_calls)
  ↓
ToolRegistry.execute
  ↓
tool(result)
  ↓
model（携带完整历史再次调用）
```

停止条件只有两个：模型不再发起工具调用，或者达到 `maxTurns`。后者是保险丝，防止模型反复调用工具导致无限消耗。

### 2. 工具的说明书和执行逻辑不分开

`Tool` 同时包含 `name`、`description`、`parameters` 和 `execute`。模型看到的参数说明与真实执行逻辑因此住在同一个对象里，不会出现“Schema 改了，执行代码忘了改”的两处漂移。

`ToolRegistry.list()` 只输出 Schema，不把 `execute` 暴露给 Provider；`ToolRegistry.execute()` 才负责真正的函数调用。

### 3. 工具失败不是 Loop 失败

未知工具、非法 JSON 参数、文件不存在、路径越狱，都不应该直接终止整个 Agent。

注册表把执行异常转换为 `isError: true` 的 `ToolResult`，Loop 再把它写成 `tool` 消息。模型能看到失败原因，下一轮可以修正路径、更换工具或向用户解释。

### 4. 消息协议必须首尾对应

模型返回的每次工具调用都有 `id`。 assistant 消息保存 `toolCalls`，对应的工具结果保存 `toolCallId`；Provider 再把它们转换成 OpenAI 线格式里的 `tool_calls` 和 `tool_call_id`。

纯工具调用轮次里，`content: null` 是合法响应，不能当成协议错误。只有文本和工具调用同时缺失时才拒绝响应。

### 5. 文件工具先解决安全边界

`read_file` 和 `list_dir` 都只接受工作区内的路径。代码先把路径解析成绝对路径，再检查它是否仍以工作区根目录为前缀，阻止 `../../etc/hosts` 这类越狱。

`read_file` 最多返回 8000 字符，避免一次工具结果撑爆上下文；`list_dir` 默认排除 `.git` 和 `node_modules`。同一轮的多个工具调用目前按模型给出的顺序串行执行，并行调度留到后面单独处理。

## 怎么验证这一天

```bash
git checkout D005
npm install
# 在 .env 中配置 PA_MODEL_API_KEY、PA_MODEL_BASE_URL、PA_MODEL_NAME
npm run dev -- "读取 package.json，告诉我项目名称和版本"
```

日志应依次出现 `loop.turn.start`、`tool.call`、`tool.result`，随后再次调用模型并以 `loop.completed` 结束。最后的运行摘要会给出累计轮次和 token 用量。

自动化校验：

```bash
npm run check   # lint + typecheck + 31 个测试
```

测试覆盖工具协议线格式、工具结果回喂、多工具串行、未知工具、非法参数、路径越狱、内容截断与 `maxTurns` 终止。

## 下一步

把 Loop 的运行过程整理成统一事件模型，让日志、回放和后续 UI 共用同一份事实来源。
