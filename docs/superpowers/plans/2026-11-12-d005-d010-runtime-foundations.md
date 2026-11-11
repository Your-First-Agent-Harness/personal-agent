# D005–D010 Runtime Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成 D005 配置收尾，并依次交付统一事件、内存会话与 REPL、上下文预算、外部取消和覆盖率关卡。

**Architecture:** `core` 只新增事件纯类型；`runtime` 继续负责 Loop 与终止条件；`memory` 保存完整历史，`context` 只生成请求窗口副本；CLI 通过组合这些能力提供一次性提问和 REPL。模型取消通过 `AbortSignal` 穿过 Provider 与 Loop，覆盖率只衡量核心行为。

**Tech Stack:** Node 24、TypeScript 原生运行、ESM、Vitest、V8 coverage、零运行时依赖。

**规格：** `docs/superpowers/specs/2026-11-12-d006-d015-course-design.md` 第 2、3、4（D006–D010）、5、6 节。

---

## 文件结构

- `src/core/event.ts`：`AgentEvent`、`EventSink`、运行停止原因的纯类型。
- `src/observability/event-sink.ts`：把事件适配为现有 JSON Logger，不包含执行逻辑。
- `src/runtime/loop.ts`：发事件、裁剪请求上下文、响应取消；始终返回完整历史。
- `src/memory/session.ts`：进程内 Session，防御性复制消息快照。
- `src/cli/repl.ts`：可注入输入输出的 readline REPL。
- `src/cli/main.ts`：组合一次性提问、Session、REPL、SIGINT 与事件日志。
- `src/context/build.ts`：字符预算、工具组配对和截断。
- `src/adapters/model/provider.ts`：`ChatRequest.signal` 与取消错误契约。
- `src/adapters/model/openai-compatible.ts`：组合外部 signal 与 60 秒超时。
- `src/adapters/config.ts`：`maxContextChars` 配置。
- `vitest.config.ts`：V8 覆盖率阈值。
- `test/{events,session,repl,context,cancellation}.test.ts`：每日新增行为的独立测试。
- `docs/weekly/2026-w47.md`：D006–D010 周志。

### Task 1：D005 收尾并建立干净基线

**Files:**
- Modify: `.gitignore`
- Create: `.env.example`
- Modify: `README.md`（仅 main 索引冲突时保留索引版）

- [ ] **Step 1：先把本计划及另外两份计划提交到 main，避免混入 D005**

```bash
git add docs/superpowers/plans/2026-11-12-d005-d010-runtime-foundations.md docs/superpowers/plans/2026-11-12-d011-d013-workspace-tools.md docs/superpowers/plans/2026-11-12-d014-d015-errors-and-integration.md
git commit -m "docs: plan D006-D015 implementation"
git checkout D005
```

预期：工作区只剩 `.gitignore` 修改和 `.env.example` 未跟踪文件；计划文档已进入 main 提交。

- [ ] **Step 2：验证真实 `.env` 不会进入提交，模板不含真实密钥**

```bash
git check-ignore .env
git diff -- .gitignore
git diff --no-index /dev/null .env.example
```

预期：第一条输出 `.env`；模板只出现 `sk-your-key-here`、模型名、base URL 和日志级别，不出现真实 `.env` 的值。

- [ ] **Step 3：运行完整检查并提交 D005 收尾**

```bash
npm run check
git add .gitignore .env.example
git commit -m "chore(D005): add safe environment template"
git push origin D005
```

预期：lint、typecheck、31 个既有测试全部通过；commit 只包含两个配置文件。

- [ ] **Step 4：合并 main 并推送基线**

```bash
git checkout main
git merge --no-ff D005 -m "merge: D005 environment template"
git push origin main
```

预期：main 包含课程设计、实施计划和 D005 配置收尾，进度仍为 D005 / D100。

### Task 2：D006 统一事件模型

**Files:**
- Create: `src/core/event.ts`
- Create: `src/observability/event-sink.ts`
- Modify: `src/runtime/loop.ts`
- Modify: `src/cli/main.ts`
- Test: `test/events.test.ts`
- Modify: `README.md`

- [ ] **Step 1：从 D005 创建 D006，并写失败的事件顺序测试**

```bash
git checkout D005
git checkout -b D006
```

