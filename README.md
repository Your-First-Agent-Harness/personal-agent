# Personal Agent · 第 42 天

**进度：D042 / D100 · v0.1.0 · 主题：第三方 API 接入（Open-Meteo 当前天气）**

D041 已经用嵌套知识工具把一次用户请求变成「两层工具调用 → 最后回答」。D042 跨过本机边界：把一个**真实、只读、无密钥的 HTTPS API** 接入同一个 Tool / ToolRegistry / AgentLoop，而不是在 Demo 中直接 `fetch` 后拼一段天气文本。

本日只交付一个内置 Tool：`weather_current`。它请求 Open-Meteo 当前天气，不做搜索或翻译，不引入 SDK，不新增运行时依赖，也不把 D043 的通用安全沙箱提前塞进本日。

---

## 1. 今日运行

### 真实第三方 Demo（默认就是 live）

```bash
npm ci
npm run check
npm run demo:d042
```

环境：Node 24、原生 TypeScript ESM、原生 `fetch`。无需 API Key，也不需要 `.env`。

Demo 中：

- 模型是离线、确定性的两轮脚本，不访问模型服务；
- 第一轮模型只产生 `weather_current` ToolCall；
- **真实 Tool 使用生产默认 `fetch` 请求真实 Open-Meteo**；
- 第二轮模型只读取对应 Tool Message 并组织回答；
- 任一请求、校验或天气结果检查失败时，不打印 `PASS`，CLI 退出非零。

### 重新采集真实 evidence

```bash
set -o pipefail
npm run demo:d042 2>&1 | tee evidence/d042-transcript.txt
```

当前证据：[`evidence/d042-transcript.txt`](./evidence/d042-transcript.txt)。本轮真实运行退出码为 **0**。天气会随时间和 Open-Meteo 网格更新，所以复跑数值漂移是正常现象，不应修改旧证据来追逐新数值。

### 离线可重复验证

```bash
npx vitest run test/d042-weather.test.ts test/d042-demo.test.ts
```

测试通过工厂注入确定性 fake `fetch`，不访问外网。`runD042Demo(output, { mode: 'offline', fetchImpl })` 也使用真实 AgentLoop、Registry 和 Tool 边界，但它**不是第三方真实调用证据**；离线输出会明确写出这一点。

---

## 2. 本轮真实 transcript

以下是本轮已保存的真实 Open-Meteo 响应摘要，不是 fixture：

```text
> personal-agent@0.1.0 demo:d042
> node scripts/d042-weather.ts

D042 Demo：真实 AgentLoop + 离线确定性模型 + weather_current。
transport=live：真实 Open-Meteo HTTPS API，无 API Key。
host=api.open-meteo.com
输入={"latitude":31.2304,"longitude":121.4737}
工具调用=weather_current 参数={"latitude":31.2304,"longitude":121.4737}
最终回答=Open-Meteo 当前天气：Asia/Shanghai，观测时间 2026-11-13T07:30，温度 15.5°C，风速 7.4km/h，weather_code=3。来源：open-meteo。
turns=2 stopReason=completed
天气来源=open-meteo 经纬度=31.247803,121.5 时区=Asia/Shanghai observed_at=2026-11-13T07:30
温度=15.5°C 风速=7.4km/h weather_code=3
D042 Demo PASS：真实 Loop 已完成 toolCall → tool → final，最终回答只使用工具消息。
```

`31.2304,121.4737` 是请求坐标；`31.247803,121.5` 是 Open-Meteo 实际返回的天气网格坐标。输出保留后者，不把请求坐标冒充服务观测位置。

`weather_code=3` 是 API 返回的 WMO 代码。本日不自行编造天气描述或代码映射。

---

## 3. 为什么选无密钥天气 API

一个最小第三方接入仍然必须回答四个问题：

1. **调用方能否决定网络目的地？** 若可以，工具很容易变成 SSRF 通道。
2. **第三方失败如何进入 AgentLoop？** 原始异常、HTML 错误页和完整响应体不应直接灌回模型。
3. **请求会占用多少时间和内存？** 没有超时与响应上限的 `fetch` 不是可靠工具。
4. **最终回答的依据在哪里？** 天气必须来自 Tool Message，而不是脚本中的固定文案。

Open-Meteo 的 Forecast API 适合用来练习这些边界：

