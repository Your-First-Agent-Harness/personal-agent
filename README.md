# D014 · 标准工具错误与连续错误保险丝

## 今天要做出的东西

- 为所有工具定义统一的 `ToolErrorCode`、`ToolErrorDetail` 和 `ToolResult.error`，让错误既能回喂模型，也能被程序判断。
- Registry 在执行工具前完成 JSON 解析和 JSON Schema 子集校验；参数不合法时，工具执行次数保持为零。
- 文件、目录、编辑和命令工具使用稳定错误码，不再把预期失败混成不透明的异常。
- Loop 统计整个 run 中的连续工具错误，默认连续三次后停止后续工具与 Provider 请求。
- 配置、CLI 和 Logger 都识别 `tool_errors`；未知异常统一脱敏为 `INTERNAL_ERROR`。

## 一个 ToolResult 有两条输出通道

`content` 和 `isError` 继续承担 Provider 的模型线格式，新增的 `error` 是 Harness 内部使用的机器可读详情。**Provider 不需要理解内部错误码，也不会收到 `error` 对象。**

例如，缺少必填参数时，结果形状如下：

```json
{
  "content": "参数校验失败：$.value，缺少必填字段（期望 必填字段）\n提示：请修正 $.value：期望 必填字段；缺少必填字段",
  "isError": true,
  "error": {
    "code": "INVALID_ARGUMENTS",
    "message": "参数校验失败：$.value，缺少必填字段（期望 必填字段）",
    "retryable": true,
    "hint": "请修正 $.value：期望 必填字段；缺少必填字段"
  }
}
```

Loop 只把 `content` 写入对应的 `role: "tool"` 消息。`run_command` 也遵守这一边界：它的 `content` 仍是原来的 JSON，保留 `command`、`exitCode`、`timedOut`、`cancelled`、stdout/stderr 及截断标记，结构化错误只放在外层 `ToolResult.error`。

已知 `ToolError` 保留 `code/message/retryable/hint`。未知异常不会把原始 message 或 stack 回喂模型，而是统一变成：

```text
INTERNAL_ERROR · 工具执行失败，请检查输入后重试
```

## Registry 的固定错误管线

每次调用严格按以下顺序处理：

1. 按名称查工具；不存在则返回 `UNKNOWN_TOOL`。
2. 解析 `arguments`；空字符串视为 `{}`，非法 JSON 返回 `INVALID_JSON`，且不回显原始非法输入。
3. 调用 `validateArguments`；失败返回带字段路径和期望值的 `INVALID_ARGUMENTS`，绝不执行工具。
4. 调用 `tool.execute`。
5. 捕获执行异常并经过 `normalizeError`；已知错误保留详情，未知错误脱敏。

因此，工具失败通常不是 Loop 异常，而是一次可回喂的 `ToolResult`。模型能在下一次请求中看到可读错误并修正参数。

## 支持的 JSON Schema 子集

本日只实现以下能力：

| 能力 | 行为 |
| --- | --- |
| `type` | `object`、`string`、`number`、`integer`、`boolean` |
| `required` | 检查对象必填字段 |
| `properties` | 递归校验嵌套字段，路径形如 `$.profile.name` |
| `additionalProperties: false` | 拒绝未声明字段 |
| `enum` | 使用 `Object.is` 判断允许值 |

`object` 不接受 `null` 或数组，`number` 必须是有限数，`integer` 必须通过 `Number.isInteger`。未知关键字直接忽略。

这不是完整 JSON Schema：数组、组合Schema、`$ref`、格式与数值范围等高级能力不在本日范围内。比如 `timeoutMs` 的 1–30000 范围仍由 `run_command` 自己做语义校验。

## 内置工具错误码

| 场景 | 错误码 | 可重试 |
| --- | --- | --- |
| 路径越出工作区 | `PATH_OUTSIDE_WORKSPACE` | 是 |
| 文件不存在 / 非普通文件 | `FILE_NOT_FOUND` / `NOT_A_FILE` | 是 |
| 目录不存在 / 非目录 | `DIRECTORY_NOT_FOUND` / `NOT_A_DIRECTORY` | 是 |
| 默认拒绝覆盖 / 父目录不可用 | `FILE_EXISTS` / `PARENT_NOT_FOUND` | 是 |
| 编辑零匹配 / 多匹配 | `EDIT_NO_MATCH` / `EDIT_MULTIPLE_MATCHES` | 是 |
| 编辑超过 2000 行 | `DIFF_TOO_LARGE` | 否 |
| 命令非零退出或启动失败 | `COMMAND_FAILED` | 是 |
| 命令超时 / 外部取消 | `COMMAND_TIMEOUT` / `COMMAND_CANCELLED` | 是 / 否 |
| 未识别的内部异常 | `INTERNAL_ERROR` | 是 |

路径保护抛出 `ToolError`，由 Registry 统一转换；其他预期失败通常直接通过 `toolError(...)` 返回。失败时原有的文件安全边界不变：拒绝覆盖、编辑失败和超大 diff 都不会改动原文件。

## 连续错误保险丝的状态转换

计数器属于整个 run，而不是某个 turn：

```text
工具成功：consecutive = 0，继续
工具失败：consecutive += 1
  ├─ consecutive < 上限：错误 content 入历史，继续后续工具或下一次 Provider 请求
  └─ consecutive ≥ 上限：写入当前 tool 消息后立即停止
```

达到上限时，Loop：

- 发出 `run_completed`，其 `stopReason` 为 `tool_errors`；
- 返回 `stopReason: "tool_errors"`、`text: ""`、完整消息历史、累计 usage 和 turns；
- 不执行同一轮剩余工具，也不再请求 Provider。

默认上限为 3。序列 `fail → fail → success → fail → fail → fail` 中，success 会把计数清零，因此六个调用全部执行后才停止，而不是在第三个调用提前停止。

配置优先级仍为 **默认值 < `agent.config.json` < `PA_*` 环境变量**：

```json
{
  "agent": {
    "maxConsecutiveToolErrors": 5
  }
}
```

也可设置 `PA_MAX_CONSECUTIVE_TOOL_ERRORS=5`。值必须是正整数；省略时默认 3。

CLI 的一次性提问和 REPL 共用 `runTurn`，触发保险丝时都会输出：

```text
连续工具错误达到上限，任务未收敛，请检查最后的工具错误。
```

Logger 对同一事件记录 `warn("loop.tool_errors", { turn })`，不会把它误记为正常完成。

## 怎么复现

```bash
git switch D014
npm install
npx vitest run test/errors.test.ts
npx vitest run test/tool-errors.test.ts
npx vitest run test/config.test.ts
```

只复现某个教学示例：

```bash
npx vitest run test/errors.test.ts -t "缺少必填参数"
npx vitest run test/errors.test.ts -t "未知异常"
npx vitest run test/tool-errors.test.ts -t "默认连续三次"
npx vitest run test/tool-errors.test.ts -t "成功工具清零"
npx vitest run test/tool-errors.test.ts -t "CLI 连续错误输出"
```

完整验证：

```bash
npm run check
npm run test:coverage
```

测试使用脚本化 Provider、临时工作区和本地 HTTP 服务，不需要真实模型。脱敏与 CLI 测试只使用伪造密钥字符串，不读取真实 `.env`。

## 今天的边界

本日不实现完整 JSON Schema、并行工具、命令沙箱或真实 ARK 集成验证。保险丝只按 `isError` 统计连续失败，不判断具体错误码；取消仍沿用 D009 的独立语义，`COMMAND_CANCELLED` 不会被误报为超时。