在 `test/events.test.ts` 建立脚本化 Provider 和 `events: AgentEvent[]`，加入以下四个断言场景：

```ts
function providerFrom(results: ChatResult[]): ModelProvider {
  let index = 0;
  return {
    name: 'scripted',
    chat: () => {
      const result = results[index];
      index += 1;
      return result === undefined ? Promise.reject(new Error('没有更多响应')) : Promise.resolve(result);
    },
  };
}

it('无工具路径按顺序发出轮次、响应和完成事件', async () => {
  const events: AgentEvent[] = [];
  const result = await runAgentLoop({
    provider: providerFrom([{ text: 'done', model: 'm' }]),
    registry: new ToolRegistry(),
    messages: [{ role: 'user', content: 'go' }],
    maxTurns: 3,
    maxTokens: 128,
    workspaceRoot: '.',
    eventSink: { emit: (event) => events.push(event) },
  });

  expect(result.stopReason).toBe('completed');
  expect(events.map((event) => event.type)).toEqual([
    'turn_started',
    'assistant_responded',
    'run_completed',
  ]);
  expect(events[2]).toMatchObject({ turn: 1, stopReason: 'completed' });
});

it('工具错误也发出开始和结果事件，且错误仍回喂', async () => {
  const events: AgentEvent[] = [];
  const result = await runAgentLoop({
    provider: providerFrom([
      { text: '', model: 'm', toolCalls: [{ id: 'c1', name: 'missing', arguments: '{}' }] },
      { text: 'done', model: 'm' },
    ]),
    registry: new ToolRegistry(),
    messages: [{ role: 'user', content: 'go' }],
    maxTurns: 3,
    maxTokens: 128,
    workspaceRoot: '.',
    eventSink: { emit: (event) => events.push(event) },
  });

  expect(result.stopReason).toBe('completed');
  expect(events.map((event) => event.type)).toEqual([
    'turn_started', 'assistant_responded', 'tool_call_started',
    'tool_call_finished', 'turn_started', 'assistant_responded', 'run_completed',
  ]);
  expect(events[3]).toMatchObject({ type: 'tool_call_finished', isError: true });
  expect(result.messages.some((message) => message.role === 'tool' && message.content.includes('未知工具'))).toBe(true);
});
```

另两个测试分别覆盖同一轮两个工具的事件顺序，以及 `maxTurns: 1` 时最后事件为 `{ type: 'run_completed', stopReason: 'max_turns' }`。不传 `eventSink` 的既有 `test/loop.test.ts` 必须原样通过。

- [ ] **Step 2：运行测试，确认因事件模块和参数不存在而失败**

```bash
npx vitest run test/events.test.ts
```

预期：FAIL，找不到 `src/core/event.ts` 或 `eventSink` 类型不匹配。

- [ ] **Step 3：实现事件纯类型和 Loop 发事件**

创建 `src/core/event.ts`：

```ts
export type AgentStopReason = 'completed' | 'max_turns';

export type AgentEvent =
  | { readonly type: 'turn_started'; readonly turn: number; readonly messageCount: number }
  | { readonly type: 'assistant_responded'; readonly turn: number; readonly textChars: number; readonly toolCallCount: number }
  | { readonly type: 'tool_call_started'; readonly turn: number; readonly toolCallId: string; readonly toolName: string }
  | { readonly type: 'tool_call_finished'; readonly turn: number; readonly toolCallId: string; readonly toolName: string; readonly isError: boolean; readonly contentChars: number }
  | { readonly type: 'run_completed'; readonly turn: number; readonly stopReason: AgentStopReason };

export interface EventSink {
  emit(event: AgentEvent): void;
}
```

`AgentLoopOptions` 用 `eventSink?: EventSink` 替换 `logger?: Logger`，`StopReason` 改为 `AgentStopReason` 的别名。Loop 在原有执行点同步调用 `options.eventSink?.emit(...)`：轮次开始前、assistant 消息入历史后、每个工具执行前后、completed/max_turns 返回前。工具开始事件不记录参数正文，结果事件只记录布尔值与字符数。

- [ ] **Step 4：先写 Logger 适配测试，再实现适配器**

测试用内存 sink 捕获 Logger 行，向适配器发送 `tool_call_started` 和 `run_completed`，断言只产生对应 JSON 行，`message` 分别为 `tool.call` 和 `loop.completed`，且不包含 API Key 或工具参数。

