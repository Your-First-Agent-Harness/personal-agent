# D006 · 统一事件模型：让运行过程可观测

> 本文件是 D006 分支的教学内容说明。分支索引见 [main](../../tree/main)。

## 今天要做出的东西

- `AgentEvent` 判别联合：用五种事件描述 Loop 中发生的事实
- 同步 `EventSink`：Runtime 只发事件，不依赖具体日志实现
- Logger 适配器：把事件摘要映射为现有 JSON 日志，CLI 不重复打印同一事实
- 确定性测试：覆盖无工具、单工具、多工具、工具错误和 `maxTurns` 的事件顺序

## 今天讲什么

### 1. 为什么统一事件

D005 的 Loop 直接调用 Logger，执行编排和观测格式耦合在一起。D006 让 Loop 只描述“发生了什么”，由接入层决定如何展示。日志、后续 UI 或其他观测器因此可以消费同一份事实，而不必进入 Runtime 修改分支逻辑。

### 2. 五种事件与必要摘要

| 事件 | 含义 | 摘要字段 |
|---|---|---|
| `turn_started` | 一轮模型调用开始 | `turn`、`messageCount` |
| `assistant_responded` | assistant 响应已写入历史 | `turn`、`textChars`、`toolCallCount` |
| `tool_call_started` | 一个工具调用即将执行 | `turn`、`toolCallId`、`toolName` |
| `tool_call_finished` | 工具已返回成功或错误结果 | `turn`、`toolCallId`、`toolName`、`isError`、`contentChars` |
| `run_completed` | 本次 Loop 正常完成或达到最大轮次 | `turn`、`stopReason` |

`AgentStopReason` 今天只有 `completed` 和 `max_turns`。工具事件不包含参数正文，结果只保留错误标记和字符数，避免把密钥或敏感内容带入观测层。

无工具路径的顺序是 `turn_started → assistant_responded → run_completed`。有工具时，每次调用都在响应事件之后按 `tool_call_started → tool_call_finished` 成对出现；同一轮多个工具保持串行顺序。工具错误也会发出结果事件，并继续按 D005 的约定回喂给模型。达到 `maxTurns` 时，最后一个事件仍是 `run_completed`，但其 `stopReason` 为 `max_turns`。

### 3. EventSink 是同步且可选的

`EventSink.emit(event)` 返回 `void`。Loop 在原有执行点同步调用它，不建立队列，也不引入异步调度。`runAgentLoop` 接收可选的 `eventSink`；不传 sink 时，消息历史、工具回喂、累计用量和终止行为都保持不变。

### 4. Logger 只是事件的一种消费者

`createLoggerEventSink(logger)` 把五种事件映射为现有 JSON 日志。assistant 响应使用 `debug`，`completed` 使用 `info`，`max_turns` 使用 `warn`。CLI 只通过这个适配器观测 Loop，不再同时传入 Logger，因此同一事实不会打印两次；最后的运行摘要仍由 CLI 自己输出。

## 怎么复现这一天

```bash
git checkout D006
npm install

# 五种执行路径与 Logger 适配，共 7 个测试
npx vitest run test/events.test.ts

# 不传 eventSink 的 D005 行为保持不变
npx vitest run test/loop.test.ts

# 完整校验：lint + typecheck + 38 个测试
npm run check
```

配置好模型环境变量后，也可以观察真实 CLI 日志：

```bash
npm run dev -- "读取 package.json，告诉我项目名称和版本"
```

日志会依次出现 `loop.turn.start`、`tool.call`、`tool.result`，最后根据停止原因出现 `loop.completed` 或 `loop.max_turns`。

## 今天的边界

事件是即时的运行事实，**不做持久化，也不提供 Replay**。本日没有事件存储、断点恢复、异步事件总线或流式响应；它们不属于这个统一事件契约的隐含能力。
