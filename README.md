# D045｜安全架构评审：攻击面、信任边界与纵深防御

这一天不新增工具或安全功能，而是把 D028–D044 放回同一张架构图中，回答三个问题：**模型和外部内容不可信时，哪些能力默认可达？已有控制究竟证明什么？距离可评审的生产部署还差哪些独立防线？**

本日交付一份静态安全架构评审、一套带讲师稿和完整答案的精炼课程，以及一份可签署的内部评审清单。所有结论区分代码与测试证据、文档建议、D046 待实证和未解决项；不把模块名称、Demo 或测试总数冒充安全认证。

## 1. 交付物与阅读路径

| 文档 | 用途 | 适合读者 |
| --- | --- | --- |
| [安全架构评审报告](docs/d045-security-architecture-review.md) | 完整攻击面、六类信任边界、20 项风险矩阵、攻击链、处置和 D046 实证计划 | 维护者、安全架构师、平台负责人 |
| [安全架构精炼课程](docs/d045-security-course.md) | 100 分钟讲师稿、12 个练习及完整答案，训练评审方法 | 工程师、内部培训组织者、自学者 |
| [安全评审检查清单](docs/d045-security-review-checklist.md) | 默认配置、身份、文件、命令、网络、MCP、审计、隐私、回归和签署门槛 | 正式评审与发布审批人员 |
| 本 README | 结论摘要、证据边界、复跑方式与当前验收记录 | 所有读者 |

建议先用 10 分钟读本 README，再按职责阅读：

- **做架构决策**：评审报告第 2、4、6、7、9 节。
- **做代码修复**：风险矩阵中对应 ID、证据文件和 D046 实验判据。
- **做内部培训**：课程按讲授与练习交替进行；答案不代表攻击实验已经执行。
- **做上线审批**：逐项填写检查清单，不允许仅凭本文档完成就勾选控制项。

## 2. 一句话结论

**当前项目适合可信、本机、单用户的教学与开发；不应把默认 CLI 直接暴露给不可信用户、不可信仓库或不可信 MCP，也不能宣称已有多租户生产隔离。**

原因不是“所有代码都不安全”，而是已有局部控制没有自动组成默认全局策略：

- D029 有 allowedTools、tenant、tool/action 和 sensitive 确认，但默认 CLI Registry 没有配置这些选项。
- 默认内置工具包含 `run_command`，其 `shell:true` 可执行模型给出的命令字符串。
- 普通文件工具的 workspace 检查是词法 `path.resolve + startsWith`，不是符号链接/TOCTOU 防线。
- 工具结果会原样回到模型；文件、知识库和 MCP 文本都可能成为间接提示注入载体。
- Provider、MCP 和普通工具的资源/信任策略并不一致，不能用 D042 或 D044 的局部加固覆盖全系统。
- D044 是很强的**应用层命令准入与审计**，但不是容器、系统调用过滤或网络/文件系统沙箱。

