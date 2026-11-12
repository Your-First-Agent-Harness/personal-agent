# D020 · 让回答逐字抵达：一次全链路真实流式改造

> 交付形态：当日教学长文 + 可执行代码与测试。
>
> 基线：D019 提交 `ed27b3ca850a5e86b630bc54f0fb64bc00e995ff`。

非流式 Agent 的等待体验很直接：请求已经发出，模型可能正在生成，终端却长时间没有任何变化。直到整段响应返回，答案才一次性出现。

D020 打通的不是一个“打字机动画”，而是一条真正的数据通路：

```text
OpenAI-compatible SSE 字节流
  → 增量 UTF-8 解码
  → SSE 事件解析
  → Provider 文本增量与工具片段聚合
  → Loop assistant_delta 事件
  → CLI 即时写出
  → 最终答案只出现一次
```

工具调用、用量统计、取消、超时和旧 Provider 契约也必须继续成立。否则只是让普通聊天看起来更快，却让 Agent 在最需要可靠性的路径上失去原有能力。

## 读完你能带走什么

1. 解释 `chat()` 与可选 `streamChat()` 如何共存，旧 Provider 为什么不需要跟着修改。
2. 区分网络字节分帧与 SSE 事件分帧，处理任意字节边界、CRLF、注释、多行 `data:` 和 `[DONE]`。
3. 按协议 `index` 聚合交错的流式工具调用，而不是按到达顺序错误拼接参数。
4. 理解 Loop 的 `streaming` 开关、`assistant_delta` 事件和不支持流式时的回退。
5. 解释 CLI 如何实时输出、避免最终答案重复，同时不吞掉取消或未收敛提示。
6. 分清外部取消、Provider 内部超时、网络故障、HTTP 故障和协议故障。
7. 用本地 SSE 服务跑通 CLI 子进程全链路测试，并准确说明“没有调用真实 ARK”的验证边界。

## 一、改造前的断点在哪里

D019 的 Provider 只有一次性请求：

```ts
chat(request): Promise<ChatResult>
```

它适合表达完整的模型响应，却没有“响应尚未结束，但已经有一小段文本”的位置。即使 CLI 想提前显示，也只能等 `chat()` 返回。

因此，流式改造不能只改终端。终端没有数据源，Loop 没有增量事件，Provider 没有增量读取，任何单点修改都无法形成真实流式输出。

D020 将职责拆成四层：

| 层 | 新增职责 | 明确不负责 |
| --- | --- | --- |
| OpenAI-compatible Provider | 读取 SSE、交付文本增量、聚合完整结果 | 不执行工具，不直接写终端 |
| Loop | 按开关选择流式能力，把 delta 转为领域事件 | 不解析 SSE，不处理终端换行 |
| CLI | 开启流式、即时输出、完成时去重 | 不重新请求模型，不修改 agent 历史 |
| Logger | 继续记录摘要事件 | 不为每个 delta 刷一条日志 |

最终仍返回同一个 `ChatResult`。这一点很重要：**增量是及时反馈，完整结果是后续编排的确定依据，两者不是二选一。**

## 二、从可选 Provider 能力开始

`src/adapters/model/provider.ts` 保留原有 `chat()`，增加可选方法：

```ts
export interface ModelProvider {
  readonly name: string;
  chat(request: ChatRequest): Promise<ChatResult>;
  streamChat?(
    request: ChatRequest,
    onDelta: (delta: string) => void,
  ): Promise<ChatResult>;
}
```

`onDelta` 只携带本次新增的文本，不携带“到目前为止的完整答案”。调用方可以顺序写出，Provider 同时把这些片段拼成最终的 `result.text`。

方法可选带来两个直接收益：

- 旧测试里的 scripted Provider 不必为了实现新接口而增加空方法；
- Loop 可以做能力检测，在 Provider 不支持流式时回退到 `chat()`。

OpenAI-compatible Provider 则同时实现两种方法。原有 `chat()` 保持普通 JSON 请求，`streamChat()` 在请求体中明确加入：

```json
{
  "stream": true,
  "stream_options": { "include_usage": true }
}
```

工具定义仍按原线格式放在 `tools` 中，不会因为切换到流式而丢失 Agent 的工具能力。

## 三、全链路时序：文本如何一路到达终端

一次普通回答的完整路径如下：

