# Personal Agent

> 一个从零实现的 Agent Harness：工具可插拔、MCP 可互通、上下文可工程化、运行可观测、效果可评测。
> 用 100 天、每天 3 小时直播写成。

**进度**：D009 / D100 · 未发布

---

## 每日分支索引

每天的内容是一个独立分支，分支内的 README 是该天的**教学内容说明**；本文件只做索引，不承载任何一天的内容。

| 分支 | 日期 | 主题 | 当日产出 |
|---|---|---|---|
| [D001](../../tree/D001) | 2026-11-11 | 立项：先想清楚要走的 100 天 | 仓库、MIT 协议、G1–G5 关卡定义 |
| [D002](../../tree/D002) | 2026-11-12 | 架构分层：六层与一条硬规则 | 六层架构图、目录骨架、ADR-000 |
| [D003](../../tree/D003) | 2026-11-13 | 脚手架：先让机器能判对错 | 配置三层覆盖、结构化日志、CI 三段 |
| [D004](../../tree/D004) | 2026-11-14 | 模型适配：终端第一次开口 | Provider 接口、OpenAI-compatible 实现、真实模型调用 |
| [D005](../../tree/D005) | 2026-11-15 | 工具循环：让模型读懂工作区 | Tool 契约、注册表、文件工具、Agent Loop |
| [D006](../../tree/D006) | 2026-11-16 | 统一事件模型 | AgentEvent、EventSink、Logger 适配 |
| [D007](../../tree/D007) | 2026-11-17 | 内存 Session 与五轮 REPL | Session、五轮历史、readline REPL |
| [D008](../../tree/D008) | 2026-11-18 | 字符预算与工具组安全裁剪 | buildContext、工具组配对、PA_MAX_CONTEXT_CHARS |
| [D009](../../tree/D009) | 2026-11-19 | 取消与模型超时 | AbortSignal、外部取消、模型超时语义 |

> 索引随每天合并更新。分支名与任务卡的天数一一对应：`D001` = D1。

## 怎么读这个仓库

```bash
git clone git@github.com:Your-First-Agent-Harness/personal-agent.git
cd personal-agent
git checkout D002   # 切到某一天，读该分支的 README
```

- 想看**某一天讲了什么**：切到对应分支，读 README。
- 想看**最新进度**：留在 `main`。
- 想看**某个决策为什么这么做**：`docs/adr/`。

## 目录

| 路径 | 说明 |
|---|---|
| `docs/architecture.md` | 六层架构、依赖方向、一次工具调用的链路 |
| `docs/adr/` | 不可逆决策记录 |
| `src/` | 接入 / 编排 / 能力 / 上下文 / 记忆 / 领域 / 观测 七个子目录 |

## License

MIT
