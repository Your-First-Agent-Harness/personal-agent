# Personal Agent D023：崩溃恢复与可验证幂等

> 日期：2026-12-03 · 分支：`D023` · 前置：`D022`
>
> 目标：同一个 `sessionId + runId + userMessage` 的已完成请求可以重复提交，但 Provider、工具和用户消息写入都不能再次执行；冲突输入必须拒绝；中断运行不能伪装成已完成。

## 1. 今天要解决的问题

D022 已经具备 SQLite Session/Run 持久化、启动时把 `running` 恢复为 `interrupted`，以及真实 SIGKILL 后由第二个进程读取事实的能力。但它还不是幂等执行：

1. `PersistentAgentService.run()` 先追加用户消息，再尝试插入 run；
2. 重复 runId 会先改变 Session，随后才撞 `runs.id` 主键；
3. run 只保存状态，不保存原始输入和完成结果；
4. 因而重复已完成请求无法返回原结果，冲突输入和中断重提也没有清晰边界。

D023 不把“数据库还在”误当成“请求可以安全重放”。今天只补幂等契约及其真实进程证据，不做 D024。

## 2. 从 D022 继续

```bash
git switch D022
git switch -c D023
npm ci
```

开始时 D022 基线测试为 **11/11 通过**。生产实现仍使用 Node 24 原生 TypeScript/ESM、`node:sqlite` 和参数化 SQL，没有新增运行时依赖。

## 3. RED：先证明缺陷真实存在

新增 `test/d023-idempotency.test.ts`，在未改生产代码时运行：

```bash
npm test -- test/d023-idempotency.test.ts
```

首次结果为 **4 项全部失败**，不是编译错误或人为制造的失败：

| RED 场景 | 观察到的缺陷 |
| --- | --- |
| 重开后重复 completed 请求 | `UNIQUE constraint failed: runs.id`，没有返回原结果 |
| 同 runId 改 userMessage | 错误是主键冲突，不是明确“冲突”；新用户消息已被追加 |
| 同 runId 改 sessionId | 新 Session 已写入，原请求没有受到完整保护 |
| interrupted 重提 | 没有中断专用拒绝，且用户消息被重复追加 |
| D022 旧表保存完成结果 | `userMessage` 和 `result` 均未持久化 |

其中冲突用例一次覆盖两种输入变化，所以测试总数是 4，而不是 5。

随后只修改生产实现，再运行同一命令，结果为 **4/4 通过**。D021—D023 定向回归合计 **24/24 通过**。

五次 SIGKILL 测试是在上述单元 RED→GREEN 之后增加的进程级回归验证，首次运行为 **5/5 通过**；它是真实验证证据，但不冒充 RED 证据。

## 4. D023 幂等契约

### 4.1 请求身份

服务以 runId 查找既有记录，并比较 `sessionId` 和 `userMessage`：

| 既有记录与请求 | 行为 |
| --- | --- |
| runId 不存在 | 正常创建 running，执行 Loop |
| completed，sessionId/userMessage 相同 | 返回持久化的原完成结果 |
| 任意状态，sessionId 或 userMessage 不同 | 抛出包含“冲突”的 `RunStoreError` |
| interrupted，输入相同 | 明确提示已中断，不执行 Provider/工具 |
| running 或 failed，输入相同 | 明确拒绝重复执行 |
| completed 但缺完成结果或 Session | 拒绝，不猜测、不重放 |

只有“输入一致的 durable completed”是读取快捷路径。其他已有 runId 都不会进入 Loop。

重复 completed 时，以下行为均被测试锁定：

- Provider 调用次数不增加；
- 工具副作用不增加；
- 用户消息不重复；
- run 数和既有 `updatedAt` 不变；
- `messages/text/turns/stopReason/usage/run` 与首次完成结果一致。

`maxTurns`、Provider 实例等执行选项没有序列化为请求指纹；同一三元组重复提交时直接返回原结果，不会换 Provider 再算一次。需要新输入或新执行时必须使用新 runId。省略 runId 时会生成随机 ID，不提供跨请求去重键。

### 4.2 中断不是完成

`recover()` 只暴露 Session 与 interruptedRuns，不把工具临时状态恢复成 completed。对 interrupted 使用相同请求再次调用 `run()` 会拒绝；如需重试，必须先人工核对副作用，再用新 runId 显式发起。

## 5. 持久化与事务设计

### 5.1 最小新增字段

`src/memory/run-store.ts` 为 runs 表增加两个可空列：

```text
user_message TEXT   -- 服务层请求的原始用户输入
result_json  TEXT   -- AgentLoopResult：消息、文本、轮数、停止原因、用量
```

新表直接包含这两列。打开 D022 旧数据库时，通过 `PRAGMA table_info(runs)` 检查并用固定 SQL `ALTER TABLE ... ADD COLUMN` 补齐；测试先手工建立真实 D022 表结构，再验证输入和结果可写入、关闭、重开、读回。

所有值仍通过 `?` 参数绑定。`RunRecord` 新增可选 `userMessage` 与 `result`，直接使用这两个旧字段缺失时的安全拒绝边界，不改 D022 的 RunStore 基本状态机。

### 5.2 写入顺序

