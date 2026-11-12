# D040 来源与核查记录

> 课程：MCP 是标准还是过渡方案
> 固定访问日期：**2026-11-12**
> 用途：为讲义、讲师稿、练习和 README 提供可追溯的事实依据。
> 边界：链接可访问不等于其中所有主张都已被独立验证；厂商文档只能证明该厂商公开描述的行为，仓库 Demo 只能证明本仓库中的行为。

## 1. 核查方法

最终引用共 **28 个**，全部使用 HTTPS。2026-11-12 先阅读正文或关键段落，再对下表每个 URL 统一执行实际网络检查。每个 URL 的 curl 核心命令为：

```bash
curl -L \
  --max-time 35 \
  --connect-timeout 12 \
  -A 'Mozilla/5.0 D040-source-check' \
  -sS \
  -o /dev/null \
  -w '%{http_code}\t%{url_effective}\t%{content_type}' \
  "$url"
```

实际驱动方式是 `python3` 标准库 `concurrent.futures.ThreadPoolExecutor(max_workers=6)` 对 URL 列表并发调用上述 `curl`，逐项记录进程返回码、HTTP 状态、最终 URL 和 stderr；没有使用 `-k`，没有跳过 TLS 校验，也没有把 curl 进程返回码 `0` 等同于 HTTP 成功。

结果摘要：**27/28 个 URL 返回 HTTP 200；1/28 返回 HTTP 403**。403 项是 OpenAI Function calling 页面；其正文在本次资料阅读阶段可以通过页面读取工具取得，但本轮统一 curl 检查未返回 200，因此明确标为“正文已读 / curl 403”，不写成“所有检查均通过”。下表“最终 URL / 结果”保留真实重定向，不用原始 URL 冒充最终地址。

## 2. MCP 规范：明确版本的协议事实

### S01

- **标题**：Specification
- **URL**：https://modelcontextprotocol.io/specification/2025-11-25
- **用于支撑**：2025-11-25 是明确版本；MCP 基于 JSON-RPC 2.0，不能把一个 SDK 或一个版本当作全部 MCP。
- **检查结果**：HTTP `200`；最终 URL 与原始 URL 相同；`text/html`。

### S02

- **标题**：Architecture
- **URL**：https://modelcontextprotocol.io/specification/2025-11-25/architecture
- **用于支撑**：Host–Client–Server 架构；Host 可管理多个 Client，Client 与 Server 的连接边界；架构角色不等于业务权限。
- **检查结果**：HTTP `200`；最终 URL 与原始 URL 相同；`text/html`。

### S03

- **标题**：Lifecycle
- **URL**：https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle
- **用于支撑**：Initialization、Operation、Shutdown；版本协商与 capability negotiation 的区别；未协商能力不得使用。
- **检查结果**：HTTP `200`；最终 URL 与原始 URL 相同；`text/html`。

### S04

- **标题**：Transports
- **URL**：https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
- **用于支撑**：stdio 的换行分隔消息、stdout/stderr 边界；Streamable HTTP 的 POST、可选 GET/SSE、会话与协议头、断线恢复及 Origin 校验等要求。
- **检查结果**：HTTP `200`；最终 URL 与原始 URL 相同；`text/html`。

### S05

- **标题**：Authorization
- **URL**：https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
- **用于支撑**：基于 HTTP 的授权约定、OAuth 相关机制及其适用传输边界；stdio 不应被讲成自动获得同一套 HTTP OAuth 流程。
- **检查结果**：HTTP `200`；最终 URL 与原始 URL 相同；`text/html`。

### S06

- **标题**：Security Best Practices
- **URL**：https://modelcontextprotocol.io/specification/2025-11-25/basic/security_best_practices
- **用于支撑**：confused deputy、token passthrough、session hijacking 等威胁及缓解措施；协议规范不能替代部署方安全控制。
- **检查结果**：HTTP `200`；最终 URL 为 https://modelcontextprotocol.io/docs/2025-11-25/tutorials/security/security_best_practices ；`text/html`。

### S07

- **标题**：Tools
- **URL**：https://modelcontextprotocol.io/specification/2025-11-25/server/tools
- **用于支撑**：`inputSchema`、可选 `outputSchema`、`content`、`structuredContent`、`isError`、annotations；工具描述与 annotations 不能被默认当作可信授权。
- **检查结果**：HTTP `200`；最终 URL 与原始 URL 相同；`text/html`。

### S08

- **标题**：Resources
- **URL**：https://modelcontextprotocol.io/specification/2025-11-25/server/resources
- **用于支撑**：Resources 是独立于 Tools 的服务端能力；本课程将其列为本仓库未实现能力，而不是从 `tools/list` 推断它存在。
- **检查结果**：HTTP `200`；最终 URL 与原始 URL 相同；`text/html`。

### S09

