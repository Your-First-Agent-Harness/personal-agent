# D028｜Schema 与参数校验：让非法入参止步于 execute 之前

> 日期：2026-12-08
> 基线：D027 热插拔工具注册表
> 目标：用零依赖、递归的 JSON Schema 子集校验，覆盖对象、数组、必填字段、类型和必要约束；模型输入错误统一通过 `ToolResult` 回喂，开发者声明的非法 Schema 则在注册期失败。

---

## 1. 今天解决什么问题

D014 已经能拒绝根值类型错误、缺少必填字段、额外字段和错误标量类型，但仍有几条漏检路径：

```json
{
  "profile": { "name": "", "age": -1 },
  "tags": ["agent", 7],
  "members": [{ "name": "Grace" }, { "name": 9 }]
}
```

如果 Schema 声明 `tags` 是字符串数组、`members` 是对象数组、`name` 至少一个字符、`age` 不得小于零，上述输入都应该失败。D027 的注册表还允许开发者注册未知类型、畸形 `required`、错误 `items` 等声明，直到执行时才暴露模糊行为。

D028 在原有校验器上补齐两道工序，而不是另建一套工具协议：

1. **注册期 Schema 校验**：拒绝 Harness 不支持的类型和畸形约束。
2. **执行前参数校验**：递归检查 JSON 参数，在调用工具的 `execute` 之前返回结构化错误。

本日不引入 `zod`、其他运行时依赖或代码生成器。这里借鉴的是 zod / pydantic 的“先解析输入，再交给业务函数”思想，保留项目已有的 `Tool`、`ToolResult` 和 JSON Schema 格式。

## 2. 设计：两道门，两个受众

### 2.1 开发者注册工具时

`register` 和 `replace` 都经过同一个 `createEntry`，因此声明检查只需放在这里：

```text
register / replace
        │
        ▼
检查名称、描述、parameters、execute、版本和元数据
        │
        ▼
validateToolSchema(parameters)
        │
        ├─ 非法 → 抛出带 Schema 路径的 TypeError，不写入注册表
        │
        └─ 合法 → 按 D027 语义注册或原子替换
```

Schema 是**开发者代码**，不是模型本轮可以修正的输入。因此非法声明使用 `TypeError`，而不是伪装成一次工具执行失败。

`replace` 仍然先完整创建新 entry、再更新 Map。新 Schema 非法时，旧工具的名称、描述、版本和执行函数都保持不变，热插拔能力不回退。

### 2.2 模型调用工具时

```text
模型的 arguments 字符串
        │
        ▼
JSON.parse（空字符串按 D014 兼容语义视为 {}）
        │
        ├─ JSON 语法错误 → INVALID_JSON ToolResult
        │
        ▼
validateArguments（从根值开始递归）
        │
        ├─ Schema 校验失败 → INVALID_ARGUMENTS ToolResult，execute 零调用
        │
        ▼
entry.tool.execute(parsedArguments, context)
        │
        ▼
工具业务结果或工具业务错误
```

模型输入属于**可修正的调用错误**，所以仍然回喂 `{ isError: true, error: { code, message, hint, retryable } }`，由 Agent Loop 交给模型修复。JSON 解析、参数校验和执行器内部错误处理都不向 Loop 泄漏未捕获异常。

## 3. Schema 声明：模型看到的仍是普通 JSON Schema

下面是一个同时包含嵌套对象、数组、必填字段和约束的示例：

```ts
const parameters = {
  type: 'object',
  properties: {
    profile: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1 },
        age: { type: 'integer', minimum: 0, maximum: 150 },
      },
      required: ['name', 'age'],
      additionalProperties: false,
    },
    tags: {
      type: 'array',
      items: { type: 'string', minLength: 1 },
    },
    members: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1 },
        },
        required: ['name'],
        additionalProperties: false,
      },
    },
  },
  required: ['profile', 'tags', 'members'],
  additionalProperties: false,
};
```

注册表把这个对象原样放进 `function.parameters`，不添加私有字段，不改变 OpenAI-compatible 模型的 Tool Schema 格式。`minLength`、`minimum` 和 `maximum` 同时具有两个作用：

- 给模型更明确的生成约束；
- 在服务端真正执行约束，而不是信任模型一定遵守描述。

### 3.1 本日明确支持的子集

