# Personal Agent · 第 41 天

**进度：D041 / D100 · v0.1.0**

本日目标：把一个**小而真实的本地 Markdown 知识库**接入现有 AgentLoop。模型先通过 `knowledge_search` 找到相对路径和行号，再通过 `knowledge_read` 读取同一文档快照中的原文，最后生成带行号来源的回答。

本日选择的是**内置只读知识库 Tools**，不是另做一个 MCP Server。D035～D039 的 MCP 能力保持原样；本日不引入向量数据库、embedding 服务、联网检索、动态工具检索，也不实现后续完整沙箱或通用资源治理。

---

## 1. 本日交付

- `src/tools/knowledge.ts`
  - `createKnowledgeTools(root)` 在工厂调用时读取真实文件，建立一次不可变文档快照。
  - `knowledge_search`：确定性的、大小写不敏感的逐行子串搜索。
  - `knowledge_read`：按相对 `.md` 路径及可选一基行号闭区间读取同一快照。
  - 拒绝绝对路径、路径穿越、非 Markdown、未知文件和非法行范围；索引跳过所有符号链接。
- `src/demo/d041.ts`
  - 使用真实 `AgentLoop`、真实 `ToolRegistry`、真实文件 I/O 和离线确定性模型。
  - 第 2 次模型响应必须从真实 search 工具消息中取路径/行号，不能由 Demo 绕过 Loop 拼参数或答案。
- `scripts/d041-knowledge.ts` 与 `npm run demo:d041`
  - 创建明确的临时教学知识库，输出工具调用、来源、完成状态和清理状态；失败时非零退出。
- `test/d041-knowledge.test.ts`
  - 覆盖搜索排序、行号、片段、读取范围、Schema、白名单、错误边界、符号链接和快照更新。
- `test/d041-demo.test.ts`
  - 验证完整 search → read → 带引用回答的 Loop 数据依赖，而不只验证 mock。
- `evidence/d041-transcript.txt`
  - 本日实际运行 `npm run demo:d041` 保存的终端证据。
- `src/index.ts` 与 `package.json`
  - 导出必要的知识库工厂和 D041 Demo API，注册 `demo:d041`；没有新增运行时依赖。

---

## 2. 架构与数据流

本日没有另造执行链，仍使用项目已有契约：

```text
用户问题
  │
  ▼
AgentLoop
  │  把 ToolRegistry.list() 提供的 Schema 交给 ModelProvider
  ▼
离线确定性 ModelProvider
  │  第 1 次：knowledge_search({ query: "发布窗口" })
  ▼
ToolRegistry
  ├─ 工具名解析
  ├─ D029 白名单权限
  ├─ D028 JSON Schema 校验
  └─ 统一 ToolResult / ToolError
          │
          ▼
  createKnowledgeTools 创建的共享 Markdown 快照
          │
          ▼
真实 tool 消息：operations/release.md，第 3 行
  │  回喂 AgentLoop，进入第 2 次模型调用
  ▼
knowledge_read({
  path: "operations/release.md",
  startLine: 3,
  endLine: 3
})
  │
  ▼
真实 tool 消息：带行号的原文
  │  回喂 AgentLoop，进入第 3 次模型调用
  ▼
最终回答 + 来源 operations/release.md:3
```

两个工具闭包共享同一个 `ReadonlyMap<string, KnowledgeDocument>`。搜索返回的路径一定可以用读取工具在同一快照中查找；如果它已被删除或本来不在快照中，则返回明确错误，不会退回到任意文件系统读取。

### 与 MCP 的边界

D036 已提供 filesystem MCP server，D037 已验证官方 client 接入。本日的两个工具直接注册进进程内 `ToolRegistry`，调用不经过 stdio、MCP transport 或 client。这样可以用最小实现讲解“知识库快照与引用”，同时复用既有 Loop、Schema、权限和错误契约。

---

## 3. 最小接入方式

```ts
import { ToolRegistry, createKnowledgeTools } from 'personal-agent';

const registry = new ToolRegistry({
  allowedTools: ['knowledge_search', 'knowledge_read'],
});

for (const tool of createKnowledgeTools('/absolute/path/to/markdown-kb')) {
  registry.register(tool);
}
```

随后把这个 `registry` 传给现有 `runAgentLoop` 即可。根目录在工厂调用时通过 `realpathSync` 固定；`ToolContext.workspaceRoot` 不会替换知识库根目录。

`createKnowledgeTools` 只返回两个 `Tool`，没有写入、删除、执行命令或网络访问能力。`Tool.execute` 返回 `Promise<ToolResult>`，工具结果以 JSON 字符串放入 `content`，由 Loop 作为真实 `tool` 消息回喂模型。

---

## 4. `knowledge_search` 契约

### 4.1 输入 Schema

