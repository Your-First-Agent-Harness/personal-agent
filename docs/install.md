# personal-agent v0.1.0 安装与验收

本指南面向第一次拿到仓库或 GitHub Release tarball 的用户。v0.1.0 的可安装能力包括 CLI、五个内置工具，以及无需 API Key 的真实三工具离线 Demo。

## 1. 准备 Node.js

要求 Node.js 24 或更新版本；开发验收使用 Node.js `24.19.0`、npm `11.17.0`。

```bash
node --version
npm --version
```

发布包运行时是编译后的原生 ESM JavaScript，不需要 tsx、ts-node、TypeScript 或任何运行时 npm 依赖。TypeScript、Vitest 等仅在从源码开发时由 `npm ci` 安装为 devDependencies。

## 2. 从源码做开发验证

```bash
git clone https://github.com/Your-First-Agent-Harness/personal-agent.git
cd personal-agent
npm ci
npm run check
npm run test:coverage
npm run build
npm run demo:g1
```

`npm run check` 包含 ESLint、TypeScript typecheck 和全量测试。全量测试中的 D025 用例还会实际执行一次 `npm pack`、在 `/tmp` 新建目录安装 tarball，并从安装目录调用 bin。

`npm run demo:g1` 执行的是构建后的 `dist/cli/main.js`。它不需要 `.env`、模型密钥或网络。

## 3. 生成可安装 tarball

在仓库根目录执行：

```bash
RELEASE_DIR="$(mktemp -d /tmp/personal-agent-v010.XXXXXX)"
npm pack --pack-destination "$RELEASE_DIR"
```

`prepack` 会自动运行 `npm run build`，所以包内使用的是最新 `dist`。生成文件为：

```text
personal-agent-0.1.0.tgz
```

包保持 `private: true`，不会因此被发布到 npm；该 tarball 用于 GitHub Release 和本地干净安装。

## 4. 在全新目录安装并运行 G1 Demo

继续使用上面的 `RELEASE_DIR`：

```bash
npm install --offline --ignore-scripts \
  --prefix "$RELEASE_DIR/install" \
  "$RELEASE_DIR/personal-agent-0.1.0.tgz"

(cd "$RELEASE_DIR/install" && ./node_modules/.bin/personal-agent demo)
```

这里安装的是 tarball，不是仓库目录；CLI 也不是用仓库 `node_modules` 或 `src` 启动。`--offline` 与 `--ignore-scripts` 进一步证明安装和 Demo 不依赖联网或安装脚本。

Demo 使用**确定性离线脚本 ModelProvider**，不是实际 AI 模型响应；但下列操作全部通过真实 `ToolRegistry`、Agent Loop 和内置工具完成：

1. `read_file` 读取临时工作区里有缺陷的 `math.js`；
2. `run_command` 执行 `node --test math.test.js`，确认退出码为 `1`；
3. `edit_file` 把 `left - right` 精确改为 `left + right`，输出真实 diff；
4. 再次 `run_command`，确认测试退出码为 `0`；
5. 重新读取最终文件，断言加法修复存在、临时目录已清理。

机器可读输出可用于自动化验收：

```bash
(cd "$RELEASE_DIR/install" && ./node_modules/.bin/personal-agent demo --json)
```

关键字段应为：

```json
{
  "provider": "deterministic-offline-script",
  "beforeExitCode": 1,
  "afterExitCode": 0,
  "stopReason": "completed",
  "turns": 5,
  "workspaceRemoved": true
}
```

如需删除本次安装，确认变量指向刚创建的 `/tmp/personal-agent-v010.*` 目录后，可执行 `rm -rf "$RELEASE_DIR"`。

## 5. 一条命令重复完整安装验收

源码仓库中提供同一流程的可重复脚本：

```bash
npm run test:acceptance
```

脚本自动完成构建、打包、全新 `/tmp` 目录离线安装、包内容检查、公开 ESM 导出导入、安装后 bin 的 G1 Demo，以及最终文件和退出码断言。成功标志：

```text
G1_INSTALL_ACCEPTANCE_PASS
```

脚本在 `finally` 中删除自己的临时目录，不会把 tarball 留在仓库。

## 6. 可选：调用真实模型

只有普通 CLI 的真实模型调用才需要用户自己的 OpenAI 兼容服务配置。G1 Demo 不读取也不使用这些值。

从安装目录运行普通 CLI 前，在 shell 中导出配置：

```bash
export PA_MODEL_BASE_URL="https://your-provider.example/v1"
export PA_MODEL_API_KEY="your-own-key"
export PA_MODEL_NAME="your-model-name"
export PA_WORKSPACE="/absolute/path/to/your/workspace"

(cd "$RELEASE_DIR/install" && ./node_modules/.bin/personal-agent "读取项目结构并说明入口")
```

源码开发也可用 `.env` 配置后执行 `npm run dev -- "你的任务"`；`.env` 被 Git 与 npm 包排除。安装后的 bin 不自动加载 `.env`，因此应像上面一样显式导出环境变量。真实模型调用是否可复现取决于用户服务、密钥额度和模型行为，不属于离线 G1 Demo 的承诺。

## 7. 包内容与边界

tarball 包含 `dist` 的 `.js` 与 `.d.ts`、CLI bin、类型化 exports、README、LICENSE、本安装指南和 v0.1.0 Release Note。`src`、`test`、`scripts`、`coverage`、`.env*`、运行数据、仓库 dev 的 `node_modules` 与临时 tarball 均不进入包。

v0.1.0 是第一周 G1 版本：不包含 MCP，不提供进程恢复、托管运行等后续能力的发布级支持。普通 CLI 仅适配 OpenAI 兼容协议。

如果看到 `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`，说明误运行了旧的 `0.1.0-dev` 源码 tarball 或 `node_modules` 中的 `.ts` 文件。请改用本页的 v0.1.0 tarball 和 `.bin/personal-agent`，其入口为 `dist/cli/main.js`。

## 8. Demo 记录状态

本日未制作 mp4 或其他视频，本机没有可用的 asciinema，因此没有 `.cast` 或虚构的视频链接。仓库保存的是从已安装 bin 录下的[真实终端输出](../docs/demos/v0.1.0-terminal.log)，不是视频；上面的命令可完整复现。
