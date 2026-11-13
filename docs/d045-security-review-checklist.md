# D045｜安全架构评审检查清单

> 用途：内部正式评审、上线门槛和回归复核。所有方框默认留空；勾选必须有证据链接、owner 和日期。完成 D045 文档不等于完成本清单，也不代表外部评审或上线签署已经发生。

评审依据：[架构评审报告](d045-security-architecture-review.md) · [课程与答案](d045-security-course.md)

## 0. 评审记录

- [ ] 已记录评审 commit SHA、分支、Node/OS、部署拓扑和配置脱敏快照。
- [ ] 已明确评审对象是本机教学、单用户开发、内部服务还是多租户生产；不同场景分别评分。
- [ ] 已列出此次不在范围内的系统、第三方服务和平台假设。
- [ ] 已区分 `[代码+测试]`、`[代码可见]`、`[文档建议]`、`[D046 待实证]`、`[未解决]`。
- [ ] 没有把单元测试数量写成安全攻击覆盖率，没有把模块名称写成安全保证。
- [ ] 每项发现有资产、入口、边界、威胁、已有控制、剩余风险、S/L 依据、处置和 owner。

证据 / 备注：



## 1. 资产、入口与信任边界

- [ ] 已盘点 API key、配置/env、工作区、宿主文件、对话、工具结果、MCP、审计和可用性资产。
- [ ] 已画用户/配置 → CLI → Provider → Loop → Registry → Tool → OS 的数据流。
- [ ] 已画 MCP client 与 server 的双向不受信输入，而不是只审 tools/call 出方向。
- [ ] 已标出 ToolResult 回到模型并再次发送 Provider 的路径。
- [ ] 已标出天气坐标、prompt、工具 Schema/结果、日志和审计的数据外发/落盘路径。
- [ ] 模型输出、文件内容、知识库、MCP description/Schema/result 均按不可信数据处理。
- [ ] 已分析至少一条端到端链：不可信内容 → 模型 → 高权限工具 → 宿主副作用。
- [ ] 已记录各防线的失败模式：拒绝、显式错误、截断、超时、继续执行或静默成功。

证据 / 备注：



## 2. 默认配置、身份与最小权限

- [ ] 已审 `src/cli/main.ts`，没有假设 Registry 能力会自动启用。
- [ ] 默认 CLI 的工具集合符合场景；不可信场景没有默认 open shell/write。
- [ ] `allowedTools` 的 `undefined`（不限）与 `[]`（全拒）语义经过配置测试。
- [ ] Registry `tenantId` 来自可信初始化/认证映射，绝不来自模型 arguments。
- [ ] `tool:action` 权限精确到实际 action；未把工具名允许误当作任意参数允许。
- [ ] sensitive 工具显式标记；确认回调包含主体、工具、动作、资源和必要参数摘要。
- [ ] 确认拒绝、超时和异常均 fail-closed，且不向模型泄露秘密。
- [ ] 每主体/租户使用独立最小策略；没有仅凭 tenantId 字符串宣称身份认证。
- [ ] 远程 MCP 工具的 sensitive 由本地策略决定，不信任远端自我声明。
- [ ] 高风险工具默认不注册，而不只是“文档建议用户不要调用”。
- [ ] 配置、allowlist、审计路径及其父目录仅可信管理员可写。

当前证据：`src/tools/registry.ts`、`src/cli/main.ts`、`test/d027-tool-registry.test.ts`、`test/d029-permissions.test.ts`。

未解决 / 处置 / owner / 截止日：



## 3. Schema、模型与上下文

- [ ] 已把 D028 描述为自有 Schema 子集，而非完整 JSON Schema。
- [ ] 工具没有依赖未支持关键字获得安全保证；危险字段有领域运行时校验。
- [ ] 模型 arguments 的 JSON.parse 失败、类型错误、额外字段均有稳定错误。
- [ ] 工具结果、文件、MCP 和知识库内容不会仅因进入 system/长文本就被视为可信指令。
- [ ] 即使假设模型一定被注入，最小权限、命令准入和 OS 隔离仍能限制影响。
- [ ] 敏感操作确认不是只根据模型自己生成的“已确认”布尔值。
- [ ] 上下文字符预算保留 system、最新 user 和工具配对，且未宣称等于精确 token 计费。
- [ ] maxTurns/maxTokens/maxConsecutiveToolErrors 已按部署设置并验证。
- [ ] 没有把提示注入分类器或一次“不服从”实验当作根治证明。