因此当前发布建议是：**可信教学场景可有条件使用；不可信或生产场景在 P0 关闭前不通过。** 详见[评审结论](docs/d045-security-architecture-review.md#9-评审结论风险接受与签署建议)。

## 3. 架构攻击面速览

```text
用户 / 配置 / env
        │
        ▼
      CLI ─────────────────────────────┐
        │                              │ 默认无 allowedTools / tenant / 敏感确认
        ▼                              │
OpenAI-compatible Provider             │
  可配置 baseUrl + Bearer              │
        │                              │
        ▼                              ▼
    AgentLoop ───── tool call ───► ToolRegistry
        ▲                              │ Schema 子集 + 可选策略
        │                              ▼
        │                       文件 / shell / 多步骤工具链
        │                              │
        └──── 原样 ToolResult           ▼
                                  宿主文件与进程
        │
        └──────────────────────► MCP stdio client/server
                                      │
                                      ▼
                             远端描述 / Schema / 结果
```

评审报告把攻击面拆成六个边界：配置入进程、Provider 入 Loop、Loop 入 Registry、Tool 入 OS、Agent 与 MCP、数据出进程/落盘。每个边界都同时审资产、入口、已有控制和剩余风险，而不是只列模块功能。

## 4. 最高优先级发现

完整 20 项矩阵见[评审报告第 4 节](docs/d045-security-architecture-review.md#4-资产--入口--边界--威胁--控制--剩余风险矩阵)。以下是摘要，不是新增漏洞通告或外部渗透结果。

| ID | 发现 | 评级依据 | 当前处置 |
| --- | --- | --- | --- |
| R01 | 默认 CLI 可从模型 tool call 到 open shell，未启用 Registry 白名单/敏感确认 | S4/L3：默认路径可达，影响是当前 OS 用户权限 | 不可信场景禁用默认高风险工具；P0 默认最小权限 |
| R02 | 文件路径只做词法边界，符号链接与检查/使用竞态未解决 | S3/L2：需链接或替换前提，可越出 workspace | D046 无害实证；长期 dirfd/no-follow 或 OS 沙箱 |
| R03 | 文件/知识库/MCP 内容可形成间接提示注入，工具结果无信任隔离 | S4/L2：恶意内容现实存在，影响取决于工具权限 | 动作级最小权限、确认、精确命令和 OS/出口防线 |
| R04/R05 | Provider 可配置出口，缺统一 redirect/私网/超时/响应字节策略 | 秘密泄露需配置控制；恶意响应可影响可用性 | 固定出口、网络策略和本地假服务回归 |
| R06 | MCP stdout 单帧和未换行累计缓冲无字节上限 | S3/L2：恶意/故障子进程可耗尽单实例内存 | 上限后关闭并 settle pending；D046 有界洪水测试 |
| R07/R08 | 远程工具元数据不受信；stdio toolNames 不是身份认证 | 恶意 MCP 或错误暴露可扩大权限 | 本地敏感策略、服务审批、父进程/OS 边界 |
| R09 | D030 韧性可选，普通命令/文件/Provider 没有统一默认预算 | 大文件、死循环、慢响应可耗资源 | 默认超时/字节/并发/磁盘预算，幂等重试 |
| R10/R11 | D043/D044 均非 OS 沙箱；允许解释器仍有宿主能力 | 高影响，通常需误用或管理员配置 | 文档明示；真正 OS 隔离和可信白名单路径 |
| R12 | JSONL 审计不防篡改、未显式 chmod 0600，completion 失败不回滚 | 日志泄露/篡改与磁盘故障仍需部署治理 | 集中审计、权限/保留/WORM；明确失败语义 |
| R14/R15 | tenantId 不是认证；prompt/结果/日志有第三方与隐私边界 | 错误多租户部署或敏感数据接入时成立 | 认证身份映射、数据分类、最小上下文和保留策略 |

S/L 是相对架构优先级，不是 CVSS，也不表示已经发生安全事件。

## 5. 已有控制：可以引用什么证据

| 范围 | 可以说的 | 不能说的 |
| --- | --- | --- |
| D028 Schema | 对声明的自有子集做参数校验，有 D028 测试 | “完整 JSON Schema”“未知关键字自动拒绝” |
| D029 Registry | 同名注册 Schema/执行；allowedTools、tenant、action、sensitive 确认有测试 | “默认 CLI 全启用”“tenantId 已认证”“允许工具即允许所有 argv 安全” |
| D030 / D032 | 可选 per-tool 超时、重试、限流、熔断、取消；多步骤发布门禁与产物核验 | “所有工具默认可靠”“重试保证无副作用”“多步骤链是事务框架” |
| Context | 按字符保留 system/最新 user、工具配对与截断 | “精确 token 安全”“能防提示注入” |
| MCP client / server | 握手版本、ID、通知/坏帧、timeout、关闭与分页控制 | “无限帧有上限”“对端已认证” |
| D037 Backend | 统一本地/MCP list/read/write 适配 | “这是 realpath 文件安全边界” |
| MCP 适配 / 集成 / 重连 | 本地 policy/resilience/sensitive 组合、server allowlist、协议集成 | “远端 Schema/result 可信”“内建透明重连”“多租户认证” |
| D041 Knowledge | 只读快照；加载和查询 realpath，跳过库外链接 | “有安全写入”“实时追踪文件”“正文可信” |
| D042 Weather | 固定 Open-Meteo HTTPS、数字坐标、禁重定向、timeout、body bytes、字段校验 | “Provider/任意 URL 也有相同保证” |
| D043 Command | shell 命令的临时 cwd、最小 env、timeout、进程组、输出截断与清理 | “OS 沙箱”“精确 argv”“输出超限杀进程/有审计队列” |
| D044 Secure Command | 精确 realpath executable + argv、无 shell、资源/队列/取消、fail-closed 审计 | “容器/seccomp/chroot”“解释器无宿主权限”“JSONL 不可篡改” |

D044 的 decision 审计失败会阻止 spawn；completion 失败会显式报错，但已经发生的副作用不能回滚。单实例 JSONL 串行 append 也不等于跨进程协调、fsync、WORM、签名或防宿主篡改。

## 6. 纵深防御目标

```text
已认证主体
  → 默认拒绝的 Policy / Registry
  → 内容来源与动作级确认
  → 窄业务工具或精确命令规则
  → 每调用资源预算与幂等语义
  → OS 文件/进程/网络沙箱
  → 最小泄露、抗篡改、可告警的集中审计
```

这是 **[文档建议]**，不是 D045 新增实现。P0 是在不可信输入或真实秘密接入前完成：默认最小工具集、认证主体、文件真实路径边界、Provider/MCP 资源与出口控制、动作级授权和 OS 沙箱。P1 包括集中审计、隐私/供应链门禁和故障/恶意对端验证。

## 7. 评审方法与证据纪律

本日采用以下方法：

1. 从默认入口和公共导出开始，而不是只看安全命名模块。
2. 将源码行为与对应测试交叉核对，记录控制是否默认启用。
3. 用 STRIDE 与端到端攻击链审模型、工具、MCP、OS 和第三方边界。
4. 给严重度/可能性写前提，避免把本地教学项目虚构成远程未认证服务。
5. 把“已有控制”“剩余风险”“修复/缓解/避免/接受/验证”分别记录。
6. 所有攻击实验只建议使用临时目录、loopback、无害 canary/marker 和有界数据。

明确证据边界：

- 本日没有改源码、测试、package 或 lockfile，没有新增运行时依赖。
- 本日没有运行 D046 对抗实验，没有预先伪造 RED/GREEN。
- 没有外部安全评审、渗透测试、授课、学员反馈或发布签署。
- `docs/architecture.md` 是早期概览；其中名称不能替代当前源码的安全语义。
- 现有 505 测试是功能回归基础，不是攻击面覆盖率。

## 8. 复跑与最终验收

要求 Node.js 24+。只读复核：

```bash
npm ci
npm run check
npm run test:coverage
git diff --check
```

可单独复跑本评审重点引用的控制：

```bash
npx vitest run \
  test/d028-schema-validation.test.ts \
  test/d027-tool-registry.test.ts test/d029-permissions.test.ts \
  test/d030-resilience.test.ts test/d032-multi-tool-demo.test.ts \
  test/context.test.ts test/tools.test.ts test/run-command.test.ts \
  test/write-file.test.ts test/edit-file.test.ts \
  test/d035-mcp-client.test.ts test/d036-mcp-server.test.ts \
  test/d036-stdio-integration.test.ts test/d037-mcp-tool.test.ts \
  test/d037-filesystem-backend.test.ts test/d037-stdio-integration.test.ts \
  test/d039-reconnect-demo.test.ts \
  test/d041-knowledge.test.ts test/d042-weather.test.ts \
  test/d043-sandboxed-command.test.ts \
  test/d044-secure-command.test.ts test/d044-audit-sink.test.ts test/d044-demo.test.ts
```

### D045 实际验收记录

2026-11-12 在本分支最终提交前实际运行，结果如下；没有手工修改测试或覆盖率输出：

| 命令 | 实际结果 |
| --- | --- |
| `npm run check` | 通过：TypeScript、ESLint，以及 **54 个测试文件 / 505 个测试**全部通过 |
| `npm run test:coverage` | 通过：**54 / 54** 测试文件、**505 / 505** 测试；未执行 0、跳过 0 |
| `git diff --check` | 通过：无 whitespace error |

本次 `All files` 覆盖率：

| Statements | Branches | Functions | Lines |
| ---: | ---: | ---: | ---: |
| **91.51%** | **86.55%** | **97.26%** | **93.75%** |

这些数值来自当前基线的真实 Vitest/V8 输出。它们用于回归比对，不代表 91.51% 的攻击路径已验证，也不改变本文任何未解决状态。

通过上述命令只表示文档日没有破坏既有实现，并不关闭风险矩阵。正式评审仍须在[检查清单](docs/d045-security-review-checklist.md)记录实际 SHA、部署配置、证据链接、owner、风险接受期限和签署角色。

## 9. D046 建议，不在本日交付内

下一阶段可做最小、无害的实证：

1. 不可信 Markdown/MCP 内容的 canary 提示注入链，并验证最小权限能切断。
2. 文件最终 symlink、父目录 symlink、新文件与 TOCTOU。
3. MCP 未换行/超长帧和巨大结果的有界资源测试。
4. 本地 Provider 假服务的慢响应、大响应、redirect 与错误脱敏。
5. D043/D044 shell 元字符、argv、输出和审计故障对照。
6. 解释器白名单与真实 OS 文件/网络边界。
7. 审计文件权限、篡改可见性和 decision/completion 失败差异。
8. 普通工具缺省资源预算及显式 D030 包装对照。

这些项目前均为 **[D046 待实证]**。本日没有创建对应 Demo、攻击回放或测试证据；如果未来修复，应先写真实 RED，再实现 GREEN，并复跑完整回归。

## 10. 本日变更边界

- 变更仅为本 README 与三份 `docs/d045-*.md` 中文材料。
- 保留 D044 的源码、测试、Demo、evidence 与历史文档，不改写既有安全结论。
- 不做 D046，不做 release、外部 issue 或依赖升级。
- 文档中的部署架构、加固优先级和签署门槛是建议；只有明确标为代码+测试的条目才代表现有自动化证据。
