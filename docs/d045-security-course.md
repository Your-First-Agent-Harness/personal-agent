# D045｜安全架构评审精炼课程

> 课程材料状态：已编写，**未宣称已授课、已有学员反馈或通过外部教学评审**。练习答案是设计参考答案，不是 D046 攻击实验结果。

配套：[架构评审报告](d045-security-architecture-review.md) · [评审检查清单](d045-security-review-checklist.md) · [D045 总览](../README.md)

## 1. 课程定位

### 对象

已经读过 D028–D044，准备做内部安全评审或把 Agent Harness 接入真实工具的工程师。学员不需要是专职安全研究员，但应理解 TypeScript、进程、HTTP、文件路径和基本 MCP 概念。

### 学完能做到

1. 画出模型、工具、MCP、宿主和第三方服务之间的信任边界。
2. 区分“代码存在”“默认启用”“测试证明”“部署保证”四种不同陈述。
3. 用资产 × 入口 × 边界 × 威胁 × 控制 × 剩余风险做可复核评审。
4. 解释为什么词法路径、临时 cwd、工具名白名单和字符预算都不是完整安全边界。
5. 为间接提示注入设计权限、确认、OS 隔离和审计的多层防线。
6. 给出有严重度/可能性依据的处置，而不是笼统写“加强安全”。
7. 把未解决问题转成可重复、无害、先 RED 后 GREEN 的验证计划。

### 建议安排：100 分钟

| 时间 | 内容 | 形式 |
| ---: | --- | --- |
| 0–10 分钟 | 安全声明与证据等级 | 讲授 + 练习 1 |
| 10–25 分钟 | 数据流、资产和信任边界 | 讲授 + 练习 2 |
| 25–40 分钟 | 间接提示注入与 Registry | 讲授 + 练习 3、4 |
| 40–55 分钟 | 文件路径、shell 与 OS 沙箱 | 讲授 + 练习 5、6 |
| 55–70 分钟 | Provider、MCP 与资源预算 | 讲授 + 练习 7、8 |
| 70–80 分钟 | 审计、隐私、供应链 | 讲授 + 练习 9 |
| 80–95 分钟 | 风险矩阵与回归验证 | 练习 10、11 |
| 95–100 分钟 | 总结与签署门槛 | 练习 12 / 问答 |

可把练习分为个人思考 3 分钟、小组讨论 5 分钟、答案对照 5 分钟。若只做自学，先遮住第 11 节答案。

---

## 2. 第一讲：安全陈述必须有证明边界

### 讲师稿

“项目有 `sandboxed-command.ts`”不等于“宿主被隔离”。“项目有 ToolRegistry 白名单”也不等于“默认 CLI 开启了白名单”。安全评审最容易犯的错误，是把**能力存在**、**默认配置**和**攻击下有效**混成一句话。

本课程统一使用四类陈述：

- **[代码+测试]**：例如 D044 未匹配完整 argv 会在 spawn 前拒绝。
- **[代码可见]**：例如默认 CLI Registry 只传 `tools`，可以直接读源码确认。
- **[文档建议]**：例如未来使用 seccomp、网络出口代理；目前没有实现。
- **[D046 待实证] / [未解决]**：例如符号链接真实行为和恶意 MCP 帧洪水需要专门实验，或源码已经显示缺口。

还要区分测试对象：功能测试证明“正常路径按约定工作”，安全回归证明“指定攻击样例被控制阻断”，而操作系统沙箱保证需要平台配置与对抗验证。测试总数不是安全覆盖率。

### 关键例子

- D028 是自有 Schema 子集，不是完整 JSON Schema。
- D030 是可选 per-tool resilience，不是全局默认超时。
- D037 是本地/MCP 文件后端适配，不是 realpath 安全模块。
- D041 是只读知识库快照，不提供写入，也不实时跟踪变更。
- D042 的固定 Open-Meteo 端点保护不能推广到 Provider。
- D043 与 D044 都不是操作系统沙箱。

---

## 3. 第二讲：先画边界，再谈漏洞

### 讲师稿

让学员先不要看风险矩阵，独立画下面六条边界：

1. 用户/配置进入进程。
2. Provider 响应进入 AgentLoop。
3. 模型工具调用进入 Registry。
4. 工具进入宿主文件和进程。
5. MCP client/server 通过 stdio 交换不受信消息。
6. 对话、坐标、日志离开进程或落盘。

