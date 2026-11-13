# Personal Agent · 第 43 天

**进度：D043 / D100 · v0.1.0 · 主题：沙箱执行——进程组、临时工作目录与环境变量清理**

D042 已经演示了第三方 Tool 的输入、超时和响应边界。D043 新增独立 `sandboxed_command` Tool：每次调用创建一次性工作目录，使用固定最小环境，在独立进程组中执行命令，并在结束、超时或取消后清理同组进程与临时目录。

本日**没有修改 `run_command` 的兼容性，也没有把它静默替换成沙箱实现**。调用方必须显式导入、注册并使用 `sandboxed_command`。本日不做通用命令白名单、CPU/内存 rlimit、完整审计或 D044。

> 这是 macOS/POSIX 上的最小进程、初始工作目录和 env 隔离练习，不是容器，也不提供系统级强隔离。shell 命令仍能访问绝对路径、在启动后自行 `cd`、访问网络或尝试创建新进程会话；不能把本工具描述成“防止一切危险命令”。

---

## 1. 运行

环境：Node 24、原生 TypeScript ESM、Vitest；零新增运行时依赖。Demo 与测试都不访问外部网络，也不需要 API Key 或 `.env`。

```bash
npm ci
npm run demo:d043
npm run check
npm run test:coverage
```

只跑本日测试：

```bash
npx vitest run test/d043-sandboxed-command.test.ts test/d043-demo.test.ts
```

重新采集真实 Demo transcript：

```bash
set -o pipefail
npm run demo:d043 2>&1 | tee evidence/d043-transcript.txt
```

当前证据：[`evidence/d043-transcript.txt`](./evidence/d043-transcript.txt)。本次运行退出码为 **0**。任一隔离、清理或越权断言失败时，Demo 不打印 `PASS`，CLI 以非零状态退出。

---

## 2. 本日真实 Demo transcript

```text
> personal-agent@0.1.0 demo:d043
> node scripts/d043-sandbox.ts

D043 Demo：一次性 cwd、最小 env、独立进程组与结构化 ToolResult。
边界=进程/临时工作目录/env 最小隔离；不是容器、seccomp、权限降级或网络隔离。
hostSecret=null allowedEnv=explicit-public-value
isolatedCwd=true writable=true cleanedUp=true
controlledDanger=removed-inside-sandbox cleanedUp=true
cwdEscape=PATH_OUTSIDE_WORKSPACE markerCreated=false
hostRootRemoved=true
D043 Demo PASS：伪造宿主秘密未泄漏，临时目录可写且已清理，cwd 越权在启动前被拒绝。
```

Demo 做了三次真实 Tool 调用：

1. **安全命令**：在一次性目录写入并读回 `artifact.txt`，同时报告 `process.cwd()` 和精选 env。宿主进程只注入伪造变量 `D043_DEMO_HOST_SECRET=FAKE_D043_DEMO_HOST_SECRET_VALUE`；子进程看到 `hostSecret=null`，只能看到显式传入的 `D043_DEMO_PUBLIC`。
2. **受控危险操作**：只在一次性目录创建并删除无害的 `controlled-danger.txt`，随后验证整个临时根目录已清理。它不删除宿主文件，也不证明文件系统级 containment。
3. **cwd 越权**：传入 `cwd: '../outside'`。工具在启动命令前返回 `PATH_OUTSIDE_WORKSPACE`，越权 marker 不存在。

测试还单独创建真实 shell → Node 子进程 → Node 孙进程，验证超时与 `AbortSignal` 都终止整个同组进程树；这些 PID 检查不靠 mock。

---

## 3. 架构与数据流

