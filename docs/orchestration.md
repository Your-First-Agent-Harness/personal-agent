# Task Orchestration Baseline（D080）

D071–D079 建立了 PA 的任务编排基础：队列、后台 Runner、取消/暂停/恢复、子 Agent 契约、并行聚合、资源隔离、DAG 依赖、Run Store 和幂等保护。

## 可验证证据

- D071：任务状态从 queued 到 running/completed/failed。
- D072：Worker 成功和失败都能回写任务状态。
- D073：取消、暂停、恢复和完成的非法转换受阻断。
- D074–D076：子 Agent 有父任务、工具白名单、预算、深度和数量限制。
- D075：并行任务部分失败隔离。
- D077：DAG 循环依赖拒绝，ready 节点可计算。
- D078：Run Store 保存事件、结果和错误。
- D079：重复结果短路，unknown 副作用冻结。

## 边界

当前核心实现仍以进程内内存结构为主，尚未提供 SQLite 任务队列、跨进程 Worker、真实 SIGKILL 恢复或分布式锁。因此 D080 是编排组件基线，不宣称已经完成生产托管运行。

## 复现

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run demo:d079
```
