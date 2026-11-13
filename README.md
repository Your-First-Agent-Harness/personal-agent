# D044｜安全加固：工具白名单、资源限制、审计日志

这一天把 D043 的“进程生命周期防护”推进为**默认拒绝的命令安全边界**：只有精确白名单中的可执行文件和完整 argv 才能执行；子进程永远不经过 shell；运行时间、输出字节、并发与队列都有上限；允许、拒绝和完成结果进入独立 JSONL 审计。

> 安全定位：这是应用层的命令准入与资源治理，不是容器、seccomp、Landlock、App Sandbox 或完整操作系统沙箱。D043 的开放式 `sandboxed_command` 为兼容而保留，但不能被当作安全命令白名单使用。新 Demo 只使用本日的 `secure_command`。

配套精炼课程：[`docs/d044-security-course.md`](docs/d044-security-course.md)。

## 1. 运行与验收

要求 Node.js 24+。实现使用原生 TypeScript ESM、Vitest 和 Node 内置模块，**没有新增运行时依赖**，Demo 不访问外网。

```bash
npm ci
npm run demo:d044
npm run check
npm run test:coverage
```

单独复跑本日测试：

```bash
npx vitest run \
  test/d044-secure-command.test.ts \
  test/d044-audit-sink.test.ts \
  test/d044-demo.test.ts
```

Demo 每次在系统临时目录创建独立的伪造攻击与审计环境，完成后递归删除该目录。脚本将**本次实际运行**的审计样例写到 `evidence/d044-audit.jsonl`；它是可重复生成的最新样例，不冒充不可变历史归档。用下列命令同时保存终端证据：

```bash
set -o pipefail
npm run demo:d044 2>&1 | tee evidence/d044-transcript.txt
```

任何验收不成立都会非零退出，且不会输出 `D044 Demo PASS`。

## 2. 从既有实现审查出什么

| 既有模块 | 可复用认识 | 本日为什么不能原样充当安全边界 |
| --- | --- | --- |
| D029 `ToolRegistry` | 调用入口可执行 `resolvePermission`；权限不足时不进入工具 | 它授权的是工具名/动作，不检查 argv；`secure_command` 被允许后仍需命令级精确白名单 |
| D043 `sandboxed-command.ts` | 一次性工作目录、超时、进程组终止、有界输出、取消与清理 | 输入是 command string，真实 `spawn(..., { shell: true })`；元字符会被解释，不是安全沙箱 |
| D030 `resilience.ts` | 并发上限、队列上限、排队超时、AbortSignal 移除等待者 | 通用包装器无法判断命令是否允许，也不负责进程输出字节与审计顺序 |
| D013 `run-command.ts` | 简单命令工具便于 Agent 调用 | 面向本机开发自动化，不是默认拒绝的不可信命令入口 |
| logger / EventSink | 常规日志和领域事件便于观察 AgentLoop | 普通日志可能丢字段、含敏感参数或随事件订阅失败；不能替代独立、可持久化的执行审计 |

结论是**新增边界而不是改写旧默认对象**：旧 D043 行为与测试保持兼容，新安全 Demo 不调用旧工具。

## 3. 威胁模型

### 3.1 本日防御的行为

