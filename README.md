# D048 — 动态工具检索，按需加载

> 工具很多，不等于每轮都要把全部工具 Schema 塞进 prompt；模型没看到某个工具，也不等于该工具获得了新的权限边界。

本日在 **D047（`6f8dd698ba8d1d5e3abaa572edaa737ff614c4dd`）** 之上实现：

- 基于当前用户请求或每轮显式查询的确定性词法检索；
- `DynamicToolRegistry` 只向模型发送少量选中 Schema；
- `registerLazy()` 提供同步或异步 factory、按需加载、并发去重和成功缓存；
- 保留 `ToolRegistry.execute()` 的 allowlist、tenant、JSON/Schema、敏感确认、resilience 和错误回喂；
- `runAgentLoop()` 每轮重新检索，之前发现的工具仍可执行，完整工具结果继续进入后续消息；
- 零新增运行时依赖，Node 24 原生 TypeScript ESM，完全离线 Demo。

## 1. 先分清五个状态

| 状态 | 本日含义 | 是否授予执行权限 |
|---|---|---|
| registered | 工具或 lazy 描述已登记在 Registry | 否 |
| visible | 通过 Registry 的 allowlist / tenant 目录过滤 | 否 |
| selected | 本次词法查询命中，Schema 被放进本轮模型请求 | 否 |
| loaded | lazy factory 已成功返回 Tool，并缓存到该注册项 | 否 |
| executable | 本次 `execute()` 通过全部策略、参数和确认检查 | 是，仍受既有执行约束 |

动态检索只改变 **selected**。它没有取代 D029 的策略边界，也没有创造第四种租户或白名单语义。

## 2. 请求路径

```text
最新 user 消息 / getToolQuery(messages, turn)
                    │
                    ▼
DynamicToolRegistry.catalog()
  仅取当前 allowlist + tenant 可见的静态 Schema
                    │
                    ▼
searchToolSchemas(catalog, query, limit)
  归一化 → 去重词元 → 评分 → 稳定排序 → 截断
                    │
                    ▼
            本轮 provider.chat({ tools })
                    │
                    ▼ tool call
ToolRegistry.execute()
  allowlist → tenant → JSON → Schema → 敏感确认
                    │
                    ▼ 仅首次有效执行
              lazy factory
                    │
                    ▼ 缓存前运行时门禁
       name / description / parameters 契约一致
                    │
                    ▼
         resilience → Tool.execute(args, context)
                    │
                    ▼
          完整 ToolResult 回喂下一轮 AgentLoop
```

普通 `ToolRegistry` 仍返回全量可见 Schema。只有显式使用 `DynamicToolRegistry` 才开启动态子集。

## 3. 检索算法

实现位于 `src/tools/retrieval.ts`，没有 embedding、网络请求或新增依赖。

### 3.1 归一化与词元

1. 使用 Unicode `NFKC` 和小写归一化；
2. 英文/数字提取连续 ASCII 词元，因此 `weather_current` 可按 `weather`、`current` 检索；
3. 中文连续序列长度为 1～2 时保留整体，更长时生成相邻二字词元；
4. 查询词元通过 `Set` 去重，重复输入同一个词不会重复加分。

二字词元只是轻量词法近似。例如“请查询北京天气”会产生“查询”“北京”“天气”等词元，可以命中描述中的“查询当前天气”。它不是中文分词器或语义模型。

### 3.2 评分与稳定排序

每个唯一查询词元独立评分，分数累加：

| 命中位置 | 分值 |
|---|---:|
| 工具名词元完全命中 | +12 |
| 工具名子串命中 | +6 |
| 描述词元完全命中 | +4 |
| 描述子串命中 | +2 |

名称和描述可以同时得分；同一类别内完全命中优先于子串命中。只保留正分结果，按以下顺序排序：

1. 总分降序；
2. 同分保持 `catalog()` 的注册顺序；
3. 按 `limit` 截断。

默认 `limit = 5`。边界行为是确定的：

