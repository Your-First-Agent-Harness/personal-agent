# D002 · 架构分层：六层，和一条不能破的硬规则

> 本文件是 D002 分支的教学内容说明。分支索引见 [main](../../tree/main)。

## 今天产出了什么

- `docs/architecture.md`：六层职责表、依赖方向图、一次工具调用的时序图
- `docs/adr/0000-why-not-framework.md`：四条技术路线的对比与结论
- `src/` 七个子目录的骨架：cli / core / runtime / tools / context / memory / adapters / observability

## 今天讲什么

### 1. 六层怎么切

| 层 | 目录 | 一句话职责 | 明确不做 |
|---|---|---|---|
| 接入层 | `src/cli` | 命令行入口与渲染 | 不含业务逻辑 |
| 编排层 | `src/runtime` | Loop、会话、队列、断点续跑 | 不管工具实现 |
| 能力层 | `src/tools`、`src/adapters` | 工具协议、模型 Provider、MCP、存储 | 不感知上下文预算 |
| 上下文层 | `src/context`、`src/memory` | 预算、裁剪、压缩、长期记忆 | 不直接发请求 |
| 领域层 | `src/core` | 纯类型与协议 | 零外部依赖 |
| 观测层 | `src/observability` | trace / replay / eval / cost | 不改变执行结果 |

切分的依据不是"功能相似"，而是**变更原因**：会因为不同理由变化的代码，放在不同层。

### 2. 那条硬规则：依赖只向下

`core` 的 import 列表里只允许出现标准库。任何跨层调用必须走接口，禁止直接 import 兄弟层的实现文件。

这条规则的价值在 D50 之后才显现：当工具从 3 个变成 30 个、上下文策略迭代到第三版时，能保证 Loop 一行不改。

### 3. 一次工具调用 = 一串 span

```
用户 → runtime → context → model → 工具 → 回填 → 下一轮
```

图上每个箭头，未来都必须能对应一个 trace span。要是某一步无法观测，说明它被藏起来了——那正是这个项目要避免的事。

### 4. 两个现场做出来的判断

- **Loop 放 runtime，不放 core**：Loop 会随策略变化（串行 / 并行 / 子 Agent），是可替换的编排策略；core 只保留不变的数据结构。
- **context 单独成层**：它是 Agent 效果的第一变量，必须能独立度量。和 memory 混在一起，预算就永远算不清。

### 5. ADR-000：为什么不用现成框架

四条路线（LangChain 二次封装 / Vercel AI SDK / 自研 core / fork 开源 Harness）六维对比，结论是：**自研 core，模型、MCP、数据库一律用官方 SDK**。

自研不等于自造轮子。凡是被别人定义好的协议，直接用；凡是要讲清楚的控制流，自己写。

## 怎么查看这一天

```bash
git checkout D002
cat docs/architecture.md
cat docs/adr/0000-why-not-framework.md
find src -type d
```

## 明天

D003：脚手架、配置加载、日志规范、CI——让这个骨架能被自动验证。