```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "minLength": 1,
      "description": "要查找的非空白原始子串"
    }
  },
  "required": ["query"],
  "additionalProperties": false
}
```

空字符串由 Registry 的 Schema 校验拒绝；只有空白的字符串由工具拒绝。两者都得到 `INVALID_ARGUMENTS`，不会变成一次“搜索全部”。

### 4.2 搜索算法与可解释排序

1. 对查询做 `trim`，然后使用 JavaScript `toLowerCase()` 做大小写不敏感比较。
2. 对快照中每个文档逐行执行原始子串匹配；包含空格的查询仍是一个完整子串，不拆词，不做同义词扩展。
3. 一条命中结果对应一行。`score` 是查询在该行中的**非重叠出现次数**。
4. 排序键依次为：`score` 降序、相对路径升序、行号升序。
5. `snippet` 是该行去除首尾空白后的文本，最多 160 个字符；超长时使用 `...` 截断。它不包含额外上下文行。
6. 没有命中是成功结果，`total: 0`、`results: []`，不是工具异常。

### 4.3 真实结果示例

Demo 搜索 `发布窗口` 后得到：

```json
{
  "query": "发布窗口",
  "matchType": "case-insensitive-substring",
  "ranking": "score:desc,path:asc,line:asc",
  "total": 1,
  "results": [
    {
      "path": "operations/release.md",
      "line": 3,
      "score": 1,
      "snippet": "发布窗口为每周二 14:00，发布前必须完成全量测试。"
    }
  ]
}
```

`path` 始终是相对知识库根目录的 `/` 分隔路径；`line` 从 1 开始。模型可以直接把这两个字段用于下一次 `knowledge_read`，并在最终答案中引用它们。

---

## 5. `knowledge_read` 契约

### 5.1 输入 Schema

```json
{
  "type": "object",
  "properties": {
    "path": {
      "type": "string",
      "minLength": 1,
      "description": "知识库内的相对 .md 路径"
    },
    "startLine": {
      "type": "integer",
      "minimum": 1,
      "description": "可选起始行，包含该行，默认为 1"
    },
    "endLine": {
      "type": "integer",
      "minimum": 1,
      "description": "可选结束行，包含该行，默认为最后一行"
    }
  },
  "required": ["path"],
  "additionalProperties": false
}
```

### 5.2 行范围规则

- 行号从 **1** 开始，`startLine` 和 `endLine` 都包含在结果中。
- 两个参数都省略时读取全文；只省略 `endLine` 时读到最后一行；只省略 `startLine` 时从第 1 行开始。
- `endLine < startLine`：拒绝，返回 `INVALID_ARGUMENTS`。
- 任一端超过 `totalLines`：拒绝，返回 `INVALID_ARGUMENTS`，错误消息包含文档总行数；不做静默截断。
- `0`、负数、小数、字符串行号：拒绝；整数与最小值也会先经过 Schema。
- 空文档只在省略行范围时读取，返回 `startLine: 0`、`endLine: 0`、`totalLines: 0`、`lines: []`；对空文档指定任何范围都是 `INVALID_ARGUMENTS`。

### 5.3 真实结果示例

```json
{
  "path": "operations/release.md",
  "startLine": 3,
  "endLine": 3,
  "totalLines": 4,
  "lines": [
    {
      "line": 3,
      "text": "发布窗口为每周二 14:00，发布前必须完成全量测试。"
    }
  ]
}
```

读取结果保留 `totalLines`，便于调用方判断后续引用或继续读取的范围。`lines` 中每行都带独立行号，避免把截取后的数组下标误当成原文件行号。

---

## 6. 这不是语义 RAG

本日实现刻意保持可解释、可测试、零新增依赖：

| 能力 | D041 是否提供 |
|---|---|
| 本地 UTF-8 Markdown 文件真实读取 | 是 |
| 大小写不敏感的逐行子串匹配 | 是 |
| 行内出现次数、路径、行号排序 | 是 |
| 相对路径、原文行号和片段 | 是 |
| 分词、倒排索引 | 否 |
| embedding、向量数据库、相似度检索 | 否 |
| 语义改写、同义词扩展、模型重排 | 否 |
| RAG 文档切块与向量召回 | 否 |
| 联网搜索或第三方知识库同步 | 否 |

因此，“发布窗口”可以命中包含这四个连续字符的行，但不能因为语义相近而命中“何时上线”。这不是伪 AI 搜索，也不声称具有语义理解能力。模型的职责是根据确定性的工具结果选择读取位置和组织答案；检索本身没有模型参与。

---

## 7. 快照如何建立与更新

### 7.1 建立时发生真实文件 I/O

调用 `createKnowledgeTools(root)` 时同步完成：