新运行的事务边界保持小而明确：

1. 在任何写入前读取并处理既有 runId；
2. SessionStore 用自己的事务保存新用户消息；
3. RunStore 插入 running，同时保存 userMessage；
4. Loop 执行 Provider/工具；
5. SessionStore 用自己的事务保存最终消息；
6. RunStore 用**同一条 UPDATE** 写入 `completed + stop_reason + result_json + updated_at`。

第 6 步使 run 状态与其完成结果不会出现“一半 completed、一半没有结果”的单行更新状态。完成结果包含消息快照，所以即使之后 Session 继续追加内容，旧 run 的结果仍可从自己的 JSON 恢复。

两个 Store 仍使用各自连接。**Session 保存与 Run 完成不是一个跨表事务**：如果进程恰好在第 5、6 步之间死亡，下一进程会把 running 转为 interrupted，不会返回 completed 或自动重放。恢复所需的 running→interrupted 批量更新仍由单个 SQLite 事务完成。

## 6. 五次真实 SIGKILL 验证

涉及文件：

- `test/d023-process.ts`：可独立启动的完成、崩溃、校验进程；
- `test/d023-crash-idempotency.test.ts`：5 个独立迭代，各自使用独立临时目录、SQLite 文件和工具日志。

### 6.1 每一轮的步骤

1. **complete 进程**：Provider 先调用一次本地 `record` 工具，日志追加 `complete`，再返回最终回答并正常退出；
2. **crash 进程**：同一 Session 用新 runId 发起“崩溃请求”，先执行工具并追加 `crash`，第二次 Provider 调用时保持 pending；
3. 工具完成后、Provider 阻塞时才发送 ready；父进程收到 ready 后执行真实 `child.kill('SIGKILL')`，并验证退出 signal；
4. **第一个 verify 进程**：重新打开磁盘，重复 `recover()` 两次，重复 completed 请求，再重提 interrupted 请求；
5. **第二个 verify 进程**：再做一次同样校验，完整输出必须与第一个 verify 一致。

### 6.2 避免假崩溃与固定时序

崩溃夹具在返回永不 settle 的 Promise 之前启动存活定时器，事件循环不会因 pending Promise 本身而自然退出。父进程只等待明确 ready，不依赖固定 50ms 等脆弱延迟；超时只作为失败保护。

verify 中的 Provider 和工具都是“禁止执行”的计数替身。每轮都断言：

- `providerCalls === 0`、`unexpectedToolCalls === 0`；
- 工具日志严格为 `['complete', 'crash']`，没有第三条重放记录；
- completed 的持久化执行结果与首次完全一致；
- crashed 为 interrupted，重复提交返回包含“中断”的错误；
- Session 只比完成快照多一条崩溃前的用户消息，没有重复用户消息；
- runs 始终只有 complete/crash 两条；
- 两次恢复及两个 verify 进程的快照一致。

实际结果：**5 次 SIGKILL，5/5 通过**；独立运行该文件约 1.4 秒。

```bash
npm test -- test/d023-crash-idempotency.test.ts
```

## 7. 完整验证与真实覆盖率

```bash
npm run check
npm run test:coverage
```

2026-12-03 本分支实际结果：

- ESLint：通过；
- TypeScript `tsc --noEmit`：通过；
- **28 个测试文件、217 项测试全部通过**；
- 其中新增 9 项：4 项幂等/迁移测试 + 5 项真实 SIGKILL 测试；
- 保留的 208 项旧测试全部通过。

| 覆盖率 | 实际值 | 项目阈值 |
| --- | ---: | ---: |
| Statements | 94.06% | 80% |
| Branches | 89.29% | 75% |
| Functions | 98.69% | 80% |
| Lines | 94.77% | 80% |

命令输出中的 npm `home` 配置提示不是测试失败。测试只使用本地临时文件、脚本 Provider 和真实子进程，不读取凭证，也不进行真实外部网络验证。

## 8. 明确边界

- **不承诺外部副作用 exactly-once。** 已完成后的服务层重复请求不会重放工具；但崩溃前工具可能已发邮件、扣款或写外部系统，SQLite 无法撤销这些效果。
- **不自动重放 interrupted。** 人工审计后用新 runId 重试，才是显式、可审计的边界。
- **不是跨 Session/Run 的分布式事务。** 最终 Session 与 run 完成之间的崩溃会留下 interrupted，由调用方处理。
- **不是多进程并发执行协调器。** 没有 leader election、heartbeat 或跨进程请求队列；运行写入按单进程服务边界使用。数据库主键不是授权多个进程同时写同一 Session 的理由。
- **旧 D022 完成记录不自动获得幂等结果。** 缺少 userMessage/result 的历史记录仍可读取，但不会被猜成可安全返回的 D023 完成结果。
- 文件、Shell、外部业务 API 仍需要自己的权限、补偿与审计策略。

## 9. 本日复盘

幂等的关键不是给 Loop 加一个内存缓存，而是让请求身份、完成状态和可返回结果一起跨越进程边界持久化。真正安全的顺序也必须改变：**先识别重复，再决定是否写入**。对无法判定的中断状态，拒绝和显式人工重试比“再跑一次试试”更可靠。