| 威胁 | 防御 | 可复核证据 |
| --- | --- | --- |
| 未授权可执行文件 | `realpath` 后的 executable 必须等于白名单规则 | 未白名单 Node 脚本返回 `COMMAND_NOT_ALLOWED` |
| `;`、`>`、管道、命令替换 | 不拼接 shell 字符串；完整 argv 精确匹配；`shell:false` | 五种元字符测试与 Demo 均在 spawn 前拒绝 |
| 借允许命令追加危险参数 | argv 长度和每一项都必须完全相等，不用 `startsWith` | 在允许脚本后追加写 marker 参数仍拒绝 |
| 默认绝对路径写宿主 | 未列入精确规则的脚本/路径不能启动 | marker 不存在，且未创建一次性 cwd |
| 永久运行 | 每次子进程有 wall timeout，超时杀进程组 | 返回 `COMMAND_TIMEOUT`，审计含 signal/耗时 |
| stdout/stderr 洪水 | 两路共享 Buffer 字节预算，超限杀进程而不是无限收集 | 返回 `COMMAND_OUTPUT_LIMIT`，保留字节不超过预算 |
| 并发与无限排队 | `maxConcurrent`、`maxQueue`、`maxQueueWaitMs` | 满载拒绝、排队超时和取消都有测试 |
| 调用方取消 | 运行中终止进程组；排队中移除 waiter；预取消不 spawn | `COMMAND_CANCELLED` 与 completion 审计 |
| 审计服务/磁盘故障 | decision 写入失败时 fail-closed，不启动 | `AUDIT_WRITE_FAILED` 且 marker 不存在 |
| 日志泄露伪造秘密 | 显式敏感值替换、常见键值脱敏、结果输出脱敏、argv SHA-256 | 测试和 Demo JSONL 不含伪造秘密 |

### 3.2 明确不在本日边界内

- 没有 CPU rlimit、内存 rlimit、cgroup、job object 或配额统计；没有运行 OOM、fork bomb，也不展示伪造 CPU/内存指标。
- 没有系统调用过滤、网络命名空间或文件系统挂载隔离。被允许的 Node/解释器脚本仍拥有当前 OS 用户的能力。
- 一次性 cwd 只减少相对路径污染，**不是 chroot**。允许规则中的程序若本身会写绝对路径，白名单不会阻止它。
- `realpath` 与 `spawn` 之间仍有文件系统 TOCTOU 窗口；白名单路径及其父目录应由可信管理员维护。
- Windows 的进程树终止语义弱于 POSIX 进程组；本日实测环境是 macOS/Node 24。
- 脱敏不是通用 DLP。未配置的任意秘密格式仍可能泄露；低熵参数的 SHA-256 也可能被字典猜测。
- JSONL 不是防篡改账本，没有哈希链、签名、WORM、跨进程锁或远端复制。

## 4. 架构与执行顺序

```text
结构化 { executable, args, timeoutMs? }
                  │
                  ▼
      参数校验 + realpath(executable)
                  │
                  ▼
  规则逐条比较：realpath(executable) + 完整 argv
             │             │
           不匹配         匹配
             │             │
             ▼             ▼
  denied decision 审计   allowed decision 审计
             │             │
             │          写失败：AUDIT_WRITE_FAILED，不 spawn
             │             │ 写成功
             │             ▼
             │       有界并发 / FIFO 队列 / 排队取消
             │             │
             │             ▼
             │      mkdtemp → spawn(shell:false)
             │             │
             │       timeout / bytes / abort
             │             │
             │             ▼
             │       close → 清理 → completion 审计
             │             │
             │       审计失败：显式错误；执行不可回滚
             ▼             ▼
               ToolResult + 可追溯 operationId
```

拒绝在创建临时目录和 `spawn` 之前发生。允许调用有两条审计：`decision/SPAWN_PENDING` 与最终 `completion`；拒绝调用只有一条最终 `decision/COMMAND_NOT_ALLOWED`。两段通过相同 `operationId` 关联。

## 5. 白名单与 argv 规则

### 5.1 为什么不用 startsWith

`command.startsWith('git ') === true` 无法区分可信前缀与以下危险输入：

```text
git status; touch /tmp/not-ok
printf safe > /absolute/host/path
printf safe | another-command
printf "$(another-command)"
```

D044 不接受 command string，也没有 PATH 搜索。规则中的 executable 必须是绝对路径，调用同样如此；比较前双方经过 `realpath`，避免仅凭另一个符号链接字符串绕过。argv 必须长度相同且每项 `===`。

### 5.2 最小配置

