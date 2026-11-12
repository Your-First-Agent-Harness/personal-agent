# D019 · 错误不是异常终点：一次真实 Agent 修复如何闭环

> 课程日期：2026-11-29
>
> 交付形态：课程长文 + 可执行 Demo。本环境没有已制作视频，因此不提供视频链接或观看数据。

一个 Agent 系统成熟的标志，不是工具永远不失败，而是失败之后仍能回答三个问题：**发生了什么、由谁决定下一步、整个任务为什么停止。**

今天用仓库里一个已经发生、已经修复、而且可以重复回放的缺陷，走完这条证据链：

```text
真实失败路径
  → 可重复的最小回归测试
  → 找到互相冲突的停止语义
  → 三行最小修复
  → 同一测试由红变绿
  → 在临时仓库副本中用真实工具再演一次修复
  → 明确这套证据不能证明什么
```

这里所说的“真实”有明确边界：

- D017 提交 `26a8dc4` 增加了失败路径矩阵，其中 FP-07 固定了取消优先级缺陷，并在 `src/runtime/loop.ts` 加入三行修复；
- D018 提交 `83ab5d2` 增加 `scripts/d018-real-repair.ts`，在系统临时目录中重建旧缺陷，再用真实工具完成修复回放；
- D019 只把这些已有代码、测试和本次实测整理成教学内容，不重新实现 D014–D018 的功能。

这个缺陷不是来自 GitHub issue，也没有被包装成用户反馈或线上事故。本文不虚构外部链接、发布量、真实 ARK 成功记录或性能结论。

## 读完你能带走什么

1. 看懂一次工具调用如何穿过 Loop、Provider、ToolRegistry，再变成 `role: "tool"` 的历史消息。
2. 区分单次工具的 `COMMAND_CANCELLED` 与整个 run 的 `stopReason: "cancelled"`。
3. 解释为什么取消检查必须放在**工具结果入历史之后、连续错误保险丝之前**。
4. 亲自运行 D018 Demo，核验“旧副本失败、精确编辑、同一测试通过”的闭环。
5. 识别脚本化 Provider、临时目录、覆盖率和取消机制各自的能力边界。

## 一、先把三种“失败”分开

Agent 最容易发生的混乱，是把所有不顺利都压成一句“执行失败”。本仓库刻意保留三条不同的语义通道。

| 情况 | 代码中的表达 | Loop 的处理 |
| --- | --- | --- |
| 工具失败 | `ToolResult.isError === true`，可带结构化 `error` | 未达到连续错误上限时，作为 tool 消息回喂；达到上限时以 `tool_errors` 停止 |
| Provider 故障 | HTTP、协议、网络或 Provider 内部超时形成 `ModelError` | 不伪装成工具结果，继续抛给上层决定如何处理 |
| 外部取消 | 调用方触发 `AbortSignal` | 整个 run 以 `cancelled` 正常终止，并发出 `run_cancelled` |

Provider 请求期间的外部取消会先由 Provider 归一为 `ModelCancelledError`，Loop 再把它转成 `cancelled`。它不应和 Provider 的 HTTP 故障混为一谈。

还有两种正常返回的停止原因：模型不再调用工具时是 `completed`，轮次耗尽时是 `max_turns`。今天关注的焦点是：**为什么一个已经发生的外部取消，旧实现却会报告 `tool_errors`？**

答案不是命令没有取消，也不是错误码错了，而是两个本来都正确的机制，在错误的先后顺序里争夺了最终解释权。

## 二、一次工具调用如何穿过整个 Harness

核心入口是 `src/runtime/loop.ts` 的 `runAgentLoop()`。可以把一次调用压缩成下面这张图：

```text
调用方
  │  messages / maxTurns / maxConsecutiveToolErrors / AbortSignal
  ▼
Loop
  │  registry.list() 取得工具 Schema
  ▼
Provider.chat({ messages, tools, maxTokens, signal })
  │  返回 text / toolCalls / usage
  ▼
Loop 保存 assistant 消息
  │  按 toolCalls 顺序串行执行
  ▼
ToolRegistry.execute(call, { workspaceRoot, signal })
  │  找工具 → 解析 JSON → 校验参数 → tool.execute()
  ▼
ToolResult { content, isError?, error? }
  │
  ▼
Loop 发 tool_call_finished → 保存 role: tool 消息
  │
  ├─ 检查 signal.aborted：是则 cancelled
  │
  └─ 否则更新连续错误计数，必要时以 tool_errors 停止
       │
       └─ 未停止且还有后续轮次：把新历史再次交给 Provider
```