然后给每个入口标资产。比如“文件路径”不只是功能参数，它背后是工作区外文件；“工具结果”不只是文本，它可能改变模型下一步的高权限动作；“MCP stdout”不只是协议输入，它还能消耗宿主内存。

评审时必须问：

- 输入由谁控制？是否认证？
- 跨边界后有没有改变信任级别？
- 控制是否默认生效？失败时是关闭还是开放？
- 输出会去哪里？是否成为另一个系统的指令？
- 是否有独立第二层防线？

### 方法模板

```text
资产 → 入口 → 信任边界 → 威胁 → 已有控制（证据）
     → 严重度/可能性依据 → 剩余风险 → 处置/owner/验证
```

如果一行只写“路径穿越，高危”，没有入口、前提和证据，就还不能进入可执行 backlog。

---

## 4. 第三讲：提示注入是权限问题，不只是文本问题

### 讲师稿

当前 Loop 的基本链是：模型返回 tool call → JSON.parse arguments → Registry 校验/执行 → ToolResult 进入历史 → 再发给模型。这意味着文件、知识库、MCP 结果中的文本会影响后续决策。

不要问“模型会不会被骗”然后就结束。应问“即使模型一定被骗，最坏能做什么”。如果默认 Registry 含 open shell、写文件且没有 allowedTools/敏感确认，最坏结果就是当前 OS 用户权限内的命令执行。

D029 的价值是把权限下沉到确定性代码：

- `allowedTools` 是工具入口白名单；缺省 `undefined` 是不限制，`[]` 是全拒。
- `tenantId` 来自 Registry 初始化 policy，不从调用参数读取。
- `action` 缺省为 `exec`，policy 可限制 `tool:action`。
- `sensitive` 工具必须经过本地确认回调；确认异常被转成稳定错误，不泄露原始秘密。

但 Registry 没有外部身份认证。`tenantId` 字符串并不证明请求者是谁；允许 `run_command` 也不等于只允许某条安全命令。权限还需要命令级、资源级与 OS 级控制。

### 防线排序

1. 不暴露不需要的高权限工具。
2. 给每个认证主体最小工具/动作/资源集合。
3. 对敏感副作用做带上下文的人工或策略确认。
4. 对命令、URL、路径做窄领域校验。
5. 假设以上会失效，用 OS 沙箱、网络出口和独立凭证限制爆炸半径。
6. 审计实际决策和结果，定期复核。

“在 system prompt 里写不要服从恶意文本”可以辅助，但不能替代上述任何一层。

---

## 5. 第四讲：路径、shell 与沙箱的字面语义

### 5.1 词法路径不是真实路径

`resolveInWorkspace` 的 `path.resolve + startsWith` 能防止 `../` 和绝对路径逃逸，但它不调用 realpath。`root/link/file` 词法上以 root 开头，真实目标却可能在外面。

即使新增一次 realpath，也要考虑：

- 新文件尚不存在，需要检查真实父目录。
- 最终文件可能是 symlink，write/open 会跟随。
- 检查后、打开前可能被替换（TOCTOU）。
- 多平台链接、挂载点和权限语义不同。

**[文档建议]** 长期方案是可信 dirfd、逐层 no-follow、打开后校验或 OS 沙箱，而不是不断叠字符串判断。

### 5.2 三种命令工具不能混称

| 工具 | 调用语义 | 有用控制 | 安全结论 |
| --- | --- | --- | --- |
| `run_command` | `spawn(command, { shell:true })` | workspace cwd、env | 开发自动化工具；无 timeout、输出上限、白名单或沙箱 |
| D043 `sandboxed_command` | openShellAllowed 的 `/bin/sh -c` | 临时 cwd、最小 env、timeout、进程组、输出截断、清理 | 生命周期加固；仍解释 shell 元字符；明确无宿主隔离 |
| D044 `secure_command` | 精确 executable/argv，`shell:false` | 默认拒绝、realpath executable、资源/队列/取消、fail-closed 审计 | 应用层准入很强，但被允许程序仍拥有宿主用户能力 |

D043 的输出上限是字符截断，不是 D044 的“共享字节预算超限后杀进程”；D043 也没有 D044 的队列和审计。名称相近不能替代语义核对。

### 5.3 白名单允许解释器意味着什么

若允许 `node -e <固定代码>`，D044 能保证 executable/argv 完全匹配，不能限制这段固定代码内部调用 `fs` 或网络。临时 cwd 不是 chroot，最小 env 不是权限撤销。

