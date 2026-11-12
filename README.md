# D026：v0.1 发布复盘、第一批外部反馈与 issue 归档

计划日期：2026-12-06  
基线：D025 `ab3c77c`  
任务卡：D026「v0.1 发布复盘、读取第一批外部反馈、首批 issue 归档」。

> 本日结论：真实仓库的首批 open/closed issue 为 **0 条**，因此归档 0 条，不编造用户、评论、公开课或观看数据。交付物是一套可重复执行的只读查询、可追溯分类规则、未来 issue 模板和真实空快照。

计划日期来自任务卡；下文 `capturedAt`、`publishedAt` 均保留 GitHub 实际返回值，不改写成任务卡日期。

## 1. 目标与范围

本日只完成四件事：

1. 根据仓库和 GitHub 已有事实复盘 v0.1.0，而不是补写不存在的发布活动。
2. 用 `gh` 查询 `Your-First-Agent-Harness/personal-agent` 的 open 和 closed issue。
3. 将编号、标题、状态、作者、URL、标签、时间、正文、评论和可复现信息整理成机器可读快照；有分类必须有依据。
4. 用自动化测试证明空结果和未来的非空结果都能走同一套归档流程。

脚本只读 GitHub，只写本地 JSON。它不创建、关闭、编辑 issue，不发表或回复评论，不修改标签，也不读取或保存 token。没有升级依赖，没有实现 MCP 等后续任务，也没有修改 main 的课程索引。

## 2. v0.1.0 发布事实复盘

### 2.1 已核验事实

本日通过 `git show v0.1.0`、`gh release view v0.1.0` 和仓库已有发布文档交叉核对：

