# D029｜权限模型：让工具先获得授权，再执行

> 📅 2026-12-09 ｜ 分支：`D029` ｜ 基线：D028 `9f58c37ad687a5ff8cfe24c0ee1bf86ec2dc8d83`
> 前置：完成 D027（工具注册与热切换）、D028（JSON / Schema 参数校验）
> 前置阅读：`docs/00-manifesto.md`、`docs/04-philosophy/quality-is-everything.md`

---

## 一、今天做什么

D028 保证“参数正确的调用才进入工具”，但还没有回答三个更靠前的问题：

1. 这个调用方有没有权使用这个工具？
2. 这个工具属于哪个租户，当前调用属于哪个租户？
3. 高风险操作是否得到了**这一次调用**的明确确认？

D029 在 D027 的 `ToolRegistry` 内增加最小权限层：

- **工具级白名单**：同时约束模型发现与直接执行；
- **租户隔离**：共享工具、当前租户工具之外，其余工具不可发现、不可执行；
- **敏感工具逐次确认**：每次执行都要针对 `toolCallId` 明确批准，不缓存批准结果；
- **失败安全**：未确认、拒绝确认、确认回调抛错或返回非 `true`，都不会进入 `execute`；
- **统一错误出口**：权限与确认失败仍返回可回喂模型的 `ToolResult`，不冲垮 Loop；
- **默认兼容**：没有配置权限策略的旧 Registry、CLI 与离线 Demo 保持原有用法。

今天不实现账户系统、登录、角色权限、审批 UI、网络服务，也不提前实现 D030。

### 学习成果

完成后应能回答：

- 为什么模型生成的 `ToolCall` 是待授权请求，而不是执行命令？
- 为什么白名单 / 租户检查要先于 JSON 与 Schema 校验？
- 为什么敏感确认要放在参数校验之后、`execute` 之前？
- `allowedTools: undefined` 和 `allowedTools: []` 有什么本质区别？
- 为什么不能让调用方通过 `ToolContext.tenantId` 自己声明租户？
- 为什么“上次同意过”不能推出“这次也同意”？

---

## 二、Threat boundary：信任边界在哪里

### 2.1 不受信任的输入

以下内容都应视为不可信，即使它们来自模型：

- `toolCall.name`、`toolCall.arguments`、`toolCall.id`；
- 模型猜测的、没有出现在本轮 Schema 列表里的工具名；
- 调用方在 `execute` 的上下文中传入的 `tenantId`；
- 畸形 JSON、错误类型，以及试图探测隐藏工具参数规则的请求。

模型可以提出调用意图，但只有宿主配置的 Registry 策略能决定它是否可见、是否可执行。

### 2.2 受信任的宿主配置

以下能力属于部署方 / 宿主的受信任管理面，不应直接暴露给模型：

- `new ToolRegistry(policy)` 中的白名单、租户身份与确认回调；
- `register`、`replace`、`unregister` 等 Registry 管理操作；
- 把某个工具声明为 `tenantId` 或 `sensitive`；
- 确认回调如何把请求呈现给真实用户或宿主审批系统。

一个 Registry 实例代表一个调用主体。需要服务多个租户时，由宿主为各主体建立并保存正确的 Registry，而不是把模型提供的租户字符串当作认证结果。

### 2.3 本日边界不防御什么

这是进程内权限层，不是完整安全边界：

- 不防御已经能修改宿主内存、Registry 或配置对象的恶意代码；
- 不验证租户身份凭证，`tenantId` 只是宿主绑定的隔离标签；
- 不提供用户登录、角色体系、跨进程授权或网络访问控制；
- 不自动判断工具是否敏感，注册者必须显式声明；
- 不代替工具自身的路径、文件类型、退出码等业务约束。

---

## 三、声明工具边界与调用方策略

### 3.1 工具注册：租户与敏感级别

D027 的 `version` 与 `metadata` 原样保留。D029 新增两个一等注册选项：