| 输入 | 行为 |
|---|---|
| 空字符串、纯空白、没有可识别词元 | `[]` |
| 没有正分匹配 | `[]` |
| `limit = 0` | `[]` |
| 负数、小数、`NaN`、`Infinity` | 抛出“limit 必须是非负整数”的 `RangeError` |
| 重复词、大小写差异 | 去重、归一化后检索 |
| 同分 | 不随机、不按时间，保持目录顺序 |

## 4. API 使用

### 4.1 动态目录与 lazy tool

```ts
import {
  DynamicToolRegistry,
  runAgentLoop,
  type ToolSchema,
} from './src/index.ts';

const weatherSchema: ToolSchema = {
  name: 'weather_current',
  description: '查询当前天气与温度 current weather',
  parameters: {
    type: 'object',
    properties: { city: { type: 'string' } },
    required: ['city'],
    additionalProperties: false,
  },
};

const registry = new DynamicToolRegistry({
  limit: 3,
  allowedTools: ['weather_current'],
});

registry.registerLazy(weatherSchema, async () => ({
  ...weatherSchema,
  execute: (args) => Promise.resolve({
    content: JSON.stringify({ args, temperatureC: 24 }),
  }),
}));

// 完整策略可见目录，不执行 factory。
const catalog = registry.catalog();

// 只返回本次查询选中的 Schema，也不执行 factory。
const selected = registry.list('查询上海天气');

const result = await runAgentLoop({
  provider,                 // 调用方提供的既有 ModelProvider
  registry,
  messages: [{ role: 'user', content: '查询上海天气' }],
  maxTurns: 4,
  maxTokens: 512,
  workspaceRoot: '.',
});
```

也可以直接使用纯函数：

```ts
searchToolSchemas(catalog, 'weather WEATHER weather', 3);
```

### 4.2 每轮查询

默认情况下，`runAgentLoop()` 使用消息中最新一条 `user` 内容作为每轮查询。没有用户查询时，动态目录返回空工具列表。

需要显式控制时可传：

```ts
getToolQuery: (messages, turn) => turn === 1 ? '天气' : '日程'
```

Loop 每轮都重新调用 `registry.list(query)`，不会在首轮永久冻结目录。第二轮可以收到不同子集；工具调用是否允许执行仍由 `execute()` 独立判断。工具结果以完整 `tool` 消息回喂，不因为下一轮检索变化而丢失。

### 4.3 向后兼容

```ts
const registry = new ToolRegistry();
registry.register(existingTool);

registry.list();        // 仍然是全量策略可见 Schema
registry.list('天气');  // 普通 Registry 忽略可选查询，仍是全量
```

既有 `Tool`、provider 的 `ChatRequest.tools`、`runAgentLoop()` 和 `createAgentLoop()` 契约不变。eager 或已缓存工具仍同步进入原 `Tool.execute()`，避免改变取消信号等时序。

## 5. lazy 生命周期与缓存

`registerLazy(schema, factory, options?)` 接收静态 Schema 和 `() => Tool | Promise<Tool>`。静态 Schema 是目录展示、参数校验和运行时实现契约的依据。factory 返回 Tool 的 `name`、`description`、`parameters` 必须与注册静态 Schema 一致；这由 Registry 在缓存和业务 `execute()` 之前强制检查，不依赖调用方自觉。

| 阶段 | factory 是否运行 |
|---|---|
| `registerLazy()` | 否 |
| `catalog()` / `discover()` / 检索 / 被选中 | 否 |
| 白名单或租户拒绝 | 否 |
| JSON 或参数 Schema 校验失败 | 否 |
| 敏感工具确认拒绝 | 否 |
| 通过上述检查的首次有效执行 | 是 |
| factory 返回后的 Schema 契约校验失败 | 是，但业务 `execute()` 不运行，且不缓存 |
| 后续执行 | 否，使用成功缓存 |
| 多个并发首次执行 | 只运行一次，共享同一个加载 Promise |

factory 抛错或 reject 时：

- 错误进入 Registry 原有 `ToolResult` 错误边界，不向 Loop 抛出未处理异常；
- 普通异常规范化为 `INTERNAL_ERROR`，不把原始密钥或错误细节写入 content；
- 失败的 Promise 不成为永久缓存，后续有效执行可以重试；
- 成功后才缓存 Tool，同一注册项不重复 factory；
- `replace()` / `unregister()` 仍通过替换或删除整个注册项管理生命周期。

