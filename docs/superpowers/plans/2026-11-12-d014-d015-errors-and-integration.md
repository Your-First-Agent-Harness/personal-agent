# D014–D015 Errors And Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 统一工具错误语义与 Schema 参数校验，加入连续错误保险丝，并用确定性测试和真实 ARK 运行验证完整修复闭环。

**Architecture:** `core` 定义可序列化错误详情和 `ToolError`；Registry 在执行前完成 JSON 与 Schema 校验，并把已知/未知异常安全地转换成 ToolResult。Loop 只观察 `isError` 计算连续失败，不理解具体工具；D015 用真实内置工具、临时项目和脚本化 Provider 做端到端验收，真实模型脚本不进 CI。

**Tech Stack:** Node 24、TypeScript、Vitest、JSON Schema 子集、OpenAI-compatible ARK、零运行时依赖。

**前置：** 已完成 `2026-11-12-d011-d013-workspace-tools.md`，D013 已合并 main。

**规格：** `docs/superpowers/specs/2026-11-12-d006-d015-course-design.md` D014–D015、统一错误与数据流、测试与交付策略。

---

## 文件结构

- `src/core/tool.ts`：`ToolErrorCode`、`ToolErrorDetail`、`ToolError`、`ToolResult.error`。
- `src/tools/errors.ts`：把 ToolError 转为模型可读且机器可读的 ToolResult。
- `src/tools/schema.ts`：object/string/number/integer/boolean、required/properties/additionalProperties/enum 校验。
- `src/tools/registry.ts`：未知工具、非法 JSON、执行前参数校验、异常脱敏。
- `src/tools/{workspace,fs,write-file,edit-file,run-command}.ts`：统一预期错误码。
- `src/runtime/loop.ts`：`maxConsecutiveToolErrors` 与 `tool_errors` 停止原因。
- `src/adapters/config.ts`：三层配置及默认值 3。
- `src/cli/main.ts`：传入保险丝配置并输出未收敛原因。
- `test/{errors,tool-errors}.test.ts`：Schema、错误脱敏和保险丝。
- `test/d015-integration.test.ts`：确定性修复闭环。
- `scripts/d015-real-ark.ts`：隔离临时目录的真实 ARK 验证，不参与 CI。

### Task 1：D014 标准错误与连续错误保险丝

**Files:**
- Modify: `src/core/tool.ts`
- Create: `src/tools/errors.ts`
- Create: `src/tools/schema.ts`
- Modify: `src/tools/registry.ts`
- Modify: `src/tools/workspace.ts`
- Modify: `src/tools/fs.ts`
- Modify: `src/tools/write-file.ts`
- Modify: `src/tools/edit-file.ts`
- Modify: `src/tools/run-command.ts`
- Modify: `src/core/event.ts`
- Modify: `src/observability/event-sink.ts`
- Modify: `src/runtime/loop.ts`
- Modify: `src/adapters/config.ts`
- Modify: `src/cli/main.ts`
- Test: `test/errors.test.ts`
- Test: `test/tool-errors.test.ts`
- Modify: `test/config.test.ts`
- Modify: `README.md`

- [ ] **Step 1：创建 D014，写 Schema 与错误结构失败测试**

```bash
git checkout D013
git checkout -b D014
```

在 `test/errors.test.ts` 注册一个带执行计数器的工具：Schema 要求 object、`value` 为必填 string、允许 `mode` enum `['fast','safe']`、additionalProperties false。加入以下测试：

```ts
it('缺少必填参数时不进入工具执行', async () => {
  const { registry, calls } = registryWithSchemaTool();
  const result = await registry.execute(
    { id: 'c1', name: 'typed', arguments: '{}' },
    { workspaceRoot: '.' },
  );
  expect(calls).toBe(0);
  expect(result.isError).toBe(true);
  expect(result.error).toMatchObject({ code: 'INVALID_ARGUMENTS', retryable: true });
  expect(result.error?.hint).toContain('value');
});

it('错误类型、额外字段和 enum 均在执行前拒绝', async () => {
  const { registry, calls } = registryWithSchemaTool();
  for (const args of [{ value: 1 }, { value: 'x', extra: true }, { value: 'x', mode: 'bad' }]) {
    const result = await registry.execute(
      { id: JSON.stringify(args), name: 'typed', arguments: JSON.stringify(args) },
      { workspaceRoot: '.' },
    );
    expect(result.error?.code).toBe('INVALID_ARGUMENTS');
  }
  expect(calls).toBe(0);
});

it('未知异常不泄露堆栈、密钥或原始异常正文', async () => {
  const registry = new ToolRegistry();
  registry.register({
    name: 'boom', description: 'x', parameters: { type: 'object' },
    execute: () => Promise.reject(new Error('stack trace sk-real-secret')),
  });
  const result = await registry.execute({ id: 'c1', name: 'boom', arguments: '{}' }, { workspaceRoot: '.' });
  expect(result.error?.code).toBe('INTERNAL_ERROR');
  expect(result.content).not.toContain('sk-real-secret');
  expect(result.content).not.toContain('stack trace');
});
```