实现：

```ts
import type { AgentEvent, EventSink } from '../core/event.ts';
import type { Logger } from './logger.ts';

export function createLoggerEventSink(logger: Logger): EventSink {
  return {
    emit(event: AgentEvent): void {
      switch (event.type) {
        case 'turn_started':
          logger.info('loop.turn.start', { turn: event.turn, messageCount: event.messageCount });
          break;
        case 'assistant_responded':
          logger.debug('loop.assistant', { turn: event.turn, textChars: event.textChars, toolCallCount: event.toolCallCount });
          break;
        case 'tool_call_started':
          logger.info('tool.call', { turn: event.turn, tool: event.toolName, toolCallId: event.toolCallId });
          break;
        case 'tool_call_finished':
          logger.info('tool.result', { turn: event.turn, tool: event.toolName, toolCallId: event.toolCallId, isError: event.isError, chars: event.contentChars });
          break;
        case 'run_completed':
          if (event.stopReason === 'max_turns') logger.warn('loop.max_turns', { turn: event.turn });
          else logger.info('loop.completed', { turn: event.turn });
          break;
      }
    },
  };
}
```

CLI 传入 `eventSink: createLoggerEventSink(logger)`，删除 Loop 内旧的直接 Logger 调用，确保同一事实不打印两次。

- [ ] **Step 5：验证、编写当日 README、提交并合并**

README 写明事件联合的五种事实、同步 sink、四种事件顺序复现命令和“不做持久化/Replay”边界。然后执行：

```bash
npm run check
git add src test README.md
git commit -m "feat(D006): emit structured agent events"
git push -u origin D006
git checkout main
git merge --no-ff D006
```

若 README 冲突，执行 `git checkout --ours README.md && git add README.md && git commit -m "merge: D006 统一事件模型"`。在 main 索引追加 `| [D006](../../tree/D006) | 2026-11-16 | 统一事件模型 | AgentEvent、EventSink、Logger 适配 |`，进度改为 D006 / D100，提交 `docs: index D006` 并推送 main。

### Task 3：D007 内存 Session 与五轮 REPL

**Files:**
- Create: `src/memory/session.ts`
- Create: `src/cli/repl.ts`
- Modify: `src/cli/main.ts`
- Test: `test/session.test.ts`
- Test: `test/repl.test.ts`
- Modify: `README.md`

- [ ] **Step 1：创建 D007，并写 Session 隔离与五轮历史测试**

```bash
git checkout D006
git checkout -b D007
```

测试固定 Provider 依次返回 `回答 1` 到 `回答 5`。每轮先 `session.append([{ role: 'user', content: input }])`，保存 `before = session.snapshot()`，运行 Loop 后执行：

```ts
session.append(result.messages.slice(before.length));
```

第五轮 Provider 收到的消息应包含此前全部 user/assistant；最终 Session 有 5 条 user 和 5 条 assistant。另一个测试对快照执行 `(snapshot as Message[]).push(...)`，断言内部历史不变；两个 Session 分别追加消息后互不可见。

- [ ] **Step 2：运行测试确认失败，再实现防御性快照**

```bash
npx vitest run test/session.test.ts
```

实现 `src/memory/session.ts`：

```ts
import { randomUUID } from 'node:crypto';
import type { Message } from '../core/message.ts';

function clone(message: Message): Message {
  return { ...message, ...(message.toolCalls === undefined ? {} : { toolCalls: message.toolCalls.map((call) => ({ ...call })) }) };
}

export class Session {
  readonly id: string;
  private readonly history: Message[];

  constructor(id = randomUUID(), messages: readonly Message[] = []) {
    this.id = id;
    this.history = messages.map(clone);
  }

  snapshot(): readonly Message[] {
    return this.history.map(clone);
  }

  append(messages: readonly Message[]): void {
    this.history.push(...messages.map(clone));
  }
}
```

- [ ] **Step 3：写 REPL 行为失败测试**

用 `Readable.from(['第一轮\n\n第二轮\n/exit\n'])` 和可捕获 `Writable` 驱动 `runRepl`，`runTurn` 记录问题并返回固定答案。断言调用仅为 `['第一轮', '第二轮']`，输出包含两个答案，遇到 `/exit` 后不再读取。另测单轮以及首行 `/exit` 时 `runTurn` 零调用。