```text
调用方 args + ToolContext{workspaceRoot, signal}
  │
  ├─ 直接执行边界：对象、额外字段、command、cwd、timeoutMs、env 全部校验
  ├─ signal 已取消？→ 结构化 COMMAND_CANCELLED，不创建进程
  ▼
realpath(workspaceRoot)
  │ mkdtemp(.d043-sandbox-XXXXXX)
  ▼
一次性 sandboxRoot
  │ resolveInWorkspace(cwd) → mkdir → realpath 双重 containment 检查
  │ 越界？→ 清理临时根，返回 PATH_OUTSIDE_WORKSPACE，命令未启动
  ▼
spawn(command, {shell:true, detached:true, cwd, env:最小白名单})
  │ stdin=ignore；stdout/stderr 各最多保留 8000 字符
  │
  ├─ 正常 close → 再终止仍存活的同组后台进程
  ├─ timeoutMs → 对负 PGID 发送 SIGKILL → COMMAND_TIMEOUT
  ├─ AbortSignal → 对负 PGID 发送 SIGKILL → COMMAND_CANCELLED
  └─ 非零退出 → 保留 stdout/stderr/exitCode → COMMAND_FAILED
  ▼
rm(sandboxRoot, {recursive:true, force:true})
  ▼
JSON ToolResult：cwd、sandboxRoot、exitCode、signal、stdout/stderr、
               timedOut、cancelled、truncated、cleanedUp
```

进程组的关键是 POSIX `detached: true` 让 shell 成为新进程组 leader；终止时使用 `process.kill(-child.pid, 'SIGKILL')`，而不是只杀直接子进程。正常退出后也执行一次同组清理，避免父进程退出但同组后台孙进程继续运行。

---

## 4. 安全边界：做到了什么，没有做到什么

| 范围 | 本日真实行为 | 明确边界 |
| --- | --- | --- |
| 初始工作目录 | 每次调用在指定工作区下创建独立临时根；`cwd` 只能解析到该根内 | shell 启动后可以自行 `cd`，这不是系统调用级文件沙箱 |
| 写入与清理 | 临时目录默认可写；成功、失败、超时、取消后都请求递归清理 | 清理失败会返回 `COMMAND_FAILED` 和 `cleanedUp:false`，不伪报成功 |
| 环境变量 | 不展开或继承 `process.env`；只提供固定 `PATH/HOME/TMPDIR/PWD/LANG` 与显式安全 env | 敏感名称拒绝规则不是秘密扫描器；调用方不得把秘密伪装成普通变量值传入 |
| 进程生命周期 | POSIX 独立进程组；超时、取消和正常结束都清理同组进程 | 子进程若调用 `setsid`、创建新会话或脱离原进程组，本工具无法保证追回 |
| 输出 | 分别保留 stdout/stderr、退出码、signal 和截断标记 | 8000 字符之外的内容被丢弃，不是完整日志归档 |
| 非法输入 | 直接 `execute` 也返回统一 `ToolResult`，不向调用方抛参数异常 | Registry 仍会在外层先做 JSON/Schema 校验 |
| 平台 | 本日实测 macOS 的 POSIX 进程组语义 | Windows 只有直接子进程 fallback，不声称等价进程组保证 |

### 绝不是这些能力

- 不是容器、VM、chroot、seccomp、Seatbelt 或 Landlock。
- 没有 UID/GID 权限降级，没有只读根文件系统。
- 没有网络隔离；命令仍可尝试联网。本日测试和 Demo 只是主动选择不联网。
- 没有 CPU、内存、磁盘、进程数或文件描述符 rlimit。
- 没有通用命令白名单、恶意命令识别或“防止一切危险命令”的承诺。
- 没有完整安全审计、入侵检测或不可绕过的资源回收。
- shell 命令能访问绝对路径，也能读写当前 OS 用户本来有权访问的其他位置。**因此不要把不可信命令直接交给本工具。**

`cwd` 防越权特指**工具选择初始工作目录的参数路径**。一次性根在启动前经过 resolve + realpath 检查，但启动后的任意 shell 行为不受内核级文件策略约束。Demo 选择无害临时文件证明隔离目录可写和副作用可清理，而不是执行真正破坏性命令来制造假象。

---

## 5. Tool API

### 导入与注册

```ts
import { ToolRegistry, sandboxedCommandTool } from './src/index.ts';

const registry = new ToolRegistry();
registry.register(sandboxedCommandTool);
```

`sandboxed_command` 是独立导出，不加入既有默认十工具列表；这是为了避免无提示改变旧 Agent 的工具面与 `run_command` 行为。

### 参数

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `command` | `string` | 必填、非空、不含 NUL；经 `/bin/sh` 等系统 shell 执行 |
| `cwd` | `string` | 可选，默认 `.`；相对一次性 sandboxRoot，越界在启动前拒绝 |
| `timeoutMs` | `integer` | 可选，默认 `10000`，范围 `1..30000` |
| `env` | `Record<string,string>` | 可选；只传非敏感值，不能覆盖固定变量 |