另测非法 JSON 的 code 为 `INVALID_JSON`、未知工具为 `UNKNOWN_TOOL`，两者均有模型可读 hint。直接测试 `validateArguments`，覆盖 string/number/integer/boolean/object 和嵌套 properties 的路径 `$.profile.name`。

- [ ] **Step 2：运行测试确认失败，再定义错误契约**

```bash
npx vitest run test/errors.test.ts
```

在 `src/core/tool.ts` 增加：

```ts
export type ToolErrorCode =
  | 'UNKNOWN_TOOL' | 'INVALID_JSON' | 'INVALID_ARGUMENTS'
  | 'PATH_OUTSIDE_WORKSPACE' | 'FILE_NOT_FOUND' | 'NOT_A_FILE'
  | 'DIRECTORY_NOT_FOUND' | 'NOT_A_DIRECTORY' | 'FILE_EXISTS' | 'PARENT_NOT_FOUND'
  | 'EDIT_NO_MATCH' | 'EDIT_MULTIPLE_MATCHES' | 'DIFF_TOO_LARGE'
  | 'COMMAND_FAILED' | 'COMMAND_TIMEOUT' | 'COMMAND_CANCELLED' | 'INTERNAL_ERROR';

export interface ToolErrorDetail {
  readonly code: ToolErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly hint?: string;
}

export class ToolError extends Error {
  constructor(
    readonly code: ToolErrorCode,
    message: string,
    readonly retryable: boolean,
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'ToolError';
  }
}
```

`ToolResult` 增加 `readonly error?: ToolErrorDetail`；`ToolContext.signal` 保持 D009 契约。

创建 `src/tools/errors.ts`：

```ts
import { ToolError, type ToolErrorCode, type ToolResult } from '../core/tool.ts';

export function errorResult(error: ToolError): ToolResult {
  return {
    content: error.hint === undefined ? error.message : `${error.message}\n提示：${error.hint}`,
    isError: true,
    error: { code: error.code, message: error.message, retryable: error.retryable, ...(error.hint === undefined ? {} : { hint: error.hint }) },
  };
}

export function toolError(code: ToolErrorCode, message: string, retryable: boolean, hint?: string): ToolResult {
  return errorResult(new ToolError(code, message, retryable, hint));
}

export function normalizeError(error: unknown): ToolError {
  return error instanceof ToolError
    ? error
    : new ToolError('INTERNAL_ERROR', '工具执行失败，请检查输入后重试', true, '可读取相关文件或修正参数后重试');
}
```

- [ ] **Step 3：实现 JSON Schema 子集并接入 Registry**

创建 `src/tools/schema.ts`，完整实现如下；不支持的 schema 关键字直接忽略，不宣称完整 JSON Schema：