- [ ] **Step 4：实现可测试 REPL，并接入 CLI Session**

`src/cli/repl.ts` 使用 `createInterface({ input, output })` 和 `for await (const line of rl)`：trim 后 `/exit` break、空串 continue，其他输入 `await runTurn(text)` 并写答案，`finally` 中 `rl.close()`。接口为：

```ts
export interface ReplOptions {
  readonly input: NodeJS.ReadableStream;
  readonly output: NodeJS.WritableStream;
  readonly runTurn: (prompt: string) => Promise<string>;
}

export async function runRepl(options: ReplOptions): Promise<void> {
  const rl = createInterface({ input: options.input, output: options.output });
  try {
    for await (const line of rl) {
      const prompt = line.trim();
      if (prompt === '/exit') break;
      if (prompt === '') continue;
      options.output.write(`${await options.runTurn(prompt)}\n`);
    }
  } finally {
    rl.close();
  }
}
```

CLI 创建一个 Session。`runTurn` 按 Step 1 的方式保存用户消息、运行 Loop、只追加新增 assistant/tool 消息；带参数时只调用一次，不带参数时调用 `runRepl`。保留 Provider、密钥检查和一次性提问行为。

- [ ] **Step 5：验证、文档、提交与索引**

```bash
npm run check
node --env-file-if-exists=.env src/cli/main.ts
```

手工 REPL 验证两轮记忆、空行和 `/exit`。README 给出五轮脚本测试命令并明确“进程退出即丢失”。提交 `feat(D007): add in-memory sessions and REPL`，推送 D007，合并 main；索引日期 `2026-11-17`，产出写 `Session、五轮历史、readline REPL`，进度改为 D007 / D100。

### Task 4：D008 字符预算与工具组安全裁剪

**Files:**
- Create: `src/context/build.ts`
- Modify: `src/runtime/loop.ts`
- Modify: `src/adapters/config.ts`
- Modify: `src/cli/main.ts`
- Test: `test/context.test.ts`
- Modify: `test/config.test.ts`
- Modify: `README.md`

- [ ] **Step 1：创建 D008，写裁剪失败测试**

```bash
git checkout D007
git checkout -b D008
```

`test/context.test.ts` 必须包含：

```ts
it('短历史原样保留', () => {
  const messages: Message[] = [{ role: 'system', content: 's' }, { role: 'user', content: 'u' }];
  expect(buildContext(messages, 100)).toEqual(messages);
});

it('保留 system 和最新用户目标，并插入省略标记', () => {
  const messages: Message[] = [
    { role: 'system', content: '规则' },
    { role: 'user', content: '旧目标' },
    { role: 'assistant', content: 'x'.repeat(100) },
    { role: 'user', content: '最新目标' },
  ];
  const result = buildContext(messages, 40);
  expect(result[0]).toEqual(messages[0]);
  expect(result.at(-1)?.content).toBe('最新目标');
  expect(result.some((message) => message.content.includes('已省略'))).toBe(true);
  expect(totalChars(result)).toBeLessThanOrEqual(40);
});
```

再覆盖：system 自身超预算抛错；超长最新用户保留末尾且有截断标记；assistant toolCalls 与对应 tool 同组保留或同组省略；大工具组只截断 tool content，不拆配对；裁剪后 Session 完整历史长度不变。配置测试断言默认 24000、文件覆盖、环境覆盖和 `PA_MAX_CONTEXT_CHARS=0` 抛 `ConfigError`。

- [ ] **Step 2：运行测试确认失败后实现纯函数**

```bash
npx vitest run test/context.test.ts test/config.test.ts
```

创建 `src/context/build.ts`，完整实现如下；测试里的 `totalChars` 也从这里导入：