factory 成功返回但静态 Schema 漂移时，同样走上述 `ToolResult` 边界，并在业务副作用前拒绝：

- `name`、`description`、`parameters` 任一不一致都不会进入 `Tool.execute()`，漂移实例不会写入成功缓存；
- `description` / `parameters` 漂移返回字段明确的 `INTERNAL_ERROR`、`retryable: true` 和“修正 factory 返回值后重试”的 hint，不回显漂移值或异常堆栈；
- `parameters` 使用 Node 内置 `isDeepStrictEqual()` 做深严格比较，对象 key 顺序不同不会误报；无需新增依赖；
- 修正 factory 后，后续有效执行会重新加载并再次校验。

## 6. 动态可见性不是授权

`DynamicToolRegistry` 只覆盖 `list()` 的模型可见子集；所有执行仍进入同一个 `ToolRegistry.execute()`：

1. 名称查找与白名单检查；
2. 工具注册 tenant 与请求 tenant 匹配；
3. JSON 解析；
4. 注册 Schema 参数校验；
5. 敏感工具显式确认；
6. lazy factory 加载；
7. `name` / `description` / `parameters` 运行时契约校验与成功缓存；
8. 既有 resilience 与业务执行；
9. 统一错误规范化。

因此以下两件事可以同时成立：

- 某次搜索没找到 `weather_current`，模型本轮看不到它；
- 已注册且策略允许的直接 `weather_current` 调用仍可执行。

反过来，被 allowlist / tenant 排除的工具既不会进入搜索目录，也不能通过构造 tool call 绕过执行策略。敏感工具在未确认前不会运行 factory。

## 7. 离线 Demo

```bash
npm run demo:d048
```

Demo 文件：

- `src/demo/d048.ts`：8 个有区分度的 lazy 工具、scripted `ModelProvider`、真实 `runAgentLoop()`；
- `scripts/d048-dynamic-tools.ts`：命令行入口；
- `evidence/d048-transcript.txt`：真实终端输出。

最终实测：

| 指标 | 结果 |
|---|---|
| 全量目录 | 8 个工具 |
| 全量目录 Schema | 2049 字符 |
| 第 1 轮实际发送 | `weather_current`, `weather_forecast`；497 字符 |
| 第 2 轮实际发送 | `weather_current`, `weather_forecast`；497 字符 |
| factory 加载 | 只有 `weather_current = 1`，其余 7 个均为 0 |
| 实际执行 | 只有 `weather_current` |
| 完整工具结果 | 包含 `上海`、`24`、`晴`、`适合散步`、`tool-weather` |
| 最终回答 | 由第二轮 provider 根据实际 tool 消息生成 |
| Loop | 2 轮，`completed`，输出 `D048 Demo PASS` |

**字符数只是可测量代理指标，不是 token 精确节省。** 本 Demo 不声称生产延迟、成本或性能提升，也不访问真实天气或模型 API。

## 8. 测试与 TDD 证据

新增 4 个测试文件，现共 21 项（首轮 17 项，契约复审追加 4 项）：

| 文件 | 覆盖 |
|---|---|
| `test/d048-tool-retrieval.test.ts` | 英文/中文、排序、同分、重复词、空查询、无匹配、limit、策略目录、旧 `list()` 兼容 |
| `test/d048-lazy-tools.test.ts` | 选中不实例化、同步/异步加载、并发去重、缓存、factory 失败恢复、name/description/parameters 漂移、乱序 parameters 等价、安全顺序、确认、resilience、搜索不可见仍可执行 |
| `test/d048-loop.test.ts` | 每轮子集变化、最新用户查询、空查询、跨轮旧工具执行、完整结果回喂 |
| `test/d048-demo.test.ts` | 真实 AgentLoop、8 个 lazy 工具、Schema 子集、factory 计数、工具执行和最终回答 |

首轮严格先写测试并运行：

