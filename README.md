# D089 · 权限审批 CLI 与敏感工具确认

D089 增加一次性 tool call 审批记录和 CLI：按调用 id、工具名记录 `approved` 或 `denied` 决策，为现有 ToolRegistry 的敏感工具确认回调提供产品化入口。

## 命令

```bash
node dist/cli/main.js approval approve call-1 write_file
node dist/cli/main.js approval deny call-2 run_command
node dist/cli/main.js approval list
```

## 复现

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run demo:d089
```

## 边界

当前审批存储在进程内，CLI 每次启动是新进程；它不自动放行工具、不跨进程持久化，也不替代真实用户确认界面。D090 再处理多租户和数据保留边界。
