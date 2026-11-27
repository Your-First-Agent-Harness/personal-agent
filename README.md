# D083 · Replay 执行器

D083 增加确定性 Replay 执行器，按 Trace 输入顺序逐步调用注入的执行函数，返回每一步输出；执行器异常原样暴露，不把失败伪装成成功。

## 产出

- `src/observability/replay.ts`：ReplayStep、ReplayResult 和顺序执行器。
- `test/d083-replay.test.ts`：正常回放和执行失败测试。
- `scripts/d083-replay.ts`：可复现验收脚本。

## 复现

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run demo:d083
```

## 边界

当前 Replay 只执行注入的确定性回调，不重建真实模型上下文、不调用在线服务，也不声称能够复现真实模型随机性。
