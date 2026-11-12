# Personal Agent Harness — D030 工具执行韧性

D030 的目标只有一件事：**单个工具故障不拖垮整体**。

D029 已经有工具 Schema 校验、租户隔离、工具白名单和敏感工具确认。本日在不改变这些语义的前提下，为每次 `ToolRegistry.execute()` 增加四种可独立启用的能力：

1. **每次尝试超时**：把拖住的调用转成标准错误；
2. **安全重试**：只重试明确可重试的故障，默认不重试；
3. **有界限流**：限制并发、队列长度和排队等待时间；
4. **熔断与单探针恢复**：连续故障时快速失败，冷却后受控探测恢复。

Node.js 24、原生 TypeScript、ESM、Vitest，零运行时依赖。未配置 `resilience` 的工具仍走 D029 的直接执行路径，内置工具和离线 Demo 不需要修改。

---

## 1. 从哪里接入

注册工具时传入 `resilience`。四种策略都可省略，公共配置类型从包入口导出：

```ts
import {
  ToolRegistry,
  type Tool,
  type ToolResilienceOptions,
} from 'personal-agent';

const resilience: ToolResilienceOptions = {
  timeoutMs: 800,
  retry: {
    maxRetries: 2,
    baseDelayMs: 100,
    idempotent: true,
  },
  rateLimit: {
    maxConcurrent: 2,
    maxQueue: 4,
    maxWaitMs: 500,
  },
  circuitBreaker: {
    failureThreshold: 3,
    cooldownMs: 5_000,
  },
};

const registry = new ToolRegistry();
registry.register(readOnlyRemoteTool, { resilience });
```

这个例子的含义是：一个逻辑调用最多执行 3 次，每次最多 800ms；第一次重试前等 100ms，第二次前等 200ms；同一注册条目最多同时执行 2 个逻辑调用，另有最多 4 个调用排队，每个最多等 500ms；连续 3 个逻辑调用发生可计数失败后熔断 5 秒。

### 默认值与安全边界

| 配置 | 默认值 | 含义 |
| --- | ---: | --- |
| `resilience` | `undefined` | 不包装，完整保留 D029 行为 |
| `timeoutMs` | 不启用 | Registry 不增加单次尝试超时 |
| `retry.maxRetries` | `0` | 首次失败后不再尝试 |
| `retry.baseDelayMs` | `100` | 指数退避的起始毫秒数 |
| `retry.idempotent` | `false` | 不把工具默认当成幂等 |
| `retry.allowNonIdempotent` | `false` | 不允许非幂等工具自动重试 |
| `rateLimit` | 不启用 | 不增加 Registry 并发限制 |
| `rateLimit.maxQueue` | `0` | 许可占满时直接拒绝，不排队 |
| `rateLimit.maxWaitMs` | `1000` | 排队调用的最长等待时间 |
| `circuitBreaker` | 不启用 | 不统计失败，也不快速失败 |

`maxRetries` 是**首次执行之后的额外次数**，不是总次数。因此 `maxRetries: 2` 最多调用工具 3 次。

非幂等工具必须明确承担重复执行风险才会重试：

```ts
registry.register(idempotentByRequestKeyTool, {
  resilience: {
    retry: {
      maxRetries: 1,
      allowNonIdempotent: true,
      baseDelayMs: 200,
    },
  },
});
```

这里的配置名只是风险提示，不会自动让操作变幂等。对 `write_file`、`edit_file`、`run_command`、支付或创建资源的工具，只有在确有去重键、事务或其他服务端去重保障时才应考虑此选项。

---

## 2. 统一执行顺序

D029 的参数解析、Schema 校验、租户策略和敏感确认仍由 Registry 完成，而且只进行一次。进入韧性执行器后，顺序如下：

```text
Registry.execute
  │
  ├─ JSON / 参数 / Schema / 租户权限 / 敏感确认（D029，只执行一次）
  │
  ├─ 未配置 resilience ───────────────────────→ 直接 tool.execute（旧路径）
  │
  └─ 已配置 resilience
       │
       ├─ 熔断预检：冷却期直接失败，不必先排队
       ├─ 取得限流许可：直接执行 / 有界排队 / 拒绝
       ├─ 熔断复核：排队期间状态可能已改变
       │
       ├─ 逻辑调用的第 1 次尝试
       │    └─ 外部取消 + 本次尝试 timeoutMs + tool.execute
       ├─ 可重试且已 opt-in？
       │    └─ 是：可取消的指数退避，再进入下一次尝试
       │
       ├─ 按最终 ToolResult 给本次逻辑调用记一次熔断结果
       └─ 释放限流许可，唤醒一个仍存活的排队者
```

这个顺序有三个重要结果：

- **限流覆盖整个逻辑调用**，包括重试和退避，避免重试绕过并发上限；
- **熔断按逻辑调用计数**，一个调用内部的 3 次失败尝试只记一次失败；
- **超时按尝试计时**，重试会获得新的尝试预算，而不是共享一个总超时。

---

## 3. 每次尝试超时与外部取消

### 3.1 协作式取消