### 2.1 Loop：编排者，不是模型，也不是工具

`src/runtime/loop.ts` 负责：

- 保存完整消息历史；
- 把工具 Schema 和历史交给 Provider；
- 按 Provider 返回的顺序串行执行工具；
- 发出 `turn_started`、`assistant_responded`、`tool_call_started`、`tool_call_finished` 等事件；
- 根据工具结果、外部信号和轮次限制决定何时停止。

它不会自己阅读测试输出并决定修哪里。下一轮采取什么动作，来自 Provider 的下一次响应。

### 2.2 Provider：提出动作，不直接执行动作

`src/adapters/model/provider.ts` 定义了最小契约：

- 输入是 `messages`、`maxTokens`、可选 `tools` 和 `signal`；
- 输出是文本、模型名、可选 `toolCalls` 和 token 用量。

`src/adapters/model/openai-compatible.ts` 负责把这些领域消息转换为 OpenAI 兼容线格式，也把外部请求取消转换为 `ModelCancelledError`。HTTP 非成功、响应结构不合法等仍是 `ModelError`，不会被偷偷写成一次工具失败。

D018 Demo 使用的是 `scripted-d018`：它按预定顺序返回五个响应。这样可以重复测试 Harness 的编排和工具行为，但它不是会自主规划的模型。

### 2.3 ToolRegistry：把执行失败变成可处理的数据

`src/tools/registry.ts` 同时承担两件工作：

- `list()` 向 Provider 提供稳定的工具 Schema；
- `execute()` 根据调用名找到工具，解析并校验参数，然后执行。

未知工具、非法 JSON、非法参数和预期工具失败都会成为 `ToolResult`。工具抛出的异常也会在 `execute()` 内被标准化；未知异常统一脱敏为 `INTERNAL_ERROR`，而不是把原始堆栈直接送进后续模型历史。

这就是“错误不是异常终点”的第一层含义：**工具失败通常是下一轮决策所需的数据，不必立刻炸穿整个 Loop。** 但连续错误保险丝仍然存在，避免系统永远不收敛。

### 2.4 tool 消息：把一次调用的证据接回历史

`src/core/message.ts` 中，assistant 消息可以携带 `toolCalls`；工具完成后，Loop 写入：

```ts
{
  role: 'tool',
  toolCallId: call.id,
  name: call.name,
  content: toolResult.content,
}
```

`toolCallId` 把结果对回那一次调用，`name` 方便日志与回放，`content` 是 Provider 下一轮能看到的内容。

有一个容易漏掉的细节：`ToolResult.error` 是 Harness 内部的结构化详情，**不会由 Loop 自动序列化进 tool 消息**。因此 FP-07 会分别检查：

- Registry 记录的结果中有 `error.code === "COMMAND_CANCELLED"`；
- 历史最后一条 tool 消息的 JSON `content` 中有 `cancelled: true`。

这两份证据互补，不能混写成一个字段。

### 2.5 maxConsecutiveToolErrors：防失控保险丝，不是取消原因裁判

`src/runtime/loop.ts` 默认把 `maxConsecutiveToolErrors` 设为 3：

- 当前工具 `isError === true`，计数加一；
- 当前工具成功，连续计数清零；
- 达到上限，发出 `run_completed`，其 `stopReason` 为 `tool_errors`，然后返回。

它适合回答“工具是否连续失败到不应继续”，却不拥有覆盖外部取消的权力。D017 的 FP-07 故意把上限设为 1，让优先级冲突在最短路径里暴露。

### 2.6 AbortSignal：贯穿 Provider、Loop 与工具的控制信号

同一个 `options.signal` 会传给 Provider 和 `ToolRegistry.execute()`。Loop 还在多个边界主动检查它：

- run 开始前；
- 每轮 Provider 请求前；
- 每个工具启动前；
- 工具结果保存后、连续错误计数前。

`src/tools/run-command.ts` 则监听 `abort`：记录 `cancelled = true`，向子进程发送 `SIGTERM`，等进程关闭后形成结构化结果。

所以取消不是某一层单独完成的。工具负责合作式停止自己的执行，Loop 负责给整个 run 一个一致的最终原因。