| 关键字 | 行为 |
| --- | --- |
| `type: object` | 必须是非 null、非数组对象；工具根 Schema 必须声明此类型 |
| `type: array` | 必须是数组；`items` 存在时逐项递归校验 |
| `type: string` | 必须是字符串；支持 `minLength` |
| `type: number` | 必须是有限数值；支持 `minimum` / `maximum` |
| `type: integer` | 必须是整数；支持 `minimum` / `maximum` |
| `type: boolean` | 必须是布尔值，不把 `0` / `1` 自动转换 |
| `type: null` | 只接受 null，主要用于嵌套声明和内部校验器 |
| `properties` | 对象字段到子 Schema 的映射，逐层递归 |
| `required` | 字符串数组；使用自有属性判断，字段值显式为 null 不等于缺失 |
| `additionalProperties` | 支持布尔值；为 false 时拒绝未声明字段 |
| `enum` | 沿用 D014 的非空允许值检查，适合字符串等标量 |
| `items` | 一个 Schema 对象，不是元组 Schema 数组 |
| `minLength` | 非负整数；按 Unicode 字符计数，而非 UTF-16 code unit 数 |
| `minimum` / `maximum` | 有限数值，边界值本身合法；声明时下限不得大于上限 |

`description` 等供模型阅读的未知关键字继续原样保留；参数校验器不对它们赋予额外语义。本实现不是完整 JSON Schema，也不声称支持 `$ref`、`oneOf`、元组、`pattern`、`format`、对象枚举深比较或隐式类型转换。

## 4. 注册期非法 Schema：尽早给出可定位错误

例如：

```ts
registry.register({
  name: 'broken',
  description: '错误声明示例',
  parameters: {
    type: 'object',
    properties: {
      values: { type: 'array', items: [] },
    },
  },
  execute: async () => ({ content: 'never' }),
});
```

会同步抛出：

```text
TypeError: 非法工具注册：parameters $.properties.values.items，items 必须是单个 Schema 对象（期望 object）
```

注册检查会递归定位：

- 根 `type` 不是 `object`；
- 未知 `type`；
- `properties` 或字段子 Schema 不是对象；
- `required` 不是字符串数组；
- `additionalProperties` 不是布尔值；
- 数组 `items` 不是单个 Schema 对象；
- `minLength` 为负数、非整数，或用在非字符串类型上；
- `minimum` / `maximum` 不是有限数、用在非数值类型上，或范围颠倒；
- `enum` 不是非空数组。

这类失败发生在工具对模型可见之前，避免一个永远无法可靠执行的坏声明进入 Loop。

## 5. 参数校验顺序与根值规则

注册完成后，每次模型调用按以下顺序处理：

1. **解析 JSON**：语法错误直接返回 `INVALID_JSON`。
2. **校验枚举**：当前节点声明 `enum` 时先检查允许值。
3. **校验当前节点类型**：根节点也从这里开始，因此根 `null`、数组、字符串、数值和布尔值都不能冒充工具要求的对象。
4. **校验当前节点约束**：字符串检查 `minLength`，数值依次检查 `minimum`、`maximum`。
5. **递归数组**：有 `items` 时按索引逐项进入子 Schema。
6. **校验对象结构**：依次检查 `required`、额外字段和已声明字段；字段子 Schema 继续递归。
7. **全部通过后才调用 execute**：校验器只返回第一条可读错误，不做参数转换。

空 `arguments: ''` 继续按 D014 契约变为 `{}`；如果工具有必填字段，会在 Schema 阶段得到缺字段错误。根 `arguments: 'null'` 不会被改成 `{}`，而是明确报告根值期望 `object`、实际 `null`。

之所以返回第一条错误，是为了兼容 D014 的错误结构和现有模型修复循环，而不是在本日引入新的批量错误协议。

## 6. 错误路径与修复提示

数组索引用 `[n]`，对象字段用 `.field`，根节点用 `$`。例如：

```json
{
  "profile": { "name": "Ada", "age": 20 },
  "tags": [],
  "members": [{ "name": "Grace" }, { "name": 9 }]
}
```

返回：

```json
{
  "isError": true,
  "error": {
    "code": "INVALID_ARGUMENTS",
    "message": "参数校验失败：$.members[1].name，期望 string，实际为 number",
    "hint": "请修正 $.members[1].name（期望 string）后重试工具调用。",
    "retryable": true
  }
}
```

这条结果可以原样回喂，模型无需猜测究竟是哪一项出错。常见修复信息包括：

| 输入问题 | 路径示例 | 修复方向 |
| --- | --- | --- |
| 缺少对象内必填字段 | `$.profile.name` | 补上该字段 |
| 数组元素类型错误 | `$.tags[1]` | 把第 2 项改为字符串 |
| 数组内对象字段错误 | `$.members[1].name` | 修正对应成员字段 |
| 字符串太短 | `$.profile.name` | 满足 `长度 >= 1` |
| 数值越界 | `$.profile.age` | 满足 `>= 0` 或 `<= 150` |
| 不允许的额外字段 | `$.members[0].extra` | 删除字段，只保留声明字段 |

## 7. 内置工具如何接入

现有工具不更换执行函数，只补充声明：