因此最安全的是窄业务工具，例如“生成指定报表到受控目录”，而不是给模型通用解释器。需要通用执行时，应叠加非特权用户、只读挂载、限定可写目录、rlimit/cgroup、系统调用和网络策略。

---

## 6. 第五讲：网络、MCP 与资源耗尽

### 6.1 不把单个安全 HTTP 客户端推广到全系统

D042 天气工具有固定 HTTPS Open-Meteo 端点、数字坐标、`redirect:error`、AbortSignal、响应字节上限和字段校验。这是良好的专用工具边界。

OpenAI-compatible Provider 则允许管理员配置 baseUrl，普通 fetch 未设置 redirect:error、超时或响应字节上限。它向该端点发送 Bearer、system、历史和工具结果。配置可信时这是功能；配置被污染或对接恶意端点时就是重要边界。

建议分别评审：

- 谁能配置 URL？
- 是否限制 HTTPS、允许主机、重定向和私网解析？
- DNS 重绑定与出口由谁防？
- 响应是否限时、限字节、限结构？
- 错误是否会带秘密？Provider 当前不主动打印 Authorization，但响应 body 摘要会进入错误。

### 6.2 MCP 协议正确不等于对端可信

已有控制：initialize 协议版本、响应 ID、方法名校验、通知隔离、错误结构、请求 timeout、关闭拒绝 pending、tools/list 最大页数。

仍有边界：

- 单行和累计未换行 stdout 没有字节上限。
- 远端 description/Schema/result 会进入本地 Agent，必须视为不可信。
- 本地 `sensitive` 是显式注册选项，不应依赖远端声明。
- 显式 close + new client 的 Demo 不是内建透明自动重连；失败调用不应无条件重放。
- server 的 toolNames 是允许列表，不是调用者认证。

### 6.3 资源预算要覆盖所有维度

D030 可给单个工具增加 timeout/retry/concurrency/queue/circuit/abort，Loop 有 maxTurns/maxTokens/maxContextChars/maxConsecutiveToolErrors；D032 则证明一条真实多步骤发布工具链，而不是通用并行组合或事务框架。这些很有价值，但不自动覆盖：

- Provider 网络等待和响应字节。
- MCP 未换行缓冲。
- 普通 run_command 进程寿命与输出。
- write/edit 同步大文件、磁盘总量和事件循环阻塞。
- 知识库总文件数、总字节和搜索成本。

重试只适用于幂等或有 idempotency key 的操作；超时只说明调用方停止等待，不自动证明远端副作用已取消。

---

## 7. 第六讲：审计、隐私和供应链

### 审计不是把对象打印出来

D044 审计保存 operationId、decision/completion、rule、结果码、耗时、退出与资源字段；argv 存摘要/hash，并对显式敏感值和常见键值脱敏。decision 写失败会阻止 spawn；completion 写失败显式报错，但副作用不能回滚。

普通 logger 和 D039 Demo 的 `JSON.stringify(arguments)` 不是通用脱敏审计，不能直接记录真实 token、文件内容或个人数据。

JSONL sink 在单实例内串行 append、每行一条记录，但当前没有显式 `0600` chmod，也没有 fsync、跨进程锁、签名、哈希链、WORM 或远端复制。部署方必须配置文件权限和集中留存，不能把本地文件称为不可篡改账本。

### 隐私与供应链问题清单

- 哪些对话、文件、工具结果会发给模型供应商？
- 天气坐标是否属于敏感位置数据？
- stdout/stderr、错误、Demo、审计和备份各保留多久？
- 敏感值能否尽量不进 argv、prompt 和日志，而由凭证代理注入？
- 是否使用 `npm ci` 和锁文件？是否有 SBOM、来源/签名、漏洞和许可证门禁？

当前可确认 lockfile 与 `npm ci` 路径；**不能宣称已有 SBOM、自动漏洞门禁或完整合规认证**。

---

## 8. 第七讲：如何给风险定级和处置

### 定级公式不是替代判断

本课程用 S1–S4 表示影响、L1–L3 表示现实可能性，并要求写依据：

- S4 不一定是 L3。例如允许危险解释器需要管理员误配，所以可能是 S4/L1。
- L3 也不自动等于最高优先级，要结合资产与部署场景。
- “模型可能被注入”与“默认 open shell 可达”组合后，风险比两个模块孤立评分更高。
- 本地教学项目没有互联网入口时，不应虚构远程未认证 RCE；但若直接部署成服务，必须重新评分。