```ts
registry.register(readFile, {
  version: '1.0.0',
  metadata: { owner: 'workspace' },
  tenantId: 'tenant-a',
});

registry.register(writeFile, {
  version: '1.0.0',
  metadata: { owner: 'workspace', risk: 'write' },
  tenantId: 'tenant-a',
  sensitive: true,
});
```

语义如下：

| 注册选项 | 省略 | 显式配置 |
| --- | --- | --- |
| `tenantId` | 共享工具；兼容旧工具 | 仅精确匹配该租户的 Registry 可见、可执行 |
| `sensitive` | 普通工具 | `true` 时，每次执行前都必须获得本次明确确认 |

`metadata` 仍是调用方自己的发现与路由信息，不替代权限字段。把 `sensitive: true` 写进自定义 metadata 不会自动获得强制确认语义。

### 3.2 Registry 策略：白名单、租户与确认回调

```ts
import { ToolRegistry } from '../src/index.ts';
import type { ToolConfirmationRequest } from '../src/index.ts';

async function approveOnce(request: ToolConfirmationRequest): Promise<boolean> {
  // 由宿主接入终端、桌面确认或已有审批系统。
  // 这里必须针对 request.callId 获取一次新的决定。
  // 超时、取消或异常应返回 false 或抛错，Registry 会安全拒绝。
  return await hostConfirmationPort.approveOnce(request);
}

const registry = new ToolRegistry({
  allowedTools: ['read_file', 'write_file'],
  tenantId: 'tenant-a',
  confirmSensitiveTool: approveOnce,
});
```

`confirmSensitiveTool` 收到的请求为：

```ts
{
  callId: 'call-042',
  toolName: 'write_file',
  args: { path: 'note.txt', content: 'hello' }, // 已通过 Schema 校验
  tenantId: 'tenant-a',                        // 有租户策略时才出现
}
```

确认结果必须严格为 `true` 才批准。`false`、`undefined`、其他真值都不是明确批准。

### 3.3 白名单的默认值不是空数组

| `allowedTools` | 含义 |
| --- | --- |
| 省略 / `undefined` | 不启用白名单，保持 D028 兼容；仍受租户与敏感确认约束 |
| `['read_file']` | 只有名为 `read_file` 的工具可能可见、可执行 |
| `[]` | 显式禁止所有工具 |

白名单和租户是 **AND** 关系：工具必须同时通过两项检查。白名单包含某工具，不会让其他租户的工具变得可见。

### 3.4 租户的默认值不是“全部租户”

| Registry 租户策略 | 未声明租户的工具 | 声明 `tenant-a` | 声明 `tenant-b` |
| --- | --- | --- | --- |
| 未配置 | 可见、可按其他策略执行 | 不可见、不可执行 | 不可见、不可执行 |
| `tenant-a` | 可见、可按其他策略执行 | 可见、可按其他策略执行 | 不可见、不可执行 |
| `tenant-b` | 可见、可按其他策略执行 | 不可见、不可执行 | 可见、可按其他策略执行 |

没有通配符租户，也没有“未配置就全开”的捷径。

`list()`、`discover()`、`describe()` 和 `size` 只反映当前策略可见工具；`UNKNOWN_TOOL` 的候选提示也只使用这份可见集合。直接猜测隐藏工具名只会得到通用 `TOOL_NOT_ALLOWED`，不会得到其 Schema、参数错误、租户列表或确认配置。

工具实际收到的 `ToolContext.tenantId` 由 Registry 策略写入。Registry 会忽略调用方自行传入的租户值，不能用下面的方式越权：

```ts
// registry 绑定 tenant-a；传入 tenant-b 不会改变实际主体。
await registry.execute(call, {
  workspaceRoot: '.',
  tenantId: 'tenant-b',
});
```

---

## 四、完整校验顺序

`Registry.execute` 的顺序是权限设计的一部分：