- **标题**：Prompts
- **URL**：https://modelcontextprotocol.io/specification/2025-11-25/server/prompts
- **用于支撑**：Prompts 的能力边界与发现/获取语义；本仓库没有实现该能力。
- **检查结果**：HTTP `200`；最终 URL 与原始 URL 相同；`text/html`。

### S10

- **标题**：Schema Reference
- **URL**：https://modelcontextprotocol.io/specification/2025-11-25/schema
- **用于支撑**：协议类型和字段的权威参照；课程中的示例是节选，不能代替完整 Schema。
- **检查结果**：HTTP `200`；最终 URL 与原始 URL 相同；`text/html`。

## 3. 版本演进：不能把“最新”当成无日期事实

### S11

- **标题**：Specification（2026-07-28）
- **URL**：https://modelcontextprotocol.io/specification/latest
- **用于支撑**：访问日时，`latest` 实际解析到 2026-07-28；课程引用规范时固定明确版本与访问日期。
- **检查结果**：HTTP `200`；最终 URL 为 https://modelcontextprotocol.io/specification/2026-07-28 ；`text/html`。

### S12

- **标题**：Versioning and Compatibility
- **URL**：https://modelcontextprotocol.io/specification/2026-07-28/basic/lifecycle
- **用于支撑**：2026-07-28 的 stateless、self-contained requests、per-request capability negotiation、`_meta`、`server/discover`、`UnsupportedProtocolVersionError`（示例 code `-32022`）及 Modern/Legacy/Dual-era 兼容讨论。
- **检查结果**：HTTP `200`；最终 URL 为 https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning ；`text/html`。
- **特别边界**：这些是后续版本行为，**不是** D035–D039 已实现行为。

### S13

- **标题**：Overview（2026-07-28 Transports 页面）
- **URL**：https://modelcontextprotocol.io/specification/2026-07-28/basic/transports
- **用于支撑**：后续版本传输与请求模型的对照；不能用旧版有状态会话直觉解释所有新版请求。
- **检查结果**：HTTP `200`；最终 URL 与原始 URL 相同；`text/html`。

### S14

- **标题**：Versioning
- **URL**：https://modelcontextprotocol.io/specification/versioning
- **用于支撑**：官方版本策略说明；同时记录访问时页面标记与 `latest` 解析之间观察到的“current”标识不完全一致。
- **检查结果**：HTTP `200`；最终 URL 为 https://modelcontextprotocol.io/docs/2026-07-28/learn/versioning ；`text/html`。
- **特别边界**：这不是需要课堂“修正”的仓库问题。课程只做版本化引用，不选择性地隐瞒不一致，也不据此编造官方路线结论。

## 4. 治理、实现分级与 Registry

### S15

- **标题**：Governance and Stewardship
- **URL**：https://modelcontextprotocol.io/community/governance
- **用于支撑**：公开治理、维护者与决策机制是判断开放性的证据；治理存在不等于所有实现质量一致。
- **检查结果**：HTTP `200`；最终 URL 与原始 URL 相同；`text/html`。

### S16

- **标题**：SEP Guidelines
- **URL**：https://modelcontextprotocol.io/community/sep-guidelines
- **用于支撑**：规范增强提案流程、工作原型和一致性验证在演进中的作用；公开流程是“开放标准”论据，也是“版本迁移成本”论据。
- **检查结果**：HTTP `200`；最终 URL 与原始 URL 相同；`text/html`。

### S17

- **标题**：Feature Lifecycle and Deprecation Policy
- **URL**：https://modelcontextprotocol.io/community/feature-lifecycle
- **用于支撑**：Active、Deprecated、Removed 生命周期；通常至少 12 个月弃用窗口，特定活跃安全风险可缩短但至少 90 天。
- **检查结果**：HTTP `200`；最终 URL 与原始 URL 相同；`text/html`。

### S18

- **标题**：SDKs
- **URL**：https://modelcontextprotocol.io/docs/sdk
- **用于支撑**：官方 SDK 列表与实现入口；SDK 属于实现层，不是协议规范本身。
- **检查结果**：HTTP `200`；最终 URL 为 https://modelcontextprotocol.io/docs/2026-07-28/sdk ；`text/html`。

### S19

- **标题**：SDK Tiers
- **URL**：https://modelcontextprotocol.io/community/sdk-tiers
- **用于支撑**：SDK 在功能完整度、维护承诺、conformance 等方面有分级；“存在 SDK”不能推出“所有实现一致”。
- **检查结果**：HTTP `200`；最终 URL 与原始 URL 相同；`text/html`。

### S20

- **标题**：The MCP Registry
- **URL**：https://modelcontextprotocol.io/registry/about
- **用于支撑**：Registry 的发现与元数据角色、namespace 验证边界；实际代码扫描主要依赖包仓库和下游聚合方，不能把发布身份验证说成代码安全审计。
- **检查结果**：HTTP `200`；最终 URL 与原始 URL 相同；`text/html`。