```text
CLI runTurn
  │ streaming: true
  ▼
Loop
  │ provider.streamChat(request, onDelta)
  ▼
OpenAI-compatible Provider
  │ POST /chat/completions，stream: true
  ▼
本地或远端 OpenAI-compatible 服务
  │ SSE data: ... delta.content ...
  ▼
Provider
  │ onDelta("你")
  ▼
Loop eventSink
  │ { type: "assistant_delta", turn: 1, delta: "你" }
  ├──────────────→ Logger sink：不写逐 delta 摘要
  └──────────────→ Terminal sink：立即 write("你")

后续片段沿同一路径继续到达；流结束后：
```

```text
Provider 返回 ChatResult
  │ text / model / toolCalls? / usage?
  ▼
Loop 保存完整 assistant 消息
  │ assistant_responded
  ▼
CLI complete(result.text)
  │ 已经流过普通答案：只补换行
  ▼
stdout：你好\n
```

如果模型要求调用工具，Provider 会先完成所有工具片段聚合，Loop 再沿用原有逻辑保存 assistant 消息、串行执行工具、写入 tool 消息并进入下一轮。流式输出没有改变工具执行器、连续错误保险丝、上下文构建或停止原因。

### Loop 中的事件顺序

显式开启流式且 Provider 支持时，一次纯文本回答的事件严格是：

```text
turn_started
assistant_delta（每个非空文本片段一次）
assistant_responded
run_completed
```

`assistant_delta` 是即时展示事件，`assistant_responded` 是完整响应已经确定的摘要事件。二者承担不同职责，不能相互替代。

## 四、SSE 解析：先处理字节，再处理事件

SSE 解析最常见的错误，是假设一次 `reader.read()` 恰好得到一个完整事件。网络没有这种保证：

- 一个事件可能拆在多个字节块里；
- 多个事件可能合在一个字节块里；
- 一个多字节 UTF-8 字符也可能跨块；
- 不同服务可能使用 LF 或 CRLF；
- 心跳注释和多行 `data:` 都不是模型正文。

D020 在 `src/adapters/model/openai-compatible.ts` 中使用 `response.body.getReader()`，每读到一个字节块就增量解码：

```ts
buffer += decoder.decode(value, { stream: true });
```

`{ stream: true }` 让 `TextDecoder` 保留尚未完整的 UTF-8 字节序列，等后续字节到达后再组成字符。读取结束时再调用 `decoder.decode()` 刷新内部状态。

### 4.1 字节分帧不等于事件分帧

解码后的文本先进入 `buffer`，再用空行识别事件边界：

```ts
/\r?\n\r?\n/
```

它同时接受：

```text
data: {...}\n\n
```

和：

```text
data: {...}\r\n\r\n
```

每找到一个边界，就只消费当前完整事件，剩余内容继续留在 buffer。这样，一次 `read()` 交付多少字节都不会改变事件解析结果。

流结束时，如果 buffer 还有非空内容，也会消费最后一个事件。因此末尾 `data: [DONE]` 不依赖额外空行才能被接受。

### 4.2 一个事件里只取 data 行

每个事件按行拆分后，只保留以 `data:` 开头的行，去掉字段前缀，再用换行连接：

```text
: keep-alive
data: {"model":"stream-model",
data: "choices":[{"delta":{"content":"你好"}}]}
```

其中：

- `: keep-alive` 是注释/心跳，不进入 JSON；
- 两行 `data:` 按 SSE 规则以 `\n` 连接；
- 连接后的文本才交给 `JSON.parse()`；
- 空 data 与 `[DONE]` 是控制信息，不作为 JSON 解析。

这避免了两个极端：把整段 SSE 当 JSON，或只取第一条 `data:` 而丢掉其余内容。

### 4.3 文本增量立即交付，最终结果同步聚合

当 `choices[0].delta.content` 是非空字符串时，Provider 同时做两件事：

```text
最终 text += content
onDelta(content)
```

因此测试既能断言回调顺序为 `["你好", "，世界"]`，也能断言最终 `result.text === "你好，世界"`。这里不是等整个 body 结束后重新拆分完整答案模拟流式。

## 五、工具调用为什么必须按 index 聚合

文本 delta 通常按顺序拼接，工具调用却多了一个维度：同一条流中可以交错出现多个调用的片段。