```text
收到 ToolCall
  ↓
1. 注册表查找：不存在 → UNKNOWN_TOOL
  ↓
2. 白名单 + 租户授权：不通过 → TOOL_NOT_ALLOWED
  ↓
3. JSON.parse：失败 → INVALID_JSON
  ↓
4. Schema 校验：失败 → INVALID_ARGUMENTS
  ↓
5. 敏感工具逐次确认：未批准 / 回调失败 → 标准 ToolError
  ↓
6. tool.execute(args, trustedContext)
  ↓
业务 ToolError → ToolResult，Loop 回喂模型
```

### 4.1 为什么授权在 JSON / Schema 之前

如果先校验隐藏工具的参数，调用方就能通过不同错误探测：

- 工具是否真的存在；
- 某个字段是否必填；
- 字段类型与 Schema 细节；
- 工具是否被标记为敏感。

所以未授权请求即使带有畸形 JSON，也只会得到 `TOOL_NOT_ALLOWED`，不会进入解析、Schema 或确认回调。

### 4.2 为什么确认在 JSON / Schema 之后

确认请求需要呈现有意义的操作内容。畸形 JSON 或错误参数不应该触发用户确认，更不应该以“用户同意过”为由绕过 D028。

因此顺序不是“所有权限都最早”，而是：

- **访问授权尽量早**，避免信息泄露；
- **操作确认足够晚**，确保批准的是合法、明确的参数；
- **两者都必须早于 `execute`**。

---

## 五、确认语义与错误结果

### 5.1 每次执行都重新确认

批准不会写入全局布尔值，也不会按工具名缓存：

```text
call-first  → confirm(call-first)  = true  → 执行一次
call-second → confirm(call-second) = false → 拒绝
```

即使工具名和参数相同，第二次执行仍会调用确认回调。即使调用方重试同一个 `toolCallId`，Registry 也不会复用上一次回调结果。

宿主可以在回调之外实现自身审批流程，但不能把 Registry 当成永久批准存储。

### 5.2 标准错误码

| 错误码 | 触发位置 | retryable | 回喂原则 |
| --- | --- | --- | --- |
| `UNKNOWN_TOOL` | 注册表查找 | `true` | 只提示当前可见工具 |
| `TOOL_NOT_ALLOWED` | 白名单 / 租户 | `false` | 通用拒绝，不附隐藏 Schema 或租户信息 |
| `INVALID_JSON` | JSON 解析 | `true` | 沿用 D028，可修正 arguments |
| `INVALID_ARGUMENTS` | Schema 校验 | `true` | 沿用 D028，定位可见工具的具体字段 |
| `TOOL_CONFIRMATION_REQUIRED` | 无回调、回调拒绝或非 `true` | `false` | 本次未获明确确认，不执行 |
| `TOOL_CONFIRMATION_FAILED` | 回调抛错 / Promise reject | `false` | 不回传回调异常、密钥或后端细节 |

权限拒绝示意：

```json
{
  "content": "工具执行失败：当前策略不允许调用该工具",
  "isError": true,
  "error": {
    "code": "TOOL_NOT_ALLOWED",
    "message": "当前策略不允许调用该工具",
    "retryable": false,
    "hint": "请改用当前策略可见且允许的工具"
  }
}
```

Loop 仍按 D026 的方式把它序列化为 `role: 'tool'` 消息，并保留原 `toolCallId`。下一轮模型可以放弃、解释或选择已授权工具；Loop 不需要了解权限细节，也不会因拒绝而崩溃。

---

## 六、默认行为与兼容性

### 6.1 不传策略的旧代码

```ts
const registry = new ToolRegistry();
registry.register(tool); // 未声明 tenantId / sensitive

registry.list();
await registry.execute(call, { workspaceRoot: '.' });
```

这与 D028 相同：工具可发现，JSON / Schema 校验不变，业务异常仍规范化为 `ToolResult`。`runAgentLoop`、CLI、持久化 Runner 和 `createBuiltinTools` 都无须修改。

需要注意：新声明的租户工具或敏感工具本来就不是旧代码。对它们故意采用失败关闭：

- 没配置对应租户 → 拒绝租户工具；
- 没配置确认回调 → 拒绝敏感工具。