当前证据：`src/tools/schema.ts`、`src/runtime/loop.ts`、`src/context/build.ts`、`test/d028-schema-validation.test.ts`、`test/context.test.ts`。

未解决 / 处置 / owner / 截止日：



## 4. 文件系统与知识库

- [ ] `read_file`、`write_file`、`edit_file` 已分别审阅，不以同一 helper 推断全部安全。
- [ ] 已测试绝对路径、`..`、root 前缀相似目录、NUL/错误类型等常规输入。
- [ ] 已测试最终文件 symlink、父目录 symlink 和不存在新文件的真实父目录。
- [ ] 已评估 stat/realpath 与 open/write 之间的 TOCTOU；没有声称一次 realpath 消除竞态。
- [ ] 长期方案使用可信 dirfd、逐层 no-follow、打开后校验或 OS 沙箱，并有平台兼容验证。
- [ ] 不可信用户不能在可信工作区任意创建/替换链接；root 与父目录权限已检查。
- [ ] 读写有文件字节、总磁盘、执行时间和错误大小预算；不会用同步大文件阻塞事件循环。
- [ ] D037 只按实际本地/MCP 后端适配语义评审，没有虚构额外 canonicalization 防线。
- [ ] D041 按只读快照评审；加载与查询 realpath、跳过库外链接的测试已复跑。
- [ ] 知识库有总文件数/总字节预算；单条 50,000 字符预览（另加截断标记）与 2,000 候选限制未被误写成总内存上限。
- [ ] 快照不是实时安全视图；Markdown 正文仍按提示注入载体处理。

当前证据：`src/tools/workspace.ts`、`fs.ts`、`write-file.ts`、`edit-file.ts`、`filesystem-backend.ts`、`knowledge.ts`；`test/tools.test.ts`、`test/write-file.test.ts`、`test/edit-file.test.ts`、`test/d037-filesystem-backend.test.ts`、`test/d041-knowledge.test.ts`。

未解决 / 处置 / owner / 截止日：



## 5. 命令执行与 OS 隔离

- [ ] `run_command` 明确标为 `shell:true` 开发工具；不可信场景默认禁用。
- [ ] D043 明确标为 `/bin/sh -c` 生命周期加固，不是 OS/FS/network 沙箱。
- [ ] 没有把 D043 输出字符截断写成 D044 的输出字节超限终止；没有虚构 D043 队列/审计。
- [ ] D044 executable 为绝对路径并 realpath，argv 长度与每项精确匹配，`shell:false`。
- [ ] 未匹配命令在临时目录创建和 spawn 前拒绝；有外部 marker 证明无副作用。
- [ ] D044 wall timeout、共享 stdout/stderr 字节、并发、队列、排队超时和取消均有回归。
- [ ] 临时 cwd 未被描述为 chroot；最小 env 未被描述为撤销宿主权限。
- [ ] allowlist 中解释器、包管理器、网络工具和通用写工具经过单独高权限审批。
- [ ] realpath/spawn TOCTOU 已记录；白名单文件和父目录由可信管理员维护。
- [ ] 不可信代码另有非特权用户、只读挂载、限定可写目录、rlimit/cgroup、系统调用与网络隔离。
- [ ] 没有为证明风险而运行 fork bomb、真实 OOM、破坏宿主或访问真实秘密。

当前证据：`src/tools/run-command.ts`、`sandboxed-command.ts`、`secure-command.ts`；`test/run-command.test.ts`、`test/tools.test.ts`、`test/d043-sandboxed-command.test.ts` 与 D044 三个测试文件。

未解决 / 处置 / owner / 截止日：



## 6. Provider、天气与网络出口

