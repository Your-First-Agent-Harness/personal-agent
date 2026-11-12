# Personal Agent · D031 工具设计复盘与 ADR-001 定稿

> **课程日期**：2026-12-11
> **分支**：D031，从 D030 `6a59ec10cd2a23b4d08c42359f81184971e11e0f` 创建
> **任务**：复盘 D027–D030，定稿 ADR-001《工具设计取舍》
> **本日性质**：文档与复盘，不新增运行时行为，不制造失败测试

D027–D030 已经把工具从“函数列表”变成一条有注册、有校验、有权限、有韧性的调用管线。D031 不再向前堆功能，而是回答：**为什么这样组合，付出了什么成本，哪些结论有代码和测试依据，哪些仍然不能承诺。**

## 本日交付

| 文件 | 内容 |
| --- | --- |
| [`docs/adr/0001-failure-semantics.md`](docs/adr/0001-failure-semantics.md) | ADR-001 定稿；保留 D017 失败语义初稿，补齐 D027–D030 的决策、备选方案、trade-off、后果与检查项 |
| [`docs/weekly/2026-w50.md`](docs/weekly/2026-w50.md) | D027–D030 真实复盘；逐日实现、96 个定向测试、可靠证据和遗留边界 |
| [`README.md`](README.md) | 本日教学说明、ADR 阅读路径和可运行验证命令 |

文件路径继续沿用 `0001-failure-semantics.md`，是为了保留 D017 的演进痕迹和既有引用；文档标题已扩展为《工具设计取舍》，没有另建互相竞争的 ADR-001。

## 1. 本日目标

读完本日内容，你应能：

1. 画出一次 ToolCall 从模型发现到失败回喂的完整路径。
2. 区分**工具版本元数据**与版本兼容协商，区分**逻辑调用**与内部尝试。
3. 解释为什么参数校验先于敏感确认，权限检查又先于 JSON/Schema。
4. 解释每尝试超时、幂等重试、有界队列和 half-open 熔断分别限制什么。
5. 用源码、提交和测试复查 ADR，而不是把 ADR 当作不可验证的宣言。
6. 说出当前实现的限制，不把进程内策略误称为生产级 IAM、分布式治理或安全沙箱。

## 2. 一张图理解工具设计

```text
注册 / 替换
  先验证 Tool + Schema + resilience，再修改 Map
  非法替换不破坏旧工具
       │
       ▼
每个 Agent turn 重新 list()
  模型只看到当前可见的名称、描述、参数 Schema
  单次请求保留 Schema 快照，下一轮可发现替换/注销
       │
       ▼
Registry.execute(ToolCall)
  1. 可见性：白名单 + 共享/当前租户
  2. JSON 解析
  3. 递归 Schema 校验
  4. sensitive 工具取得本次确认
  5. 熔断预检 → 有界并发/排队 → 取得许可后再查熔断
  6. 每次尝试独立 timeout / AbortController
  7. 仅符合条件的故障进行幂等、有界重试
       │
       ▼
统一 ToolResult
  content + isError + error.code / retryable / hint
       │
       ▼
Agent Loop
  把 content 作为 role="tool" 消息回喂
  成功清零连续失败；连续失败达到上限则终止
```

这里最重要的取舍是：**执行前尽早拒绝，执行后统一失败语义；安全策略决定是否允许，韧性策略决定允许后的故障如何被限制。**

## 3. 工具设计取舍讲解

### 3.1 契约放在一起，治理放在 Registry 条目里

`Tool` 同时包含 `name`、`description`、`parameters` 和 `execute`。模型看到的参数说明不会与执行函数分成两套注册流程。

Registry 额外保存：

- `version`：非空字符串；未声明时为 `unversioned`；
- `metadata`：给宿主发现的附加信息；
- 白名单/租户以外的条目归属与 sensitive 标记；
- 当前条目的 resilience 执行器。

选择同名单活动条目，而不是 `name@version` 多版本共存，是为了让发现、执行和策略都简单。代价也很明确：**版本只做诊断，不强制 SemVer、不比较兼容、不支持按版本调用。**

每轮重新发现兼顾撤销和修复，单次请求不追加点则避免模型请求内的工具数组突然变化。替换会建立新的韧性状态，已开始调用不会被强行切换。

### 3.2 Schema 采用可维护子集，不假装完整标准

当前递归校验支持：

- object、string、number、integer、boolean、array、null；
- properties、required、items、`additionalProperties: false`；
- minLength/maxLength、minimum/maximum、enum、uniqueItems。

它的价值是：