例如：

```text
index 0：weather，arguments = {"city":
index 1：time，   arguments = {"zone":
index 0：arguments = "杭州"}
index 1：arguments = "UTC"}
```

如果按到达顺序维护“当前工具”，`index 0` 的后半段参数就可能被拼到 `index 1`。即使每个 JSON 片段都传输正确，最终工具参数仍会损坏。

D020 使用协议里的 `index` 作为聚合键：

```ts
Map<number, {
  id: string;
  name: string;
  arguments: string;
}>
```

每个片段到达时：

1. 读取并校验整数 `index`；
2. 找到该 index 已有的聚合状态，不存在则创建；
3. 合并后续可能出现的 `id`、`function.name`；
4. 将 `function.arguments` **追加**到该调用的参数字符串；
5. 流结束后按 index 数值排序，生成 `ToolCall[]`。

上述例子最终得到：

```json
[
  {
    "id": "call_weather",
    "name": "weather",
    "arguments": "{\"city\":\"杭州\"}"
  },
  {
    "id": "call_time",
    "name": "time",
    "arguments": "{\"zone\":\"UTC\"}"
  }
]
```

如果最终缺少 `id` 或 `name`，Provider 抛出 `ModelError`，不会把身份不完整的调用交给 Registry。参数本身的 JSON 解析与 Schema 校验仍由原有 ToolRegistry 负责，职责没有混合。

## 六、末尾 usage 与普通 JSON 回退

### 6.1 用量事件可以没有 choice

请求中的 `stream_options.include_usage: true` 要求兼容服务在流末尾提供用量。此时事件可能是：

```json
{
  "model": "stream-model",
  "choices": [],
  "usage": {
    "prompt_tokens": 7,
    "completion_tokens": 11
  }
}
```

`choices: []` 在这里不代表响应损坏。Provider 先读取 usage，再接受这种末尾事件，并映射为现有领域结构：

```ts
{
  inputTokens: 7,
  outputTokens: 11,
}
```

Loop 继续按原来的方式累计每轮 usage，不需要第二条用量通道。

### 6.2 stream: true 不保证服务一定返回 SSE

部分旧网关或测试 mock 即使收到 `stream: true`，仍会返回 `application/json` 的完整响应。

因此 Provider 在 HTTP 成功后检查 `content-type`：

- 包含 `text/event-stream`：进入增量 SSE 读取；
- 否则：按原有完整 JSON 响应解析文本、工具调用、模型名和 usage。

这个回退不是伪造 delta，而是兼容不支持流式响应的网关。它也保留了旧 CLI 工具错误测试的行为：旧测试不需要为了新实现而改写服务器协议。

## 七、Loop：显式开关，默认不变

`src/runtime/loop.ts` 的 `AgentLoopOptions` 新增：

```ts
readonly streaming?: boolean;
```

选择逻辑只有两种：

```text
streaming === true 且 provider.streamChat 存在
  → streamChat，并转发 assistant_delta

其他情况
  → 原有 chat
```

这意味着：

| 调用方式 | 实际行为 |
| --- | --- |
| 不传 `streaming` | 非流式 `chat()` |
| `streaming: false` | 非流式 `chat()` |
| `streaming: true`，Provider 支持 | 真正流式 |
| `streaming: true`，Provider 不支持 | 回退 `chat()` |

默认值不变是兼容性的关键。原有 embedder、脚本化 Provider 和 Loop 测试不需要了解新展示层，仍然得到相同的消息历史、usage、工具调用和停止原因。

只有 CLI 在 `src/cli/main.ts` 中显式设置 `streaming: true`，没有把“终端想即时显示”变成所有 Loop 调用方的强制行为。

## 八、CLI：实时输出之后，最终答案不能再来一遍

如果终端收到 delta 时立即写出，Loop 结束后再无条件写一次 `result.text`，用户会看到：

```text
你好你好
```

D020 在 `src/cli/repl.ts` 中用 `TurnOutput` 描述一轮输出状态：

```ts
interface TurnOutput {
  readonly text: string;
  readonly streamed: boolean;
  readonly status?: boolean;
}
```

`createTerminalTurn(write)` 为每轮建立独立的终端协调器：

- 收到 `assistant_delta` 就立即 `write(event.delta)`；
- 记录本轮是否出现过流式输出；
- `complete(text)` 保存 Loop 的最终文本或状态提示。

