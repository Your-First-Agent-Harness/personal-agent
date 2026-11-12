# Personal Agent · D032 十个工具跑通一个真实任务

> **进度**：D032 / D100
> **版本**：`0.1.0`
> **课程日期**：2026-12-12
> **分支**：`D032`，从 D031 `99181d289e9f762f2da2f1d9f8c1a51e38d829f7` 创建
> **任务**：注册 10 个用途清晰的工具，让一个任务通过真实 AgentLoop + ToolRegistry 串联至少 4 个不同工具

D032 不再增加 Registry 机制，而是把前五天做出的工具契约、Schema、权限、错误回喂和 Loop 组合成一条可以逐帧核对的任务链：**读取发布规则，真实运行测试，只有门禁通过才生成报告，写入后再核对文件摘要。**

本日最终注册恰好 10 个工具，正常任务实际串联 9 个不同工具。所有文件读写、命令执行、TAP 解析、门禁判断、报告渲染和 SHA-256 校验都通过真实工具完成；脚本化 ModelProvider 只决定下一步调用，并从上一条 `role="tool"` 消息取出真实结果构造下一步参数。

## 本日交付

| 文件 | 内容 |
| --- | --- |
| [`src/demo/d032-tools.ts`](src/demo/d032-tools.ts) | 复用 5 个内置工具，新增 5 个内聚工具，组成恰好 10 个工具的 Demo Registry |
| [`src/demo/d032.ts`](src/demo/d032.ts) | 离线 Provider、真实 AgentLoop 编排、逐步证据、正常与失败断言、临时目录清理 |
| [`scripts/d032-multi-tool.ts`](scripts/d032-multi-tool.ts) | `demo:d032` 的可执行入口 |
| [`test/d032-multi-tool-demo.test.ts`](test/d032-multi-tool-demo.test.ts) | 注册数量、真实顺序、参数依赖、最终回答、失败门禁、Schema 和摘要异常测试 |
| [`evidence/d032-transcript.txt`](evidence/d032-transcript.txt) | 实际执行 `npm run demo:d032` 后重定向保存的终端输出，不是手写脚本 |
| [`README.md`](README.md) | 本日动机、设计取舍、工具清单、运行方式、证据和边界 |

## 1. 为什么需要多工具 Demo

单独测试一个工具，只能证明这个工具的局部契约正确。真实任务还需要回答：

1. 模型看到的工具清单是否就是 Registry 当前发现的清单？
2. 第二步拿到的是否真是第一步的输出，而不是演示程序偷偷准备的变量？
3. 工具失败是否会回喂 Loop，后续步骤能否依据失败证据改变决策？
4. 写文件之前的摘要，能否用于写文件之后的完整性校验？
5. 最终回答能否由实际步骤和结果支撑？

因此，本日不以“注册了 10 个”作为唯一完成标准，而检查一条完整消息历史：**assistant 发起 ToolCall → Registry 校验并执行 → tool 消息回喂 → 下一轮读取该消息 → 最终回答。**

## 2. 恰好 10 个工具

`createBuiltinTools()` 仍只返回原来的 5 个通用工具。`createD032Tools()` 在其上组合 5 个 Demo 工具，不改变其他任务的默认注册行为。

| # | 工具 | 清晰用途 | 本任务是否使用 |
| --- | --- | --- | --- |
| 1 | `read_file` | 读取工作区内文本；本任务读取 `quality-gate.json` | 是 |
| 2 | `list_dir` | 列出工作区内容，确认测试、源码和门禁配置的输入边界 | 是 |
| 3 | `write_file` | 把已经渲染的报告真实写入临时工作区 | 是 |
| 4 | `edit_file` | 对已有文本做精确替换；本任务没有需要修复的源码，不为了凑数调用 | 否 |
| 5 | `run_command` | 在工作区执行 Node 原生测试并返回退出码、stdout、stderr | 是 |
| 6 | `parse_tap_output` | 从上一步命令 JSON 的 stdout 提取 TAP tests/pass/fail 等汇总 | 是 |
| 7 | `evaluate_test_gate` | 根据 minPass、maxFail 和退出码给出通过/拒绝及原因 | 是 |
| 8 | `render_release_report` | 只把已通过的门禁结果渲染为确定性 Markdown | 是 |
| 9 | `sha256_text` | 在写入前计算完整报告文本的 SHA-256 | 是 |
| 10 | `verify_file_sha256` | 写入后重新读取文件，比较实际与预期 SHA-256 | 是 |