```ts
import { createJsonlAuditSink, createSecureCommandTool } from './src/index.ts';

const source = "process.stdout.write('safe')";
const tool = createSecureCommandTool({
  allowlist: [{
    id: 'print-safe-v1',
    executable: process.execPath,
    args: ['-e', source],
  }],
  auditSink: createJsonlAuditSink({ filePath: '.audit/secure-command.jsonl' }),
  resources: {
    defaultTimeoutMs: 500,
    maxTimeoutMs: 2_000,
    maxOutputBytes: 4_096,
    maxConcurrent: 1,
    maxQueue: 2,
    maxQueueWaitMs: 500,
  },
  sensitiveValues: ['FAKE_EXAMPLE_ONLY_NOT_A_CREDENTIAL'],
});

const result = await tool.execute(
  { executable: process.execPath, args: ['-e', source], timeoutMs: 500 },
  { workspaceRoot: process.cwd() },
);
```

规则是“固定程序 + 固定完整参数”。需要动态参数时，应把每个可信组合定义成规则，或在上层把结构化业务输入编译成严格受控规则；不要把任意用户字符串插进 `node -e`、shell、PowerShell 等解释器规则。允许解释器等于允许该段代码具备当前用户权限。

## 6. 资源预算与取消语义

| 配置 | 默认值 | 含义 |
| --- | ---: | --- |
| `defaultTimeoutMs` | 5000 | 未显式传 timeout 时的子进程 wall timeout；若只设置更低的 max，会随 max 下调 |
| `maxTimeoutMs` | 30000 | 每调用 timeout 的可配置上限 |
| `maxOutputBytes` | 8192 | stdout 与 stderr **合计保留**的原始字节上限 |
| `maxConcurrent` | 1 | 同一工具实例内允许同时运行的子进程数 |
| `maxQueue` | 0 | 满载时可等待的调用数；0 表示不排队 |
| `maxQueueWaitMs` | 1000 | 排队等待上限，不计入子进程 wall timeout |

约束：除 `maxQueue >= 0` 外均为正安全整数，`defaultTimeoutMs <= maxTimeoutMs`。调用级 `timeoutMs` 必须位于 `1..maxTimeoutMs`。

wall timer 从 `spawn` 后启动，覆盖子进程直到 `close`；realpath、decision 审计、排队与最终清理不计入该 timer。排队有独立时限。超限、超时和运行中 abort 会优先尝试 POSIX 进程组 `SIGKILL`，避免只杀父 shell/父进程留下孙进程。

输出按收到的 Buffer 字节计数，而不是 `string.length`。超限时停止继续保留并终止进程；解码时避免因为截断 UTF-8 产生超出预算的替换字符。审计里的 `stdoutBytes/stderrBytes` 是实际保留字节数，不谎称测得进程一生累计产生的全部字节。

## 7. 审计 schema、脱敏与写失败策略

### 7.1 每条 JSONL 的字段

| 字段 | 作用 |
| --- | --- |
| `schemaVersion` | 当前为 1 |
| `timestamp` | ISO 时间；工厂可注入 `clock` |
| `operationId` | 同次调用的 decision/completion 关联 ID；可注入 `idGenerator` |
| `phase` | `decision` 或 `completion` |
| `tool` / `ruleId` | 工具名与命中的规则；拒绝时 ruleId 为 null |
| `decision` / `status` | allowed/denied；pending/succeeded/denied/failed |
| `resultCode` | `SPAWN_PENDING`、`OK`、白名单/资源/超时/审计等明确结果码 |
| `executable` / `argv` | 脱敏后的操作标识与参数摘要 |
| `argvSha256` | 对原始 argv 的 JSON 数组做 SHA-256，便于精确复核而不保存明文 |
| `durationMs` / `queueWaitMs` | 单调时钟耗时与排队耗时；单调时钟可注入 |
| `exitCode` / `signal` | 子进程退出信息；未启动时为 null |
| `resource` | timeout、输出预算、保留字节、是否截断、是否清理 |

`monotonicClock` 用于 duration，避免系统时间回拨造成负耗时。无效 schema 的调用在命令决策前返回 `INVALID_ARGUMENTS`；它们没有可信 executable/argv，不进入本命令执行审计，可由上层请求校验日志记录。

