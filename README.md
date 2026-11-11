# D008 · 上下文字符预算与工具组安全裁剪

## 今天要做出的东西

- `buildContext(messages, maxChars)`：从完整历史生成单次模型请求的防御性副本，短历史原样保留，长历史按字符预算裁剪。
- 长历史始终保留 system 与最新用户目标，并在 system 后插入 `…[更早的上下文已省略]`；system 自身超限会显式报错。
- 最新用户消息单条超限时以 `…[已截断]` 开头并保留原消息末尾；工具组超限时只截断 tool content，不修改 assistant 的工具调用。
- Loop 每轮只把裁剪窗口发给 Provider，返回值与 Session 仍保存完整历史。
- `AppConfig.agent.maxContextChars` 默认 `24000`，可由 `agent.config.json` 的 `agent.maxContextChars` 或 `PA_MAX_CONTEXT_CHARS` 覆盖；优先级为默认值 < 文件 < 环境变量，值必须是正整数。

## 字符预算公式

本日直接按 JavaScript 字符串的 `length` 计数。单条消息的成本为：

```text
messageChars(message)
  = message.content.length
  + (message.toolCallId?.length ?? 0)
  + (message.name?.length ?? 0)
  + 每个 toolCall 的 id.length + name.length + arguments.length

totalChars(messages) = 所有 messageChars 之和
```

省略标记本身也计入预算。裁剪时先保留全部 system 和省略标记，再优先选择最新用户目标，并从最近消息向前选择剩余单元；最终窗口满足 `totalChars(window) <= maxChars`。

## 工具组配对示例

下面的 assistant 与 tool 是一个不可拆分的单元：

```ts
[
  {
    role: 'assistant',
    content: '准备读取',
    toolCalls: [{ id: 'c1', name: 'read_file', arguments: '{"path":"a.ts"}' }],
  },
  {
    role: 'tool',
    toolCallId: 'c1',
    name: 'read_file',
    content: '文件内容……',
  },
]
```

预算足够时两条一起保留，预算不足时两条一起省略。若 assistant 与 tool 元数据能放入预算、仅工具结果过大，则只缩短 tool 的 `content` 并追加截断标记，`toolCalls` 与 `toolCallId` 仍完整配对。裁剪选择不会单独纳入没有 assistant 配对的孤立 tool。

## 怎么复现这一天

```bash
git switch D008
npm install

# 短历史、省略与截断、system 超限、工具配对、孤立 tool、完整 Session 历史
npx vitest run test/context.test.ts

# 默认预算、文件覆盖、环境覆盖、零值与非法值
npx vitest run test/config.test.ts

# 完整校验：lint + typecheck + 全部自动化测试
npm run check
```

真实 CLI 可通过环境变量调整单次请求窗口，例如：

```bash
PA_MAX_CONTEXT_CHARS=12000 npm run dev -- "继续完成这个任务"
```

这不会改变 Session 的完整历史，只限制每轮发送给 Provider 的消息窗口。

## 今天的边界

本日是**字符级近似预算，不是 tokenizer**，`length` 不等于模型 token 数；也**不做摘要压缩**，被省略的旧内容不会生成替代摘要。Session 仍是进程内完整历史，不做持久化、长期记忆或向量检索。