启用韧性执行器后，每次尝试都会得到一个新的 `AbortSignal`：

- 外部 `context.signal` 取消时，内部 signal 同步取消，并保留外部 `signal.reason`；
- `timeoutMs` 到期时，只取消本次尝试的内部 signal；
- 已经在外部取消状态的调用不会进入工具；
- 正在排队或退避时收到外部取消，也会立即结束等待。

标准错误如下：

| 错误码 | `retryable` | 触发条件 |
| --- | ---: | --- |
| `TOOL_TIMEOUT` | `true` | 某次尝试超过 `timeoutMs` |
| `TOOL_CANCELLED` | `false` | 外部 `AbortSignal` 取消 |

`TOOL_TIMEOUT` 只有在重试已启用且满足其他安全条件时才会自动重试。`TOOL_CANCELLED` 不重试，也不计入熔断失败。

### 3.2 迟到结果与 rejection

超时或取消只是决定本次 Registry 调用的结果。执行器会同时处理工具 Promise 的迟到 fulfill 和迟到 rejection：

- 迟到结果不会覆盖已经返回的超时/取消结果；
- 迟到 rejection 有拒绝处理器，不会遗留未处理 rejection；
- 外部取消不会把 `signal.reason` 拼进返回给模型的文本，避免泄漏调用方对象或敏感信息。

### 3.3 不能承诺“强制停止”

如果工具忽略 `context.signal`，Registry 仍会及时返回标准错误，但**无法强制停止工具内部工作**。文件写入、网络请求或子进程可能继续，副作用也可能发生。同步 CPU 死循环同样无法被 JavaScript 定时器抢占。

工具作者必须自己响应 signal，才能真正停止工作。`run_command` 已有自己的命令超时和进程取消机制；Registry 的 `TOOL_TIMEOUT` 是外层保险丝，不会把内部已有的 `COMMAND_TIMEOUT` 改写成其他错误。

---

## 4. 安全重试

一次失败后，必须同时满足以下条件才会重试：

1. 结果是标准错误，且 `error.retryable === true`；
2. 错误码不属于禁止重试集合；
3. 尚未达到 `maxRetries`；
4. 配置了 `idempotent: true` 或 `allowNonIdempotent: true`；
5. 外部 signal 尚未取消。

以下错误绝不自动重试，即使工具错误地把它们标成 `retryable: true`：

```text
INVALID_JSON
INVALID_ARGUMENTS
UNKNOWN_TOOL
TOOL_SCHEMA_INVALID
PATH_OUTSIDE_WORKSPACE
TOOL_NOT_ALLOWED
TOOL_CONFIRMATION_REQUIRED
TOOL_CONFIRMATION_FAILED
COMMAND_CANCELLED
TOOL_CANCELLED
TOOL_RATE_LIMITED
TOOL_CIRCUIT_OPEN
```

参数错误、越权、缺少确认都不是“多试几次就会好”的故障。限流与熔断错误位于重试层之外，也不会在当前逻辑调用里形成隐式无限重试。

退避公式很简单：

```text
第 1 次重试前：baseDelayMs
第 2 次重试前：baseDelayMs × 2
第 3 次重试前：baseDelayMs × 4
...
```

等待可被外部取消打断。当前版本没有 jitter，这是有意的最小实现；大量客户端同时故障时，应在调用层增加抖动或分散调度。

重试沿用同一份已解析参数和已确认的上下文，不会重新进行敏感确认。因此，敏感且有副作用的工具更不能把自动重试当作默认操作。

---

## 5. 有界限流

限流状态属于**当前 Registry 实例中的一个工具注册条目**。两个工具互不占许可；`replace()` 会创建新条目并重置其限流状态。它不是跨进程的全局限流器。

### 5.1 直接拒绝模式

```ts
resilience: {
  rateLimit: { maxConcurrent: 1 },
}
```

一个逻辑调用仍在执行或退避时，下一个调用立即得到 `TOOL_RATE_LIMITED`。默认 `maxQueue: 0`，不存在隐藏的无限队列。

### 5.2 有界排队模式

```ts
resilience: {
  rateLimit: {
    maxConcurrent: 2,
    maxQueue: 8,
    maxWaitMs: 1_000,
  },
}
```

- 活跃逻辑调用数最多为 `maxConcurrent`；
- 等待者最多为 `maxQueue`，队列满时立即拒绝；
- 每个等待者最多等待 `maxWaitMs`，超时后从队列移除；
- 等待者按 FIFO 取得释放的许可；
- 外部取消会把等待者从队列移除，不会卡住后续调用；
- 取得许可后会再次检查熔断状态，排队期间打开的熔断器仍会阻止执行。

队列满和排队超时都返回 `TOOL_RATE_LIMITED`，通过标准 `content` 区分原因。它的 `retryable: true` 表示调用方可以稍后重试，不表示本框架会在后台自动重试。

---

## 6. 熔断、冷却与 half-open

### 6.1 失败计数口径

只有逻辑调用最终返回的错误同时满足以下条件才计数：

```text
result.isError === true
AND result.error.retryable === true
AND 错误码不在“禁止重试”集合中
```