1. `realpathSync(root)` 固定根目录，并确认它是目录。
2. 按名称排序递归遍历目录，保证快照构建顺序确定。
3. 只读取普通、扩展名严格为 `.md` 的文件；不读取 `.txt`、`.markdown` 或其他文件。
4. 所有符号链接都跳过，不跟随到目标，也不递归进入链接目录。
5. 使用 `readFileSync(path, 'utf8')` 读取真实文件，按 CRLF/LF 分行，存入内存快照。
6. 搜索和读取只访问这个共享快照，不在每次调用时隐式重新扫描磁盘。

因此，搜索和读取使用的是真实文件内容，但都具有明确的快照语义，而不是“每次 Tool 调用看到不同版本”。

### 7.2 更新方式：显式重建并替换注册项

本日没有文件监听器，也没有隐式 refresh。文档变化后重新调用工厂，并用现有 `ToolRegistry.replace` 替换同名工具：

```ts
// 初始快照
for (const tool of createKnowledgeTools(root)) registry.register(tool);

// 修改、增加或删除 Markdown 后，显式建立新快照
for (const tool of createKnowledgeTools(root)) registry.replace(tool);
```

`replace` 会保持注册名不变，并确保新旧两个工具仍来自同一次新快照。不要只替换其中一个工具，否则 search 与 read 会看到不同版本。

测试证明：磁盘修改后，旧 Registry 仍返回旧内容、看不到新增文件；重建后，新 Registry 才能搜索新内容并读取新增文档。

---

## 8. 安全约束与错误行为

所有正常工具调用仍经过 `ToolRegistry`：工具名解析、白名单、Schema 校验和 `ToolResult` 错误归一化均未被绕过。

| 输入或场景 | 行为 |
|---|---|
| `query: ""` 或全空白查询 | `INVALID_ARGUMENTS` |
| 查询无命中 | 成功，`total: 0` |
| 未知 `.md` 路径或新增文件尚未进入快照 | `FILE_NOT_FOUND` |
| `.txt` 等非 Markdown 路径 | `INVALID_ARGUMENTS` |
| 绝对路径，包括 Windows 盘符形式 | `PATH_OUTSIDE_WORKSPACE` |
| `../` 等规范化后越出根目录的路径 | `PATH_OUTSIDE_WORKSPACE` |
| 反向范围或超过总行数 | `INVALID_ARGUMENTS` |
| 白名单只允许 search，却调用 read | `TOOL_NOT_ALLOWED` |
| 库内符号链接指向库外文件或目录 | 建立快照时跳过，搜索无结果，读取为错误；不读取目标内容 |
| `ToolContext.workspaceRoot` 指向其他目录 | 不影响知识库根目录，不能借此换根 |

测试使用临时目录创建真实库外秘密文件、真实文件符号链接和真实目录符号链接，断言搜索、读取及错误输出均不包含秘密内容。Demo 与测试不读取或提交任何真实凭证。

这是一层小型只读接入边界，不宣称是完整对抗性沙箱。例如，索引期间的并发文件替换、超大文件、资源配额和更完整的文件系统隔离留给后续工作，不在 D041 扩张实现。

---

## 9. 真实 AgentLoop Demo

### 9.1 运行

```bash
npm run demo:d041
```

要求 Node 24；本日实际环境为 Node `v24.19.0`。Demo 不请求网络，不需要 API Key。

### 9.2 Demo 如何证明没有绕过 Loop

1. 在系统临时目录创建 `mkdtemp` 工作区，写入 `overview.md` 和 `operations/release.md`。它们是明确构造的教学资料，不冒充真实第三方知识库。
2. 通过 `createKnowledgeTools(workspace)` 读取真实文件并注册两个工具。
3. 第 1 次确定性模型响应只发出 search 调用。
4. Loop 执行工具后，把真实 JSON 结果作为 `tool` 消息加入历史。
5. 第 2 次模型响应从消息历史中查找 `d041-search` 对应的真实工具消息，解析首个结果的 `path` 和 `line`，用它构造 read 参数。测试逐项比较 read 参数与 search 结果，证明数据依赖。
6. Loop 再次执行工具并回喂真实 read 消息。
7. 第 3 次模型响应从 read 消息中的 `lines[0].text` 生成回答，并使用真实路径/行号作为来源。
8. Demo 断言工具顺序、无工具错误、3 turns、`completed`、引用和清理状态后才输出 PASS。
9. `finally` 中递归删除临时目录；入口脚本捕获异常、输出堆栈并设置 `process.exitCode = 1`。

### 9.3 本轮真实观察

```text
[01] knowledge_search
  参数：{"query":"发布窗口"}
  结果：operations/release.md，第 3 行，score=1
[02] knowledge_read
  参数：{"path":"operations/release.md","startLine":3,"endLine":3}
来源：operations/release.md:3 发布窗口为每周二 14:00，发布前必须完成全量测试。
最终回答：发布窗口为每周二 14:00，发布前必须完成全量测试。（来源：operations/release.md:3）
stopReason=completed turns=3
workspaceRemoved=true
D041 Demo PASS
```