```ts
export interface SchemaIssue {
  readonly path: string;
  readonly expected: string;
  readonly message: string;
}

function matchesType(type: string, value: unknown): boolean {
  switch (type) {
    case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value);
    case 'string': return typeof value === 'string';
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'integer': return typeof value === 'number' && Number.isInteger(value);
    case 'boolean': return typeof value === 'boolean';
    default: return true;
  }
}

function validateNode(schema: Record<string, unknown>, value: unknown, path: string): SchemaIssue | undefined {
  const enumValues = schema['enum'];
  if (Array.isArray(enumValues) && !enumValues.some((candidate) => Object.is(candidate, value))) {
    return { path, expected: enumValues.map(String).join(' / '), message: '不是允许的枚举值' };
  }

  const type = schema['type'];
  if (typeof type === 'string' && !matchesType(type, value)) {
    return { path, expected: type, message: `期望 ${type}，实际为 ${Array.isArray(value) ? 'array' : typeof value}` };
  }
  if (type !== 'object') return undefined;

  const record = value as Record<string, unknown>;
  const rawProperties = schema['properties'];
  const properties = rawProperties !== null && typeof rawProperties === 'object' && !Array.isArray(rawProperties)
    ? rawProperties as Record<string, Record<string, unknown>>
    : {};
  const required = Array.isArray(schema['required'])
    ? schema['required'].filter((key): key is string => typeof key === 'string')
    : [];

  for (const key of required) {
    if (!Object.hasOwn(record, key)) {
      return { path: `${path}.${key}`, expected: '必填字段', message: '缺少必填字段' };
    }
  }
  if (schema['additionalProperties'] === false) {
    for (const key of Object.keys(record)) {
      if (!Object.hasOwn(properties, key)) {
        return { path: `${path}.${key}`, expected: `仅允许 ${Object.keys(properties).join(', ')}`, message: '存在额外字段' };
      }
    }
  }
  for (const [key, propertySchema] of Object.entries(properties)) {
    if (!Object.hasOwn(record, key)) continue;
    const issue = validateNode(propertySchema, record[key], `${path}.${key}`);
    if (issue !== undefined) return issue;
  }
  return undefined;
}

export function validateArguments(schema: Record<string, unknown>, value: unknown): SchemaIssue | undefined {
  return validateNode(schema, value, '$');
}
```

Registry 顺序固定为：查工具 → JSON.parse（空串视为 `{}`）→ `validateArguments` → `tool.execute` → catch `normalizeError`。校验失败返回 `INVALID_ARGUMENTS`，content/hint 包含字段路径与期望值。所有已知 ToolError 用 `errorResult`，未知异常只返回脱敏的 INTERNAL_ERROR。

- [ ] **Step 4：统一现有工具错误码**

按映射修改工具，不改变成功结果：

| 场景 | code | retryable |
|---|---|---|
| 路径越界 | PATH_OUTSIDE_WORKSPACE | true |
| 文件不存在 / 非文件 | FILE_NOT_FOUND / NOT_A_FILE | true |
| 目录不存在 / 非目录 | DIRECTORY_NOT_FOUND / NOT_A_DIRECTORY | true |
| 默认拒绝覆盖 / 父目录缺失 | FILE_EXISTS / PARENT_NOT_FOUND | true |
| 编辑零匹配 / 多匹配 / 超 2000 行 | EDIT_NO_MATCH / EDIT_MULTIPLE_MATCHES / DIFF_TOO_LARGE | true / true / false |
| 命令非零 / 超时 / 外部取消 | COMMAND_FAILED / COMMAND_TIMEOUT / COMMAND_CANCELLED | true / true / false |

预期失败用 `toolError(...)` 返回；路径保护抛 `ToolError`，由 Registry 转换。run_command 的 JSON content 保留原字段，同时附加 `error` 详情到 ToolResult；不要把内部错误码塞进 Provider 协议。

- [ ] **Step 5：写连续错误保险丝失败测试**

在 `test/tool-errors.test.ts` 写两个场景：

```ts
it('连续三次工具错误后以 tool_errors 停止', async () => {
  const { provider, requests } = scriptedProvider(alwaysFailingToolCall());
  const result = await runAgentLoop({
    provider, registry: registryWithAlwaysFailingTool(), messages: [{ role: 'user', content: 'go' }],
    maxTurns: 10, maxTokens: 128, workspaceRoot: '.', maxConsecutiveToolErrors: 3,
  });
  expect(result.stopReason).toBe('tool_errors');
  expect(result.turns).toBe(3);
  expect(requests).toHaveLength(3);
});
```

第二个测试在同一轮按 `fail, fail, success, fail, fail, fail` 调用工具；若无清零会在第三次停止，正确实现必须执行全部 6 次后才停止。另测成功工具结果不带 error，失败 tool 消息 content 仍回喂下一次请求。

- [ ] **Step 6：实现保险丝、配置和 CLI 未收敛输出**

`AgentStopReason` 增加 `'tool_errors'`。`AgentLoopOptions` 增加 `maxConsecutiveToolErrors?: number`，默认 3；每轮从 0 之前的局部计数移到整个 run 的 `let consecutiveToolErrors = 0`。每个工具结果入历史后：isError 则加 1，否则清零；达到上限发 `{ type:'run_completed', stopReason:'tool_errors' }` 并返回 `text: ''`。

