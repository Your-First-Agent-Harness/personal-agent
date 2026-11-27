# D088 · 工具注册与能力清单 CLI

D088 增加 `tools list` CLI，复用 `ToolRegistry.discover()` 展示当前内置工具的名称、版本、描述和完整 JSON Schema 元数据。

## 命令

```bash
node dist/cli/main.js tools list
node dist/cli/main.js tools list --json
```

## 复现

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run demo:d088
```

## 边界

D088 只提供能力发现，不动态安装插件、不执行工具、不修改注册表；插件生命周期和权限审批留待后续产品化任务。