固定 env：

```text
PATH=/usr/bin:/bin:/usr/sbin:/sbin
HOME=<sandboxRoot>
TMPDIR=<sandboxRoot>
PWD=<初始 cwd>
LANG=C
```

额外 env 名必须是合法标识符。常见 `SECRET/TOKEN/PASSWORD/CREDENTIAL/PRIVATE/API_KEY/ACCESS_KEY/AUTH/COOKIE` 命名，以及 `NODE_OPTIONS`、`BASH_ENV`、`LD_*`、`DYLD_*` 等执行注入入口会被拒绝。该规则只是纵深防御，不替代调用方审查值。

### 直接调用示例

```ts
const result = await sandboxedCommandTool.execute(
  {
    command: 'printf "safe"',
    cwd: '.',
    timeoutMs: 5_000,
    env: { PUBLIC_DEMO_VALUE: 'non-sensitive' },
  },
  { workspaceRoot: hostWorkspace, signal: controller.signal },
);
```

成功时 `content` 是 `SandboxedCommandResult` JSON：

```json
{
  "command": "printf \"safe\"",
  "sandboxRoot": "/tmp/work/.d043-sandbox-XXXXXX",
  "cwd": "/tmp/work/.d043-sandbox-XXXXXX",
  "exitCode": 0,
  "signal": null,
  "timedOut": false,
  "cancelled": false,
  "stdout": "safe",
  "stderr": "",
  "stdoutTruncated": false,
  "stderrTruncated": false,
  "cleanedUp": true
}
```

路径是本次执行的历史证据；返回时目录通常已经删除。预先取消时没有创建沙箱，两个路径字段为空字符串。

| 情况 | `isError` | `error.code` | 结构化输出 |
| --- | --- | --- | --- |
| 退出码 0 且清理成功 | 未设置 | 未设置 | 完整返回 |
| 非零退出、启动或清理失败 | `true` | `COMMAND_FAILED` | 非零退出仍保留 stdout/stderr/exitCode |
| 超时 | `true` | `COMMAND_TIMEOUT` | `timedOut:true` |
| AbortSignal | `true` | `COMMAND_CANCELLED` | `cancelled:true` |
| 参数、env 非法 | `true` | `INVALID_ARGUMENTS` | 人类可读错误，不启动命令 |
| `cwd` 越界 | `true` | `PATH_OUTSIDE_WORKSPACE` | 不启动命令 |

---

## 6. 测试矩阵

本日新增 **30 项测试**：工具 29 项，真实 Demo 1 项。

| 能力 | 验证方法 |
| --- | --- |
| 隔离 cwd、可写、结构化输出 | 子进程写入/读回文件，报告真实 `process.cwd()`；断言 stdout、stderr、exitCode 和清理状态 |
| 沙箱内嵌套 cwd | `nested/work` 自动创建并位于一次性根内 |
| cwd 越权不启动 | `../outside` 返回路径错误，越权 marker 不存在 |
| 宿主秘密不继承 | 宿主只设置伪造 secret，子进程得到 `null`，ToolResult 不含伪造值 |
| 显式安全 env | `D043_TEST_PUBLIC` 可见；固定 PATH/HOME/TMPDIR/PWD 精确断言 |
| 敏感/注入 env 拒绝 | `AWS_SECRET_ACCESS_KEY`、`NODE_OPTIONS`、`DYLD_INSERT_LIBRARIES` 全部使用假值 |
| 非零退出 | 真实 `process.exit(7)` 保留 7、stdout 和 stderr |
| 超时进程组清理 | 真实 shell、Node 子进程、Node 孙进程写 PID；超时后逐个确认不存在 |
| AbortSignal 进程组清理 | 同类三级进程树，在 PID 握手后 abort，逐个确认不存在 |
| 正常退出后台清理 | 父进程 `unref` 后立即退出，同组后台孙进程仍被回收 |
| 预取消 | 命令未执行，返回结构化 `cancelled:true` |
| 输出上限 | stdout/stderr 分别产生 9000 字符，各自在 8000 字符处截断 |
| 统一非法输入错误 | 非对象参数、缺字段、额外字段、非法 timeout/cwd/env 均为 `INVALID_ARGUMENTS` |
| 工作区不可用 | 不抛异常，返回 `COMMAND_FAILED` |
| 公共 API 与 Schema | 独立导出与既有 `run_command` 不同；参数声明完整 |
| 真实 Demo | 不访问网络，实际检查 cwd/env、受控危险文件清理、cwd 越权与宿主根清理 |

