# D081 · 统一 Trace/Span 模型

D081 增加进程内 Trace Recorder：每次任务运行可以创建根 span 和子 span，记录父子关系、开始/结束时间和结构化属性，为后续 Replay/Eval 提供统一事件边界。

## 产出

- `src/observability/trace.ts`：Trace/Span 记录器。
- `test/d081-trace.test.ts`：父子 span、时间、属性和未知 span 测试。
- `scripts/d081-trace.ts`：可复现验收脚本。

## 复现

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run demo:d081
```

## 边界

当前 Trace Recorder 仅驻留内存，不接入 OpenTelemetry、日志文件或远程 collector；时间戳用于组件级链路验证，不代表生产观测可靠性。
