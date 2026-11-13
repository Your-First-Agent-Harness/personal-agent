# D044 安全加固课程：从“能执行”到“可约束、可追溯”

> 课程材料，不表示已经向任何真实学员授课。建议 60–75 分钟，配合本仓库测试和离线 Demo 使用。

## 一、学习目标

完成后，学习者应能：

1. 解释工具权限、命令白名单和 OS 沙箱是三层不同控制。
2. 用结构化 argv 与 `shell:false` 防止 shell 元字符注入，而不是依赖 `startsWith`。
3. 为每调用设置 wall timeout、字节输出预算、并发/队列预算和取消语义。
4. 设计能关联允许、拒绝、结果、耗时和退出信息的审计记录。
5. 区分 fail-open、fail-closed 与“副作用已经发生但 completion 审计失败”。
6. 说出当前实现不具备 CPU/内存 rlimit、网络/文件系统隔离和防篡改审计。

## 二、课前准备（5 分钟）

```bash
npm ci
npm run demo:d044
npx vitest run test/d044-secure-command.test.ts test/d044-audit-sink.test.ts
```

不需要 API Key、真实凭证或外网。所有秘密都是 `FAKE_...NEVER_REAL` 伪造值。不要自行换成真实凭证做实验。

## 三、讲义

### 第 1 单元：权限通过不等于操作安全（8 分钟）

D029 Registry 的 `tool_policy` 解决“这个主体能否调用这个工具”。即使 `secure_command:exec` 已允许，以下来源仍不可信：

- 模型生成的 executable 或 argv；
- 外部文档、网页、issue 中间接注入的参数；
- 插件传入的过长、畸形或含秘密的参数；
- 已被允许程序产生的无限输出或子孙进程。

因此还需要命令层的准入、资源层的有界执行和审计层的事后追溯。

**讨论题：** 如果把 `run_command:*` 加入白名单，是否等价于允许所有 shell 行为？为什么？答案应区分工具动作授权与具体命令授权。

### 第 2 单元：白名单必须先定义“相等”（12 分钟）

不安全思路：

```ts
const ok = command.startsWith('printf ');
```

它既没有定义命令边界，也没有定义参数边界，更没有阻止 shell 解释后续的 `;`、`>`、`|` 或 `$()`。

本课程的规则是：

```text
allow(call, rule) =
  realpath(call.executable) === realpath(rule.executable)
  AND call.args.length === rule.args.length
  AND every(call.args[i] === rule.args[i])
```

最后通过 `spawn(executable, args, { shell: false })` 启动。元字符即使出现在已允许的字面参数中，也只是参数内容，不会变成新命令。

**关键限制：** 白名单不是“安全程序名单”。允许 `node -e <代码>` 就是允许这段代码；允许 shell 解释器也会继承解释器能力。对不可信输入应优先暴露业务级结构化工具，而不是通用解释器。

### 第 3 单元：每个资源都要有所有者和上限（12 分钟）

| 资源 | 上限 | 超限动作 |
| --- | --- | --- |
| 子进程时间 | 每调用 timeout，且不得超过 maxTimeoutMs | 杀进程组，返回 COMMAND_TIMEOUT |
| 输出内存 | stdout/stderr 合计 maxOutputBytes | 停止保留并杀进程组 |
| 活跃执行 | maxConcurrent | 满载进入有界队列或拒绝 |
| 等待者数量 | maxQueue | 返回 COMMAND_RESOURCE_LIMIT |
| 等待时间 | maxQueueWaitMs | 移除 waiter 并拒绝 |
| 调用者意图 | AbortSignal | 运行中终止；排队中移除；预取消不 spawn |

字节与字符不同：一个 UTF-8 字符可能占多个字节，按 `string.length` 限制不能证明 Buffer 内存预算。当前审计记录的是“保留字节”，不是伪造的总输出统计。