### 为什么是这 5 个新工具

它们分别承担**解析、判断、渲染、计算、核验**，不是把同一个函数换五个名字：

- 解析器不理解发布规则，只提取测试事实；
- 门禁不运行命令，只消费配置和结构化测试摘要；
- 渲染器不重新判断测试，且拒绝渲染未通过的门禁；
- 文本摘要不知道文件路径，文件核验不依赖渲染器内部状态；
- 最后的文件校验能发现“写入内容不是计算摘要时内容”的错误。

这是一种有意的粒度取舍：足够小以便独立测试和替换，又不把每个字符串操作都暴露给模型。

## 3. 正常任务的 9 步真实串联

```text
list_dir
  ↓ 确认工作区输入
read_file(quality-gate.json)
  ↓ configJson
run_command(node --test --test-reporter=tap)
  ↓ 完整命令 JSON（含 stdout / exitCode）
parse_tap_output
  ↓ summaryJson
evaluate_test_gate(configJson + summaryJson)
  ↓ passed=true 时才继续
render_release_report(gateResultJson)
  ↓ 同一份 Markdown 文本
sha256_text(text) ─────────┐
  ↓ expectedSha256         │
write_file(content)        │
  ↓                        │
verify_file_sha256(path) ←─┘
  ↓ matched=true
最终回答：2/2 通过 + 报告路径 + 实际摘要
```

关键不是工具数量，而是参数依赖。自动化测试逐项比较：

- `parse_tap_output.commandResultJson === run_command` 的原始结果；
- `evaluate_test_gate.configJson === read_file` 的原始结果；
- `evaluate_test_gate.summaryJson === parse_tap_output` 的原始结果；
- 渲染器收到门禁原始结果；
- 摘要工具和写入工具收到完全相同的渲染文本；
- 文件核验的预期值来自 `sha256_text` 的真实输出。

Provider 通过当轮 `ChatRequest.messages` 查找之前的 tool 消息，没有绕开 Harness 读取另一份隐藏结果。

## 4. 失败行为：测试红了就不能出报告

`runD032Demo(output, { fixture: 'failing' })` 使用同一套 Loop、Registry 和工具，只把临时测试改成一通过、一失败：

1. `run_command` 真实返回 `exitCode=1` 和 `isError=true`；
2. Loop 把错误结果作为 tool 消息回喂，而不是丢弃现场；
3. 解析器仍能从命令 JSON 的 TAP stdout 得到 `pass=1、fail=1`；
4. 门禁返回 `passed=false`，原因包含失败数和退出码；
5. Provider 在第五步后直接给出“发布门禁未通过……未生成报告”；
6. 不调用渲染、摘要、写入和文件核验工具，磁盘上没有发布报告。

另外，`render_release_report` 自身也拒绝 `passed !== true`，避免其他调用方绕过门禁。非法参数在执行前被 Registry 的 Schema 校验拦截；文件摘要不匹配时校验工具明确失败。

## 5. 运行方式

### 环境

- Node.js 24；本日实际使用 `v24.19.0`。
- 原生 TypeScript ESM，无 Babel、ts-node 或 tsx。
- 不请求网络，不需要 API Key，不新增运行时依赖。
- 干净检出尚未安装开发依赖时先运行 `npm ci`。

### 一键 Demo

```bash
npm run demo:d032
```

预期看到：10 个注册工具、9 个编号步骤、每步参数摘要和结果摘要、最终回答、报告正文以及 `D032 Demo PASS`。

重新生成可提交终端证据：

```bash
npm run demo:d032 > evidence/d032-transcript.txt
```

临时工作区在成功和失败路径都会清理，因此报告正文保留在终端证据中，不伪装成仍存在的临时文件。

### 定向测试

```bash
npx vitest run test/d032-multi-tool-demo.test.ts --coverage.enabled false
```

4 个测试分别覆盖：

1. 恰好 10 个名称唯一、描述和 Schema 完整的工具，非法参数被拦截；
2. 9 步正常顺序、逐步原始参数依赖、最终回答、报告、摘要和目录清理；
3. 测试失败后保留证据、门禁停止、不写报告；
4. 标准 SHA-256 向量和文件摘要不匹配。

### 全量检查与覆盖率

```bash
npm run check
npm run test:coverage
```