因此 `COMMAND_FAILED`、未耗尽的内部异常和重试耗尽后的 `TOOL_TIMEOUT` 可以计数；参数、权限、确认、外部取消、限流和熔断拒绝不会烧断工具。`retryable: false` 的永久业务错误也不计数。

这是基于工具错误元数据的启发式判断，而不是网络健康检查。工具作者应准确设置 `retryable`；例如某个文件不存在是否代表工具不健康，需要由具体工具的语义决定。

一次逻辑调用无论内部尝试多少次，最终最多记一次失败。`closed` 状态下成功会把连续失败数清零；不可计数的调用错误既不增加也不清零计数。

### 6.2 状态图

```text
                         成功：计数清零
                    ┌──────────────────────┐
                    │                      │
                    ▼                      │
                 CLOSED                    │
                    │                      │
                    │ 可计数失败达到 failureThreshold
                    ▼                      │
                  OPEN                     │
                    │                      │
          冷却期内：TOOL_CIRCUIT_OPEN       │
          不执行工具、不等待退避             │
                    │                      │
                    │ cooldownMs 到期       │
                    ▼                      │
                HALF_OPEN                  │
             只允许一个实际探针             │
             并发请求快速失败               │
                    │                      │
          ┌─────────┴─────────┐            │
          │                   │            │
       探针成功            探针可计数失败    │
          │                   │            │
          └───────────────────┘            │
          │                   │            │
          ▼                   ▼            │
        CLOSED ───────────── OPEN           │
                            重新开始冷却      │
```

更精确地说：探针成功关闭熔断；探针发生可计数失败会写入新的打开时间并重新冷却。探针若返回参数/权限等不可计数错误，不会证明工具恢复健康，也不会延长冷却；熔断器保持打开，后续调用可再尝试一个探针。

在 `open` 状态下，之前已运行的普通并发调用即使迟到成功，也不能代替 half-open 探针关闭熔断器。`cooldownMs: 0` 表示立即允许单探针，但仍不会放开并发探针。

熔断状态同样只在当前 Registry 注册条目内有效；替换工具会重置状态，进程重启不会恢复历史计数。

---

## 7. 标准错误速查

| 错误码 | 默认 `retryable` | 当前逻辑调用会自动重试吗 | 计入熔断吗 |
| --- | ---: | --- | --- |
| `TOOL_TIMEOUT` | `true` | 满足重试配置时 | 最终仍失败时计入 |
| `TOOL_CANCELLED` | `false` | 否 | 否 |
| `TOOL_RATE_LIMITED` | `true` | 否，调用方稍后决定 | 否 |
| `TOOL_CIRCUIT_OPEN` | `true` | 否，调用方稍后决定 | 否 |
| 参数 / 权限 / 确认错误 | 保持原值 | 绝不 | 否 |
| 其他工具错误 | 保持原值 | 仅显式 `retryable=true` 且安全 opt-in | 同左 |

这些错误都使用既有 `ToolResult` / `ToolError` 结构，不会从 Registry 抛出未包装的普通异常。Loop 继续把工具结果回喂给模型；一个工具的错误不会让同轮其他健康工具消失。

---

## 8. 测试与验证

新增测试：`test/d030-resilience.test.ts`。

```bash
# D030 的 40 个行为与集成用例
npm test -- --run test/d030-resilience.test.ts

# lint + TypeScript + 全套测试
npm run check

# 全套测试与覆盖率
npm run test:coverage
```

测试覆盖：

- 每次尝试超时、外部 reason 透传、预取消、迟到 rejection；
- 无配置时原 signal 身份和原结果对象保持不变；
- 默认 0 次重试、非幂等默认不重试、显式 opt-in、指数退避、退避取消；
- `INVALID_JSON` / 参数 / 权限 / 确认等禁止重试；
- 并发占满直接拒绝、队列上限、排队超时、排队取消、工具间隔离；
- 熔断打开、冷却、成功关闭、失败重开、单 half-open 探针；
- 参数/权限错误不计入熔断，成功清零，重试只计一次逻辑失败；
- 非法数值配置在注册时失败且不留下半个工具；
- **Loop 端到端**：故障工具两次尝试都超时后，标准错误与健康工具结果一起回喂，第二轮正常完成。

定时测试使用 Vitest fake timers，冷却与退避不需要真实等待。建议交付前重复运行 D030 文件，检查异步测试是否稳定。

---

## 9. 限制与后续边界

- 这是 Registry 执行层的轻量策略，不是分布式限流、跨进程熔断或任务队列；
- 不注入假时钟，生产使用 `Date.now()` 和原生 timer，测试使用 fake timers；
- 无 jitter、无动态退避、无指标后端，避免在 D030 扩成通用框架；
- 忽略 signal 的工具不能被强制取消，只能隔离等待结果并消费迟到 rejection；
- 非幂等 opt-in 只是授权重复尝试，不提供副作用去重；
- D029 的租户、白名单、敏感确认语义保持不变；
- 不修改 D031 ADR，也不提前实现后续 MCP 或跨 Registry 状态共享。
