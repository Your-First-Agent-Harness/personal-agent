# D013 · run_command、取消与有界输出

## 今天要做出的东西

- 新增 `run_command`，在 `workspaceRoot` 通过系统 shell 执行一条命令，并分别捕获 stdout、stderr 和退出码。
- `timeoutMs` 默认 10000ms，只接受 1–30000 的整数；超时和 D009 的 `AbortSignal` 都会向子进程发送 SIGTERM。
- stdout 与 stderr 各自最多保留 8000 个原始字符，超出后添加明确截断标记，两个通道互不影响。
- 非零退出、超时、取消和 spawn error 都返回 `isError: true` 的工具结果，供模型在后续轮次修正，不伪装成模型故障。
- `src/tools/builtin.ts` 在内置工具末尾稳定追加 `run_command`，既有顺序不变。

## 参数与返回值

```json
{
  "command": "npm run check",
  "timeoutMs": 30000
}
```

`command` 是必填非空字符串；`timeoutMs` 可省略。工具的 `content` 是 JSON 字符串，包含：

```json
{
  "command": "npm run check",
  "exitCode": 0,
  "timedOut": false,
  "cancelled": false,
  "stdout": "检查输出",
  "stderr": "",
  "stdoutTruncated": false,
  "stderrTruncated": false
}
```

命令以 `close` 事件作为收尾。timer 和 abort listener 在 settle 前清理，后续的 `error` 或 `close` 不会重复完成同一个结果。被信号终止或 spawn 失败时，`exitCode` 可以为 `null`。

## 失败输出怎么回喂模型

`npm run check` 一类命令可能依次暴露 lint、typecheck 或测试失败。非零退出不会让 Loop 中断：`ToolRegistry` 保留 `isError`，Loop 把 JSON `content` 作为对应 `toolCallId` 的 `role: "tool"` 消息追加到历史，下一次 Provider 请求即可看到失败输出并决定如何修复。

下面用确定性的 Node 子进程模拟一次检查失败，不调用真实模型。它打印错误标记以及脚本化的下一轮请求最后一条消息：

```bash
node --input-type=module <<'NODE'
import { runCommandTool } from './src/tools/run-command.ts';

const command = `${JSON.stringify(process.execPath)} -e "process.stderr.write('check failed: expected 2, received 1');process.exit(1)"`;
const result = await runCommandTool.execute(
  { command },
  { workspaceRoot: process.cwd() },
);
const nextRequestMessages = [
  { role: 'user', content: '运行检查并修复问题' },
  {
    role: 'assistant',
    content: '',
    toolCalls: [{ id: 'check-1', name: 'run_command', arguments: JSON.stringify({ command }) }],
  },
  {
    role: 'tool',
    toolCallId: 'check-1',
    name: 'run_command',
    content: result.content,
  },
];
console.log(JSON.stringify({
  isError: result.isError,
  nextToolMessage: nextRequestMessages.at(-1),
}, null, 2));
NODE
```

输出中的 `isError` 为 `true`，`nextToolMessage.content` 内包含 `exitCode: 1`、`stderr: "check failed: expected 2, received 1"`，同时 `timedOut` 和 `cancelled` 都是 `false`。把 `command` 换成 `npm run check` 时也走同一条回喂路径；真实检查输出是什么就回传什么，不需要在 CI 中准备模型或密钥。

## 超时、取消和截断

- **超时**：到达 `timeoutMs` 后设置 `timedOut: true`，发送 SIGTERM，等待子进程关闭后返回 `isError` 结果。
- **外部取消**：`context.signal` 触发后设置 `cancelled: true` 并终止子进程；预先取消也会响应，不误报为超时。
- **输出上限**：9000 个 stdout 字符只保留前 8000 个并追加 `…[stdout 已截断]`；stderr 使用独立计数和 `…[stderr 已截断]` 标记。
- **参数错误**：空 `command`、非整数或越界的 `timeoutMs` 直接给出明确参数错误，不启动子进程。

## 怎么复现

```bash
git switch D013
npm install
npx vitest run test/run-command.test.ts
```

只复现某个教学示例：

```bash
npx vitest run test/run-command.test.ts -t "成功命令"
npx vitest run test/run-command.test.ts -t "非零退出"
npx vitest run test/run-command.test.ts -t "超时终止"
npx vitest run test/run-command.test.ts -t "stdout"
npx vitest run test/run-command.test.ts -t "stderr"
npx vitest run test/run-command.test.ts -t "工作区根目录"
npx vitest run test/run-command.test.ts -t "AbortSignal"
npx vitest run test/run-command.test.ts -t "spawn error"
```

所有命令测试只用 `JSON.stringify(process.execPath)` 定位当前 Node，不依赖第三方命令。工作区和 PID 文件都位于临时目录，`afterEach` 清理；超时与取消用例还检查子进程已退出。

完整验证：

```bash
npm run check
npm run test:coverage
```

## 今天的边界

run_command 不是安全沙箱；命令白名单、环境清理、资源限制和进程隔离尚未实现。

本日也不实现 D014 的结构化错误、完整 JSON Schema 校验或连续工具错误保险丝。只执行明确可信的命令；测试和示例不需要真实 `.env`。