| 项目 | 真实事实 |
|---|---|
| tag / commit | `v0.1.0` → `c5479fd3730e58082bc3fd4aea029fb708612759` |
| GitHub Release | [personal-agent v0.1.0](https://github.com/Your-First-Agent-Harness/personal-agent/releases/tag/v0.1.0)，非 draft、非 prerelease |
| GitHub `publishedAt` | `2026-11-12T16:04:42Z`；发布说明正文中的课程发布日期另标为 `2026-12-05`，两种口径不混用 |
| Release 资产 | `personal-agent-0.1.0.tgz`，34,016 bytes |
| 资产 SHA-256 | `cf9083a47f8b99d7e32417002060f3520f0c576975ce17df824ea8c86cf0205b` |
| 运行边界 | Node.js 24+、原生 ESM、零运行时 npm 依赖，包仍为 npm `private` |
| G1 能力 | 安装后的 bin 可运行离线 Demo，以确定性脚本模型驱动真实 `read_file` → `run_command` → `edit_file` → `run_command` |
| 已有验收证据 | `docs/releases/v0.1.0.md`、`docs/install.md` 与 `scripts/verify-g1-install.ts` 记录了 tarball 离线安装和安装后运行验收 |

### 2.2 哪些做法值得保留

- **发布物从安装目录验收**：不是只检查仓库源码或包元数据，而是实际执行 `npm pack`、全新目录安装和安装后的 bin。
- **模型与工具边界清楚**：离线 Demo 明示使用 `deterministic-offline-script`，不冒充外部模型；文件读写、编辑和命令执行是真实工具行为。
- **证据可复现**：测试前后退出码、真实 diff、最终文件和临时目录清理都有断言，陌生人不需要凭一段成功文字判断发布是否可运行。

### 2.3 不能从这些事实推出的结论

- 离线 Demo 不证明外部模型质量、真实任务的智能程度或托管运行能力。
- v0.1.0 不包含 MCP，不提供后续发布级进程恢复或托管能力。
- 首批 issue 为 0 不等于用户满意，也不等于已有采用量；它只说明本次 GitHub Issues 查询没有记录。
- 本日没有制作录屏，也没有新增公开课、外部活动或观看数据。

因此，当前可验证的下一步不是虚构“用户呼声”，而是持续保留真实查询入口，并在反馈出现后先补齐复现证据、再安排修复优先级。

## 3. 第一批 issue：真实查询结果

查询目标：`Your-First-Agent-Harness/personal-agent`  
快照时间：`2026-11-12T16:17:49.466Z`  
快照文件：[docs/feedback/d026-v0.1-issues.json](docs/feedback/d026-v0.1-issues.json)

| 状态 | 数量 | issue 编号 |
|---|---:|---|
| open | 0 | 无 |
| closed | 0 | 无 |
| 合计 | **0** | 无 |

实际执行的查询为：

```bash
gh issue list \
  --repo Your-First-Agent-Harness/personal-agent \
  --state all \
  --limit 1000 \
  --json number,title,state,author,url,labels,createdAt,updatedAt,closedAt,body,comments
```

原始 `gh issue list --state all` 返回 `[]`。因为没有 issue，本次没有可读取的评论、可归档编号或可分类对象。快照仍保留完整查询命令、时间、五类零计数和 `issues: []`，使“查过但没有”与“没有查”可区分。

## 4. 可复用分类归档流程

实现分为两层：

- `src/feedback/issue-archive.ts`：纯数据转换，保留原始字段、给出分类依据、提取复现段落并统计。
- `scripts/archive-feedback.ts`：调用 `gh issue list`，将真实结果写入 JSON；测试可注入查询器，避免测试联网或伪造仓库快照。

流程固定为：**查询全部状态 → 原样保留正文字段 → 标签优先分类 → 标题关键词兜底 → 提取复现步骤 → 写快照 → 人工复核**。

### 4.1 分类规则

| 分类 | 已识别标签（不区分大小写） | 无已识别标签时的标题关键词 |
|---|---|---|
| `bug` | `bug`、`defect` | `bug`、`error`、`crash`、`failure`、`failed`、`缺陷`、`错误`、`崩溃`、`失败` |
| `documentation` | `documentation`、`docs` | `documentation`、`docs`、`document`、`文档`、`教程` |
| `enhancement` | `enhancement`、`feature`、`feature request` | `enhancement`、`feature`、`improvement`、`功能请求`、`增强`、`优化建议` |
| `question` | `question`、`support` | `question`、`how to`、`support`、`疑问`、`如何`、`怎么` |
| `other` | 无匹配 | 无匹配，不强行猜测 |

先扫描全部已识别标签，再按 `bug` → `documentation` → `enhancement` → `question` 的顺序匹配标题关键词。因此，带 `Documentation` 标签的标题即使含有 `Bug`，仍归为文档类。每条非空结果都保存 `classification.evidence`，例如 `label "bug"` 或 `title keyword "feature"`，可以回看分类原因。

这只是确定性初分，不代替维护者阅读正文和评论，也不会自动修改 issue。

### 4.2 字段保真与未知值

每条非空归档保留：

- `number`、`title`、`state`、`author`、`url`、`labels`；
- `createdAt`、`updatedAt`、`closedAt`；
- 完整 `body` 和 `comments`（评论作者、正文、时间、URL）；
- `classification` 与 `reproduction`。

缺失的作者、正文和时间写为 `unknown`。空标签数组表示确实没有标签；open issue 的 `closedAt: null` 表示尚未关闭，而不是数据丢失。脚本识别 `Steps to reproduce`、`Reproduction steps`、`Reproduction`、`Repro steps`、`复现步骤`、`如何复现` 等 Markdown 标题，并原样截取到下一标题前。没有显式段落时记为 `unknown`，这不等于“无法复现”，完整正文仍可供人工检查。

## 5. 复现与运行方式

需要 Node.js 24+ 和已具备目标仓库只读访问权限的 `gh`。无需安装新依赖。

```bash
# 查询真实仓库并覆盖本日快照
npm run feedback:archive

# 同一流程写入另一份快照，不改 GitHub issue
npm run feedback:archive -- docs/feedback/next-issue-snapshot.json

# 只运行本日新增测试
npx vitest run test/d026-feedback-archive.test.ts test/d026-feedback-command.test.ts
```

成功输出类似：

```text
ISSUE_ARCHIVE_PASS total=0 open=0 closed=0 output=<本地快照路径>
```

`output` 是本地路径；`total` 必须结合快照时间和查询命令解读。网络或鉴权失败时命令非零退出，不拿旧数据冒充新查询。凭证只由本机 `gh` 管理，不进入脚本参数、快照、日志或提交。

## 6. 未来 issue 的信息模板

未来收到反馈时，可请报告者提供以下信息。模板只是归档规范，本日没有用它创建任何 issue。

```markdown
## Problem / 问题
实际遇到了什么问题？

## Steps to reproduce
1. 执行的安装或运行命令
2. 最小操作步骤
3. 可公开的最小输入或仓库

## Expected
期望结果是什么？

## Actual
实际结果、退出码和错误是什么？

## Environment
- personal-agent 版本或 commit：
- Node.js 版本：
- 操作系统：
- 安装方式：

## Logs
粘贴必要日志；先删除 API Key、token、Cookie、私有路径和其他敏感信息。
```

有真实 issue 后，应先检查正文和必要评论，再确认自动分类是否符合证据；缺少的版本、环境或复现信息保持 `unknown`，不能由归档者补猜。

## 7. TDD、测试与覆盖率

新增行为按 RED → GREEN 实施：

1. 先写归档入口测试，观察到模块不存在导致断言失败；补最小入口后，再写空快照、字段保真、未知值、标签优先级和复现提取测试，观察到 `not implemented` 失败后才实现。
2. 查询脚本同样先观察入口测试失败，再以注入查询器的行为测试要求精确的 `gh --state all` 参数和 JSON 写入；确认失败后补实现。
3. 最后真实执行 `npm run feedback:archive`，生成的 0 条快照来自 GitHub，不来自测试夹具。

本分支实际执行：

| 命令 | 结果 |
|---|---|
| `npm run check` | ESLint、typecheck、32 个测试文件 / 239 项测试全部通过 |
| `npm run test:coverage` | 32 个测试文件 / 239 项测试全部通过，阈值未修改 |
| `npm run feedback:archive` | 真实查询成功，归档 0 条 open、0 条 closed |

全库覆盖率（语句 / 分支 / 函数 / 行）：

```text
94.54% / 89.32% / 98.85% / 95.29%
全局阈值：80 / 75 / 80 / 80（未修改）
src/feedback/issue-archive.ts：100% / 78.57% / 100% / 100%
```

测试中的 issue 编号和作者只是明确隔离的单元测试夹具，不出现在真实快照或发布复盘结论中。

## 8. 边界与明日衔接

- 查询上限为 1000 条；本次实际为 0 条，不受此上限影响。未来达到上限时必须扩大查询范围，不能声称已完整归档。
- 评论按 `gh issue list --json comments` 的返回内容保存；本次没有 issue，未触发评论分页问题。未来需要完整评论历史时，应逐条核对 issue 并记录查询范围。
- 标题关键词可能误判，分类只用于首轮整理；修复优先级仍需影响范围、复现证据和人工判断。
- 空快照是一次带时间戳的观测，不是永久状态，也不是外部采用度指标。

明日应从最新 `origin/D026` 创建下一日分支，先重跑查询并生成新快照：若仍为 0 条就如实记 0；若出现新 issue，则保存原始字段、阅读必要评论、复核分类和复现信息，再决定当天工作。不要沿用旧快照假装新反馈，也不要提前实现 MCP 等后续任务。