`writeTurnOutput()` 根据状态完成最后输出：

| 情况 | 完成时写什么 |
| --- | --- |
| 普通答案已经有 delta | 只补 `\n` |
| 普通答案没有任何 delta | 写 `${text}\n` |
| 已有 delta，但还要报告取消/未收敛 | 换行后写状态提示，再换行 |

第三种情况不能被“最终答案去重”吞掉。例如已经输出“部分回答”，随后任务取消，终端仍应显示：

```text
部分回答
任务已取消。
```

`cancelled`、`tool_errors` 和 `max_turns` 都使用状态输出语义。普通完成答案才去重，状态提示必须保留。

一次性命令与 REPL 共用这套规则；`runTurn` 仍兼容返回 `Promise<string>` 的旧测试和调用方。

### Logger 为什么不刷屏

CLI 将同一个 Loop 事件分别交给 logger sink 和 terminal sink：

```text
assistant_delta
  ├─ terminal sink：立即写出
  └─ logger sink：不匹配摘要事件，不写日志
```

现有 logger 继续记录 `turn_started`、`assistant_responded`、工具事件和完成事件。测试明确连续发出两个 `assistant_delta` 后，日志行仍为空。

这里没有把 delta 改成 debug 日志，也没有按字符记录 latency；逐 token 日志既吵，又可能把用户正文重复写入日志系统。

## 九、取消、超时与错误不是同一件事

流式请求有两个容易混淆的等待阶段：

1. `fetch()` 等待响应头；
2. `reader.read()` 持续等待响应体。

D020 在两个阶段都保留错误分层。

### 9.1 外部取消

外部取消来自调用方的 `AbortSignal`，例如 CLI 收到 SIGINT：

- 请求发出前已经取消：直接抛 `ModelCancelledError`，不调用 fetch；
- fetch 期间外部取消：归一为 `ModelCancelledError`；
- 响应体读取期间外部取消：同样归一为 `ModelCancelledError`；
- Loop 捕获该类型后，沿用原有 `cancelled(turn)`，发出 `run_cancelled` 并返回 `stopReason: "cancelled"`。

外部取消是控制意图，不是模型服务故障。

### 9.2 Provider 内部超时

Provider 使用：

```ts
AbortSignal.any([
  AbortSignal.timeout(timeoutMs),
  externalSignal,
])
```

将内部超时与外部信号合并给 fetch。若内部计时器导致请求或流读取失败，而外部 signal 没有取消，则对外是 `ModelError`，并保留原始 `cause`。

这保证调用方可以把“用户取消”与“服务等待超时”分开处理，同时仍能从 cause 诊断底层原因。

### 9.3 其他故障

| 故障 | 对外表达 |
| --- | --- |
| 网络连接失败、响应体读取异常 | `ModelError`，保留 cause |
| HTTP 非成功 | `ModelError`，保留 HTTP `status` |
| data 不是合法 JSON | `ModelError`，保留解析 cause |
| 缺少必要字段、字段类型错误、工具调用缺 id/name | `ModelError` |
| 外部取消 | `ModelCancelledError` |
| 内部超时 | 带原始 cause 的 `ModelError` |

已经形成的 `ModelError` 在流读取 catch 中原样抛出，不会被重复包装成难以定位的另一种错误。

## 十、严格 TDD：每组行为先看 RED，再做最小实现

D020 没有先写完整实现再补测试。每组生产行为都先建立会失败的测试，实际观察预期 RED，再实现到 GREEN，最后跑旧测试防止回归。

| 测试组 | 先看到的代表性 RED | 最小实现后的 GREEN |
| --- | --- | --- |
| Provider 文本流 | `streamChat` 不存在 | `stream: true`，delta 顺序与最终聚合一致 |
| SSE 分帧 | 仅按 `\n\n` 解析，CRLF/任意字节边界失败 | 增量 TextDecoder + LF/CRLF 事件边界 |
| 工具聚合 | 流式工具调用被忽略或无法交错拼接 | 按 index 保存片段并排序输出 |
| 末尾 usage | `choices: []` 被当成缺 choices | 接受带 usage 的空 choices 事件 |
| 工具定义与错误 | 流式请求未下发 tools，网络错误未归一 | 保留 tools 线格式，统一 `ModelError` |
| 取消与超时 | 请求前取消仍发请求，body 阶段语义不成立 | 两阶段区分外部取消与内部超时 |
| Loop 流式 | 仍只调用 `chat()`，没有 `assistant_delta` | 可选 streaming + 能力检测 + 非流式回退 |
| REPL 去重 | 终端协调器不存在，最终答案重复 | `TurnOutput` 与统一完成输出 |
| 状态提示 | 曾有 delta 后取消提示被去重吞掉 | `status: true` 保留取消/未收敛提示 |
| CLI 全链路 | 子进程按 JSON 解析 SSE，退出码为 1 | 本地 SSE 经 Provider → Loop → CLI 全链路通过 |

