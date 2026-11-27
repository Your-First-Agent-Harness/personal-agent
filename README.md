# D086 · CLI 任务提交与状态查询

D086 为产品化阶段增加最小 CLI 任务入口：任务可以通过 `create` 写入本地任务存储，通过 `status` 查询，通过 `list` 查看全部排队任务。

## 命令

```bash
npm run build
PA_TASK_STORE=/tmp/pa-tasks.json node dist/cli/main.js task create task-1 '{"kind":"demo"}'
PA_TASK_STORE=/tmp/pa-tasks.json node dist/cli/main.js task status task-1
PA_TASK_STORE=/tmp/pa-tasks.json node dist/cli/main.js task list
```

也可以运行确定性 Demo：

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run demo:d086
```

## 边界

D086 的 CLI 只负责本地 JSON 任务提交和查询，不执行 Worker、不提供跨进程锁，也不宣称是生产持久化队列；任务执行由后续版本接入。