1. 注册时拒绝坏 Schema，非法替换不破坏旧工具；
2. 执行前拒绝坏参数，工具副作用尚未发生；
3. 用 `$.members[1].name` 这样的路径帮助模型修复；
4. 不自动强转、trim、填默认值或删除字段，避免把错误输入变成另一种操作。

备选方案是信任模型、工具各自手写，或引入完整 JSON Schema 校验器。当前选择零新增依赖和统一错误格式，代价是维护一个明确的子集：`$ref`、oneOf/allOf、pattern、format 等未实现，也不保证模型提供商接受所有 Schema。**未实现的关键字不能当作安全约束。**

### 3.3 白名单、租户和确认解决三个不同问题

| 机制 | 回答的问题 | 当前语义 |
| --- | --- | --- |
| 白名单 | 这个调用方能用什么？ | 未配置不额外限制；空数组全禁；隐藏与执行同时过滤 |
| 租户 | 这个条目属于谁？ | 共享或当前 Registry 租户可见；tenantId 由可信策略写入 |
| sensitive 确认 | 这一次具体副作用是否被批准？ | 每次逻辑 execute 都重新确认，批准不永久保存 |

顺序不能随意交换：

- 先查可见性，隐藏工具即使收到坏 JSON 也只返回 `TOOL_NOT_ALLOWED`，不泄露 Schema；
- 再解析和校验，避免让人审批畸形参数；
- 最后确认，回调拿到 callId、工具名、已校验原始参数和可信租户。

“逐次”指每次**逻辑调用**，不是每次内部重试。敏感非幂等工具应保持默认不重试；若显式开启，同一批准覆盖该次调用的所有尝试。

### 3.4 四种韧性机制各有边界

| 机制 | 限制的对象 | 当前默认值/规则 | 不能误读为 |
| --- | --- | --- | --- |
| 每次尝试超时 | 单次 execute attempt | 未配置则不增加 Registry 超时；外部 signal 优先 | 总 deadline 或无条件强杀进程 |
| 幂等重试 | 故障后的重复副作用 | maxRetries=0；幂等或显式承担非幂等风险才开启 | 所有错误都应立即重试 |
| 有界排队限流 | 并发与等待资源 | maxQueue=0；可配置队列长度和 maxWaitMs | 无限缓冲或跨租户公平调度 |
| half-open 熔断 | 连续故障扩散 | 达阈值打开；冷却后单探针；成功关、失败重开 | 永久禁用或全量并发探测 |

还有三个容易忽略的组合规则：

1. 每次重试都重新计时 timeout，指数退避可被外部取消打断。
2. 逻辑调用在全部尝试与退避期间持有同一并发许可；每个逻辑调用只给熔断计一次最终失败。
3. 限流和熔断拒绝会回喂，但当前执行器不会立即自动重试它们，避免放大压力。

通用 AbortSignal 是协作式协议：Harness 不再接受超时后的迟到结果，却不能保证无视 signal 的 Promise、子进程或远端工作已经停止。

### 3.5 失败回喂不是永不终止

工具失败作为 `ToolResult` 返回，Loop 将其 `content` 回喂给模型。模型可以修正 JSON/参数、换路径、换工具或解释权限拒绝；不会因为一个文件错误就丢掉整个 run。

但终止边界仍在：

- 连续工具错误达到 `maxConsecutiveToolErrors`（默认 3）→ `tool_errors`；
- 达到 maxTurns → `max_turns`；
- 模型取消或外部取消 → `cancelled`；
- 模型提供商异常 → 向上抛出，不伪装成工具错误。

未知异常会脱敏成 `INTERNAL_ERROR`，但工具主动返回的 content/message 仍由工具作者负责，不能写入秘密。工具输出也是模型上下文的一部分，当前没有通用提示注入清洗器。

## 4. ADR 阅读路径

建议按以下顺序阅读，不要直接跳到检查项：

1. **先读背景与决策总览**
   [`docs/adr/0001-failure-semantics.md`](docs/adr/0001-failure-semantics.md) 第 1–2 节，理解为什么所有机制在同一条管线。
2. **再读五组决策**
   第 3 节依次是注册/发现/版本、递归 Schema、白名单/租户/确认、韧性、失败回喂。每组都包含备选方案和 trade-off。
3. **用检查项审工具**
   第 4 节可直接作为新增、替换或审查工具时的逐项清单。
4. **用证据反驳或确认文档**
   第 6 节列出测试与提交；第 7 节保留 D017 初稿，避免把后来的实现倒填成早期决策。
5. **最后读真实复盘**
   [`docs/weekly/2026-w50.md`](docs/weekly/2026-w50.md) 按 D027 → D028 → D029 → D030 解释实现证据与“不能推出的结论”。

源码对照顺序：