`check` 依次执行 ESLint、TypeScript `--noEmit` 和全部 Vitest。覆盖率阈值保持 Statements/Lines/Functions ≥ 80%、Branches ≥ 75%。

## 6. 真实证据与录屏说明

本日证据文件是 [`evidence/d032-transcript.txt`](evidence/d032-transcript.txt)。它由上述真实 `npm run demo:d032` 命令重定向生成，包含：

- 实际注册顺序；
- 实际工具调用顺序；
- 每步参数和结果摘要；
- 实际 Node TAP 解析结果；
- 实际报告文本；
- 实际 SHA-256：`dd547123cb1eb56cb69340c20aa5d4ac8fb661a884f2b0a7076667a69249603d`；
- 最终回答和 PASS 断言。

**本日未生成完整链路录屏视频。** 当前没有可靠录屏产物，所以不用静态图、拼接终端文本或口头声明冒充视频；交付物明确降级为可重跑、可 diff 的真实终端 transcript。任务卡中的录屏目标不能据此标记为已有视频证据。

## 7. 本日 TDD 记录

严格按 RED → GREEN 执行：

### RED

先创建 `test/d032-multi-tool-demo.test.ts`，再运行：

```bash
npx vitest run test/d032-multi-tool-demo.test.ts --coverage.enabled false
```

实际失败原因：

```text
Cannot find module '../src/demo/d032-tools.ts'
```

失败发生在生产模块尚不存在时，证明测试不是给既有实现补写的永久绿灯。

### GREEN

随后最小实现工具、Demo、入口和导出，再次运行同一命令：**1 个文件、4 个测试全部通过**；`npm run typecheck` 同步通过。

本日最终全量验证结果：

- `npm run check`：ESLint、TypeScript 和全量 Vitest 均通过，**37 个测试文件、340 个测试**；
- `npm run test:coverage`：同为 **37/340 全部通过**；
- Statements **93.61%**、Branches **89.41%**、Functions **99.59%**、Lines **95.22%**，全部超过项目阈值。

npm 仅输出当前环境已有的 `Unknown user config "home"` 配置提醒，不影响任何命令退出码或测试结论；本日没有修改该用户级 npm 配置。

## 8. 设计取舍与限制

- **脚本化 Provider ≠ 真实模型规划。** 本日证明 Harness 的真实串联、消息回喂和工具副作用，不声称模型在开放任务上一定能选出同样顺序。
- **离线 ≠ 工具都是纯函数。** `run_command` 和文件工具确实产生进程/文件行为；只是所有行为局限于自动创建并清理的临时工作区，且命令固定为本地 Node 测试。
- **`run_command` 不是安全沙箱。** 它经系统 shell 执行命令，不能把本 Demo 的固定命令误解为任意命令隔离能力。
- **TAP 解析是明确子集。** 当前读取 Node TAP 的 `# tests/# pass/# fail/# skipped/# todo` 汇总，不是完整 TAP 标准实现，也不是通用测试框架适配器。
- **质量门禁不是发布平台。** 只有 minPass、maxFail 和退出码规则，没有覆盖率门禁、审批、签名、部署或远端状态。
- **SHA-256 只证明内容一致。** 它不是数字签名，不能证明作者身份，也不能防御恶意工作区或恶意进程内代码。
- **10 个工具不是全局默认值。** 只有 D032 的 `createD032Tools()` 组合恰好 10 个；内置工具清单不被本日Demo污染。
- **transcript 不是性能或外部反馈证据。** 它证明本次本地执行，不证明压力表现、生产可靠性、用户采纳或公开发布。
- 版本保持 `0.1.0`；本日不实现 D033/MCP，不推进 G2/v0.3，不合并 main。

## 9. 完成标准

- [x] 恰好注册 10 个名称唯一、用途和 Schema 清晰的工具。
- [x] 一个完整任务通过真实 AgentLoop + ToolRegistry 串联 9 个不同工具，超过至少 4 个的要求。
- [x] 后续参数来自前序真实 tool 消息，输出实际顺序、参数摘要、结果摘要和最终回答。
- [x] 覆盖正常链路、精确顺序、测试失败门禁、Schema 拒绝和摘要不匹配。
- [x] 提供 `npm run demo:d032`，确定性、零新增运行时依赖、Node 24 原生 TS ESM。
- [x] 以真实终端输出生成 transcript；明确说明未生成视频，不伪造录屏。
- [x] 保持范围在 D032，不提前实现后续任务。