- 当前天气可通过 HTTPS GET 读取，不需要凭证，避免把密钥管理混入第一堂网络课；
- 输入只需经纬度，容易做严格 Schema 和范围校验；
- 当前温度、风速、天气代码、时区和观测时间都是结构化数据，便于做响应形状校验；
- 可以真实验证「模型发 ToolCall，工具出网，模型再基于 Tool Message 回答」的完整链路。

无密钥不等于无成本、无隐私问题或无限配额。仍应遵守服务条款、控制调用频率，并把经纬度视为可能敏感的位置数据。

---

## 4. HTTP 数据流

```text
离线脚本模型（第 1 轮）
  │ toolCall(name=weather_current, arguments={latitude,longitude})
  ▼
AgentLoop → ToolRegistry
  │ JSON.parse ToolCall.arguments
  │ JSON Schema：类型、必填、additionalProperties、经纬度范围
  ▼
weather_current.execute
  │ 直接执行边界再次校验数值与额外字段
  │ 固定 https://api.open-meteo.com/v1/forecast
  │ URLSearchParams 编码数值与固定查询参数
  ▼
原生 fetch（GET / redirect:error / Accept: application/json）
  │ 默认 10 秒内部 AbortController + 调用方 AbortSignal
  ▼
Open-Meteo HTTPS
  │ 非 2xx？→ 上游 HTTP 错误，不透出响应体
  │ Content-Type 不是 JSON？→ 无效响应
  │ Content-Length 超限？→ 读取正文前拒绝
  │ 分块累计超过 64 KiB？→ cancel reader 并拒绝
  ▼
有界 UTF-8 解码 → JSON.parse → 字段与类型校验
  │ 只抽取约定的 current / current_units 字段
  ▼
结构化 JSON ToolResult
  │ role=tool、toolCallId=d042-weather
  ▼
离线脚本模型（第 2 轮）
  │ 只读取这条 Tool Message
  ▼
最终天气回答 + turns=2 + stopReason=completed
```

关键分层：模型不能直接调用 `fetch`，Demo 不能把天气作为隐藏常量交给第二轮，Tool 也不能把任意上游 body 当成可信 ToolResult。

---

## 5. 输入 Schema 与固定请求

### Tool 输入

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "latitude": {
      "type": "number",
      "minimum": -90,
      "maximum": 90
    },
    "longitude": {
      "type": "number",
      "minimum": -180,
      "maximum": 180
    }
  },
  "required": ["latitude", "longitude"]
}
```

Registry 负责常规 ToolCall 的 Schema 校验；Tool 内部还校验有限数值、范围和额外键，避免直接调用 `tool.execute` 时绕过边界。NaN、Infinity、字符串坐标和调用方提供的 `url` 都不会进入网络请求。

### 固定目的地与参数

```ts
const endpoint = new URL('https://api.open-meteo.com/v1/forecast');
endpoint.search = new URLSearchParams({
  latitude: String(input.latitude),
  longitude: String(input.longitude),
  current: 'temperature_2m,wind_speed_10m,weather_code',
  timezone: 'auto',
  temperature_unit: 'celsius',
  wind_speed_unit: 'kmh',
}).toString();
```

| 参数 | 固定值或来源 | 目的 |
|---|---|---|
| `latitude` / `longitude` | 已校验的数值输入 | 选择天气位置 |
| `current` | `temperature_2m,wind_speed_10m,weather_code` | 只取本日需要的当前字段 |
| `timezone=auto` | 固定 | 让返回的本地观测时间附带明确时区 |
| `temperature_unit=celsius` | 固定 | 请求摄氏温度 |
| `wind_speed_unit=kmh` | 固定 | 请求 km/h 风速 |

没有 URL、origin、path、headers、credentials、API Key 或任意查询参数输入。`URLSearchParams` 负责编码，不拼接未经编码的用户字符串。

---

## 6. 输出 Schema

Tool 成功时，`ToolResult.content` 是结构化 JSON 文本。TypeScript 对应：

```ts
interface WeatherCurrentResult {
  source: 'open-meteo';
  latitude: number;
  longitude: number;
  timezone: string;
  observed_at: string;
  temperature_2m: number;
  temperature_unit: string;
  wind_speed_10m: number;
  wind_speed_unit: string;
  weather_code: number;
}
```

本轮真实值对应：

```json
{
  "source": "open-meteo",
  "latitude": 31.247803,
  "longitude": 121.5,
  "timezone": "Asia/Shanghai",
  "observed_at": "2026-11-13T07:30",
  "temperature_2m": 15.5,
  "temperature_unit": "°C",
  "wind_speed_10m": 7.4,
  "wind_speed_unit": "km/h",
  "weather_code": 3
}
```

字段约束：

- `source` 由已知请求来源确定，不从上游 body 中信任一个 `source` 字段；
- 经纬度必须是有限数值且仍在合法范围；
- `timezone`、`observed_at`、温度单位、风速单位必须是非空字符串；
- 温度、风速和 `weather_code` 必须是有限数值；
- `observed_at` 是返回时区下的 ISO 本地时间，阅读时必须与 `timezone` 一起解释；
- 缺失 `current` / `current_units`、字段类型错误或空单位都会成为 `UPSTREAM_INVALID_RESPONSE`，不会输出 `undefined` 天气。

### 作为库调用

```ts
import { createWeatherCurrentTool, ToolRegistry } from './src/index.ts';

