# D003 · 脚手架：先让机器能判对错，再谈功能

> 本文件是 D003 分支的教学内容说明。分支索引见 [main](../../tree/main)。

## 今天要做出的东西

- TypeScript + Node 24 工程骨架，零运行时框架依赖
- 配置加载：默认值 → 配置文件 → 环境变量，三层覆盖
- 日志规范：结构化、分级、带 traceId，禁止裸 `console.log`
- CI 三段流水线：lint → typecheck → test，红灯不许合并

## 今天讲什么

### 1. 为什么第三天就上 CI

功能还没写就先搭流水线，看起来反直觉。但 Harness 这类系统的 bug 有一个共性：**它不是报错，而是安静地做错事**——参数被静默丢弃、上下文被悄悄截断、工具结果少了一个字段。

没有自动化校验，这类问题只能等演示时炸。CI 的作用不是"保证代码对"，而是**让错误尽早发出声音**。

### 2. 配置三层覆盖

```text
默认值  <  配置文件  <  环境变量
```

优先级这样定的原因：默认值保证开箱能跑，配置文件适合团队共享，环境变量留给密钥和临时覆盖。密钥永远不进仓库，只从环境变量读。

配置用类型定义，不用 `Record<string, unknown>`：配置项是接口契约的一部分，拼错一个键名就该在编译期报错。

### 3. 日志是给未来的自己看的

三条硬规则：

1. **结构化**：输出 JSON，不拼字符串，机器可查。
2. **带上下文**：每条日志必须有 `traceId` 和当前轮次，否则 D83 做 trace 时全是孤儿。
3. **分级明确**：`debug` 只留在本地，`info` 记录状态变化，`warn` 记录可恢复异常，`error` 记录需要人介入的失败。

禁止裸 `console.log`：它是不可检索的，也是唯一无法被统一采集的输出方式。

### 4. CI 三段

| 阶段 | 命令 | 失败意味着 |
|---|---|---|
| lint | `npm run lint` | 风格或潜在错误，必须在提交前修 |
| typecheck | `npm run typecheck` | 契约被破坏 |
| test | `npm run test` | 行为与预期不符 |

三段串行，任一失败即整体失败。**不要为了过 CI 去关规则**——规则松了，后面 97 天都会替它还债。

## 怎么验证这一天

```bash
git checkout D003
npm install
npm run check      # lint + typecheck + test 一次跑完
npm run dev        # 输出一行带 traceId 的 JSON 日志
```

`npm run dev` 的实际输出（配置全部取默认值）：

```json
{"time":"...","level":"info","message":"personal-agent 启动","traceId":"...","model":"default","provider":"openai-compatible","workspace":".","maxTurns":20}
```

加 `PA_LOG_LEVEL=debug npm run dev` 会多出一行 `debug`，这就是三层覆盖在起作用。

## 明天

D004：接上第一个模型 Provider，让终端里第一次出现模型的回复。