完整、未改写的本轮终端输出保存在 [`evidence/d041-transcript.txt`](./evidence/d041-transcript.txt)。可用以下命令重新生成：

```bash
set -o pipefail
npm run demo:d041 2>&1 | tee evidence/d041-transcript.txt
```

---

## 10. TDD：先 RED，再 GREEN

本日严格先写行为测试，再写生产实现。

### 10.1 RED：功能尚不存在

先新增：

- `test/d041-knowledge.test.ts`
- `test/d041-demo.test.ts`

随后实际运行：

```bash
npx vitest run test/d041-knowledge.test.ts test/d041-demo.test.ts
```

实际结果：退出码 `1`，`Test Files 2 failed (2)`。两个套件分别明确报告：

```text
Failed to resolve import "../src/tools/knowledge.ts"
Failed to resolve import "../src/demo/d041.ts"
```

此时 `src/tools/knowledge.ts` 与 `src/demo/d041.ts` 尚未创建，失败原因正是新行为没有实现，而不是断言写错或测试碰巧通过。

### 10.2 GREEN：最小实现后复跑同一命令

实现快照、两个工具、Demo、导出和 npm script 后，原样复跑：

```text
Test Files  2 passed (2)
Tests       9 passed (9)
```

其中知识库行为 8 项，真实 AgentLoop Demo 1 项。随后 ESLint 与 `tsc --noEmit` 也通过。

### 10.3 测试关注行为，不只测 mock

- 搜索测试在临时目录写真实 Markdown，验证大小写不敏感命中、行内重复次数、路径/行号排序及精确片段。
- 读取测试验证一基闭区间、全文行数和带行号原文。
- 错误测试覆盖空查询、无结果、未知文件、非 Markdown、绝对路径、两种穿越路径、反向/越界/零行号。
- 符号链接测试创建真实库外文件和目录链接，验证秘密内容不会进入任何结果。
- 白名单测试通过真实 Registry 证明 read 会被 `TOOL_NOT_ALLOWED` 拒绝。
- 快照测试修改真实磁盘文件，证明旧快照不变、显式重建后更新。
- Demo 测试运行真实 Loop，比较 search 的真实结果与 read 的真实参数，并验证最终引用和清理。

---

## 11. 验证命令与真实数字

```bash
npm run demo:d041
npm run check
npm run test:coverage
git diff --check
```

本轮实际结果：

| 检查 | 结果 |
|---|---|
| `npm run demo:d041` | PASS；search → read → 带来源回答；3 turns；临时目录已删除 |
| `npm run check` | PASS；ESLint、`tsc --noEmit`、Vitest 全部通过 |
| 全量 Vitest | **47 个测试文件，406 项测试全部通过** |
| `npm run test:coverage` | PASS，同样是 **47 文件 / 406 测试** |
| Statements | **91.69%** |
| Branches | **86.95%** |
| Functions | **98.12%** |
| Lines | **93.50%** |
| `src/tools/knowledge.ts` | Statements **93.13%**，Branches **81.57%**，Functions **100%**，Lines **93.54%** |
| `git diff --check` | 通过，无空白错误 |
| 新增运行时依赖 | **0**；`package-lock.json` 无需变化 |

`npm run check` 包含完整旧测试，因此 D001～D040 的既有行为也一起回归，而不是只运行本日 9 项测试。

---

## 12. 已知限制与后续边界

1. **词法检索限制**：只支持连续子串，不理解语义；查询写法不同可能无结果。
2. **固定快照**：没有 watch、增量索引或自动刷新；知识库变更后必须重建两个工具。
3. **同步全量读取**：工厂创建时同步遍历并读取全部 `.md`，适合小型教学知识库，不适合海量语料或严格低延迟启动。
4. **结果未分页**：当前搜索返回全部命中行，没有 `limit`、游标、文件大小上限、超时或内存配额。
5. **片段较短**：只返回命中行，最多 160 字符；需要上下文时再用 read 指定行范围。
6. **扩展名有限**：只索引普通 `.md` 文件，不处理 `.markdown`、Frontmatter 结构化字段或附件。
7. **符号链接一律跳过**：即使链接目标仍在库内也不跟随，以换取简单、稳定的边界。
8. **不是完整沙箱**：没有实现 D043 的完整资源治理与对抗性文件系统隔离。
9. **没有新增 MCP Server**：本日演示内置工具接入，不复述或替代 D035～D039 的 MCP 流程。
10. **没有动态工具检索**：工具仍由现有 Registry 全量注册和暴露，不提前实现 D048。

这些限制是本日范围的明确边界，而不是把未完成能力伪装成已经交付。D041 到此完成，不包含 D042 的实现。