- RED：`evidence/d048-tdd-red.txt`，真实结果为 **16 failed / 1 passed / 17 total**；唯一通过项是旧 `ToolRegistry.list()` 尚未改变的兼容行为；
- GREEN：`evidence/d048-tdd-green.txt`，同一批测试 **17 passed**；
- 开发中旧 D036/D042 取消测试还捕获了 eager 工具新增微任务的时序回归；实现改为 eager/已缓存工具不等待 lazy Promise，相关测试恢复通过，未修改旧测试期望。

契约复审再次按 RED → GREEN 执行，且不篡改首轮证据：

- RED：`evidence/d048-schema-drift-red.txt`，真实结果为 **3 failed / 8 passed / 11 total**；description、parameters 和异步 factory 漂移测试均复现业务 `execute()` 被错误运行，合法乱序 parameters 回归项通过；
- GREEN：`evidence/d048-schema-drift-green.txt`，同一文件 **11 passed**，覆盖漂移拒绝、明确修复提示、不泄漏漂移值、合法乱序匹配和异步 factory。

最终完整验收：

`vitest.config.ts` 使用 `maxWorkers: 1` 串行执行测试文件，避免真实子进程测试在并发和覆盖率插桩下挤占既有 80/100ms 超时窗口；不会跳过测试、关闭隔离或放宽超时与覆盖率阈值。

```bash
npm run check
npm run test:coverage
npm run demo:d048
git diff --check
```

实测结果：

- `npm run check`：lint、typecheck、**60 个测试文件 / 532 项测试**全部通过；
- 覆盖率：语句 **91.39%**、分支 **86.26%**、函数 **96.94%**、行 **93.6%**；
- `npm run demo:d048`：`D048 Demo PASS`；
- `git diff --check`：无空白错误；
- 未新增运行时依赖。

## 9. 限制

1. **词法检索不是语义理解。** 同义词、隐含意图和跨语言语义需要在名称/描述中有对应词，或由更上层查询构造提供；二字词元不是 NLP 分词。
2. **排序不是学习排序。** 分数只用于小规模确定性候选筛选，不代表工具的业务成功率或权限等级。
3. **隐藏不是权限。** 必须继续配置 Registry 的 allowlist、tenant、敏感确认和业务授权。
4. **字符不是 token。** 2049 → 497 是本 Demo 的 JSON Schema 字符代理指标，不是精确 token、成本或延迟结论。
5. **缓存是注册项级、进程内的。** 不是跨进程或持久缓存；替换/注销对应注册项后，新注册项有自己的加载状态。
6. **静态 Schema 是运行时契约。** 参数校验以注册 Schema 为准；factory 返回的 name/description/parameters 由 Registry 强制比对，漂移在缓存和业务执行前拒绝，并提供可修复错误。它不改变授权边界，也不能替代正确的业务 Schema 设计。
7. **parameters 比较不是完整 JSON Schema 语义归一化。** 深严格比较允许对象 key 顺序差异，但数组顺序等其他结构差异仍会判为漂移；factory 应返回与注册 Schema 同构的参数对象。
8. **factory 是加载阶段，不是业务 resilience 工作。** 业务超时、重试和取消仍由 `Tool.execute()` 与既有 resilience 处理；factory 自身应避免执行不受控的长业务任务。

## 10. 本日文件

```text
src/tools/retrieval.ts            词法检索与评分
src/tools/dynamic-registry.ts     动态 Schema 子集与完整目录
src/tools/registry.ts             lazy 注册、加载、缓存和统一执行
src/runtime/loop.ts               每轮查询与真实 provider 工具子集
src/demo/d048.ts                  离线真实 Loop Demo
scripts/d048-dynamic-tools.ts     Demo 入口
test/d048-*.test.ts               单元与集成测试
evidence/d048-tdd-red.txt         首轮真实 RED
evidence/d048-tdd-green.txt       首轮真实 GREEN
evidence/d048-schema-drift-red.txt   契约复审真实 RED
evidence/d048-schema-drift-green.txt 契约复审真实 GREEN
evidence/d048-transcript.txt      真实 Demo transcript
```