### 7.2 脱敏不是审计的全部

仅打印“参数已脱敏”不足以追溯操作。本日同时保存操作 ID、规则、结果、时长、退出与资源字段。脱敏顺序为：

1. 将 `sensitiveValues` 中的每个非空值替换为 `[REDACTED]`；
2. 对 `api_key=...`、`password:...`、`secret=...`、`token:...` 等常见键值做保守替换；
3. argv、结果 args、stdout、stderr 和返回文本都经过替换；
4. 原始 argv 只用于等值比较和 SHA-256，不主动写入审计。

真实系统应尽量减少 argv 秘密，使用安全注入的凭证代理，并对审计文件设置最小权限、保留周期和访问控制。

### 7.3 fail-closed 真值表

| 阶段 | 审计结果 | 行为 |
| --- | --- | --- |
| 未允许命令的 decision | 失败 | 返回 `AUDIT_WRITE_FAILED`；不 spawn |
| 允许命令的 decision | 失败 | 返回 `AUDIT_WRITE_FAILED`；不进入队列、不创建 cwd、不 spawn |
| 子进程完成后的 completion | 失败 | 返回 `AUDIT_WRITE_FAILED`；**不假装回滚已经发生的副作用** |
| 任意写入 | 成功 | 按实际允许/拒绝/结果返回 |

因此本日没有静默 fail-open，也不宣称 completion 失败能提供事务保证。需要“所有副作用都可回滚”的系统必须使用事务性执行后端，而不是仅靠日志。

### 7.4 JSONL sink 的可靠性边界

`createJsonlAuditSink` 在同一 sink 实例内用 Promise 链串行化写入；每条记录通过一次 `appendFile(..., { flag: 'a' })` 追加，记录以单个 LF 结尾。前一次失败会返回给调用方，但不会毒化后续写入链。父目录按需创建。

“原子单条 append”仅指本实现的单条追加写入与实例内串行语义；不承诺多进程协调、断电持久化、fsync、网络文件系统语义或防篡改。生产审计应使用受控权限和可靠集中式审计设施。

## 8. API 与 Registry 组合

公共导出：

- `createSecureCommandTool(options)`
- `createJsonlAuditSink({ filePath })`
- 类型：`CommandAllowRule`、`SecureCommandResources`、`SecureCommandResult`、`SecureCommandToolOptions`、`AuditSink`、`CommandAuditRecord`、`AuditResourceUsage`
- `runD044Demo(output)`

`AuditSink.append(record)` 可注入内存、测试或受控远程实现。本日只提供本地 JSONL，未引入服务。

若放入 D029 Registry，仍需同时授权工具动作，例如 `secure_command:exec`；Registry 权限是外层主体准入，命令白名单是内层操作准入，两者不能互相替代。本日没有把新命令偷偷加入旧 Agent 默认工具集。

## 9. 测试矩阵

本日新增 3 个测试文件、38 个测试：

| 区域 | 覆盖 |
| --- | --- |
| 精确白名单 | 成功、非零退出、空白名单、相对路径/重复 id/NUL 配置 |
| shell 绕过 | `;`、`>`、`|`、`$()`、反引号后缀；字面元字符在允许 argv 中不被解释 |
| 启动前拒绝 | 未白名单绝对路径写 marker 不存在，拒绝时临时根目录仍为空 |
| 输入与 Schema | null/数组/额外字段/错误类型/NUL/相对 executable/timeout 边界 |
| 环境隔离 | 宿主伪造 env 不继承；一次性 cwd 可写并在结束后删除 |
| wall timeout | 真实悬挂进程被终止，审计有耗时与退出信息 |
| 输出字节 | 多字节 UTF-8 洪水、stdout/stderr 共享预算、保留字节与截断标记 |
| 并发与队列 | 0 队列满载拒绝、有界等待、排队超时、预取消、运行/排队取消 |
| 审计 | decision/completion、操作摘要与哈希、伪造秘密不泄露 |
| 审计故障 | 允许/拒绝 decision 失败不执行；completion 失败显式报错且不回滚 |
| JSONL | 并发 append 顺序与一行一记录；失败不静默、不毒化后续写入 |
| Demo | 允许、拒绝、绕过、输出、超时、fail-closed、8 条审计与清理 |

