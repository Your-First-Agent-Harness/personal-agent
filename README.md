# Personal Agent · D027 工具注册中心

> 当日目标：让工具可以注册、发现、替换和注销，并为调用方提供版本与元数据。Agent Loop 不能一直拿着启动时的旧工具快照；这就是本日所说的“工具可热插拔”。
>
> 本日是进程内的 TypeScript 注册中心，不是 MCP，不包含网络加载、文件监听或插件包管理。

## 1. 先理解问题

D026 的 `ToolRegistry` 已有 `register / list / execute`，但还缺少三项能力：

1. 调用方无法查询某个工具的版本与部署元数据；
2. 同名工具不能显式替换，也不能注销；
3. `runAgentLoop` 在启动时只执行一次 `registry.list()`，之后即使注册表发生变化，后续模型请求仍使用旧 Schema。

D027 只补这三块，不重写工具系统。现有 `read_file`、`list_dir`、`write_file`、`edit_file`、`run_command`、参数校验、错误回喂、会话和演示继续沿用原契约。

## 2. 设计：执行、模型 Schema、调用方发现分开

注册表内部仍以工具名为 key，但 value 现在包含：

```ts
{
  tool,       // 真正的 Tool，含 execute
  version,    // 非空版本标签
  metadata,   // 调用方自定义元数据
}
```

公开读取有两条通道，不能混成一条：

| API | 使用方 | 返回内容 |
| --- | --- | --- |
| `list()` | 模型 Provider | 原有的 `name / description / parameters` |
| `discover()` | 应用、调试器、管理界面 | 上述 Schema，加 `version / metadata` |
| `describe(name)` | 应用按名称查询 | 单个发现结果；不存在时返回 `undefined` |

这样增加管理能力不会改变发给 OpenAI 兼容接口的工具 Schema，也不会把内部标签泄露给模型。

### 热插拔的精确语义

- `register` 添加新名称；重名直接抛错，不静默覆盖。
- `replace` 替换同名工具。先完整校验新工具，再一次性 `Map.set`；校验失败时旧版本仍可用。
- `unregister` 删除名称，返回是否真的删除了条目。
- `execute` 每次调用都按名称读取当前条目，因此替换后的下一次调用使用新实现。
- Agent Loop **每轮开始前**重新调用 `list()`。同一个模型请求拿到稳定快照，下一轮请求看到最新注册、替换和注销结果。

热插拔不等于取消正在执行的异步函数：若旧实现已经开始执行，本次调用会结束；后续调用才走新实现。

## 3. 公共 API

包入口导出 `ToolRegistry`，以及 `Tool`、`ToolDescriptor`、`ToolMetadata`、`ToolRegistrationOptions` 类型。

```ts
class ToolRegistry {
  register(tool: Tool, options?: ToolRegistrationOptions): void;
  replace(tool: Tool, options?: ToolRegistrationOptions): void;
  unregister(name: string): boolean;

  list(): ToolSchema[];
  discover(): ToolDescriptor[];
  describe(name: string): ToolDescriptor | undefined;

  get size(): number;
  execute(call: ToolCall, context: ToolContext): Promise<ToolResult>;
}

interface ToolRegistrationOptions {
  readonly version?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

interface ToolDescriptor extends ToolSchema {
  readonly version: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}
```

### 兼容与默认值

原来的 `registry.register(tool)` 不需要修改：

- 未提供版本时，发现结果明确显示 `version: 'unversioned'`；
- 未提供元数据时，发现结果为 `metadata: {}`；
- `list()` 的字段和顺序规则保持原样；
- `execute` 的 JSON 解析、参数校验和结构化错误语义保持原样。

版本是非空字符串标签。本日不做 SemVer 解析、比较或自动升级，`'2026.12-beta'` 与 `'v2'` 都可以作为标签。

## 4. 示例：注册、发现、替换、注销

下面的 TypeScript 使用公开包 API；`node:assert/strict` 是 Node 内置模块，不增加运行时依赖。

```ts
import assert from 'node:assert/strict';
import { ToolRegistry, type Tool } from 'personal-agent';

const clockV1: Tool = {
  name: 'clock',
  description: '返回示例时间',
  parameters: { type: 'object', properties: {} },
  execute: () => Promise.resolve({ content: '12:00' }),
};

const registry = new ToolRegistry();
registry.register(clockV1, {
  version: '1.0.0',
  metadata: { source: 'local', owner: 'demo' },
});

assert.equal(registry.describe('clock')?.version, '1.0.0');
assert.deepEqual(registry.list(), [{
  name: 'clock',
  description: '返回示例时间',
  parameters: { type: 'object', properties: {} },
}]);

const clockV2: Tool = {
  ...clockV1,
  description: '返回升级后的示例时间',
  execute: () => Promise.resolve({ content: '13:00' }),
};
registry.replace(clockV2, {
  version: '2.0.0',
  metadata: { source: 'local', owner: 'demo' },
});

const result = await registry.execute(
  { id: 'call-1', name: 'clock', arguments: '{}' },
  { workspaceRoot: process.cwd() },
);
assert.equal(result.content, '13:00');
assert.equal(registry.describe('clock')?.version, '2.0.0');

assert.equal(registry.unregister('clock'), true);
assert.equal(registry.unregister('clock'), false);
assert.equal(registry.describe('clock'), undefined);
```