没有使用 sleep 猜测后台进程是否退出：测试通过 PID 文件握手，并轮询 `kill(pid, 0)` 直到进程消失；失败清理也会尝试杀死测试进程。

---

## 7. TDD：实际 RED → GREEN 证据

### RED 1：能力模块不存在

先写 `test/d043-sandboxed-command.test.ts` 与 `test/d043-demo.test.ts`，再运行：

```bash
npx vitest run test/d043-sandboxed-command.test.ts test/d043-demo.test.ts
```

实际输出（退出码 **1**）：

```text
FAIL  test/d043-demo.test.ts [ test/d043-demo.test.ts ]
FAIL  test/d043-sandboxed-command.test.ts [ test/d043-sandboxed-command.test.ts ]
Error: Failed to load url ../src/tools/sandboxed-command.ts (resolved id: ../src/tools/sandboxed-command.ts).
Does the file exist?
Error: Failed to load url ../src/demo/d043.ts (resolved id: ../src/demo/d043.ts).
Does the file exist?
Test Files  2 failed (2)
     Tests  no tests
```

随后才创建 `src/tools/sandboxed-command.ts` 和 `src/demo/d043.ts`。

### RED 2：公共导出未实现

核心行为转绿后，新增公共入口契约测试并先运行：

```text
FAIL test/d043-sandboxed-command.test.ts > D043 sandboxed_command > 通过公共入口导出同一个独立 Tool，不改变 run_command
AssertionError: expected undefined to be [object Object]
- Expected: [Function sandboxedCommandTool]
+ Received: undefined
Test Files  1 failed (1)
     Tests  1 failed | 28 skipped (29)
```

然后才在 `src/index.ts` 导出 Tool、结果类型和 Demo。

### GREEN：同组测试真实通过

```text
✓ test/d043-demo.test.ts (1 test)
✓ test/d043-sandboxed-command.test.ts (29 tests)
Test Files  2 passed (2)
     Tests  30 passed (30)
  Duration  3.48s
```

中间还由测试真实暴露并修复了遗漏的路径模块导入、macOS `/var` → `/private/var` realpath 差异，以及正常退出测试中父 Node 未 `unref` 子进程句柄的问题；不是用放宽安全断言换取 GREEN。

---

## 8. 完整回归与覆盖率

最终实际运行：

```text
npm run check
Test Files  51 passed (51)
     Tests  467 passed (467)

npm run test:coverage
Test Files  51 passed (51)
     Tests  467 passed (467)
```

| Statements | Branches | Functions | Lines |
| ---: | ---: | ---: | ---: |
| 91.34% | 86.57% | 97.39% | 93.49% |

门槛仍为 statements/lines ≥ 80%、functions ≥ 80%、branches ≥ 75%。一次完整回归中既有 D035 的 100ms MCP 初始化用例在 51 worker 并发下超时；该套件单独 20/20 通过后重新完整运行 `check`，最终 467/467 通过。未修改 D035 或其超时配置。

---

## 9. 文件索引与后续边界

| 文件 | 责任 |
| --- | --- |
| `src/tools/sandboxed-command.ts` | 参数/env 校验、一次性 cwd、独立进程组、输出捕获、超时/取消和清理 |
| `src/demo/d043.ts` | 无网络、无真实凭证的可执行安全断言 |
| `scripts/d043-sandbox.ts` | CLI 入口；失败输出错误并设置非零退出码 |
| `test/d043-sandboxed-command.test.ts` | 29 项真实进程、路径、env 与错误契约测试 |
| `test/d043-demo.test.ts` | Demo transcript 和报告断言 |
| `evidence/d043-transcript.txt` | 本轮真实 `npm run demo:d043` 输出 |
| `src/index.ts` | 独立公共导出 |
| `package.json` | `npm run demo:d043` |

D044 可以继续做审计、策略或更强执行边界；若目标是真正运行不可信命令，应改用有内核文件/网络/权限策略的容器或沙箱运行时，而不是继续堆叠本日这种用户态路径检查。