## 三、准确的失败时序：工具已取消，run 却报 tool_errors

下面重建 D017 旧实现中的 FP-07。测试位于 `test/d017-failure-paths.test.ts`，关键条件是：

- Provider 第一轮只要求调用一次 `run_command`；
- 命令先写入 `started` 标记，再保持运行；
- 测试确认子进程已经启动，随后调用 `AbortController.abort()`；
- `maxConsecutiveToolErrors` 为 1；
- 期望整个 run 以 `cancelled` 停止。

### 旧实现的逐步过程

1. Loop 开始第 1 轮，调用 Provider。
2. Provider 返回 `run_command` 的 tool call；Loop 保存 assistant 消息并发出 `assistant_responded`。
3. 工具启动前信号尚未取消，于是发出 `tool_call_started`，进入 Registry。
4. Registry 解析和校验参数，把同一个 signal 交给真实 `run_command`。
5. 子进程写入 `started` 后，测试触发外部取消。
6. `run_command` 的 abort 监听器记录取消并发送 `SIGTERM`；子进程关闭后，工具返回：
   - `isError: true`；
   - `error.code: "COMMAND_CANCELLED"`；
   - `content` 中包含 `cancelled: true`、`timedOut: false`。
7. Loop 发出 `tool_call_finished`，其中 `isError: true`。
8. Loop 把诊断内容作为 `role: "tool"` 消息写入历史。
9. **旧代码在这里没有检查 `signal.aborted`。**
10. 连续错误计数从 0 变成 1，恰好达到上限 1。
11. Loop 发出 `run_completed`，以 `stopReason: "tool_errors"` 返回，不再请求第二轮 Provider。

压缩成时序就是：

```text
外部取消
  → run_command 返回 COMMAND_CANCELLED
  → tool_call_finished
  → tool 诊断消息入历史
  → 连续错误数 = 1
  → 达到 maxConsecutiveToolErrors = 1
  → run_completed(tool_errors)       ← 错误的最终解释
```

D018 的临时旧副本今天再次实际输出：

```text
beforeExitCode: 1
actual:   "tool_errors"
expected: "cancelled"
pass: 0
fail: 1
```

注意，失败的是“整个 run 的停止原因”断言。单次命令已经正确报告了取消；缺陷发生在 Loop 随后的优先级判断。

## 四、准确的修复时序：先保留证据，再服从取消

D017 的最小修复只有三行，位置在 `src/runtime/loop.ts` 的工具消息写入之后：

```ts
messages.push({
  role: 'tool',
  toolCallId: call.id,
  name: call.name,
  content: toolResult.content,
});
if (options.signal?.aborted) {
  return cancelled(turn);
}
consecutiveToolErrors = toolResult.isError === true ? consecutiveToolErrors + 1 : 0;
```

修复后的前八步与旧实现完全相同。区别从第 9 步开始：

1. 工具结果和 `tool_call_finished` 仍然保留；
2. tool 消息仍然进入历史；
3. Loop 发现 `signal.aborted === true`；
4. `cancelled(turn)` 发出 `run_cancelled`，返回 `stopReason: "cancelled"`；
5. 不再累加连续错误，不执行保险丝判断，也不再请求 Provider。

```text
COMMAND_CANCELLED
  → tool_call_finished
  → tool 诊断消息入历史
  → signal.aborted === true
  → run_cancelled
  → run.stopReason === "cancelled"   ← 外部意图拥有最终优先级
```

修复后，单次工具结果仍可以是 `COMMAND_CANCELLED`。它不是被吞掉，而是不再越权决定整个 run 的停止原因。

### 为什么必须在工具结果入历史之后？

因为取消不应抹掉刚刚发生的事实。

先保存结果，调用方才能看到：

- 哪次工具调用被取消；
- 工具是否已经返回诊断；
- 命令内容里是否明确记录 `cancelled: true`；
- `tool_call_finished` 与最终 `run_cancelled` 如何衔接。

FP-07 明确断言最后一条历史仍是 tool 消息。若把检查挪到 `messages.push()` 之前，虽然最终停止原因可能也是 `cancelled`，却会丢失这次调用的结果证据，历史也可能停在只有 tool call、没有对应 tool 结果的 assistant 消息上。

### 为什么必须在连续错误保险丝之前？

因为保险丝一旦触发就会立即返回。把取消检查放到它后面，等于没有修复本次缺陷。

