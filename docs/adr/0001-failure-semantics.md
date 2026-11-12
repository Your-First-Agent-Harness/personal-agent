# ADR-001：失败语义边界——工具结果、模型故障与外部取消

- **状态**：Accepted
- **日期**：2026-11-27
- **决策者**：Stark

## 背景

Agent Loop 同时面对三类容易混淆的失败：工具执行失败、Provider 调用失败，以及调用方主动取消。如果把它们都变成字符串或都抛异常，调用方将无法判断任务是否完成、能否恢复，以及是否应该重试。

D009 已建立模型超时与协作式取消，D014 已建立标准工具错误和连续错误保险丝，D016 已验证非法参数能够回喂并恢复。D017 的失败路径矩阵进一步检查这些机制穿过真实 Loop 后是否仍保持边界，并发现：工具执行期间发生外部取消时，如果连续错误上限为 1，`COMMAND_CANCELLED` 会先触发 `tool_errors`，覆盖真正的取消原因。

本决策固定这些语义，避免后续增加重试、并行工具或更多 Provider 时重新混淆它们。

## 决策

### 1. 工具失败是可回喂的领域结果

工具查无名称、参数解析或校验失败、预期文件/命令失败，以及工具抛出的异常，由 `ToolRegistry` 转换为 `ToolResult`：

- `content` 是模型可读的反馈，Loop 以 `role: "tool"` 消息回喂；
- `isError: true` 供 Loop 统计连续错误；
- `error.code/message/retryable/hint` 是 Harness 内部的结构化详情，不直接序列化进 Provider 消息；
- 已知 `ToolError` 保留结构化详情，未知异常统一脱敏为 `INTERNAL_ERROR`，不回喂原始异常正文或堆栈。

未达到连续错误上限时，工具失败不抛穿 Loop，模型可在下一轮修正。达到上限时，Loop 以 `stopReason: "tool_errors"` 正常返回，而不是抛出工具异常。

### 2. Provider 故障不是工具结果

HTTP 非成功状态、响应 JSON 或协议结构不合法、网络请求异常和 Provider 内部超时，保持 `ModelError` 拒绝语义。HTTP 故障保留 `status`；内部超时的 `cause` 保留底层取消原因。

Loop 不把这些错误改写成 `role: "tool"`，不返回 `completed`、`tool_errors` 或 `cancelled` 来掩盖故障。是否重试由上层依据错误类型与状态另行决定，本 ADR 不引入自动重试。

### 3. 外部取消是独立的正常终止原因

调用方通过 `AbortSignal` 表示外部取消。Provider 将请求期间的外部取消归一为 `ModelCancelledError`，Loop 将其转换为 `stopReason: "cancelled"` 的正常结果，并发出 `run_cancelled`。

工具执行期间也要服从外部取消。Loop 在保存该工具的诊断结果后、更新连续错误计数和检查保险丝前，再次检查 `signal.aborted`。因此即使工具返回 `COMMAND_CANCELLED` 且连续错误上限为 1，整个 run 仍以 `cancelled` 停止。

`COMMAND_CANCELLED` 可以保留在单次工具结果中说明命令发生了什么，但它不拥有整个 run 的终止原因；外部取消优先于工具错误保险丝。

## 后果

**正面**

- 调用方能稳定地区分可恢复工具反馈、连续错误未收敛、Provider 故障和用户取消。
- Provider 重试策略不会误把工具业务错误当成 HTTP 故障，也不会把用户取消当成可重试超时。
- 文件与命令错误既有机器可读 code，也有模型可读反馈；未知异常不会把原始堆栈或伪造敏感值送入后续 Provider 请求。
- D017 矩阵为这些边界提供可执行证据，取消优先级的真实缺陷已有最小回归测试。

**负面与约束**

- Loop 的工具执行点需要保留取消检查；未来并行化工具时也必须先汇总诊断，再保证外部取消优先级。
- `ModelError` 会继续抛给上层，因此 CLI、服务端或队列消费者必须各自决定展示与重试策略。
- 脱敏承诺仅针对未知工具异常的标准化；已知 `ToolError` 的 message/hint 和命令 stdout/stderr 是明确返回的数据通道，本决策不声称对所有用户内容或命令输出做通用敏感信息清洗。
- 矩阵使用 mock fetch、脚本化 Provider 和本地进程，不证明任何公网 Provider 的可用性，也不新增真实模型重试验证。