- [ ] 已核对 Provider 实际 baseUrl、API key 来源和发送的 system/history/tools/tool results。
- [ ] 配置 URL 仅限可信管理员；生产固定允许协议/主机，必要时经出口代理。
- [ ] 已评估 redirect、DNS 重绑定、私网/loopback/link-local 和 Bearer 跨源泄露。
- [ ] Provider 有默认连接/总超时、响应字节与字段上限、取消和受控错误摘要。
- [ ] 错误、日志和测试快照不含 Authorization、API key、完整敏感 body。
- [ ] D042 的固定 Open-Meteo、数字坐标、redirect:error、timeout、响应 bytes 和字段校验测试已通过。
- [ ] 没有把 D042 的保护推广到 Provider 或通用 HTTP 工具。
- [ ] 模型供应商和天气供应商的数据分类、保留、区域、删除和备份责任已记录。
- [ ] 断网、慢响应、大响应、重定向和恶意 JSON 使用本地假服务验证，不对第三方做攻击测试。

当前证据：`src/adapters/model/openai-compatible.ts`、`src/tools/weather.ts`、`src/adapters/config.ts`、D042 测试。

未解决 / 处置 / owner / 截止日：



## 7. MCP client / server

- [ ] initialize 协议版本、响应 ID、方法名、错误结构、通知和坏帧隔离测试已复跑。
- [ ] request timeout、关闭拒绝 pending、tools/list 最大页数有边界测试。
- [ ] stdout 单帧和累计未换行缓冲有字节上限；溢出关闭并 settle 所有 pending。
- [ ] tool result、description、Schema 和分页数量有大小/结构约束。
- [ ] 远程工具按服务来源审批，不会自动获得本地高权限；本地 sensitive/policy 显式配置。
- [ ] 重连是显式受控流程；失败副作用调用不会无幂等保障自动重放。
- [ ] server toolNames allowlist 与 Registry policy 同时最小化。
- [ ] stdio server 仅暴露给可信父进程；跨用户/网络使用时有真正认证授权，而非 toolNames 冒充身份。
- [ ] MCP 子进程本身以最小 OS 权限运行，无不需要的凭证、文件和网络。
- [ ] stdio 集成与重连 Demo 只被引用为协议/组合证据，没有写成恶意对端安全认证。

当前证据：`src/adapters/mcp-stdio-client.ts`、`mcp-tool.ts`、`mcp-stdio-server.ts`；`test/d035-mcp-client.test.ts`、`test/d036-mcp-server.test.ts`、`test/d036-stdio-integration.test.ts`、`test/d037-mcp-tool.test.ts`、`test/d037-stdio-integration.test.ts`、`test/d039-reconnect-demo.test.ts`。

未解决 / 处置 / owner / 截止日：



## 8. 资源、重试与副作用

- [ ] D030 是显式 per-tool 包装；默认 CLI 中哪些工具实际包装已列明。
- [ ] timeout、retry、backoff、concurrency、queue、circuit、AbortSignal 都有正/负边界测试。
- [ ] Provider、普通命令、文件、知识库、MCP 帧和结果都纳入统一资源清单。
- [ ] 重试只用于幂等操作，或有 idempotency key、服务端去重和补偿。
- [ ] timeout/abort 不被误写为远端或子进程副作用一定回滚。
- [ ] D032 多步骤工具链的前序结果信任、部分完成、失败停止和副作用补偿已评审；未把它当成通用并行/事务框架。
- [ ] 输出/错误/日志有大小上限，磁盘与进程预算不依赖调用方自律。
- [ ] 压力实验本身有界；未用危险资源耗尽方式“验证”宿主。

未解决 / 处置 / owner / 截止日：



## 9. 审计、隐私与供应链