全量旧测试还暴露了一个重要兼容问题：旧工具错误 CLI mock 收到 `stream: true` 后仍返回普通 JSON。修复方式不是修改旧测试，而是增加非 SSE 成功响应的 JSON 回退。

这就是保留旧测试的价值：新功能不仅要让自己的测试变绿，也不能悄悄改变旧契约。

## 十一、测试地图与本地 CLI 实测

### 11.1 新增测试分别证明什么

| 文件 | 覆盖重点 |
| --- | --- |
| `test/d020-streaming.test.ts` | 9 条 Provider 测试：真实增量、任意字节边界、CRLF、注释、多行 data、DONE、工具交错聚合、末尾 usage、tools、网络/HTTP/取消/超时 |
| `test/d020-loop-streaming.test.ts` | 3 条 Loop 测试：显式流式事件序列、默认关闭、无能力回退 |
| `test/d020-cli.test.ts` | 1 条真实子进程 + 本地 HTTP SSE 全链路测试 |
| `test/repl.test.ts` | 保留旧测试，并增加普通答案去重、无 delta 回退、状态提示不被吞 |
| `test/events.test.ts` | 验证 logger 不为 `assistant_delta` 逐条写日志 |

Provider 单元测试使用假的 `fetchImpl` 与内存 `ReadableStream`，不依赖公网。

### 11.2 CLI 全链路测试不是直接调用 terminal helper

`test/d020-cli.test.ts` 启动了真正的本地 HTTP 服务，只监听 `127.0.0.1` 的随机端口。服务分两次写出文本“你”和“好”，随后发送 `[DONE]`。

测试随后：

1. 在系统临时目录创建空工作目录；
2. 直接用当前 Node.js 可执行文件启动 `src/cli/main.ts` 子进程；
3. 注入仅用于本地测试的 `PA_MODEL_*` 环境变量和假密钥 `local-test-only`；
4. 让请求经过真实 CLI 配置、Loop、Provider、HTTP、SSE 和 stdout；
5. 在结束后关闭服务器并删除临时目录。

实际断言是：

```text
exitCode = 0
stdout   = "你好\n"
stderr   = ""
请求数   = 1
请求体包含 stream: true
```

stdout 不是 `你好好\n`，也不是 `你好\n你好\n`。这证明增量已经写出，最终答案没有重复。

子进程没有通过 `npm run dev` 启动，因此不会触发该脚本中的 `.env` 加载；空临时 cwd 也不存在项目配置文件。D020 测试没有读取真实 `.env` 或真实凭证。

## 十二、配置与运行

要求 Node.js 22 或更高版本。安装开发依赖后，在仓库根目录运行：

```bash
npm run check
npm run test:coverage
```

只跑 D020 及相关回归测试：

```bash
npm test -- \
  test/d020-streaming.test.ts \
  test/d020-loop-streaming.test.ts \
  test/d020-cli.test.ts \
  test/repl.test.ts \
  test/events.test.ts
```

### 12.1 模型配置

CLI 支持 `agent.config.json` 和环境变量，环境变量优先。与本次流式请求直接相关的变量是：

| 环境变量 | 含义 |
| --- | --- |
| `PA_MODEL_PROVIDER` | 当前 CLI 使用 `openai-compatible` |
| `PA_MODEL_BASE_URL` | OpenAI-compatible 的 `/v1` 基础地址 |
| `PA_MODEL_API_KEY` | API 密钥，只从环境变量读取 |
| `PA_MODEL_NAME` | 请求中的模型名 |
| `PA_LOG_LEVEL` | `debug` / `info` / `warn` / `error` |
| `PA_WORKSPACE` | 工具允许访问的工作区根目录 |

