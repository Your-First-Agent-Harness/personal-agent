# D007 · 内存 Session 与五轮 REPL：让对话跨轮连续

> 本文件是 D007 分支的教学内容说明。分支索引见 [main](../../tree/main)。

## 今天要做出的东西

- 进程内 `Session`：保存稳定 `id` 和完整消息历史，构造、追加与读取时都做防御性复制
- 跨轮写回协议：每轮只把 Loop 新增的 assistant/tool 消息追加到 Session，下一轮带上完整历史
- 可测试的 readline REPL：忽略空行，逐行执行问题，输入 `/exit` 退出
- CLI 组合：带参数时仍是一次性提问，不带参数时在同一个 Session 上连续对话

## 今天讲什么

### 1. Loop 管一次运行，Session 管跨轮历史

`runAgentLoop` 的职责没有改变：接收一组消息，运行到完成或达到最大轮次，返回包含新增 assistant/tool 消息的完整数组。D007 把“上一次运行说过什么”交给 Session，而不是让 Loop 持有全局状态。

每轮固定执行下面四步：

```ts
session.append([{ role: 'user', content: input }]);
const before = session.snapshot();
const result = await runAgentLoop({ ...options, messages: before });
session.append(result.messages.slice(before.length));
```

`before.length` 是本轮开始前的历史长度。Loop 返回值的前半部分与快照对应，因此只追加切片中的新增消息，既不会重复旧消息，也不会漏掉工具调用及工具结果。下一次运行再从新的完整快照开始，模型就能看到此前所有轮次。

自动化测试让脚本化 Provider 依次返回“回答 1”到“回答 5”。五次请求的消息数依次为 1、3、5、7、9；第五轮请求包含前四轮 user/assistant 和第五个 user，最终 Session 恰好有 5 条 user 与 5 条 assistant。

### 2. 快照必须隔离外部修改

TypeScript 的 `readonly` 只是编译期约束，外部仍可以通过类型断言修改数组。Session 因此在构造、追加和 `snapshot()` 时复制消息数组、消息对象以及嵌套的 `toolCalls`。测试会故意对快照执行 `push`，确认内部历史不变；两个 Session 分别追加消息后也互不可见。

这份复制只针对现有 `Message` 数据结构，不是通用深拷贝工具。稳定 `id` 用于标识当前进程中的会话，但今天不会把它写入数据库或文件。

### 3. REPL 只负责逐行交互

`runRepl` 接收可注入的 `input`、`output` 和 `runTurn`，内部使用 `node:readline/promises`。每行先 `trim`：

- `/exit`：结束循环；
- 空串：不调用模型，直接读下一行；
- 其他输入：等待 `runTurn(prompt)`，把返回答案写入输出。

无论正常退出还是抛出错误，`finally` 都会关闭 readline 接口。输入输出与执行函数都可替换，所以测试使用内存流和固定答案，不需要真实终端或真实模型。

### 4. 一次性提问与 REPL 共用一条数据路径

CLI 启动时创建一个带 system 消息的 Session。带参数时只调用一次 `runTurn`，保留 D006 的输出、事件日志、Provider 与密钥检查；不带参数时把同一个 `runTurn` 交给 REPL。两条路径都遵循“追加 user → 保存快照 → 运行 Loop → 追加新增消息”的协议，D006 的事件契约不变。

## 怎么复现这一天

```bash
git checkout D007
npm install

# 五轮完整历史、防御性快照、Session 隔离，共 3 个测试
npx vitest run test/session.test.ts

# 单轮、多轮与空行、首行退出，共 3 个测试
npx vitest run test/repl.test.ts

# D006 事件契约与原有 Loop 行为回归
npx vitest run test/events.test.ts test/loop.test.ts

# 完整校验：lint + typecheck + 8 个测试文件、44 个测试
npm run check
```

需要使用真实模型时，按现有 `.env.example` 配置你自己的环境，不要把真实 `.env` 提交到 Git。随后可复现两种 CLI 形态：

```bash
# 一次性提问：只运行一轮任务
npm run dev -- "用一句话介绍这个项目"

# 多轮 REPL：在同一进程里连续提问，最后退出
npm run dev
```

REPL 中可依次输入 `第一轮`、空行、`第二轮`、`/exit`，观察空行不产生模型调用，退出后不再处理后续输入。真实模型的回答不作为测试断言；五轮记忆由脚本化 Provider 确定性验证。

## 今天的边界

Session 只存在于当前进程，**进程退出即丢失**。本日不做磁盘持久化、跨进程恢复、数据库、Replay 或并发锁。历史会完整保留，尚未做字符或 token 预算、裁剪、摘要压缩与长期记忆；REPL 也只是逐行交互，不提供流式响应。