### S21

- **标题**：Linux Foundation Announces the Formation of the Agentic AI Foundation
- **URL**：https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation
- **发布日期**：2025-12-09。
- **用于支撑**：Linux Foundation 宣布成立 AAIF，MCP 是创始贡献项目之一；这是治理与行业协作证据，不是市占率、互操作率或生产成熟度数字。
- **检查结果**：HTTP `200`；最终 URL 与原始 URL 相同；`text/html`。

### S22

- **标题**：Introducing the Model Context Protocol
- **URL**：https://www.anthropic.com/news/model-context-protocol
- **发布日期**：2024-11-25。
- **用于支撑**：MCP 的历史起点与最初问题陈述；仅作历史来源，不能单独证明访问日的生态成熟度。
- **检查结果**：HTTP `200`；最终 URL 与原始 URL 相同；`text/html`。

## 5. 相邻接口与真实适配证据

### S23

- **标题**：Function calling
- **URL**：https://platform.openai.com/docs/guides/function-calling
- **用于支撑**：应用向模型提供 `type/name/description/parameters/strict` 等工具定义；模型产生 `function_call`，应用执行函数，再回传 `function_call_output`。模型私有工具调用接口与 MCP 位于不同边界。
- **检查结果**：统一 curl 返回 HTTP `403`；最终 URL 与原始 URL 相同；`text/html`。本次资料阅读阶段通过页面读取工具成功读到上述正文，但批量 curl 未通过，故不标为 HTTP 200，也不据此声称该页面对所有客户端开放。

### S24

- **标题**：Model Context Protocol (MCP) | OpenAI Agents SDK
- **URL**：https://openai.github.io/openai-agents-js/guides/mcp/
- **用于支撑**：SDK 将 MCP tools 转为 function tools；schema conversion、缓存、名称前缀、过滤和审批仍需适配；`convertSchemasToStrict` 是 best-effort，失败时保留原 schema。
- **检查结果**：HTTP `200`；最终 URL 与原始 URL 相同；`text/html`。

### S25

- **标题**：OpenAPI Specification v3.2.1
- **URL**：https://spec.openapis.org/oas/latest.html
- **页面日期**：2026-09-10。
- **用于支撑**：OpenAPI 是语言无关的 HTTP API 描述规范；直连 REST/OpenAPI 与 MCP 是可比较而非互相冒充的方案。
- **检查结果**：HTTP `200`；最终 URL 与原始 URL 相同；`text/html`。

### S26

- **标题**：Overview
- **URL**：https://a2a-protocol.org/latest/specification/
- **用于支撑**：A2A 的独立协议边界；仅用于与 MCP 分工比较，不把课程扩展成 A2A 实现教程。
- **检查结果**：HTTP `200`；最终 URL 与原始 URL 相同；`text/html`。

### S27

- **标题**：Core Concepts and Components in A2A
- **URL**：https://a2a-protocol.org/latest/topics/key-concepts/
- **用于支撑**：Agent Card、Task、Message、Part、Artifact 等核心概念；说明 Agent 间协作与工具调用不是同一问题。
- **检查结果**：HTTP `200`；最终 URL 与原始 URL 相同；`text/html`。

### S28

- **标题**：A2A and MCP: Detailed Comparison
- **URL**：https://a2a-protocol.org/latest/topics/a2a-and-mcp/
- **用于支撑**：MCP 偏 Agent 到工具/资源，A2A 偏独立、opaque Agent 之间协作，两者可组合；该来源也是 A2A 项目的比较视角，不是中立的采用率研究。
- **检查结果**：HTTP `200`；最终 URL 与原始 URL 相同；`text/html`。

## 6. 来源使用规则与未证明事项

1. **规范优先**：协议字段、生命周期和传输语义优先引用明确版本的 MCP 规范，而不是二手文章。
2. **厂商归厂商**：OpenAI、Anthropic、A2A 和 Linux Foundation 文档分别说明其公开立场或产品行为，不能混写成整个行业的统一实现。
3. **Demo 归 Demo**：D035–D039 只证明本仓库在特定版本、stdio、Tools 子集下的实现和测试，不证明全行业互通。
4. **没有采用数字**：本课程没有引用或虚构市占率、企业采用率、生产部署数量、Server 总数或增长率。
5. **没有绝对预测**：课程结论是带条件的工程判断，不是对某项技术必然胜负或商业投资的建议。
6. **失败保留**：S23 的 curl `403` 是本轮真实结果；其余 27 项为 HTTP `200`。没有以另一个镜像 URL 掩盖这一失败。
7. **时效限制**：所有“当前”“最新”观察只适用于 2026-11-12。后续授课必须重新检查 S11–S14，并核对明确版本正文。