### 6.2 内置工具不会自动变成敏感工具

为了保留现有离线 Demo 与公共 API，本日没有给 `write_file`、`edit_file` 或 `run_command` 暗中追加全局确认。宿主如果认为某次部署中的某个内置工具敏感，应在注册时明确写出：

```ts
registry.register(runCommand, {
  sensitive: true,
  metadata: { risk: 'shell' },
});
```

这样默认兼容与部署方的风险分类不会互相偷换。

### 6.3 管理面与执行面

策略过滤的是发现与执行，不替宿主管理注册表生命周期。`replace` 会按新注册项重新声明租户 / 敏感级别；宿主必须在热切换时重新提供这些选项，不能依赖旧项自动继承。

---

## 七、TDD 与验证

### 7.1 RED → GREEN

先在 `test/d029-permissions.test.ts` 编写期望 API 与行为，再运行：

```bash
npm test -- test/d029-permissions.test.ts
```

D028 基线上实际观察到失败：白名单被忽略、跨租户工具仍执行、敏感工具未经确认执行、Loop 收到执行结果而非拒绝。确认顺序用例还加入合法调用对照，避免它仅因“根本没有确认功能”而假通过。

随后实现最小权限层，同一测试转为全绿。

### 7.2 覆盖场景

- 白名单内工具通过，白名单外工具发现与执行均被拒绝；
- 未授权畸形 JSON 不触发 JSON / Schema 探测；
- 当前租户、共享工具与其他租户的发现 / 执行边界；
- 未配置租户时不默认开放租户工具；
- 调用方伪造 `ToolContext.tenantId` 不能提权；
- 敏感工具批准、拒绝、缺少回调、回调异常、逐次重新确认；
- 参数错误不触发确认，所有拒绝路径均不调用 `execute`；
- 确认后端异常不会进入模型可见内容；
- Loop 将权限拒绝回喂并继续完成；
- D027 元数据 / 热切换、D028 JSON / Schema、标准错误与离线 Demo 回归。

### 7.3 命令

```bash
# 新行为与关键兼容回归
npm test -- test/d029-permissions.test.ts \
  test/d027-tool-registry.test.ts \
  test/d028-schema-validation.test.ts \
  test/loop.test.ts test/errors.test.ts \
  test/d025-offline-demo.test.ts

# 全量质量门
npm run check
npm run test:coverage

# 无权限配置的 G1 离线演示仍可直接运行
node --experimental-strip-types src/demo/g1.ts
```

本分支在 Node.js `v24.19.0` 下的实际验收结果：

- `npm run check`：Lint、TypeScript、35 个测试文件共 296 个测试全部通过；
- `npm run test:coverage`：语句 `94.62%`、分支 `90.38%`、函数 `99.47%`、行 `95.42%`；
- `src/tools/registry.ts`：语句 `98.57%`、分支 `98.63%`、函数 `100%`、行 `98.50%`；
- `npm run demo:g1`：无权限策略的真实离线修复闭环通过。

---

## 八、限制与 D030 衔接

本日刻意保持边界小而真实：

1. **一个 Registry 一个主体**：没有进程内多租户会话池，宿主负责绑定实例与身份。
2. **没有确认超时器**：永不 resolve 的回调会让调用一直等待；宿主应在自己的确认端口实现超时并拒绝。
3. **没有审批 UI**：回调只是宿主集成点，不规定终端、桌面或远程审批方式。
4. **没有自动风险分类**：是否敏感由注册者声明，默认旧工具不会突然被锁定。
5. **没有权限审计持久化**：标准错误已能回喂，但尚未形成独立审计日志或指标。
6. **不是恶意进程沙箱**：工具自身业务校验、工作区边界与进程隔离仍是不同层次。

D030 可以在不移动本日安全顺序的前提下继续增强运行保障，例如记录授权 / 确认决策、补充超时与审计，或处理执行后的可靠性问题。后续改动必须保持两条底线：**未授权不能借校验顺序探测信息，任何失败路径都不能跳过本次确认直接进入 `execute`。**
