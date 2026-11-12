# D022｜2026-12-02｜进程崩溃恢复：Session 恢复 + 中断任务识别

> 基线：D021 `384c927`（完整 Session SQLite 快照）；保留 D020 streaming、原有一次性 CLI/REPL 行为与旧 Session API。
>
> 本日交付真实 Run 状态持久化、连接真实 `runAgentLoop` 的薄 service，以及两个独立 Node 进程之间的 SIGKILL 崩溃恢复验证。
>
> 环境：Node.js ≥24（`node:sqlite` 内置）；零运行时依赖。

---

## 一、交付内容

| 模块 | 职责 |
| --- | --- |
| `src/memory/run-store.ts` | RunRecord 模型、SqliteRunStore、运行状态机与启动中断识别 |
| `src/runtime/persistent-runner.ts` | 连接 SessionStore、RunStore 与真实 runAgentLoop |
| `test/d022-run-store.test.ts` | 状态持久化、终态隔离、session 隔离与关闭语义 |
| `test/d022-persistent-runner.test.ts` | 完整历史保存、失败原样抛出、恢复与 StopReason |
| `test/d022-crash-recovery.test.ts` | 真实独立进程 SIGKILL 集成测试 |
| `test/d022-process.ts` | 崩溃/恢复子进程夹具，不使用直接 fail/mark 冒充崩溃 |

本日不接入 CLI，不改 Provider、工具执行器、Loop 或旧 Session API。

---

## 二、RunRecord 与 RunStore API

```ts
type RunStatus = 'running' | 'completed' | 'interrupted' | 'failed';

interface RunRecord {
  readonly id: string;
  readonly sessionId: string;
  readonly status: RunStatus;
  readonly stopReason?: StopReason;
  readonly startedAt: string; // ISO 时间
  readonly updatedAt: string; // ISO 时间
}

interface RunStore {
  start(run: { id?: string; sessionId: string }): RunRecord;
  finish(id: string, stopReason?: StopReason): RunRecord;
  fail(id: string): RunRecord;
  get(id: string): RunRecord | undefined;
  list(sessionId?: string): RunRecord[];
  interruptRunning(): RunRecord[];
  close(): void;
}
```

- `start`：未传 id 时使用 `randomUUID()`，立即持久化 `running`。
- `finish`：只允许 `running → completed`，默认 StopReason 为 `completed`，也保留 `max_turns`、`cancelled`、`tool_errors`。
- `fail`：只允许 `running → failed`。
- `get/list`：读取持久化记录；`list(sessionId)` 只返回该 Session 的运行。
- `interruptRunning`：事务内找出并更新全部遗留 `running → interrupted`，只返回本次被中断的记录。
- `close`：幂等；关闭后的所有操作抛出 `RunStoreError`。
- 所有 id、session id、状态值与时间写入均使用参数化 SQL；表结构由 store 自动创建。

SQLite 表：`runs(id, session_id, status, stop_reason, started_at, updated_at)`。RunStore 可独立打开数据库，也可与 SessionStore 打开同一个文件。

---

## 三、状态机

```text
start()
   │
   ▼
running ─── finish(stopReason) ───▶ completed
   │
   ├────── fail() ────────────────▶ failed
   │
   └─ 新进程启动 interruptRunning() ▶ interrupted

completed / failed / interrupted 均为终态，不会被后续启动恢复改写。
```

`completed` 表示 Loop 正常返回，不等同于模型一定回答成功。例如协作式取消仍由 Loop 正常返回，因此记录为 `completed + stopReason=cancelled`。Provider 异常则进入 `failed`。进程被强制杀死时没有执行任何终态写入，所以先保留 `running`，在下一个进程启动时才识别为 `interrupted`。

---

## 四、PersistentAgentService

```ts
const sessionStore = new SqliteSessionStore(path);
const runStore = new SqliteRunStore(path);
const service = new PersistentAgentService({ sessionStore, runStore });

const result = await service.run({
  runId: 'run-1',             // 可选
  sessionId: 'session-1',
  userMessage: '修复这个问题',
  provider,
  registry,
  maxTurns: 4,
  maxTokens: 1024,
  workspaceRoot: root,
  streaming: true,           // D020 选项原样传给真实 Loop
  onToken,
});

const recovered = service.recover('session-1');
// recovered: { session: Session, interruptedRuns: RunRecord[] } | undefined
```

### 正常执行时序

1. 按 `sessionId` 加载已有 Session；不存在则创建同 id 的新 Session。
2. 追加当前用户消息，并在调用 Provider 前 `SessionStore.save()`。
3. 创建并持久化 `running` RunRecord。
4. 将完整消息快照交给真实 `runAgentLoop`；provider、registry、streaming、signal 等选项继续走原 Loop。
5. Loop 正常返回后，只把本轮新增后缀追加到 Session，再保存完整快照。
6. 写入 `completed` 与实际 StopReason，返回 `{ ...AgentLoopResult, run, session }`。

### Provider 失败与进程崩溃

- Provider 抛错：写 `failed`，然后原样抛出同一个错误，不包装、不伪装完成。
- SIGKILL/进程崩溃：没有 catch/finally 伪造成功；磁盘上仍是最后提交的 `running` 与已保存 Session。
- 新 service 启动：构造时调用 `interruptRunning()`；`recover(sessionId)` 加载完整 Session，并返回该 Session 的 interrupted runs。
- `recover` 不执行 Provider、不调用工具、不自动 replay。

---

## 五、真实 SIGKILL 验证

`test/d022-crash-recovery.test.ts` 不是直接调用 `fail()` 或 `interruptRunning()` 模拟崩溃，而是：