一次性命令示例：

```bash
PA_MODEL_BASE_URL="https://你的兼容服务/v1" \
PA_MODEL_API_KEY="替换为你的密钥" \
PA_MODEL_NAME="替换为模型名" \
npm run dev -- "用一句话介绍流式输出"
```

不带提示词时进入 REPL，输入 `/exit` 退出：

```bash
npm run dev
```

`npm run dev` 使用 `node --env-file-if-exists=.env`，所以如果项目根目录存在 `.env`，它会按 Node.js 规则加载。**不要把真实密钥写进 README、测试或提交。**

CLI 已固定开启 `streaming: true`。使用其他 Provider 嵌入 Loop 时，是否开启由调用方决定；Provider 没有 `streamChat` 时会自动回退。

## 十三、本次最终实测结果

在 D020 分支完成实现后，连续执行：

```bash
npm run check && npm run test:coverage
```

两条命令均成功：

| 项目 | 实测结果 |
| --- | --- |
| ESLint | 通过 |
| TypeScript `tsc --noEmit` | 通过 |
| 全量 Vitest | **22 个测试文件，188 项测试全部通过** |
| 覆盖率运行 | 同样 **22 / 22 文件、188 / 188 测试通过** |
| Statements | **94.98%** |
| Branches | **89.45%** |
| Functions | **98.29%** |
| Lines | **95.92%** |

覆盖率配置包含 `src/**/*.ts`，排除 CLI 入口 `src/cli/main.ts`，阈值为 statements/lines/functions 80、branches 75。本次结果高于既有阈值；`src/runtime/loop.ts` 的语句、分支、函数和行覆盖率均为 100%。

本日没有新增运行时依赖，`package.json` 的 dependencies 仍为空；测试和覆盖率使用仓库已有开发依赖。

## 十四、验证边界：这次没有调用真实 ARK

必须明确区分“代码路径是真实的”和“接入了真实模型服务”。

本次已经真实执行的是：

- TypeScript 生产代码；
- Provider 的增量 reader、TextDecoder 和 SSE 解析；
- Loop 的选择、事件与工具编排；
- CLI 子进程和终端输出；
- 本地 `127.0.0.1` HTTP 服务上的真实网络请求；
- lint、typecheck、全量测试和 V8 覆盖率。

本次没有执行的是：

- 没有调用真实 ARK；
- 没有使用真实 ARK API Key；
- 没有访问公网模型服务；
- 没有验证某个具体 ARK 模型的 SSE 字段变体、首 token 延迟、吞吐、稳定性或工具调用成功率；
- 没有把本地 mock 的通过包装成线上兼容性结论。

因此，今天可以下的结论是：**在本仓库定义并测试的 OpenAI-compatible SSE 协议形状下，从本地 HTTP 服务到 CLI stdout 的流式链路已经闭环，旧测试保持通过。**

真实 ARK 或其他兼容服务是否完全符合这些协议细节，仍需在获得明确授权、独立测试凭证和允许联网的环境中另行验证。覆盖率衡量的是代码被执行的范围，不是外部服务兼容性的概率。

## 十五、D020 的最终契约

今天完成后，可以用下面这组不变量检查实现是否仍然健康：

1. `chat()` 旧契约保留，`streamChat` 是可选能力。
2. 流式请求明确发送 `stream: true`，工具定义不丢失。
3. 文本在响应体尚未结束时就能逐段到达终端。
4. 任意网络字节边界不改变 SSE 解析结果。
5. 工具参数按协议 index 聚合，交错到达也不会串线。
6. 末尾 usage 回到原有 `ChatResult`，Loop 继续累计。
7. Loop 默认非流式；显式开启但能力不足时回退。
8. 普通最终答案不重复，取消和未收敛状态不被吞。
9. 外部取消、内部超时、网络/HTTP/协议错误保持不同语义。
10. logger 不逐 delta 刷屏，完整消息历史仍是后续工具循环的依据。
11. 不支持 SSE 的旧网关仍可返回完整 JSON。
12. 本地 mock 全绿不等于真实 ARK 已验证。

**流式输出的价值不是让字符动起来，而是在不破坏 Agent 编排契约的前提下，让已经到达的信息立刻对人可见。**