```ts
import type { Message } from '../core/message.ts';

export const CONTEXT_OMITTED = '…[更早的上下文已省略]';
export const CONTEXT_TRUNCATED = '…[已截断]';

interface Unit {
  readonly messages: readonly Message[];
  readonly toolGroup: boolean;
}

function clone(message: Message): Message {
  return {
    ...message,
    ...(message.toolCalls === undefined ? {} : { toolCalls: message.toolCalls.map((call) => ({ ...call })) }),
  };
}

export function messageChars(message: Message): number {
  return message.content.length
    + (message.toolCallId?.length ?? 0)
    + (message.name?.length ?? 0)
    + (message.toolCalls ?? []).reduce(
      (sum, call) => sum + call.id.length + call.name.length + call.arguments.length,
      0,
    );
}

export function totalChars(messages: readonly Message[]): number {
  return messages.reduce((sum, message) => sum + messageChars(message), 0);
}

function unitChars(unit: Unit): number {
  return totalChars(unit.messages);
}

function groupUnits(messages: readonly Message[]): Unit[] {
  const units: Unit[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]!;
    if (message.role === 'assistant' && (message.toolCalls?.length ?? 0) > 0) {
      const ids = new Set(message.toolCalls!.map((call) => call.id));
      const group = [message];
      while (index + 1 < messages.length) {
        const next = messages[index + 1]!;
        if (next.role !== 'tool' || next.toolCallId === undefined || !ids.has(next.toolCallId)) break;
        group.push(next);
        index += 1;
      }
      units.push({ messages: group, toolGroup: true });
    } else if (message.role !== 'tool') {
      // 没有 assistant 配对的孤立 tool 不进入模型请求。
      units.push({ messages: [message], toolGroup: false });
    }
  }
  return units;
}

function truncateHead(content: string, budget: number): string {
  if (budget <= 0) return '';
  if (content.length <= budget) return content;
  if (budget <= CONTEXT_TRUNCATED.length) return CONTEXT_TRUNCATED.slice(0, budget);
  return content.slice(0, budget - CONTEXT_TRUNCATED.length) + CONTEXT_TRUNCATED;
}

function truncateLatestUser(message: Message, budget: number): Message {
  const metadataChars = messageChars({ ...message, content: '' });
  const contentBudget = Math.max(0, budget - metadataChars);
  if (contentBudget <= CONTEXT_TRUNCATED.length) {
    return { ...message, content: CONTEXT_TRUNCATED.slice(0, contentBudget) };
  }
  return {
    ...message,
    content: CONTEXT_TRUNCATED + message.content.slice(-(contentBudget - CONTEXT_TRUNCATED.length)),
  };
}

function fitToolGroup(unit: Unit, budget: number): Unit | undefined {
  const fixedChars = unit.messages.reduce(
    (sum, message) => sum + (message.role === 'tool' ? messageChars({ ...message, content: '' }) : messageChars(message)),
    0,
  );
  if (fixedChars > budget) return undefined;
  let remaining = budget - fixedChars;
  const fitted = unit.messages.map(clone);
  for (let index = fitted.length - 1; index >= 0; index -= 1) {
    const message = fitted[index]!;
    if (message.role !== 'tool') continue;
    fitted[index] = { ...message, content: truncateHead(message.content, remaining) };
    remaining = Math.max(0, remaining - message.content.length);
  }
  return { messages: fitted, toolGroup: true };
}

export function buildContext(messages: readonly Message[], maxChars: number): Message[] {
  if (!Number.isInteger(maxChars) || maxChars <= 0) throw new Error('maxChars 必须是正整数');
  const copy = messages.map(clone);
  if (totalChars(copy) <= maxChars) return copy;

  const system = copy.filter((message) => message.role === 'system');
  const systemChars = totalChars(system);
  if (systemChars > maxChars) throw new Error('system 消息本身超过上下文预算');

  const marker: Message = { role: 'system', content: CONTEXT_OMITTED };
  const available = maxChars - systemChars - messageChars(marker);
  if (available <= 0) throw new Error('预算不足以同时保留 system 和最新消息');

  const units = groupUnits(copy.filter((message) => message.role !== 'system'));
  const latestUserIndex = units.findLastIndex(
    (unit) => unit.messages.length === 1 && unit.messages[0]?.role === 'user',
  );
  const selected = new Map<number, Unit>();
  let used = 0;

  if (latestUserIndex >= 0) {
    const latest = units[latestUserIndex]!;
    if (unitChars(latest) <= available) {
      selected.set(latestUserIndex, latest);
      used = unitChars(latest);
    } else {
      const message = truncateLatestUser(latest.messages[0]!, available);
      selected.set(latestUserIndex, { messages: [message], toolGroup: false });
      used = messageChars(message);
    }
  }

  for (let index = units.length - 1; index >= 0 && used < available; index -= 1) {
    if (selected.has(index)) continue;
    const unit = units[index]!;
    const remaining = available - used;
    if (unitChars(unit) <= remaining) {
      selected.set(index, unit);
      used += unitChars(unit);
      continue;
    }
    if (unit.toolGroup) {
      const fitted = fitToolGroup(unit, remaining);
      if (fitted !== undefined) {
        selected.set(index, fitted);
        used += unitChars(fitted);
      }
    }
    break;
  }

  return [
    ...system,
    marker,
    ...[...selected.entries()]
      .sort(([left], [right]) => left - right)
      .flatMap(([, unit]) => unit.messages),
  ];
}
```

