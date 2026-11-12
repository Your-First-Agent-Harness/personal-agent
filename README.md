# D016 · 非法参数处理：校验 → 修复提示 → 重试上限 → 放弃

> 课程日期：2026-11-26

## 今天的目标

今天不新增一套参数校验器，而是用端到端回归测试证明已有的“非法参数恢复闭环”真正成立：

1. 模型给出非法 JSON，错误作为 tool 消息回喂；下一轮修正为合法参数后，工具真实执行成功，最终 `completed`。
2. 模型给出不符合 Schema 的参数，字段错误与修复提示回喂；下一轮修正后成功，最终 `completed`。
3. 连续三次非法参数不会让进程崩溃，也不会执行工具；Provider 恰好收到三次请求，Loop 以 `tool_errors` 停止。
4. 一次合法成功会清零此前的连续错误计数；成功之后重新累计到三次才停止。

交付物是 `test/d016-invalid-arguments.test.ts` 和本页教学内容。测试使用脚本化 Provider、真实 `ToolRegistry`、真实 `runAgentLoop` 和一个记录实际执行次数的 `echo` 工具，不访问真实模型。

## 与 D014、D015 的关系

D014 已经实现本日依赖的全部生产机制：

| 机制 | 现有位置 | 作用 |
| --- | --- | --- |
| JSON 解析 | `src/tools/registry.ts` | 解析失败返回 `INVALID_JSON`，不进入工具实现 |
| Schema 子集校验 | `src/tools/schema.ts` | 检查类型、必填字段、额外字段和枚举等子集 |
| 标准错误与 hint | `src/tools/errors.ts` | 形成 `content`、`isError` 和内部 `error` 详情 |
| 错误回喂 | `src/runtime/loop.ts` | 把每次 assistant/tool 配对加入历史，再问 Provider |
| 连续错误保险丝 | `src/runtime/loop.ts` | 默认上限为 3，成功清零，达到上限返回 `tool_errors` |

D014 的测试还覆盖了同轮 `fail → fail → success → fail → fail → fail`：通用工具错误也会被成功调用清零。D015 则验证了失败测试回喂后编辑、复测成功的综合修复流程。

D016 补的是另一层证据：**非法参数从 Provider 原始字符串出发，穿过 Registry、消息历史、下一轮 Provider 请求和终止条件**。因此本日没有重复实现 D014 的功能，也没有为了制造差异修改生产代码。

## 恢复闭环的完整时序

### 1. 坏消息不直接抛穿 Loop

模型发出的 `ToolCall.arguments` 是原始字符串。Registry 先查工具，再解析 JSON、校验 Schema，最后才调用 `execute`：

```text
Provider 返回非法 tool_call
  → Loop 保存 assistant 消息
  → Registry 解析 / 校验失败
  → 工具 execute 没有被调用
  → 得到 isError: true 的 ToolResult
  → Loop 保存对应 tool 消息，连续错误数 +1
  → 未达到上限，进入下一轮
```

非法 JSON 的模型线反馈包含：

```text
工具参数不是合法 JSON
提示：请把 arguments 修正为合法 JSON 对象
```

Schema 类型错误则指出具体路径和期望类型，例如：

```text
参数校验失败：$.value，期望 string，实际为 number（期望 string）
提示：请修正 $.value：期望 string；期望 string，实际为 number
```

`content` 是 Provider 下一轮能看到的 tool 消息；内部 `error.code/message/retryable/hint` 供 Harness 和调用方使用。测试直接检查第二次 Provider 请求的最后一条消息，而不是只检查 Registry 的单独返回值，因此能证明“修复提示确实回喂”。

### 2. 修正不是自动重放旧参数

第一轮错误不会触发 Harness 用原参数自动再执行一次。真正的恢复过程是：

```text
第 1 轮：assistant(arguments = 非法值)
         → tool(错误与 hint)
第 2 轮：Provider 看到错误
         → assistant(arguments = 修正值)
         → Registry 校验通过
         → 工具真实执行
         → tool(成功内容)，连续错误数清零
第 3 轮：Provider 看到成功结果
         → assistant(最终文本，无 tool_calls)
         → stopReason = completed
```

这里的“重试”是模型根据反馈生成一次新的工具调用。是否知道如何修正，是模型行为；是否保留错误上下文、是否阻止坏参数执行、是否设置终止上限，是 Harness 的职责。

### 3. 连续三次后放弃，而不是无限请求

Loop 对整个 run 维护一个连续错误计数：

```ts
consecutiveToolErrors = toolResult.isError === true
  ? consecutiveToolErrors + 1
  : 0;

if (consecutiveToolErrors >= maxConsecutiveToolErrors) {
  return { stopReason: 'tool_errors', /* ... */ };
}
```