**未覆盖资源：** CPU、RSS/虚拟内存、文件描述符、磁盘写入总量、进程数。生产环境应使用 cgroup/容器/独立用户等 OS 机制。

### 第 4 单元：审计要回答完整问题（12 分钟）

一条可执行审计至少回答：

- 谁：operationId、tool、ruleId；
- 做了什么：脱敏 executable/argv 与 argv SHA-256；
- 是否允许：decision/status/resultCode；
- 什么时候、多久：timestamp、durationMs、queueWaitMs；
- 结果如何：exitCode、signal；
- 消耗/清理如何：timeout、输出预算与保留字节、截断、清理。

允许调用先写 decision，再执行，最后写 completion。拒绝调用的 decision 已是最终记录。只有“参数已脱敏”的日志没有足够追溯力。

SHA-256 只是参数摘要，不是加密；低熵秘密仍可能被枚举。敏感值应替换，且原始错误、环境、stdout/stderr 也不能被忽略。

### 第 5 单元：故障时安全目标决定开门还是关门（10 分钟）

本课程选择 fail-closed：

```text
decision 写失败 → 不启动
completion 写失败 → 显式失败，但已执行副作用不可回滚
```

第二种情况尤其重要：返回 `AUDIT_WRITE_FAILED` 不等于命令没运行，也不等于 marker 被撤销。测试故意证明 completion 失败时 marker 已存在，防止用日志结果重写现实。

JSONL 在实例内串行 append，一次失败不会被吞掉，也不会阻塞后续写入链。但它不是分布式事务、防篡改存储或断电持久化保证。

## 四、课堂练习

### 练习 A：验证不是字符串过滤（10 分钟）

1. 阅读 `test/d044-secure-command.test.ts` 的五种元字符参数化测试。
2. 运行测试并确认攻击在 spawn 前拒绝，marker 不存在。
3. 找到“字面元字符被精确允许”的测试，解释为什么它不会创建 marker。

验收：回答必须同时提到“完整 argv 精确比较”和“shell:false”，只回答“过滤了分号”不合格。

### 练习 B：审计故障实验（10 分钟）

1. 定位 decision 与 completion 两类审计故障测试。
2. 对比两种场景 marker 是否存在。
3. 用一句话写出每种场景的安全保证。

参考结论：decision 故障保证未启动；completion 故障只保证调用方收到明确失败，不保证未执行或可回滚。

### 练习 C：资源预算评审（课后，可选）

设计一个允许固定程序输出 1 MiB 数据的测试方案，预算 4 KiB。不得运行 fork bomb、OOM 或真实破坏命令。

验收清单：

- 断言字节而非字符；
- 断言进程被终止而非仅返回截断成功；
- 断言 completion 审计的资源字段；
- 清理临时目录和进程；
- 不宣称该测试覆盖 CPU/内存 rlimit。

## 五、形成性评估

每题 0–2 分，总分 10 分；8 分表示掌握本课程范围，不表示获得任何外部安全认证。

1. 为什么 Registry 工具权限不能替代 argv 白名单？
2. 为什么 `shell:false` 仍需要白名单？
3. 为什么输出要按 Buffer 字节限制？
4. 为什么允许命令必须先写 decision 审计？
5. 当前实现还不能阻止允许脚本做哪些事情？

第 5 题至少应回答：以当前用户权限访问允许范围内的文件/网络、消耗未由 rlimit 限制的 CPU/内存，以及利用 realpath/spawn 间的文件系统变化。

## 六、复盘与延伸阅读顺序

1. 先读 `src/tools/secure-command.ts` 的决策顺序，再读进程执行与队列。
2. 再读 `src/observability/audit-sink.ts`，区分审计语义与存储语义。
3. 对照 `evidence/d044-audit.jsonl` 和 `evidence/d044-transcript.txt`，不要只看最终 PASS。
4. 最后阅读 README 的“明确不在本日边界内”，为容器、低权限用户、cgroup、集中审计设计下一层防御。