配置在 `AppConfig.agent` 增加 `maxContextChars: number`，默认值 24000，文件键 `agent.maxContextChars`，环境键 `PA_MAX_CONTEXT_CHARS`，复用 `parsePositiveInt` 并接入三层合并。

- [ ] **Step 3：让 Loop 只把窗口发给 Provider**

Loop 新增 `maxContextChars?: number`，默认 24000。每轮在 `turn_started` 后计算：

```ts
const requestMessages = buildContext(messages, options.maxContextChars ?? 24_000);
const result = await options.provider.chat({
  messages: requestMessages,
  maxTokens: options.maxTokens,
  tools,
});
```

`messages` 完整数组仍接收 assistant/tool 并作为 `AgentLoopResult.messages` 返回；不得把裁剪结果写回 Session。CLI 传入 `config.agent.maxContextChars`。

- [ ] **Step 4：验证、文档、提交与索引**

运行 `npm run check`。README 给出字符预算公式、配对裁剪示例和“不是 tokenizer、不做摘要”的边界。提交 `feat(D008): bound model context by characters`，推送 D008，合并 main；索引日期 `2026-11-18`，产出写 `buildContext、工具组配对、PA_MAX_CONTEXT_CHARS`，进度改为 D008 / D100。

### Task 5：D009 AbortSignal 与模型超时

**Files:**
- Modify: `src/core/event.ts`
- Modify: `src/core/tool.ts`
- Modify: `src/adapters/model/provider.ts`
- Modify: `src/adapters/model/openai-compatible.ts`
- Modify: `src/runtime/loop.ts`
- Modify: `src/cli/main.ts`
- Test: `test/cancellation.test.ts`
- Modify: `test/openai-compatible.test.ts`
- Modify: `README.md`

- [ ] **Step 1：创建 D009，写外部取消失败测试**

```bash
git checkout D008
git checkout -b D009
```

测试场景：

```ts
it('预先取消时不请求模型', async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const result = await runAgentLoop({
    provider: { name: 'spy', chat: () => { calls += 1; throw new Error('不应调用'); } },
    registry: new ToolRegistry(),
    messages: [{ role: 'user', content: 'go' }],
    maxTurns: 3,
    maxTokens: 128,
    workspaceRoot: '.',
    signal: controller.signal,
  });
  expect(calls).toBe(0);
  expect(result.stopReason).toBe('cancelled');
  expect(result.turns).toBe(0);
});
```

再覆盖：fetch 等待期间 abort，Provider 抛 `ModelCancelledError`，Loop 返回 cancelled 且不发下一轮；assistant 返回工具后、工具执行前取消，工具调用数为零；`AbortSignal.timeout` 仍转 `ModelError` 而不是 cancelled；最后一个事件为 `run_cancelled`。

- [ ] **Step 2：运行测试确认失败，再扩展契约**

```bash
npx vitest run test/cancellation.test.ts test/openai-compatible.test.ts
```

在 `provider.ts` 增加：

```ts
export class ModelCancelledError extends Error {
  constructor() {
    super('模型请求已取消');
    this.name = 'ModelCancelledError';
  }
}
```

`ChatRequest`、`AgentLoopOptions`、`ToolContext` 均增加 `readonly signal?: AbortSignal`。`AgentStopReason` 增加 `'cancelled'`，`AgentEvent` 增加 `{ type: 'run_cancelled'; turn: number }`。

- [ ] **Step 3：组合 Provider 信号并实现 Loop 取消出口**