默认值是 3。第三次非法参数仍然会形成 assistant/tool 历史，但不会再发起第四次 Provider 请求，也不会把异常抛给调用方。结果是 `turns: 3`、`stopReason: 'tool_errors'`、`text: ''`。

这个计数是所有连续工具错误共用的保险丝，不是“每种错误各有三次”，也不是“每个工具各有三次”。任何一次成功工具结果都会清零。

## 四个确定性测试场景

测试工具名为 `echo`，只接受一个字符串字段：

```json
{
  "type": "object",
  "properties": { "value": { "type": "string" } },
  "required": ["value"],
  "additionalProperties": false
}
```

工具的 `execute` 会记录收到的参数并返回 `echo:<value>`。所以 `executions` 既能证明合法调用真的发生，也能证明非法调用没有越过 Registry。

脚本化 Provider 按数组下标依次返回响应，同时保存每次请求的消息快照；脚本耗尽后会拒绝额外请求。Registry 和 Loop 不使用替身。

| 测试 | Provider 脚本 | 核心断言 |
| --- | --- | --- |
| 非法 JSON 后恢复 | 非法 JSON → 合法字符串参数 → 最终文本 | 第二轮请求含 `INVALID_JSON` 对应反馈和 hint；工具只执行修正后的参数；第三轮看到成功 tool 消息；最终 `completed` |
| Schema 错误后恢复 | `value: 42` → `value: "schema-ok"` → 最终文本 | 第二轮请求包含 `$.value`、期望 `string` 和字段 hint；只执行合法值；最终 `completed` |
| 三次非法参数后放弃 | 非法 JSON → 类型错误 → 缺少必填字段 | 工具执行次数为 0；Provider 恰好 3 次；三类错误依次回喂；最终 `tool_errors`，无第四次请求 |
| 成功后重新计数 | 非法 JSON → Schema 错误 → 合法成功 → 非法 JSON → Schema 错误 → 非法 JSON | 合法工具只执行一次；成功结果进入第四轮请求；运行到第 6 轮才达到新一组三次错误并以 `tool_errors` 停止 |

最后一个场景也能识别“忘记清零”的缺陷：如果第三次合法调用没有清零，第四次非法 JSON 就会凑成连续第三次错误并提前停止，不可能到达第六轮。

它与 D014 的同轮清零测试互补：D014 覆盖一轮内多个通用工具结果，D016 覆盖跨 Provider 请求的非法参数序列。

## 怎么运行

```bash
git switch D016
npm install
npx vitest run test/d016-invalid-arguments.test.ts
npm run check
npm run test:coverage
```

这些命令不需要模型密钥，也不访问真实模型。测试没有读取或写入 `.env`。

本次实际结果：

- 针对性测试：**1 个文件、4 项测试通过**。
- `npm run check`：ESLint、TypeScript 类型检查和全量测试均通过；共 **17 个测试文件、163 项测试**。
- `npm run test:coverage`：同样 **17 个测试文件、163 项测试全部通过**。

| 覆盖率指标 | 实测结果 |
| --- | ---: |
| Statements | 96.60% |
| Branches | 91.68% |
| Functions | 98.07% |
| Lines | 97.88% |
| `src/runtime/loop.ts` | 四项均为 100% |

### 为什么首次通过也保留

四个测试都是在修改任何生产代码之前编写并首次运行的，且首次运行全部通过。这说明它们描述的是 D014/D015 已经具备的行为，而不是本日新增功能。

因此本日没有人为制造 RED、没有反转断言来假装修复，也没有为了产生生产差异而改动实现。这些测试作为已存在行为的 **integration/characterization regression tests** 保留：未来如果错误不再回喂、非法参数误入工具、Provider 请求次数漂移或成功不再清零，它们会失败。

本日未进行真实模型验证，也不据此声称任何真实模型一定能自行修正参数；确定性测试验证的是 Harness 的反馈与停止机制。

## 边界与常见误解

- **Schema 校验是子集，不是完整 JSON Schema。** 本日只复用现有类型、必填字段等能力，不扩展 validator。
- **三次是 Provider 交互轮次上限，不是执行坏参数三次。** JSON 解析或 Schema 校验失败时，工具实现一次都不会执行。
- **第三次错误后没有第四次请求。** 最后一次 tool 错误仍保留在结果历史中，便于调用方诊断。
- **成功清零的是连续计数，不是删除历史。** 之前的错误消息仍在消息历史里，后续请求仍可看到完整因果链。
- **`tool_errors` 与 `max_turns` 不同。** 前者是连续工具错误保险丝，后者是模型不断要求工具时的轮数保险丝。
- **`completed` 只表示最后一轮不再调用工具。** 测试另以工具执行记录和成功 tool 内容证明本场景确实修复成功，而不只看最终文本。
- **脚本化 Provider 不证明真实模型会修复。** 它固定模型的下一步，让测试只验证 Harness 是否提供正确的恢复机会和停止条件。