- `read_file`、`list_dir`、`write_file`、`edit_file` 的 `path` 增加 `minLength: 1`；
- `edit_file.oldText` 增加 `minLength: 1`，`newText` 仍允许空字符串；
- `run_command.command` 增加 `minLength: 1`；
- `run_command.timeoutMs` 声明 `minimum: 1`、`maximum: 30000`。

因此空命令和超出范围的超时会在进程创建之前被 Registry 拒绝。工具内部仍保留原有的领域检查，例如空白命令、路径边界、精确文本匹配和超时执行；直接调用工具函数的旧测试与公共行为不被绕过。

## 8. 如何证明 execute 没有运行

`test/d028-schema-validation.test.ts` 注册了一个真实 Registry 工具，但把 `execute` 换成 Vitest 间谍：

```ts
const execute = vi.fn((args: unknown) =>
  Promise.resolve({ content: JSON.stringify(args) }),
);
registry.register({ name: 'spy', description: '记录合法入参', parameters, execute });
```

测试对每类非法输入都同时断言：

```ts
expect(result.error?.code).toBe('INVALID_ARGUMENTS');
expect(result.error?.message).toContain(expectedPath);
expect(result.error?.hint).toContain(`请修正 ${expectedPath}`);
expect(execute).not.toHaveBeenCalled();
```

覆盖的非法输入包括根值、嵌套必填字段、对象类型、数组类型、数组元素、数组内对象、字符串长度、整数类型、数值上下界和额外字段。另一个合法用例断言：

```ts
expect(execute).toHaveBeenCalledOnce();
expect(execute).toHaveBeenCalledWith(args, { workspaceRoot: '.' });
```

所以测试不是只证明“校验器会拒绝”，还证明了边界两侧的完整行为：**非法值零执行，合法值不丢字段、不改结构地执行一次。**

针对 `run_command`，测试同样使用间谍执行器验证空命令、`timeoutMs: 0` 和 `timeoutMs: 30001` 均在 spawn 之前停止；全部五个内置工具则逐一通过新的注册期检查。

## 9. TDD 与测试

本日先写行为测试并运行 RED，观察到数组、约束和注册期声明尚未被处理；随后扩展实现，目标测试转 GREEN，再跑全量回归。

```bash
# 目标测试
npm test -- test/d028-schema-validation.test.ts test/errors.test.ts

# 全量回归：34 个测试文件，286 个测试
npm test

# lint + typecheck + 全量测试
npm run check

# 覆盖率门槛
npm run test:coverage
```

D028 新文件包含 35 个测试；D014 原有的“忽略 `minLength`”边界测试更新为“支持 `minLength`，其他未知关键字仍忽略”，明确记录本次能力提升。

重点测试组：

- `D028 参数在执行前校验`：间谍零调用与合法调用对照；
- `D028 validateArguments 递归与约束`：数组索引、null、Unicode 长度和数值边界；
- `D028 注册期 Schema 校验`：非法声明路径、replace 原子性、内置工具声明。

## 10. 兼容性与边界

### 保持不变

- Node.js 24、原生 TypeScript、ESM、Vitest，运行时依赖仍为 0；
- `Tool`、`ToolSchema`、`ToolResult`、`ToolRegistry` 的公开调用方式；
- D027 的 register / unregister / replace、版本与元数据、确定性列表和异常回喂；
- D014 的 `INVALID_JSON` / `INVALID_ARGUMENTS` 错误码及可重试语义；
- 模型侧普通 JSON Schema 格式；
- Schema 校验失败不抛出到 Loop，而是返回模型可修正结果。

### 有意收紧

- 以前缺少根 `type: object` 或使用未知类型的工具可能被注册；现在会在注册期得到明确 `TypeError`。这是非法声明的 fail-fast，不是模型运行期 API 破坏。
- `replace` 遇到非法新 Schema 时保留旧工具，而不是写入半成品。

### Schema 不负责什么

Schema 只证明“值的形状与声明约束满足”，不证明业务操作一定成功。例如文件是否存在、文本是否唯一匹配、命令是否退出非零，仍是工具执行期的领域结果。

`run_command` 的 `cwd` 是工作区根目录，不是容器、seccomp 或系统调用沙箱；路径越界检查也不是命令沙箱。D028 没有把 Schema 校验包装成安全边界。

## 11. 与 D029 的衔接

D029 应在这一层之后增加权限策略，而不是把权限塞进 JSON Schema：

```text
JSON 解析
  → Schema 形状/约束校验（D028）
  → 工具权限与操作策略（D029）
  → execute
  → 持久化结果与恢复
```

建议 D029 复用当前 Registry 的统一入口，让“Schema 合法但权限不足”和“Schema 本身非法”使用不同错误码与修复提示。路径读写范围、命令允许列表、网络/进程能力和高风险操作确认应在权限层判断；即使调用者绕过模型，也仍需执行层保留防御。

本日没有实现权限、重试或熔断，它们分别属于后续任务，不在 D028 扩散范围。