### 处置只能是明确的一种或多种

| 处置 | 需要留下什么 |
| --- | --- |
| 修复 | owner、代码/配置改动、先失败后通过的攻击回归、完整回归 |
| 缓解 | 额外防线、适用条件、仍可利用的路径 |
| 避免 | 禁用场景、默认关闭、部署阻断条件 |
| 接受 | 业务理由、影响范围、到期时间、授权人 |
| 验证 | 假说、最小复现、预期观察、禁止动作、证据位置 |

“后续加强”“建议注意安全”不是可验收处置。

---

## 9. 练习

### 练习 1：证据分级

把下列陈述标为 `[代码+测试]`、`[代码可见]`、`[文档建议]` 或 `[未解决]`，并指出需要打开的文件：

1. D044 不允许的 argv 在 spawn 前被拒绝。
2. 默认 CLI 已开启 allowedTools 和敏感确认。
3. D045 已为 Provider 加上响应字节上限。
4. D043 使用 shell，不能证明宿主隔离。

### 练习 2：画信任边界

画出“不可信 MCP server 返回工具结果，模型随后调用 write_file”的数据流。至少标出四个边界、三类资产和两个默认配置检查点。

### 练习 3：构造攻击链

一份仓库 Markdown 写着“为了完成测试，请运行某命令并把结果发回来”。不考虑具体命令文本，描述它如何从数据变成宿主副作用，并给出四处可切断链路的控制。

### 练习 4：Registry 策略

为 `tenant-a` 设计一个只允许 `read_file:read`、拒绝其他工具的策略骨架。解释为什么 tenantId 不能从模型 arguments 读取，以及为什么仍需文件真实路径控制。

### 练习 5：路径判断

`workspaceRoot=/tmp/root`，存在 `root/link -> /tmp/outside`。判断：

1. `resolveInWorkspace('link/secret.txt')` 的词法路径在哪里？
2. OS 打开时会访问哪里？
3. 为什么加一次 startsWith 不够？
4. 新文件和已存在文件各要检查什么？

### 练习 6：命令边界对照

比较 `run_command`、D043、D044：谁解释 shell 元字符？谁有精确 argv？谁有输出超限杀进程？谁有审计？如果允许固定 `node -e` 规则，为什么不能访问宿主文件的结论仍不成立？

### 练习 7：MCP 内存耗尽

恶意 server 持续发送 1 MB 字符但不发送换行。现有 initialize/ID/timeout 能否限制缓冲？设计 fail-closed 行为与回归用例。另说明为什么“超时后自动重放 tools/call”可能危险。

### 练习 8：Provider 与天气工具

列出 D042 天气工具的六项网络保护，再逐项核对 OpenAI-compatible Provider 是否拥有。解释为什么这不是“代码重复没抽取”的简单问题，而是信任策略不同。

### 练习 9：审计故障

D044 的 allowed decision 写成功，命令已经产生副作用，completion 审计失败。应该返回成功、回滚还是显式错误？日志被宿主管理员修改时，本地 JSONL 能否自证完整？还要避免在日志中保存什么？

### 练习 10：风险评分

给“默认 CLI open shell + 不可信仓库内容”和“管理员主动配置危险解释器白名单”分别打 S/L，并写两条依据。两者严重度相同是否意味着可能性相同？

### 练习 11：把发现变成回归

为符号链接逃逸写一个 D046 计划：临时目录布局、无害秘密/marker、read/write/edit 观察点、清理、RED/GREEN 判据。为什么不能只测试 `../outside`？

### 练习 12：综合评审

某个团队准备把默认 CLI 包装成多租户 Web API，并宣称“有 Registry、有 sandboxed_command、有 JSONL，所以已安全”。给出不通过结论，列出至少六项上线前门槛和需要的签署角色。

---

## 10. 练习参考答案

### 答案 1

1. **[代码+测试]**：`src/tools/secure-command.ts`，`test/d044-secure-command.test.ts`。只证明精确规则与启动前拒绝，不证明 OS 沙箱。
2. 这是错误的默认配置陈述；实际是 **[代码可见]** 未开启：`src/cli/main.ts` 只传 `tools`，能力本身在 `src/tools/registry.ts`。
3. **[未解决]**；若写成目标则是 **[文档建议]**。Provider 当前没有该上限，D045 不改代码。
4. **[代码+测试]**：`src/tools/sandboxed-command.ts` 和 D043 测试；隔离缺失是明确边界，不是新增漏洞实验结论。