1. 使用 `process.execPath` 启动第一个独立 Node 子进程，数据库位于临时目录。
2. 子进程创建真实 SqliteSessionStore、SqliteRunStore、PersistentAgentService，并运行真实 `runAgentLoop`。
3. 用户消息与 running 记录落盘后，Provider 输出 `ready`，随后返回永不完成的 Promise，Loop 真实阻塞在 Provider。夹具同时保留一个定时器句柄；只有 pending Promise 不会保持 Node 事件循环存活，否则进程可能在收到信号前自然退出。
4. 父进程收到 ready 后发送 `SIGKILL`，并验证子进程退出信号确为 `SIGKILL`。
5. 启动第二个独立 Node 子进程，用新的 store/service 实例重新打开同一个 SQLite 文件。
6. 第二进程恢复出同一 `crash-run`，状态为 `interrupted`；Session id 为 `crash-session`，历史完整保留 `崩溃前必须落盘`。
7. 子进程夹具路径由 `import.meta.url` 解析，运行 cwd 是另一临时目录，不依赖仓库 cwd。
8. ready 等待有 8 秒超时，测试总超时 15 秒；`afterEach` 对仍存活的子进程补发 SIGKILL、等待退出并删除临时目录，避免 zombie 和挂住。

单测另外验证：completed/failed 不会被启动恢复误标、session 记录隔离、completed 重开数据库仍为终态、失败保留同一错误对象、取消保留 StopReason。

---

## 六、运行方式

```bash
npm ci

# 本日三组针对性测试：11 项
npm test -- test/d022-run-store.test.ts \
  test/d022-persistent-runner.test.ts \
  test/d022-crash-recovery.test.ts

# 连同 D021 Session 与 D020 streaming 回归
npm test -- test/d022-run-store.test.ts \
  test/d022-persistent-runner.test.ts \
  test/d022-crash-recovery.test.ts \
  test/d021-session-store.test.ts \
  test/d020-loop-streaming.test.ts \
  test/d020-streaming.test.ts \
  test/d020-cli.test.ts

# 完整静态检查与测试
npm run check
npm run test:coverage
```

---

## 七、TDD 与验证证据

### RED（实现前实际运行）

| 测试 | 失败证据 |
| --- | --- |
| `d022-run-store` | 6 项失败：动态导入找不到 `src/memory/run-store.ts` |
| `d022-persistent-runner` | RunStore 转绿后重跑，4 项失败：找不到 `src/runtime/persistent-runner.ts` |
| `d022-crash-recovery` | 第一子进程在 ready 前退出，stderr 明确为找不到 `persistent-runner.ts`；父进程同时完成清理 |

### GREEN（最终）

- D022 针对性：3 文件，11/11 通过。
- D022 + D021 + D020 回归：7 文件，33/33 通过。
- `npm run check`：ESLint、`tsc --noEmit`、全量测试均通过。
- 全量：26 文件，208/208 通过（基线 197 + 本日 11）。

覆盖率（最终 `npm run test:coverage`）：

| 范围 | Statements | Branches | Functions | Lines |
| --- | ---: | ---: | ---: | ---: |
| 全局 | 94.38% | 89.34% | 98.67% | 95.13% |
| `run-store.ts` | 90.19% | 85.71% | 100% | 90% |
| `persistent-runner.ts` | 100% | 100% | 100% | 100% |
| D021 `session-store.ts` | 88.46% | 90% | 100% | 88.46% |

首次 coverage 曾触发旧 `run_command` 50ms 超时测试的 PID 临时文件竞态；该旧测试针对性复验通过，随后完整 coverage 重跑 208/208 通过。本日未修改旧 `run_command` 文件。

主代理独立复核时，coverage 又暴露出崩溃夹具的自然退出竞态：pending Promise 本身不保持 Node 进程存活，导致父进程偶尔观察到 `code=0、signal=null` 而非 SIGKILL。修复仅限于夹具增加存活定时器，未改生产代码；修复后该测试连续运行 5 次均通过，完整 coverage 再次达到 26 文件、208/208 通过，全局覆盖率保持 94.38% statements、89.34% branches、98.67% functions、95.13% lines。

---

## 八、恢复边界（必须明确）

1. **不承诺 exactly-once。** 崩溃可能发生在工具副作用之后、最终 Session 保存之前；仅凭最后快照无法推断所有外部副作用是否发生。
2. **不自动重放工具。** 本日只恢复完整 Session 和 interrupted 记录，把是否继续、如何核对副作用交给调用方。
3. **恢复到最后已提交快照。** 用户消息在运行前保存，正常结束保存完整新增历史；崩溃时尚未保存的 Provider token、工具结果或内存消息无法凭空恢复。
4. **单进程重启恢复协议。** 遗留 running 标记不等于多进程 leader election、heartbeat 或活跃实例检测。不要让多个活跃 service 同时操作同一数据库；新 service 启动会中断当时所有 running 记录。
5. **interrupted 与 failed 不同。** failed 是 Provider 已明确抛错；interrupted 是新进程发现旧进程留下的 running，不能据此推断具体崩溃原因。
6. **D020 与 CLI 不变。** streaming 选项可穿透 service；原有一次性 CLI/REPL 未接入持久化，不改变既有行为。

---

## 九、D023 入口

D023 可在本日 RunRecord 与恢复点上继续设计：幂等 key、工具结果缓存、明确的 replay 策略、外部副作用对账与人工确认流程。上述能力本日均未提前实现；在完成这些语义前，不应把 interrupted run 直接自动重放为“安全续跑”。
