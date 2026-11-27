# Deployment and Runtime Diagnostics

## 本地运行

```bash
npm ci
npm run build
node dist/cli/main.js config show
node dist/cli/main.js tools list
```

## 配置

- `agent.config.json` 提供默认配置。
- `PA_*` 环境变量覆盖文件配置。
- `PA_MODEL_API_KEY` 只通过环境变量读取，`config show` 输出会脱敏。

## 诊断

```bash
npm run demo:d093
```

健康报告的 `status=ok` 只表示本进程内配置、队列和 Trace 基础检查通过；`degraded` 表示至少一个检查失败，不能等同于外部依赖全部不可用。

## 生产边界

当前发行版的任务队列、审批、Trace Store 和租户 Store 默认是进程内实现。生产部署前需要替换为持久化存储、进程间锁、日志/指标采集和真实身份认证，并为数据保留策略配置外部调度器。
