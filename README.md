# D004 · 接上第一个模型 Provider：让终端开口

> 本文件是 D004 分支的教学内容说明。分支索引见 [main](../../tree/main)。

## 今天要做出的东西

- 领域消息类型：`system / user / assistant` 三种角色，只有数据没有行为
- `ModelProvider` 接口：上层只认接口，不认厂商
- OpenAI-compatible 实现：用原生 `fetch` 发一次 `/chat/completions`
- CLI 接收问题并打印模型回复，失败时退出码非零
- 错误显式建模：HTTP 状态、非法 JSON、缺字段、网络异常、超时

## 今天讲什么

### 1. 为什么先接 OpenAI-compatible

协议比厂商稳定。绝大多数模型服务都兼容 `POST /chat/completions`，先按这套协议实现，换模型只需要改 `baseUrl` 和 `model`，代码一行不动。

`provider` 字段目前只接受 `openai-compatible`。不支持的值直接报错退出，而不是静默走默认实现——**配置拼错时必须发出声音**。

### 2. Provider 是接口，不是 SDK

```text
runtime → ModelProvider（接口） → openai-compatible（实现） → HTTP
```

上层拿到的只有三样东西：回复文本、实际模型名、token 用量。至于底层是手写 HTTP 还是官方 SDK，上层不关心。

这和 ADR-000 不冲突：ADR 说的是"协议层可以用官方 SDK"，而今天先用原生 `fetch` 把请求的每个字段摊开讲清楚，同时保持零运行时依赖。等需要流式、重试、批量时，替换 Provider 内部实现即可。

### 3. 一次调用真正经过的步骤

| 步骤 | 做什么 | 失败时 |
|---|---|---|
| 组装 | `messages` + `max_tokens` + 模型名 | 参数错误在调用前就该暴露 |
| 鉴权 | `Authorization: Bearer <key>` | 401 / 403，带状态码抛出 |
| 请求 | 60 秒超时，超时即中止 | 网络异常收敛成 `ModelError` |
| 解析 | 读 `choices[0].message.content` | 非法 JSON、缺字段都报错 |
| 记账 | 读 `usage.prompt_tokens / completion_tokens` | 没有就不编造 |

响应解析不允许 `undefined` 继续往下流。缺 `choices`、缺 `message`、`content` 不是字符串，全部当场转成 `ModelError`——这正是"安静地做错事"最容易发生的地方。

### 4. 密钥只从环境变量来

配置文件适合团队共享，密钥不适合。`PA_MODEL_API_KEY` 只从环境变量读取，不写进 `agent.config.json`，也不进仓库。

优先级仍然是三层：默认值 → `agent.config.json` → 环境变量。`PA_MODEL_BASE_URL`、`PA_MODEL_NAME`、`PA_MAX_TOKENS` 同理。

### 5. CLI 只做三件事

解析参数、调用 Provider、渲染结果。它不拼 prompt 策略，也不处理重试——那些属于 runtime，明天开始长出来。

## 怎么验证这一天

```bash
git checkout D004
npm install
export PA_MODEL_API_KEY=sk-...
export PA_MODEL_BASE_URL=https://api.openai.com/v1
export PA_MODEL_NAME=gpt-4o-mini
npm run dev -- "用一句话解释什么是 Agent Harness"
```

实际输出（第一行是启动日志，第二行是模型回复，第三行是调用记账）：

```text
{"time":"...","level":"info","message":"personal-agent 启动","traceId":"...","provider":"openai-compatible","model":"gpt-4o-mini","workspace":".","maxTurns":20}
Agent Harness 是把模型、工具、上下文和观测组装成可执行循环的那层骨架。
{"time":"...","level":"info","message":"模型回复完成","traceId":"...","model":"gpt-4o-mini","latencyMs":812,"usage":{"inputTokens":38,"outputTokens":24}}
```

失败也要能看见：

```bash
node src/cli/main.ts                 # 缺少输入，退出码 1
node src/cli/main.ts "你好"           # 没有 PA_MODEL_API_KEY，退出码 1
PA_MODEL_BASE_URL=https://example.com/v1 npm run dev -- "你好"   # HTTP 404，退出码 1
```

自动化校验：

```bash
npm run check   # lint + typecheck + 16 个测试
```

## 明天

D005：把一次问答变成多轮会话——消息从哪里来、按什么顺序回放，以及 Loop 的第一版长什么样。