先检查信号是在明确一条规则：**外部取消是 run 级控制意图，优先级高于“模型连续犯错是否还能继续”的容错策略。** 用户已经要求停止，就不应再把这次取消当成一次可回喂、可重试的普通失败。

### 为什么检查 signal，而不是特判 COMMAND_CANCELLED？

`AbortSignal` 才是外部意图的来源，错误码只是某个工具对取消的报告方式。

直接检查 signal 可以同时覆盖：

- 工具返回 `COMMAND_CANCELLED` 的路径；
- 某工具不支持取消、但在信号触发后返回其他结果的路径；
- 未来新增工具，而不要求每个工具都发明同一种取消错误码。

工具启动前的检查无法覆盖“执行期间才取消”，Provider 请求时的 `ModelCancelledError` 也无法覆盖工具阶段。因此，工具 `await` 返回后的这次检查是独立且必要的边界。

## 五、D018 如何把一次修复变成可执行回放

D017 是真实缺陷测试与最小修复的提交；D018 是之后建立的**确定性工具回放**。不要倒写成“D017 当时由一个真实模型自主发现了问题”。回放的价值在于：今天仍可用真实代码和真实工具核验这条修复路径，而不是只读一段事后叙述。

### 5.1 两层 Loop，两个停止原因

```text
外层：当前仓库中已经修复的生产 Loop
  Provider：scripted-d018，五个确定性响应
  Registry：真实 read_file / run_command / edit_file
  工作区：系统临时目录中的仓库副本
    │
    └─ 内层：副本中的 node:test 回归测试
         Provider：scripted-d018-regression
         工具：副本中的真实 run_command
         动作：启动子进程 → 等待 started → abort
         断言：副本 run 必须 cancelled，而不是 tool_errors
```

内层的 `cancelled` 描述“被修复项目中的取消测试”；外层最终的 `completed` 描述“读取、测试、编辑、复测的修复流程走完”。二者处于不同层级，不矛盾。

外层把 `maxConsecutiveToolErrors` 设为 3，使第一次回归测试失败形成的 `COMMAND_FAILED` 能作为反馈进入历史，而不是立刻熔断外层。内层仍设为 1，准确重建缺陷触发条件。

### 5.2 五轮修复过程

| 外层轮次 | Provider 动作 | 真实工具结果 | 在教学闭环中的意义 |
| --- | --- | --- | --- |
| 1 | `read_file("src/runtime/loop.ts")` | 成功 | 读取临时副本中的真实旧源码 |
| 2 | 运行 `node --test regression.test.ts` | `COMMAND_FAILED`，退出码 1 | 先取得缺陷版 RED，不跳过失败证据 |
| 3 | `edit_file` 补回取消检查 | 成功，唯一匹配并返回 diff | 只做三行精确修复，不重写整份文件 |
| 4 | 再运行完全相同的测试 | 成功，退出码 0 | 同一回归测试由红变绿 |
| 5 | 返回最终文本 | 无工具调用 | 外层以 `completed` 正常结束 |

临时副本由 `scripts/d018-real-repair.ts` 创建：复制当前 `src/`，写入最小 `package.json` 和回归测试，再只在副本的 `loop.ts` 中移除 D017 的三行检查。它不复制 `.git`、`node_modules`、`.env` 或凭证，也不运行 `npm install`。

脚本和 `test/d018-real-repair.test.ts` 还会共同核验：

- 修复前退出码为 1，输出同时包含实际 `tool_errors` 和期望 `cancelled`；
- 修复后退出码为 0，`pass: 1`、`fail: 0`；
- 修复后的副本逐字等于当前生产 `src/runtime/loop.ts`；
- Demo 前后生产源码保持不变；
- 外层历史严格是 read、修复前测试、edit、修复后测试、final 的 9 条 assistant/tool 记录；
- 外层共 5 turns、5 次 Provider 请求，最后事件为 `run_completed:5:completed`；
- 临时根目录已在 `finally` 中删除。

这份闭环不是一句 `success: true`，而是一组可以被脚本和测试同时反驳的断言。

## 六、亲手复现：三条命令就够了

需要 Node.js 22 或更高版本，并已安装仓库开发依赖。在 D019 分支的仓库根目录依次运行：

```bash
npm run demo:d018
npm run check
npm run test:coverage
```

### 6.1 Demo 应该看什么

