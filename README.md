# D087 · 配置文件与环境变量覆盖

D087 增加 `config show` CLI：读取 `agent.config.json`，应用已有的 `PA_*` 环境变量覆盖，并在展示配置时脱敏模型 API key。

## 命令

```bash
node dist/cli/main.js config show
node dist/cli/main.js config show --json
```

配置优先级：环境变量 > `agent.config.json` > 默认值。API key 只显示 `[REDACTED]`，不会写入 CLI 输出。

## 复现

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run demo:d087
```

## 边界

D087 只提供配置读取、校验和安全展示，不修改配置文件、不管理密钥、不连接远程配置中心。