### 错误与缺失语义

| 情况 | 结果 |
| --- | --- |
| 重名 `register` | 抛出 `工具重复注册：<name>`，旧条目不变 |
| 对不存在的名称 `replace` | 抛出 `无法替换未注册工具：<name>` |
| 空名称、空描述、缺少参数对象或执行函数 | 抛出带具体字段的 `TypeError` |
| 空版本或非对象元数据 | 抛出带 `version` 或 `metadata` 的 `TypeError` |
| 新替换条目校验失败 | 旧实现、旧版本和旧元数据保持不变 |
| `unregister` 已注销或不存在的名称 | 返回 `false` |
| `describe` 不存在的名称 | 返回 `undefined` |
| `execute` 不存在的名称 | 返回 `UNKNOWN_TOOL` 的可重试 `ToolResult`，不是抛出异常 |

这里的“非法注册”只检查 D027 所需的顶层工具契约，不在注册中心里另造一套 JSON Schema 校验器。执行参数仍由既有 `validateArguments` 处理。

## 5. 如何亲自验证热插拔

### 路径 A：注册表级替换与注销

```bash
npm test -- test/d027-tool-registry.test.ts
```

重点看这些用例：

- “发现当前工具的版本和元数据，同时保持模型 Schema 不变”；
- “替换同名工具后发现和执行都使用新版本”；
- “非法替换不会破坏仍可用的旧版本”；
- “注销立即移除发现和执行能力”。

### 路径 B：Agent Loop 运行中增删改

```bash
npm test -- test/loop.test.ts -t '运行中替换、注册和注销后'
```

该集成测试不是只检查 `Map`：

1. 第一次模型请求看到 `echo@1.0.0` 和 `retired`；
2. Provider 返回前，把 `echo` 替换为 `2.0.0`，注销 `retired`，注册 `fresh`；
3. 当前 `echo` 调用立即执行新版实现；
4. 第二次模型请求只看到新版 `echo` 和 `fresh`，看不到 `retired`；
5. 请求里的工具仍只有原 Schema 字段，没有 `version` 和 `metadata`。

因此它同时证明了“当前执行不陈旧”和“下一轮发现不陈旧”。

## 6. 测试与完整检查

```bash
# 定向测试
npm test -- test/d027-tool-registry.test.ts test/loop.test.ts test/tools.test.ts

# Lint、类型检查与全量测试
npm run check

# 全量测试与覆盖率
npm run test:coverage
```

推荐阅读顺序：

1. `src/tools/registry.ts`：注册条目、发现视图、替换和注销；
2. `src/runtime/loop.ts`：每轮请求前重新读取 `registry.list()`；
3. `test/d027-tool-registry.test.ts`：注册中心行为矩阵；
4. `test/loop.test.ts` 的“运行中替换、注册和注销后”用例：端到端热插拔证据。

## 7. 明确边界

- **仅当前进程、当前实例**：不持久化注册表，重启后由应用重新注册。
- **不是远程插件系统**：不扫描目录、不监听文件、不下载代码、不启动子进程加载插件。
- **不是 MCP**：协议适配、远程发现和 MCP 生命周期属于后续课程。
- **不做版本仲裁**：版本用于发现和审计，不参与依赖解析或灰度选择。
- **不做权限控制**：调用方能操作同一个注册表，就能替换其中工具。
- **不做熔断**：工具执行失败仍按既有错误回喂策略处理。
- **元数据是浅只读类型**：不在本日引入深冻结或复杂元数据 Schema；不要把凭证放进元数据。

## 8. 与 D028 衔接

D027 已经把两个职责分开：注册中心管理“当前有哪些工具及其版本”，`parameters` 则继续描述模型可见的输入契约。D028 可以在此基础上统一 `inputSchema / outputSchema` 及其类型推导，而无需再次实现注册、替换、注销或热插拔。

同样，D027 没有提前实现 D028 的完整 Schema 体系、D029 的权限策略或 D030 的熔断器。保持这个边界，后续任务才能各自只解决一个问题。