const registry = new ToolRegistry();
registry.register(createWeatherCurrentTool()); // 默认真实 fetch、10 秒、64 KiB

const result = await registry.execute({
  id: 'weather-1',
  name: 'weather_current',
  arguments: JSON.stringify({ latitude: 31.2304, longitude: 121.4737 }),
}, { workspaceRoot: process.cwd() });

if (result.isError) {
  // 读取 result.error.code / result.error.message，不解析上游错误页。
} else {
  const weather = JSON.parse(result.content);
}
```

---

## 7. 第三方错误与项目 ToolResult 的分层

网络适配层内部使用 `OpenMeteoError` 表示 `http / network / timeout / invalid_response / response_too_large`，HTTP 错误另保留数值 `status`。只有到了项目 Tool 边界，才映射成 `ToolError`；Registry 再按既有契约返回 `ToolResult.error`。

这样不会把第三方异常类泄漏成整个 Agent 的公共错误协议，也不会把 Open-Meteo 的原始错误 body 当成项目错误消息。

| 条件 | `ToolResult.error.code` | retryable | 安全处理 |
|---|---|---:|---|
| Registry Schema 参数错误 | `INVALID_ARGUMENTS` | `true` | 按 D028 既有 Schema 错误契约；不发起请求 |
| Tool 内直接执行参数错误 | `INVALID_ARGUMENTS` | `false` | 不发起请求 |
| 非 2xx，非 429/5xx | `UPSTREAM_HTTP_ERROR` | `false` | 只保留 HTTP 状态，不透出 body |
| HTTP 429 或 5xx | `UPSTREAM_HTTP_ERROR` | `true` | 只表示调用方可自行决定重试 |
| 网络或响应读取失败 | `UPSTREAM_NETWORK_ERROR` | `true` | 不透出底层错误消息 |
| 内部超时 | `TOOL_TIMEOUT` | `true` | 中止请求，包含配置的毫秒数 |
| 调用方取消 | `TOOL_CANCELLED` | `false` | 不透出取消 reason |
| 非 JSON Content-Type、无效 UTF-8/JSON、形状错误 | `UPSTREAM_INVALID_RESPONSE` | `false` | 不返回原始响应体 |
| Content-Length 或分块累计超限 | `UPSTREAM_RESPONSE_TOO_LARGE` | `false` | 取消正文并给出字节上限 |

`retryable` 只是元数据。本日注册 Tool 时**没有附加 ResilientExecutor，也没有自动重试**。即使 Registry 已具备重试能力，也不意味着每个第三方请求都应盲目叠加 retry：实时天气调用可能遇到限流，调用方需要显式决定是否增加退避、幂等键和调用预算。

---

## 8. 超时、取消与响应上限

### 时间边界

- 默认 `timeoutMs = 10_000`；工厂可为测试注入更短超时。
- 内部 `AbortController` 在超时后 abort 原生 fetch。
- `ToolContext.signal` 会转发到同一个 controller。
- 外部已取消时，不调用 fetch；等待期间取消与内部超时映射为不同错误。
- 请求完成、失败或取消后都清理 timer 与 abort listener。
- 生产默认原生 fetch 遵循 AbortSignal；自定义注入的 fetch 也必须遵守该契约，否则工具无法强行结束一个永不 settle 的任意 Promise。

### 字节边界

- 默认 `maxResponseBytes = 65_536`（64 KiB）。
- 合法 `Content-Length` 已超限时，先取消 body，不创建 reader 读取正文。
- 没有 Content-Length 或声明不准确时，以 `reader.read()` 的累计字节数为准；超过上限立即 cancel。
- 上限作用于压缩传输解码后的响应字节；不是只检查字符数。
- 不使用无上限的 `response.text()` / `response.arrayBuffer()` 后再判断大小。
- 只有有界读取完成后才做 UTF-8 解码和 JSON.parse。

`timeoutMs` 与 `maxResponseBytes` 都必须是正整数；测试可注入边界，生产默认值仍为真实 fetch。

---

## 9. 隐私与网络安全边界

| 风险 | 本日边界 |
|---|---|
| 调用方传内网 URL，形成 SSRF | 目的地和 path 全固定；Schema 禁止额外字段；`redirect: 'error'` 不跟随重定向 |
| 查询参数注入 | 只接受有限数值坐标，其他参数固定；统一使用 `URLSearchParams` |
| 上游错误页或网络异常泄露秘密 | 错误只保留状态、类别和安全摘要，不包含完整 body、原始异常或响应头 |
| 巨大响应耗尽内存 | Content-Length 预检 + 64 KiB 流式累计上限 |
| 慢响应长期占用 Loop | 10 秒内部超时 + 外部取消 |
| 上游临时错误引发请求风暴 | 本日不自动重试；重试语义仅作为 ToolResult 元数据 |
| 把第三方内容当事实或指令 | 只抽取约定的数据字段；最终模型被约束只依据 Tool Message；第三方可用性仍不由本项目保证 |
| 位置隐私 | 请求只包含经纬度，不读取环境变量或账户数据；Demo 使用上海城市级坐标，不收集用户位置 |

天气响应依然是不可信第三方输入。本日只把它作为数据处理，不执行其中的文本、不把响应作为 HTML 渲染，也不允许它改变工具目的地。

**D033–D035 的文件路径检查不是网络沙箱。** 固定 HTTPS origin、禁止重定向和输入校验只是这个单一 Tool 的最小防线，不是通用出口防火墙，不是任意第三方工具的 SSRF 解决方案，也不是凭据隔离系统。D043 才讲统一安全沙箱，D044 讲网络层安全（SSRF / 出站代理），D045 讲完整安全架构；本日没有声称完成这些治理能力。

---

## 10. 真实 Loop 与离线模型如何配合

第一轮脚本 Provider 只返回：

```text
weather_current({"latitude":31.2304,"longitude":121.4737})
```

AgentLoop 校验并执行真实工具，追加 Tool Message。第二轮 Provider 只查找 `toolCallId=d042-weather` 的 Tool Message，并从中读取温度、风速、代码和观测时间。它没有第二份天气 fixture。

因此 live 模式证明的是：

```text
确定 ToolCall + 真实第三方 HTTP + 真实 ToolResult + 基于 Tool Message 的最终回答
```

它没有假装验证一个真实 LLM 会选择正确工具。离线模式则用同一 Loop 做可重复回归，并明确标记 `transport=offline`，避免把 fake fetch 当真实外部证据。

CLI 打印 host、输入、工具调用、关键天气数据、最终回答、turns 和 stopReason；不打印无关响应头、环境变量或凭证。

---

## 11. TDD：先 RED，后 GREEN

本日在创建 `src/tools/weather.ts` 和 `src/demo/d042.ts` 之前，先写：

- `test/d042-weather.test.ts`：30 个 Tool 行为测试；
- `test/d042-demo.test.ts`：1 个真实 AgentLoop 离线确定性集成测试。

### RED（实际执行，退出码 1）

```bash
npx vitest run test/d042-weather.test.ts test/d042-demo.test.ts
```

实际结果：

```text
Test Files  2 failed (2)
Tests       no tests
Error: Cannot find module '../src/tools/weather.ts'
Error: Cannot find module '../src/demo/d042.ts'
```

失败原因是新能力尚不存在，不是测试语法错误或外网不可用。此时没有生产实现可供测试“碰巧通过”。

### GREEN（实现后实际执行）

```text
Test Files  2 passed (2)
Tests       31 passed (31)
```

实现只覆盖测试要求：固定 URL、输入与响应校验、错误映射、超时/取消、有界读取、结构化结果和 Loop Demo。随后 lint 与 TypeScript 检查也通过。

### 覆盖的确定性场景

- 成功 URL、origin、path、查询参数、显式单位、GET、Accept、禁止重定向；
- 经纬度合法边界与缺失、越界、字符串、额外 URL 参数；
- HTTP 400 / 429 / 503 与响应体不泄露；
- 网络错误安全摘要与无自动重试；
- 内部超时、等待中取消、调用前已取消；
- 非 JSON Content-Type、无效 JSON、无效响应形状；
- Content-Length 预检和无 Content-Length 的流式超限；
- 无效超时/字节上限配置；
- 真实 AgentLoop 中 Tool Message → 最终回答的数据依赖。

所有测试均使用 fake fetch，不依赖外网。

---

## 12. 最终检查与覆盖率

### `npm run check`

```text
Test Files  49 passed (49)
Tests       437 passed (437)
```

该命令完成 ESLint、`tsc --noEmit` 和全量 Vitest。

### `npm run test:coverage`

```text
All files  Statements 91.52%  Branches 86.79%  Functions 98%  Lines 93.36%
weather.ts Statements 92.42%  Branches 89.47%  Functions 94.11%  Lines 94.35%
d042.ts    Statements 83.60%  Branches 75.00%  Functions 100%  Lines 86.44%
```

`npm run demo:d042` 的真实 live 运行退出码为 0，完整输出保存在本日 evidence。npm 输出的既有 `Unknown user config "home"` warning 来自本机 npm 配置，不影响检查结果，也不是第三方天气错误。

---

## 13. 文件地图

| 文件 | 内容 |
|---|---|
| `src/tools/weather.ts` | Open-Meteo Tool、输入/输出类型、HTTP 与响应边界、错误映射 |
| `src/demo/d042.ts` | 两轮离线模型 + 真实 AgentLoop；live/offline 显式区分 |
| `scripts/d042-weather.ts` | 默认真实第三方 CLI 入口；失败退出非零 |
| `src/core/tool.ts` | 新增上游 HTTP、网络、无效响应、响应过大错误码 |
| `src/index.ts` | 按现有风格导出 D042 工厂、Demo 与公共类型 |
| `test/d042-weather.test.ts` | 30 个无网络 Tool 行为测试 |
| `test/d042-demo.test.ts` | 1 个无网络真实 Loop 集成测试 |
| `evidence/d042-transcript.txt` | 本轮真实 Open-Meteo CLI 原始输出 |
| `package.json` | 新增 `demo:d042`；无新增依赖 |
| `README.md` | 本教学与真实验收记录 |

未改 main 分支或总索引，未实现搜索/翻译，未引入 SDK，未创建通用沙箱，也未读取或提交 API Key / `.env`。

---

## 14. 已知限制

1. **只读当前天气。** 没有预报、历史天气、搜索、翻译、地理编码或城市名解析；调用方必须给经纬度。
2. **第三方数据会变化。** 网格坐标、观测时间和天气值随服务返回变化；实时 Demo 不是确定性测试。
3. **没有服务可用性保证。** 无密钥不代表无限请求；本日没有缓存、配额、限流器或自动重试。
4. **天气代码未翻译。** 保留 WMO `weather_code` 数值，避免在本日范围外维护一套可能错误的文案映射。
5. **只接受符合契约的 JSON。** Open-Meteo 如果改变字段、单位或 Content-Type，会明确失败，而不是猜测。
6. **自定义 fetch 有责任遵守 AbortSignal。** 生产原生 fetch 满足该契约；任意不尊重 signal 的注入实现无法被超时机制强制 settle。
7. **不是通用网络治理。** 没有任意域名白名单引擎、出站代理、DNS 策略、凭证代理或网络沙箱；这些留给 D043–D045。

---

## 15. 验收清单与明日

- [x] 一个只读 `weather_current` 内置 Tool，生产默认真实原生 fetch
- [x] 固定 Open-Meteo HTTPS endpoint、固定当前字段与单位、URLSearchParams
- [x] 经纬度 Schema 和直接执行边界校验，调用方不能传 URL
- [x] HTTP、网络、超时、取消、JSON、Content-Type、形状和大小错误映射
- [x] 默认 10 秒超时、64 KiB 有界流式读取，不透出原始 body
- [x] 结构化天气结果与真实 Open-Meteo 调用
- [x] 真实 AgentLoop Demo、离线确定性测试、真实 evidence
- [x] RED → GREEN、check、coverage 和已知限制记录
- [x] Node 24 / TypeScript ESM / Vitest / 零新增运行时依赖
- [x] 明确区分路径检查、单 Tool 网络边界与 D043–D045 完整安全治理

**明日 D043：**安全沙箱（路径检查、命令白名单、超时限制）。届时讨论的是跨工具统一治理，而不是把某一个天气 Tool 的固定 origin 误认为完整安全架构。