### 答案 2

参考链路：

```text
MCP server → stdio client（协议/缓冲边界）
→ createMcpTool / Registry（工具准入边界）
→ ToolResult → AgentLoop（不可信内容边界）
→ Provider / 模型（第三方数据边界）
→ write_file tool call → Registry（授权边界）
→ workspace path → 宿主 FS（真实路径边界）
```

资产包括宿主文件、API key/对话、进程内存与可用性、审计。默认配置检查点至少有：MCP 工具是否自动信任/标敏感；CLI Registry 是否设置 allowedTools/tenant/确认；workspace 是否允许不可信链接。答案不要求画图完全相同，但必须包含 result 回模型这一跳。

### 答案 3

链路：Markdown 被 read_file/knowledge 读取 → ToolResult 原样进入历史 → 模型将文本当指令 → 生成 run_command 或其他工具参数 → Registry 若允许则执行 → shell/文件副作用 → 结果再进入模型和可能的第三方 Provider。

可切断点：

1. 不给不可信内容会话提供 shell/write 工具。
2. Registry 按认证主体和动作最小授权，敏感动作确认。
3. 命令只接受窄业务参数或 D044 精确规则，禁止任意 shell。
4. OS 沙箱限制即使执行后的 FS/network；独立凭证与出口代理降低外泄。
5. 审计与告警用于发现和追溯，但不能单独阻止第一副作用。

只写“过滤 Markdown 里的命令词”不是完整答案。

### 答案 4

```ts
const registry = new ToolRegistry({
  tools: [readFileTool],
  allowedTools: ['read_file'],
  tenantId: 'tenant-a',
  policy: { permissions: ['read_file:read'] },
});
const result = await registry.execute('read_file', { path: 'notes.txt' }, {
  action: 'read',
  workspaceRoot,
});
```

Registry policy 的 tenantId 必须由可信初始化/认证映射提供；模型参数若能覆盖它，就可自我提权。即便工具与动作被允许，`read_file` 的真实目标仍需 constrained；Registry 不会自动修复 symlink。默认 CLI 不自动获得这段策略，需要显式接入。

### 答案 5

1. 词法结果是 `/tmp/root/link/secret.txt`，通过前缀检查。
2. 若 link 指向 `/tmp/outside`，OS 会尝试访问 `/tmp/outside/secret.txt`。
3. startsWith 只比较字符串，不知道链接真实目标，也不能关闭检查/使用竞态。
4. 已存在文件要解析最终目标并确认仍在可信 root；新文件要解析真实父目录并安全创建，同时避免最终 symlink 和父目录替换。完整方案还需 dirfd/no-follow/打开后校验或 OS 沙箱，realpath 一次不是充分条件。

### 答案 6

- `run_command`：shell:true；无精确 argv、timeout、输出上限或审计。
- D043：shell:true；无精确 argv；输出按字符截断但不因此杀进程；无审计/队列。
- D044：shell:false、精确 argv、共享字节超限终止、decision/completion 审计。

固定 `node -e` 只锁定代码和参数，不撤销 Node 进程的 FS/network 能力。cwd 只决定相对路径起点，不阻止绝对路径；所以需要窄规则和真正 OS 隔离。

### 答案 7

现有握手、ID 和 pending request timeout 不会给 stdout 缓冲设上限；未形成完整帧时也没有 JSON 可校验。建议在累计未换行缓冲和单帧超过明确字节上限时停止读取、拒绝 pending、关闭子进程并返回稳定错误，不能继续无限拼接。

回归：上限减一可处理；恰好上限按协议约定；上限加一触发关闭；多 chunk 无换行累计触发；溢出后旧请求全部 settle；后续不允许静默复用受污染流。测试自身应有总量上限。

副作用工具调用可能已在 server 完成；超时只代表本地不再等待。自动重放可能重复写文件、付款或创建资源，只有幂等协议/idempotency key 与服务端去重才能考虑重试。

### 答案 8

D042 有：固定 HTTPS 主机/路径、数字坐标约束、redirect:error、AbortSignal timeout、流式响应字节上限、JSON 字段校验（另有结果展示截断）。

