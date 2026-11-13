# D047｜文档日：Agent 工具调用的安全实践公开课（未授课）

本日交付一套面向外部开发者的 **90 分钟公开课课程包**：从模型生成 ToolCall 开始，沿 Registry 授权、参数与业务校验、敏感确认、有界执行、不可信结果回喂和双阶段审计，讲清“工具能调用”与“生产可上线”之间的距离。

**明确未实际授课。** 当前没有公开课直播、录屏、真实回放、出席人数、学员反馈或外部评价；课程中的“课堂”“学员”“讲师”均指教学预案。D046 transcript 是既有命令 Demo 的真实终端证据，不是本公开课回放。

本日只修改本 README 与 `docs/d047*` 文档，不修改运行时、测试、package 或证据文件，不新增依赖，不制作 release，不创建外部 issue。

## 1. 交付物

| 文件 | 用途 |
| --- | --- |
| [docs/d047-public-course.md](docs/d047-public-course.md) | 90 分钟完整讲义：逐段概念、代码事实、D046 演示、生产清单与证据索引 |
| [docs/d047-slides.md](docs/d047-slides.md) | 22 页幻灯片文案：每页 3–5 个要点、视觉建议与讲解重点 |
| [docs/d047-instructor-script.md](docs/d047-instructor-script.md) | 可直接授课的逐分钟讲师稿：原话、提问、转场、Demo 操作与失败兜底 |
| [docs/d047-exercises.md](docs/d047-exercises.md) | 5 组练习、事故推演、退出题、参考答案、评分 rubric 与 18 条 FAQ |
| 本 README | 课程定位、90 分钟结构、证据边界、复跑入口与真实验收结果 |

代码基线是 D046 提交 `b97cffa0c04d0258a410f46ab3c054fb5f58de15`，当前分支为 `D047`。本日没有从 main 重建或合并 main。

## 2. 与 D045 内部分工的区别

D045 是面向仓库内部的安全架构评审，重点是攻击面、风险登记、P0/P1/P2 和整改优先级。D047 不复述那张风险矩阵，而是面向第一次接触本项目的开发者，沿一次真实调用链组织教学：

```text
模型提出 ToolCall
  → 工具发现与执行 allowlist
  → tenant / subject / object / action 授权
  → JSON、Schema 与业务条件校验
  → 敏感操作按本次参数确认
  → timeout / retry / concurrency / output / process 边界
  → tool.execute 产生或拒绝副作用
  → 不可信 ToolResult 回喂模型
  → decision + completion 证据与异常处置
```

课程主线只有一句：**ToolCall 是提案，不是授权。** D045 中的未解决风险仍被保留为明确的“不能宣称”，不会被包装成已修复成果。

## 3. 学习目标与 90 分钟结构

听众完成课程后，应能：

1. 区分模型提议、宿主执行授权与业务对象授权；
2. 说明发现面、执行面、Schema、确认和 OS 隔离各自不能替代什么；
3. 识别工具结果、文件、网页和 MCP 内容形成的间接提示注入与外传链；
4. 正确处置非幂等超时、重试和审计写失败；
5. 使用生产清单作出 go/no-go 判断。

| 时间 | 内容 | 对应材料 |
| --- | --- | --- |
| 0–6 分钟 | 冷启动：为什么“排查构建”会变成读取 `.env` 的提案 | Slide 1–2 |
| 6–16 分钟 | ToolCall 解剖、信任边界与 Registry 顺序 | Slide 3–5 |
| 16–28 分钟 | 工具发现、租户、参数形状与业务授权 | Slide 6–9 |
| 28–37 分钟 | 不可信工具结果、秘密外传链与 Loop 保险丝 | Slide 10–12 |
| 37–51 分钟 | D046 命令安全演示：cwd、白名单、资源预算与非容器边界 | Slide 13–16 |
| 51–60 分钟 | 敏感确认、幂等、超时与重试 | Slide 17–18 |
| 60–68 分钟 | 外部 HTTP 与 MCP：协议适配不等于信任继承 | Slide 19 |
| 68–76 分钟 | 双阶段审计、写失败与“结果未知”语义 | Slide 20 |
| 76–84 分钟 | 小组事故推演 | Slide 21 |
| 84–90 分钟 | 生产清单、退出题与收束 | Slide 22 |

