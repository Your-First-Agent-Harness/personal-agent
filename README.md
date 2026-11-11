# D009 · AbortSignal 与模型超时

## 今天要做出的东西

- `ChatRequest`、`AgentLoopOptions` 与 `ToolContext` 接收同一个可选 `AbortSignal`，取消信号穿过 Loop、Provider 和工具注册表。
- OpenAI-compatible Provider 用 `AbortSignal.any` 组合外部信号与内部超时（默认 60 秒，可由 `timeoutMs` 覆盖）。外部取消抛出 `ModelCancelledError`；内部超时仍是带原始原因的 `ModelError`，HTTP 与协议错误语义不变。
- Loop 在进入循环前、每轮模型调用前和每个工具执行前检查取消；等待模型时只把 `ModelCancelledError` 转为正常取消出口，其他错误继续抛出。
- 取消结果为 `stopReason: 'cancelled'`、`text: ''`，保留已经产生的完整消息、累计 usage 和当前轮次，并在返回前发出 `run_cancelled`。Logger 将该事件记录为 `loop.cancelled`。
- CLI 注册一次 `SIGINT`：按下 Ctrl+C 会取消当前任务并输出 `任务已取消。`；正常完成和达到最大轮次的输出保持不变。

## 怎么复现这一天

```bash
git switch D009
npm install

# 预先取消、模型等待中取消、工具执行前取消、signal 传递与取消日志
npx vitest run test/cancellation.test.ts

# 外部取消与内部超时，以及既有 HTTP/协议行为
npx vitest run test/openai-compatible.test.ts

# 完整校验：lint + typecheck + 全部自动化测试
npm run check
```

测试全部使用脚本化 Provider 或本地假 `fetch`，不需要真实模型或密钥。配置好既有模型环境后，也可运行 `npm run dev -- "继续完成这个任务"`，在等待期间按一次 Ctrl+C 观察取消输出。

## 今天的边界

本日是**协作式取消**，不是对任意同步代码的强中断。同步文件工具只能在模型调用、工具调用等操作边界响应取消，无法中途打断已经开始的同步文件读写。命令子进程的终止不在本日范围内，留到 D013 的 `run_command` 实现；本日也不引入流式响应、断点续跑或持久化恢复。