```text
src/core/tool.ts
  → src/tools/registry.ts
  → src/tools/schema.ts
  → src/tools/resilience.ts
  → src/tools/errors.ts
  → src/runtime/loop.ts
```

## 5. D027–D030 复盘结论

| 日 | 真实实现带来的主要结论 | 定向测试 |
| --- | --- | --- |
| D027 | 发现、执行、版本和策略必须共享同一条目；按轮刷新让替换/注销生效 | 11 |
| D028 | 参数错误必须在副作用前变成带路径的可修复结果；Schema 子集必须明示边界 | 35 |
| D029 | 不可见不能替代执行鉴权；敏感批准必须绑定本次参数，不能永久放行 | 10 |
| D030 | 超时、重试、队列、熔断要按“尝试/逻辑调用”区分组合，不能只堆错误码 | 40 |

合计 **4 个测试文件、96 个测试通过**。全量回归为 **36 个测试文件、336 个测试通过**；V8 覆盖率为 **Statements 94.08%、Branches 90.42%、Functions 99.53%、Lines 95.38%**。

本周做得好的地方是：非法替换保留旧工具、隐藏工具不泄露 Schema、确认异常脱敏、迟到 rejection 被消费、重试不绕过幂等、队列和 half-open 都有界、失败结果仍可回喂。

仍需保留的边界是：没有版本协商、完整 Schema、生产 IAM、持久审计、分布式状态、总耗时预算、随机退避、通用资源强杀或工具输出信任系统。这些在复盘中记录为待独立决策的问题，不在 D031 偷渡实现。

## 6. 可运行验证

### 环境准备

干净检出且尚未安装依赖时：

```bash
npm ci
```

本次实际复查环境为 macOS、Node.js `v24.19.0`、npm `11.17.0`；这不是对最低 Node 版本的新承诺。

### 只复查 D027–D030

```bash
npx vitest run \
  test/d027-tool-registry.test.ts \
  test/d028-schema-validation.test.ts \
  test/d029-permissions.test.ts \
  test/d030-resilience.test.ts \
  --coverage.enabled false
```

预期：4 个文件、96 个测试通过。参数化测试会展开计数，所以数量多于测试源码中的 `it` 标题数。

### 全量检查

```bash
npm run check
```

它依次执行：

```bash
npm run lint       # eslint .
npm run typecheck  # tsc --noEmit
npm run test       # vitest run
```

`npm run check` 不包含 Prettier。独立运行 `npx prettier --check "src/**/*.ts" "test/**/*.ts"` 时，当前会对 68 个既有源码/测试文件报告格式差异；D031 未修改这些文件，因此没有批量格式化制造无关变更。此项不是 `npm run check` 的失败。

### 覆盖率

```bash
npm run test:coverage
```

阈值来自 `vitest.config.ts`：Statements/Lines/Functions ≥ 80%，Branches ≥ 75%。HTML 报告位于 `coverage/`。

### 对照真实提交

```bash
git show f50ae01  # D027 工具注册与发现
git show 9f58c37  # D028 Schema 与参数校验
git show e741f4d  # D028 删除旧占位文件
git show fc050c0  # D029 权限边界
git show 6a59ec1  # D030 韧性执行器
```

## 7. 诚实的验证范围与限制

- D031 只修改文档；`npm run check` 证明既有代码和测试仍通过，**不会自动证明 ADR 每句话完整或未来设计正确**。
- D027–D030 定向测试使用 spy、脚本化 ModelProvider、可控 Promise 和 fake timers；没有调用真实模型来判断模型一定会修复错误。
- 没有外部租户服务、生产身份系统、真实审批 UI、跨进程/跨实例一致性或生产故障注入验证。
- fake timers 验证状态机，不是 wall-clock 性能测试；96 个定向测试、336 个全量测试和高覆盖率也不是压力测试或可靠性百分比。
- 通用超时只保证 Harness 的 settle 语义；资源是否真正停止仍取决于工具对 AbortSignal 的响应。
- 未深冻结 Tool/Schema/metadata，Registry 不是恶意进程内代码的安全沙箱。
- 包版本保持 `0.1.0`；本日不发布 v0.3，不合并 main，不实现 D032。

## 8. 完成标准

- [x] ADR-001 状态、背景、已采用决策、备选方案、trade-off、后果与证据完整。
- [x] 覆盖注册/发现/版本、递归 Schema、白名单/租户/逐次确认、四类韧性和失败回喂。
- [x] 保留 D017 初稿演进，不伪造新的决策日期或外部反馈。
- [x] D027–D030 复盘基于真实 README、代码、diff 和测试。
- [x] 提供可运行的定向、全量与覆盖率验证命令。
- [x] 不写运行时代码、不改包版本、不提前发布、不展开 D032。