`npm run demo:d018` 会输出 JSON。本文不粘贴完整 JSON、整份 `loop.ts` 或完整测试报告，只列出本次实际运行应重点核验的字段：

| 证据 | 本次实际结果 |
| --- | --- |
| `beforeExitCode` | **1** |
| `beforeStdout` | 包含 **pass 0 / fail 1**，以及 actual `tool_errors`、expected `cancelled` |
| `afterExitCode` | **0** |
| `afterStdout` | 包含 **pass 1 / fail 0** |
| 外层工具序列 | read 成功 → 首次测试 `COMMAND_FAILED` → edit 成功 → 复测成功 |
| 外层完成状态 | `completed`，**5 turns / 5 requests** |
| `lastEvent` | `run_completed:5:completed` |
| `productionLoopUnchanged` | **true** |
| `tempRemoved` | **true** |

修复前的非零退出码是被测旧副本的预期证据，不是 Demo 自身失败。整个 `npm run demo:d018` 在证据全部满足后以 0 退出；若先红、后绿、文件一致或生产源码不变任一条件被破坏，脚本会主动失败。

### 6.2 本次完整验证结果

| 命令 | 实际通过结果 |
| --- | --- |
| `npm run demo:d018` | 旧副本回归失败、修复后通过；外层 `completed / 5 turns / 5 requests`，临时目录已清理 |
| `npm run check` | ESLint、`tsc --noEmit` 和全量 Vitest 均通过 |
| 全量测试 | **19 个文件、171 项测试通过，0 失败** |
| `npm run test:coverage` | 同样 **19/19 文件、171/171 测试通过** |

本次 V8 覆盖率实测为：

| Statements | Branches | Functions | Lines | `src/runtime/loop.ts` |
| --- | --- | --- | --- | --- |
| 96.61% | 91.72% | 98.07% | 97.89% | 语句 / 分支 / 函数 / 行均 100% |

这些数字只描述当前仓库、当前测试集合的本次运行，不是性能测试，也不是真实模型成功率。命令输出中只有本机 npm 关于未知 `home` 配置的既有 warning，没有测试失败、类型错误或 ESLint 错误。

## 七、读者练习：把“看懂”变成“能推翻”

### 练习 1：只跑 FP-07，写出你自己的事件顺序

```bash
npx vitest run test/d017-failure-paths.test.ts -t "FP-07"
```

不要只看最后的通过标记。回到测试源码，找出以下断言各自排除了什么错误解释：

- `requests` 长度为 1；
- Registry 结果仍为 `COMMAND_CANCELLED`；
- 最后一条历史仍为 tool 消息；
- 最后事件为 `run_cancelled`；
- 事件中不存在 `run_completed(tool_errors)`。

目标：能不看本文，独立画出失败与修复两条时序。

### 练习 2：为什么把错误上限从 1 调成 2 不是修复？

在旧实现里，第一次 `COMMAND_CANCELLED` 不再立刻触发保险丝，Loop 会进入第 2 轮，并在轮首取消检查处返回 `cancelled`。

如果只看 `stopReason`，缺陷似乎消失了；但 `turns` 会从期望的 1 变成 2，还多走了一次轮次边界。这说明调高阈值只是推迟或遮蔽冲突，没有建立“工具结果后立即服从取消”的规则。

目标：解释“让某个测试变绿”和“修正语义”有什么区别。

### 练习 3：在自己的临时实验副本中挪动三行检查

分别预测、再验证：

1. 移到 tool 消息入历史之前：哪条历史断言会失败？
2. 移到连续错误保险丝之后：为什么又得到 `tool_errors`？
3. 删除检查后，D018 的哪个字段首先证明旧副本仍然是红的？

不要直接改本课程分支的生产文件；用临时副本做实验即可。

目标：理解代码位置本身就是语义，而不只是风格。

### 练习 4：设计一个“工具成功，但信号已取消”的场景

让假工具在 `abort()` 后返回 `isError: false` 的结果。根据当前实现推断：

- tool 消息是否保留；
- 连续错误计数是否重要；
- 整个 run 应该返回什么停止原因。

目标：证明当前修复依赖的是 `AbortSignal`，不是对 `COMMAND_CANCELLED` 的字符串特判。

### 练习 5：审计 Demo，而不是复述 Demo

运行 `npm run demo:d018`，尝试找出至少四个独立字段，分别证明：