## 10. 真实 TDD RED → GREEN

测试先于实现编写。证据均为实际命令输出，没有手工编造结果。

### RED 1：实现模块不存在

```text
Test Files  3 failed (3)
Tests       0
FAIL test/d044-secure-command.test.ts [Test suite failed to run]
Error: Cannot find module '../src/tools/secure-command.ts'
```

完整输出：`evidence/d044-tdd-red.txt`。

### RED 2：只有类型和 NOT_IMPLEMENTED 骨架

```text
Test Files  3 failed (3)
Tests       38 failed (38)
D044 JSONL AuditSink: 2 failed
D044 安全加固 Demo: 1 failed
D044 精确 argv/资源/审计: 35 failed
```

完整输出：`evidence/d044-tdd-red-behavior.txt`。这使 RED 不仅证明“缺文件”，还证明所有新行为在实现前确实不成立。

### GREEN：实现后同一组测试

```text
Test Files  3 passed (3)
Tests       38 passed (38)
Duration    544ms
```

完整输出：`evidence/d044-tdd-green.txt`。随后首次原生 CLI 运行还发现 Node 24 strip-only 不支持 TypeScript 参数属性；将其改为显式字段赋值后，同一 `npm run demo:d044` 才通过。这避免了“Vitest 绿色但真实入口不能启动”。

## 11. 实际 Demo transcript

最终 `evidence/d044-transcript.txt` 来自真实 `npm run demo:d044`：

```text
D044 安全边界：realpath(executable) + 完整 argv 精确白名单；spawn shell:false
allowed=OK stdout=allowed-ok
denied=COMMAND_NOT_ALLOWED markerCreated=false
shellBypass=COMMAND_NOT_ALLOWED markerCreated=false
output=COMMAND_OUTPUT_LIMIT capturedBytes=64 budget=64
timeout=COMMAND_TIMEOUT budgetMs=40
auditFailure=AUDIT_WRITE_FAILED markerCreated=false
auditRecords=8 redacted=true digest=sha256
D044 Demo PASS
auditEvidence=evidence/d044-audit.jsonl
```

8 条 JSONL 依次为：成功 decision/completion、未白名单 decision、shell 绕过 decision、输出超限 decision/completion、超时 decision/completion。审计故障场景使用故意失败的独立 sink，所以不会凭空伪造一条“写入成功”的记录；终端中的 `AUDIT_WRITE_FAILED + markerCreated=false` 才是它的证据。

可直接复核：

```bash
node -e "const fs=require('node:fs'); const rows=fs.readFileSync('evidence/d044-audit.jsonl','utf8').trim().split('\\n').map(JSON.parse); console.log(rows.length, rows.every(r=>r.operationId && r.argvSha256.length===64))"
```

## 12. 全量质量证据

实际 `npm run test:coverage`：

```text
Test Files  54 passed (54)
Tests       505 passed (505)
All files: Statements 91.47% | Branches 86.50% | Functions 97.26% | Lines 93.75%
```

原始输出：`evidence/d044-coverage.txt`。全量 check 输出：`evidence/d044-check.txt`。最终提交前还会重跑 check、Demo、`git diff --check`，不将一次时序波动或局部测试冒充最终全量通过。

## 13. 文件导航与后续原则

- 核心：`src/tools/secure-command.ts`
- 审计：`src/observability/audit-sink.ts`
- Demo：`src/demo/d044.ts`、`scripts/d044-security.ts`
- 测试：`test/d044-*.test.ts`
- 课程：`docs/d044-security-course.md`
- 证据：`evidence/d044-*`

继续加固时，优先使用操作系统级隔离、低权限独立用户、只读根文件系统、显式网络策略、CPU/内存 cgroup、集中式防篡改审计。不要把“加一道字符串过滤”当成下一层安全边界。