`AppConfig.agent` 增加 `maxConsecutiveToolErrors`，默认 3，文件键 `agent.maxConsecutiveToolErrors`，环境键 `PA_MAX_CONSECUTIVE_TOOL_ERRORS`，复用正整数校验。配置测试覆盖默认值、环境覆盖和 0 报错。CLI 传入配置，并对 tool_errors 输出：`连续工具错误达到上限，任务未收敛，请检查最后的工具错误。` Logger 事件适配器对 `run_completed.stopReason === 'tool_errors'` 使用 `logger.warn('loop.tool_errors', { turn })`，不得记录成正常完成。

- [ ] **Step 7：全量验证、README 和每日合并**

```bash
npm run check
npm run test:coverage
```

README 给出错误 JSON 示例、支持的 Schema 子集和保险丝状态转换，明确不支持完整 JSON Schema。提交 `feat(D014): standardize tool errors and stop error loops`，推送 D014，合并 main；索引日期 `2026-11-24`，产出写 `ToolError、Schema 校验、连续错误保险丝`，进度改为 D014 / D100。

### Task 2：D015 综合修复 Demo 与真实 ARK 验证

**Files:**
- Create: `test/d015-integration.test.ts`
- Create: `scripts/d015-real-ark.ts`
- Modify: `package.json`
- Modify: `package-lock.json`（仅脚本元数据变化时，无变化则不提交）
- Modify: `README.md`
- Modify: `README.md`（main 仅索引）

- [ ] **Step 1：创建 D015，写确定性的端到端失败测试**

```bash
git checkout D014
git checkout -b D015
```

`test/d015-integration.test.ts` 在临时目录创建：

```js
// math.js
export function add(a, b) { return a - b; }

// math.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { add } from './math.js';
test('add', () => { assert.equal(add(2, 2), 4); });
```

脚本化 Provider 依次返回五个 ChatResult：

1. `read_file`，arguments `{"path":"math.js"}`；
2. `run_command`，command 为 `JSON.stringify(process.execPath) + ' --test math.test.js'`；
3. `edit_file`，把 `return a - b` 改为 `return a + b`；
4. 再次运行同一测试命令；
5. 最终文本 `修复完成，测试已通过`。

测试使用真实 `createBuiltinTools()`、Session、`runAgentLoop`、事件收集器，配置 `maxTurns: 8`、`maxContextChars: 24000`、`maxConsecutiveToolErrors: 3`。Provider 每次记录请求快照。

- [ ] **Step 2：运行测试并确认基线行为无法直接满足集成断言**

```bash
npx vitest run test/d015-integration.test.ts
```

若前五日实现已使闭环直接通过，不刻意制造失败；记录此为 characterization/integration test 的首次通过。若失败，依据具体断言修复前五日缺陷，不修改临时项目的预期结果。

- [ ] **Step 3：完成集成断言**

断言全部满足：

```ts
expect(result.stopReason).toBe('completed');
expect(result.text).toBe('修复完成，测试已通过');
expect(readFileSync(join(root, 'math.js'), 'utf8')).toContain('return a + b');

const failedRun = requests[2]?.messages.filter((message) => message.role === 'tool').at(-1);
expect(failedRun?.content).toContain('"exitCode":1');
expect(failedRun?.content).toContain('failing');

expect(events.map((event) => event.type)).toContain('tool_call_finished');
expect(events.at(-1)).toMatchObject({ type: 'run_completed', stopReason: 'completed' });
expect(session.snapshot()).toEqual(result.messages);
```

另外检查第二次 run_command 的 ToolResult 可由 Provider 在最终请求中看到 `exitCode: 0`，完整 Session 含 read/command/edit/command 的全部 assistant/tool 配对，错误事件 `isError: true` 出现在首次测试之后，且测试结束清理临时目录。

- [ ] **Step 4：创建真实 ARK 验证脚本**

`scripts/d015-real-ark.ts` 直接组合现有生产模块，不复制 Loop：