- 旧缺陷确实出现；
- 修复确实由精确编辑完成；
- 当前生产源码没有被改坏；
- 临时目录没有遗留。

目标：把“程序说成功”改写成“哪些证据使失败解释无法成立”。

## 八、常见误区

### 误区 1：`isError: true` 就应该立刻抛异常

不一定。文件不存在、命令非零退出等可以成为 Provider 下一轮的反馈。真正需要防止的是无限失败，所以才有连续错误保险丝。Provider 故障和外部取消则走各自不同的语义通道。

### 误区 2：`COMMAND_CANCELLED` 和 `cancelled` 是重复状态，可以删掉一个

它们描述不同层级：前者说明一次命令如何结束，后者说明整个 run 为什么停止。保留工具诊断，同时让 run 服从外部取消，才是完整证据。

### 误区 3：取消后无需保留 tool 消息，反正不会再问模型

消息历史不仅服务下一次 Provider 请求，也服务调用方诊断、事件关联和回放。取消不应把已发生的工具结果从历史中抹掉。

### 误区 4：把 maxConsecutiveToolErrors 调大就能解决取消问题

这只能改变保险丝何时触发，不能表达取消优先级，还可能引入额外轮次或别的停止原因。正确修复是调整判断顺序，而不是绕开触发条件。

### 误区 5：外层 completed 与内层 cancelled 相互矛盾

外层是修复流程，内层是被修复项目的取消回归。阅读任何 Agent 报告都要先问：这个状态属于哪一层、哪一个 run？

### 误区 6：Demo 跑通就证明真实模型能自主修复

D018 的动作序列由脚本预先给定。它证明真实 Loop、Registry、文件/命令/编辑工具和测试证据可以闭环，不证明真实模型会独立选择同样动作。

### 误区 7：100% 的 loop.ts 覆盖率代表所有系统语义都已证明

覆盖率说明执行过哪些代码，不等于覆盖所有时序、工具、并行场景或真实 Provider。FP-07 的价值恰恰在于一个具体的时序断言，而不是单纯提高百分比。

## 九、能力边界与不做的事情

- **脚本化 Provider 不等于真实模型。** 本次 Demo 不调用真实 ARK，不声称 ARK 修复成功，也不给出模型成功率、时延或性能数据。
- **临时副本不等于安全沙箱。** `run_command` 通过本机系统 shell 执行命令；Demo 只运行固定的 Node 回归测试和可取消子进程，不执行任意外部输入。临时目录用于隔离文件修改，不提供权限隔离、网络隔离或资源隔离。
- **取消是协作式的。** Provider 和工具需要响应 signal，Loop 在边界检查 signal；本实现不承诺强行中断一个永远不返回、也不监听取消的任意工具。
- **单次回归不等于通用修复能力。** 本文没有新增并行工具、自动重试、通用修复规划或所有取消路径的证明。相关失败语义仍由 D017 矩阵与既有测试共同支撑。
- **没有已制作视频。** 本日交付只有长文和已有可执行 Demo，不提供虚构视频链接、观看量或学习数据。
- **没有外部事故叙事。** 不创建 GitHub issue，不虚构用户反馈、发布量或线上影响。

## 十、D019 的 TDD 说明

D019 只修改这份教学 README，**没有生产代码变更，因此没有本日新增的 RED，也不伪造一次 RED/GREEN 过程**。

文中出现的 RED 有两类明确来源：

1. D017 旧实现中 FP-07 的真实语义失败：实际 `tool_errors`，期望 `cancelled`；
2. D018 在临时副本中重新注入旧缺陷后，可重复运行的修复前失败与修复后通过。

本日运行的 `npm run check` 和 `npm run test:coverage` 是对既有代码与文档所依据事实的回归验证，不冒充新功能测试。

## 结语：闭环不是“最后绿了”这么简单

一次可信的 Agent 修复，不只是把失败测试变成通过测试。它还要保留一条能够审计的因果链：

```text
失败被分类
  → 最小场景可重复
  → 工具结果成为证据
  → 外部取消不被保险丝覆盖
  → 最小修复通过同一回归
  → 历史、事件、文件和清理状态互相印证
  → 证据边界仍然清楚
```

这就是本例最重要的设计原则：**让错误成为可处理的数据，让取消保持控制优先级，让每一次“修好了”都有可以被重新运行和反驳的证据。**