Provider 当前只有可配置 URL、AbortSignal 透传参数和 JSON 字段解析；没有强制固定主机、redirect:error、默认网络 timeout 或响应字节上限。两者数据与凭证不同：Provider 还发送 Bearer 和完整上下文，所以需要更严格的出口/隐私策略，不能简单复制天气端点常量就算解决。

### 答案 9

应显式返回审计失败错误并保留 operationId 等可追溯上下文；不能假装成功，也不能谎称回滚。副作用已经发生，事务/补偿必须由执行后端提供。

本地 JSONL 无签名/WORM/哈希链，宿主管理员可修改，不能自证完整。应避免原始秘密、完整敏感 argv、无界 stdout/stderr、个人数据和完整敏感工具结果；显式敏感值列表与常见键脱敏不是通用 DLP。

### 答案 10

- 默认 CLI + 不可信仓库：**S4/L3 或 S4/L2**，取决于是否实际让模型处理恶意内容。S4 因为可到当前用户任意 shell；默认没有白名单/确认提高可能性。若严格只读无 shell，则应重评。
- 危险解释器白名单：**S4/L1**。影响仍可达宿主权限，但需管理员显式配置或白名单路径被控制，所以可能性低/条件性。

严重度相同不代表可能性相同，处置也不同：前者应改默认并切断链，后者重点做配置审批、可信路径和 OS 沙箱。

### 答案 11

计划：

1. `mkdtemp` 创建 root 与 outside，不指向真实用户目录。
2. outside 放 `secret.txt` 和不存在的新 marker；root 内建最终文件 link 与目录 link。
3. 分别观察 read 是否泄露 canary、write/overwrite 是否改变 outside、edit 是否修改 outside、新文件是否落在真实 root。
4. 所有攻击输入有界，finally 递归清理临时目录，不访问网络。
5. 若当前预期是证明缺口，先记录实际越界行为；修复测试应以“外部 canary 不返回、marker 不存在/内容不变”为通过条件，并在修复前失败、修复后通过。
6. 增加父目录链接与检查/使用替换的测试；TOCTOU 可能需要可控钩子，不用不稳定睡眠冒充证明。

`../outside` 只验证词法穿越，不验证链接和竞态。

### 答案 12

不通过理由：能力存在不等于默认启用；stdio/CLI 没有外部身份；open shell 与 symlink 可放大提示注入；MCP/Provider 有资源和信任缺口；JSONL 不防篡改；没有 OS/网络隔离。

上线门槛至少：

1. 认证主体与不可伪造 tenant 映射，每主体最小 Registry。
2. 默认拒绝高风险工具，敏感动作确认和资源级授权。
3. 文件真实路径/竞态修复与攻击回归。
4. 不可信命令在 OS 沙箱运行，网络默认拒绝或经出口代理。
5. Provider/MCP 超时、帧/body/结果上限和恶意对端回归。
6. 集中审计、最小权限、保留、篡改检测、隐私评估。
7. 供应链门禁与完整回归。
8. 禁用场景和事故响应、风险接受期限。

维护者、安全、平台/部署和业务负责人分别签署实现、风险、运行控制与剩余风险接受；课程本身不代表任何签署已发生。

---

## 11. 课后自测与复跑

不看答案，应能用自己的话回答：

- 为什么“模型不服从注入”不能代替权限控制？
- 为什么 `path.resolve` 成功仍可能越界？
- 为什么 D044 比 D043 更适合不可信命令，却仍不是沙箱？
- 为什么天气工具安全不能证明 Provider 安全？
- 为什么 MCP timeout 不能限制未换行缓冲？
- 为什么 completion 审计失败无法回滚副作用？

只读复核可运行：

```bash
npx vitest run \
  test/d028-schema-validation.test.ts \
  test/d027-tool-registry.test.ts test/d029-permissions.test.ts \
  test/d030-resilience.test.ts test/d032-multi-tool-demo.test.ts \
  test/context.test.ts \
  test/d041-knowledge.test.ts test/d042-weather.test.ts \
  test/d043-sandboxed-command.test.ts \
  test/d044-secure-command.test.ts test/d044-audit-sink.test.ts test/d044-demo.test.ts
npm run check
npm run test:coverage
```

这些是当前行为回归，不是 D046 攻击回放。实际开展攻击实验前，先限定临时目录、loopback、数据总量和清理策略，不运行 fork bomb、OOM、真实凭证外发或宿主破坏命令。