- [ ] 每次敏感调用能关联认证主体、tenant、operation/request ID、工具/动作、策略决策和结果。
- [ ] D044 allowed decision 写失败时不进入队列、不建 cwd、不 spawn；拒绝 decision 失败也不执行。
- [ ] completion 写失败显式报错，文档没有声称回滚已发生副作用。
- [ ] 审计记录操作元数据，不无界保存原始秘密、完整敏感 argv、prompt、工具结果或 stdout/stderr。
- [ ] 显式 sensitiveValues 和常见键脱敏未被写成通用 DLP；低熵 argv hash 的字典风险已评估。
- [ ] 普通 logger 与 D039 Demo 输出不被当作脱敏审计；真实秘密不会进入演示参数。
- [ ] JSONL 文件/目录权限显式配置；当前实现没有自动 `chmod 0600`，部署已补足并验证。
- [ ] 已评估单实例串行 append 之外的跨进程协调、fsync、断电、网络文件系统和备份语义。
- [ ] 生产审计有防篡改、集中留存、访问审计、保留/删除、告警和时钟策略。
- [ ] 数据供应商、日志、审计和备份均有隐私 owner 与处理依据。
- [ ] 使用 lockfile 与 `npm ci`；SBOM、来源/签名、漏洞和许可证门禁若未完成则明确标为未解决。
- [ ] 没有声称当前已有遥测关闭合规认证、外部审计、WORM 或供应链安全认证。

当前证据：`src/observability/audit-sink.ts`、D044 audit/demo 测试、`package-lock.json`。

未解决 / 处置 / owner / 截止日：



## 10. 回归与攻击验证

- [ ] `npm run check` 在实际评审 SHA 上通过，保存真实终端输出。
- [ ] `npm run test:coverage` 通过，记录测试数及 statements/branches/functions/lines 四项。
- [ ] `git diff --check` 通过；只包含批准的变更。
- [ ] 每个安全修复先有能证明攻击/缺口的 RED，再有同测试 GREEN，再跑完整回归。
- [ ] RED 不是只有“模块不存在”；关键行为至少有可观察失败。
- [ ] 没有用预写 transcript、手工修改覆盖率或一次模型输出替代真实运行。
- [ ] symlink 覆盖最终链接、父目录链接、新文件和 TOCTOU。
- [ ] 提示注入用无害 canary/marker，同时验证权限与 OS 层，而非只看模型是否服从。
- [ ] MCP 覆盖未换行洪水、超长帧、巨大结果、坏分页和 timeout 后不自动重放。
- [ ] Provider 用 loopback 假服务覆盖慢响应、大响应、redirect、坏字段和秘密脱敏。
- [ ] D043/D044 对照覆盖 shell 元字符、argv 追加、输出、超时、取消与审计故障。
- [ ] 所有实验限定临时目录/loopback/数据总量，finally 清理，无真实秘密和外部攻击流量。
- [ ] 未执行的 D046 项仍标为待实证，没有在本清单提前勾选。

证据链接 / 实际输出：



## 11. 风险处置与发布门槛

- [ ] 每个 S4/S3 项都有修复、避免、缓解或书面风险接受，不允许只写“已知”。
- [ ] P0 项在不可信输入/真实秘密/多租户接入前关闭；P1 项有明确试运行前期限。
- [ ] 风险接受包含业务理由、影响范围、补偿控制、到期日和授权人。
- [ ] 默认禁用场景写入运行文档和部署校验，而非仅存在本清单。
- [ ] README、架构文档、工具 description、Demo 和对外材料没有“完整沙箱/完整 JSON Schema/自动重连”等过度声明。
- [ ] 新安全能力只有实际代码与测试完成后才从建议改为已验证。
- [ ] 维护者已签署源码与测试证据。
- [ ] 安全负责人已签署威胁模型与剩余风险。
- [ ] 平台/部署负责人已签署身份、OS、网络、文件权限、审计和隐私运行控制。
- [ ] 业务负责人已接受或拒绝剩余风险；发布决定和日期已记录。

### 最终决定

- [ ] 通过
- [ ] 有条件通过（条件、owner、期限已附）
- [ ] 不通过

评审 SHA：<br>
评审日期：<br>
维护者：<br>
安全负责人：<br>
平台/部署负责人：<br>
业务负责人：<br>
剩余风险复审日：

> 当前 D045 只提供清单与静态评审，不代替上述人员作出决定。