以上是授课时间预算，不是已经发生的课堂记录。讲师完整话术和压缩课时方案见[讲师稿](docs/d047-instructor-script.md)。

## 4. 课程使用的真实证据

课程用四种标记避免混淆事实与建议：

| 标记 | 本课中的例子 |
| --- | --- |
| 【代码实证】 | Registry 检查顺序、Schema 子集、Loop 回喂、weather 响应边界、resilience 默认值 |
| 【运行实证】 | D046 的 12 项门禁、8 个 operation、16 条 JSONL、3 次允许 spawn、拒绝 spawn 增量 0 |
| 【教学推演】 | `.env` 冷启动、取消订单、支付超时、小组事故与练习 |
| 【未解决风险】 | 默认开放 Shell、文件符号链接、OS 隔离、MCP 动态工具与本地审计耐久性 |

主要一手入口：

- [`src/tools/registry.ts`](src/tools/registry.ts)：allowlist、租户、JSON、Schema、确认和 resilience 顺序；
- [`src/runtime/loop.ts`](src/runtime/loop.ts)：工具结果回喂与 Loop 停止条件；
- [`src/tools/workspace.ts`](src/tools/workspace.ts)：普通文件工具当前的真实路径边界；
- [`src/tools/sandboxed-command.ts`](src/tools/sandboxed-command.ts) 与 [`src/tools/secure-command.ts`](src/tools/secure-command.ts)：两种命令模型；
- [`src/tools/weather.ts`](src/tools/weather.ts)、[`src/adapters/mcp-tool.ts`](src/adapters/mcp-tool.ts)：外部输入边界；
- [`src/observability/audit-sink.ts`](src/observability/audit-sink.ts)：JSONL 串行 append；
- [D046 transcript](evidence/d046-transcript.txt) 与 [D046 audit JSONL](evidence/d046-audit.jsonl)：已保存的真实运行证据；
- [D045 内部安全评审](docs/d045-security-architecture-review.md)：课后深入阅读，不是本课外讲结构。

## 5. D046 演示的课堂用法

课堂只原样复跑：

```bash
npm run demo:d046
```

要求 Node.js 24+，无需 API Key，不访问外网。演示使用唯一 `mkdtemp` 实验根、专用 victim/marker、伪造环境变量和 `finally` 清理。讲师必须先展示安全边界，再运行命令。

重点只讲三组观察：

1. **D043 绝对路径/cwd**：可以离开初始 cwd，但 D046 的 victim 始终在实验根内；固定 env 不泄露不等于文件系统隔离。
2. **D044 精确准入与正向控制**：五类未允许调用在 spawn 前拒绝；env 正向控制证明真实执行计数有效，三条允许链合计 spawn 3 次。
3. **资源与审计**：共享 64 字节输出预算、30ms wall timeout、8 个 operation 与 16 条双阶段记录；最后要求实验根删除。

现有真实 transcript 末尾为：

```text
summary auditRecords=16 operations=8 secureSpawnCount=3 secureDeniedSpawnDelta=0 hostRootRemoved=true recording=none
D046 Demo PASS: 12 项门禁成立；攻击未离开实验根；明确未录屏。
auditEvidence=evidence/d046-audit.jsonl
```

这段话是**既有 D046 结果引用**，不是 D047 公开课现场输出。若课堂复跑失败，讲师必须保留真实错误并切换到已保存 transcript，不能手写 PASS 冒充本次成功。

禁止把演示改造成真实用户路径、真实凭证、真实外传、端口监听、fork bomb、OOM 或其他破坏性载荷。

## 6. 必须保留的技术边界