```ts
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadConfig } from '../src/adapters/config.ts';
import { createOpenAICompatibleProvider } from '../src/adapters/model/openai-compatible.ts';
import { runAgentLoop } from '../src/runtime/loop.ts';
import { createBuiltinTools } from '../src/tools/builtin.ts';
import { ToolRegistry } from '../src/tools/registry.ts';

const testSource = [
  "import assert from 'node:assert/strict';",
  "import { test } from 'node:test';",
  "import { add } from './math.js';",
  "test('add', () => { assert.equal(add(2, 2), 4); });",
  '',
].join('\n');

const config = loadConfig();
if (config.model.provider !== 'openai-compatible' || config.model.apiKey === undefined) {
  throw new Error('请在 .env 配置 PA_MODEL_API_KEY、ARK base URL 和模型名');
}
const root = mkdtempSync(join(tmpdir(), 'pa-d015-ark-'));
try {
  writeFileSync(join(root, 'math.js'), 'export function add(a, b) { return a - b; }\n');
  writeFileSync(join(root, 'math.test.js'), testSource);
  const provider = createOpenAICompatibleProvider({
    baseUrl: config.model.baseUrl ?? 'https://ark.cn-beijing.volces.com/api/v3',
    apiKey: config.model.apiKey,
    model: config.model.name,
  });
  const registry = new ToolRegistry();
  for (const tool of createBuiltinTools()) registry.register(tool);
  const result = await runAgentLoop({
    provider,
    registry,
    messages: [
      { role: 'system', content: '你是修复助手。必须读取文件、运行测试、精确编辑并复测，不要编造结果。' },
      { role: 'user', content: '修复当前工作区的 math.js，使 node --test math.test.js 通过。' },
    ],
    maxTurns: config.agent.maxTurns,
    maxTokens: config.agent.maxTokensPerTurn,
    maxContextChars: config.agent.maxContextChars,
    maxConsecutiveToolErrors: config.agent.maxConsecutiveToolErrors,
    workspaceRoot: root,
    eventSink: { emit: (event) => process.stdout.write(`${JSON.stringify(event)}\n`) },
  });
  const verification = spawnSync(process.execPath, ['--test', 'math.test.js'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 10_000,
  });
  process.stdout.write(`${JSON.stringify({
    stopReason: result.stopReason,
    turns: result.turns,
    text: result.text,
    verificationExitCode: verification.status,
    verificationStdout: verification.stdout,
    verificationStderr: verification.stderr,
  })}\n`);
  if (result.stopReason !== 'completed' || verification.status !== 0) process.exitCode = 1;
} finally {
  rmSync(root, { recursive: true, force: true });
}
```

`package.json` 增加 `"demo:d015": "node --env-file-if-exists=.env scripts/d015-real-ark.ts"`。脚本不输出 apiKey，不读课程仓库外的真实文件，临时目录在 finally 清理；最终测试由脚本独立复跑，不能只相信模型的完成声明。

- [ ] **Step 5：运行真实 ARK 验证并记录实际结果**

先执行确定性检查，再运行真实脚本：

```bash
npm run check
npm run test:coverage
PA_MODEL_BASE_URL=https://ark.cn-beijing.volces.com/api/v3 npm run demo:d015
```

真实 `.env` 提供 ARK endpoint 对应的模型名和密钥，不在终端打印密钥。把实际日期、模型名、turns、stopReason、首次测试失败→编辑→复测成功的事件顺序写入 D015 README；若真实模型未收敛，如实记录事件和失败原因，不伪造成功，也不把该不确定性加入 CI。

- [ ] **Step 6：完成 D015 教学 README 与总验收**

README 串讲数据流：Session 完整历史 → buildContext 请求窗口 → AgentEvent → Registry 校验 → ToolResult error → 错误回喂/成功继续 → 连续错误保险丝。给出确定性和真实 ARK 两条复现命令。

最终执行：

```bash
npm run check
npm run test:coverage
git status --short
```

确认 coverage 和临时项目未进入 Git。提交 `test(D015): verify end-to-end workspace repair`，推送 D015，合并 main；README 冲突保留 main 索引版。main 索引日期 `2026-11-25`，产出写 `确定性修复闭环、真实 ARK 验证`，进度改为 D015 / D100，提交 `docs: index D015` 并推送 main。

## 自检

- 规格覆盖：未知工具、非法 JSON、必填/类型/额外字段/enum、错误脱敏、连续三次与成功清零、CLI 未收敛、修复前后命令结果、事件/历史/错误码、真实 ARK 均有任务。
- 类型衔接：`ToolErrorDetail` 是 Provider 不需要理解的内部结构；D009 `cancelled` 与 D014 `tool_errors` 都通过既有 AgentStopReason/事件输出；D015 使用 D007 Session 和 D008 配置。
- 安全边界：真实密钥只从 `.env` 读取；未知异常正文不回喂；所有修复在临时目录；真实模型结果不作为 CI 断言。
- 范围控制：未加入完整 JSON Schema、并行工具、沙箱、磁盘 Session、Replay 或 D016+ 内容。