Provider 在 fetch 前检查 `request.signal?.aborted`，已取消则抛 `ModelCancelledError`。fetch signal 使用：

```ts
const signals = [AbortSignal.timeout(timeoutMs)];
if (request.signal !== undefined) signals.push(request.signal);
signal: AbortSignal.any(signals);
```

catch 中若 `request.signal?.aborted` 则抛 `ModelCancelledError`，其他异常保持现有 `ModelError`。Loop 在 for 之前、每轮模型前、每个工具前检查 signal；模型调用只捕获 `ModelCancelledError` 并返回，其他错误继续抛出。返回结构为完整已产生消息、`text: ''`、`stopReason: 'cancelled'`、已累加 usage，并先发送 `run_cancelled`。Registry 执行上下文传入同一 signal。

- [ ] **Step 4：接入 SIGINT，运行全部验证**

CLI 创建 `AbortController`，`process.once('SIGINT', () => controller.abort())`，把 signal 传给 Loop；cancelled 输出 `任务已取消。`，completed/max_turns 的既有输出不变。Logger 适配器把 `run_cancelled` 记录为 `loop.cancelled`。

README 明确同步文件工具只在边界响应，命令子进程终止留到 D013。提交 `feat(D009): support cooperative cancellation`，推送 D009，合并 main；索引日期 `2026-11-19`，产出写 `AbortSignal、外部取消、模型超时语义`，进度改为 D009 / D100。

### Task 6：D010 覆盖率关卡与周志

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.github/workflows/ci.yml`
- Modify: 核心行为测试文件（仅补未覆盖分支）
- Create: `docs/weekly/2026-w47.md`
- Modify: `README.md`

- [ ] **Step 1：创建 D010 并安装匹配 Vitest 的 V8 provider**

```bash
git checkout D009
git checkout -b D010
npm install --save-dev @vitest/coverage-v8@^5.1.0
```

`package.json` 增加 `"test:coverage": "vitest run --coverage"`，保留现有 `check`。

- [ ] **Step 2：配置阈值并首次运行覆盖率**

创建 `vitest.config.ts`：

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/cli/main.ts'],
      reporter: ['text', 'html'],
      thresholds: { statements: 80, lines: 80, functions: 80, branches: 75 },
    },
  },
});
```

运行 `npm run test:coverage`。若失败，只针对报告指向的可观察分支补测试：配置非法值、Session 含 toolCalls 的复制、REPL 空输入/退出、上下文 system 超限/工具组截断、取消前后、Logger 各事件分支。不得通过排除 `src/runtime`、`src/context` 或降低阈值通过。

- [ ] **Step 3：让 CI 与本地执行同一覆盖率命令**

`.github/workflows/ci.yml` 最后一步由 `npm run test` 改为 `npm run test:coverage`，lint/typecheck 不变。`.gitignore` 已有 `coverage/`，执行 `git status --short` 确认报告未被跟踪。

- [ ] **Step 4：写周志并完成每日交付**

`docs/weekly/2026-w47.md` 固定包含：D005 重复内容为何重排；D006–D010 每日能力和验证命令；字符预算不等于 token、内存 Session 不持久化、同步工具不能中途取消三个边界；下周入口 D011–D015。README 教读者运行覆盖率并解读四项阈值。

```bash
npm run check
npm run test:coverage
git add package.json package-lock.json vitest.config.ts .github/workflows/ci.yml test docs/weekly README.md
git commit -m "test(D010): enforce core coverage thresholds"
git push -u origin D010
git checkout main
git merge --no-ff D010
```

README 冲突保留 main 索引版。索引日期 `2026-11-20`，产出写 `V8 覆盖率 80/80/80/75、CI 关卡、周志`，进度改为 D010 / D100，提交索引并推送 main。

## 自检

- 规格覆盖：D005 配置、D006 事件、D007 五轮 Session/REPL、D008 配对裁剪、D009 取消/超时、D010 覆盖率/CI/周志均有独立任务。
- 类型衔接：D009 扩展的 `AgentStopReason` 和事件供 D014 继续扩展；`ToolContext.signal` 供 D013 使用；完整历史与请求窗口分离供 D015 集成断言使用。
- 安全边界：不读取或提交真实 `.env`；事件不记录密钥；测试全部使用脚本化 Provider；每日先测试后实现。