- **默认配置**：默认 CLI 注册内置工具，包括开放 `run_command`；allowlist 与敏感确认未显式配置时，不能声称已自动启用。
- **Schema**：当前是本地子集，不是完整 JSON Schema；不能代替条件必填、对象属主、金额一致和状态机校验。
- **文件路径**：普通文件工具当前使用绝对路径与词法根目录检查，不是全路径 realpath 隔离；D045 已记录符号链接风险。
- **D043**：临时 cwd、固定 env 和进程组管理不是文件系统或 OS 沙箱。
- **D044**：精确 executable/argv、`shell:false`、资源预算与审计很有价值，但仍不是容器；没有 namespace、cgroup、seccomp 或完整 MAC。
- **结果回流**：工具、HTTP 与 MCP 内容仍不可信；结构校验不等于语义可信，Loop 限制不等于授权。
- **重试**：默认 `maxRetries=0`；`retryable=true` 不是自动重试许可，超时不是事务回滚。
- **审计**：decision 写失败阻止启动；允许命令 completion 写失败显式失败但不可回滚。本地 JSONL 不等于远程、防篡改、完整审计平台。
- **验证范围**：测试与覆盖率只代表代码回归，不代表攻击面覆盖、外部安全认证或所有风险已经关闭。

## 7. 备课与复跑

```bash
npm ci
npm run check
npm run test:coverage
npm run demo:d046
git diff --check
```

只复跑课程涉及的部分可执行规格：

```bash
npx vitest run \
  test/d028-schema-validation.test.ts \
  test/d029-permissions.test.ts \
  test/d030-resilience.test.ts \
  test/d042-weather.test.ts \
  test/d044-secure-command.test.ts \
  test/d044-audit-sink.test.ts \
  test/d046-attack-chains.test.ts \
  test/d046-demo.test.ts
```

测试通过不能替代真实业务授权、OS 隔离、外部服务状态核验或上线评审。

## 8. 课程包自检

- [x] 90 分钟逐段时间合计完整，幻灯片与讲师稿页码一致；
- [x] 22 页幻灯片均含标题、3–5 个要点、视觉建议和讲解重点；
- [x] 讲师稿包含建议原话、互动、转场、D046 操作与失败兜底；
- [x] 练习含参考答案、退出题、评分 rubric 和 FAQ；
- [x] 明确区分代码事实、真实运行证据、教学推演和未解决风险；
- [x] 未把 secure_command 称为容器，未把 Schema 称为完整 JSON Schema；
- [x] 未虚构授课、回放、出席、学员反馈或外部评价；
- [x] 最终门禁实跑结果已填写到第 9 节。

## 9. 最终验收记录

2026-11-12 在本分支实际运行完整检查；数值来自真实 Vitest/V8 输出。课程备课本身没有新增运行时测试，以下结果不代表攻击面覆盖率或外部安全认证。

| 命令 | 实测结果 |
| --- | --- |
| `npm run check` | ESLint、TypeScript 通过；**56 个测试文件 / 511 项测试全部通过** |
| `npm run test:coverage` | **56 / 56** 测试文件、**511 / 511** 测试通过，覆盖率门禁通过 |
| `git diff --check` | 通过，无 whitespace error |

`All files` 四项覆盖率：

| Statements | Branches | Functions | Lines |
| ---: | ---: | ---: | ---: |
| **91.61%** | **86.67%** | **96.75%** | **93.86%** |

## 10. 未发生事项

- 未实际举办公开课，未进行直播或录屏；
- 无真实课程回放、学员名单、出席数据、答卷、反馈或外部评价；
- 未把 D046 安全演示 transcript 冒充公开课记录；
- 未修改运行时、测试、package、D046 证据或历史文档；
- 未执行 D048、release、外部 issue 或生产部署；
- 未进行任何真实攻击、真实凭证读取、真实数据外传或外部安全认证。

若后续真实授课，应另行记录实际日期、形式、演示结果、原始问题与改进；不得把本备课包倒填成已发生活动。
