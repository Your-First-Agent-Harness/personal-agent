# 安装与本地打包验证

本文面向第一次拿到仓库的开发者。以下命令以 macOS / Linux、Node.js 24 为准，不需要发布 npm 包，也不需要真实模型密钥即可完成安装与打包冒烟。

## 1. 准备 Node.js 24

从 Node.js 官网或你常用的版本管理器安装 Node.js 24，然后确认当前终端实际使用的版本：

```bash
node --version
npm --version
```

`node --version` 的主版本号应为 `24`。如果系统装有多个 Node.js 版本，先切换版本再执行后续命令；不要仅在 IDE 设置里修改解释器。

## 2. 克隆并安装依赖

```bash
git clone https://github.com/Your-First-Agent-Harness/personal-agent.git
cd personal-agent
git switch D024
npm ci
```

如果评审其他日分支，将 `D024` 换成对应分支名。`npm ci` 按 `package-lock.json` 安装，不更新锁文件；不要用 `npm install` 代替首次可复现安装。

## 3. 配置占位符

仓库提供 `.env.example`。复制为 `.env` 后再填写自己的值；`.env` 已被 Git 忽略，不要提交，也不要在日志或文档中打印真实密钥。

```bash
cp .env.example .env
```

最小配置格式如下，以下均为占位符，不是可用密钥或指定服务商：

```dotenv
PA_MODEL_API_KEY=sk-your-key-here
PA_MODEL_NAME=your-model-name
PA_MODEL_BASE_URL=https://your-openai-compatible-endpoint.example/v1
PA_LOG_LEVEL=info
```

只有真实调用 OpenAI 兼容模型时才需要有效密钥。安装、静态检查、测试、覆盖率及下文的 tarball 冒烟均不会请求模型服务。

## 4. 全量检查

```bash
npm run check
npm run test:coverage
```

`check` 依次执行 ESLint、TypeScript 类型检查和全部测试；覆盖率报告写入 `coverage/`。全局阈值为 statements `80`、functions `80`、lines `80`、branches `75`。进程测试会创建并清理临时子进程及数据库，SIGKILL 恢复测试应保留运行，不要为缩短时间跳过。

源码由 Node.js 24 直接运行。本地开发命令为：

```bash
npm run dev -- "你的任务"
```

只有执行这条真实 Agent 命令时才需要把第 3 节占位符替换为有效配置。

## 5. npm pack 与干净目录安装冒烟

`npm pack` 只在本机生成 tarball，不发布 npm，也不创建 GitHub release。下面把 tarball 和安装目录都放在新的临时目录中，避免复用仓库的 `node_modules` 或数据库。

```bash
SMOKE_ROOT="$(mktemp -d)"
npm pack --pack-destination "$SMOKE_ROOT"
mkdir "$SMOKE_ROOT/install"
npm install --prefix "$SMOKE_ROOT/install" \
  "$SMOKE_ROOT/personal-agent-0.1.0-dev.tgz"
```

如果版本号变化，先查看 `npm pack` 输出的实际文件名，再替换命令中的 `.tgz` 文件名。`npm install` 必须成功退出，且临时目录中应存在 `node_modules/personal-agent/package.json`。

当前 `0.1.0-dev` 是 `private` 的源码开发包，没有编译后的 `dist` 或 `exports`。Node.js 24 会拒绝剥离 `node_modules` 内 TypeScript 的类型（`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`），因此不要从这个 tarball 导入 `src/*.ts`，也不要把 `--experimental-transform-types` 当作绕过方案。可运行 Agent 的方式仍是第 4 节的仓库内 `npm ci` 与 `npm run dev`；公开可运行发布物不在本日范围内。

下面的冒烟只验证 tarball 已安装、包元数据可读取且原生 `node:sqlite` 可用，不宣称安装了可导入的 JavaScript 运行时：

```bash
(
  cd "$SMOKE_ROOT/install"
  node --input-type=module --eval '
    import { readFileSync } from "node:fs";
    import { DatabaseSync } from "node:sqlite";
    const manifest = JSON.parse(
      readFileSync("node_modules/personal-agent/package.json", "utf8"),
    );
    if (manifest.name !== "personal-agent" || manifest.version !== "0.1.0-dev") {
      throw new Error("tarball metadata smoke failed");
    }
    const database = new DatabaseSync(":memory:");
    try {
      if (database.prepare("SELECT 1 AS ok").get()?.ok !== 1) {
        throw new Error("node:sqlite smoke failed");
      }
      console.log("personal-agent tarball install/sqlite smoke: ok");
    } finally {
      database.close();
    }
  '
)
```

看到 `personal-agent tarball install/sqlite smoke: ok` 才表示上述安装、元数据与 SQLite 检查成功。该冒烟使用 `:memory:`，不会在工作目录留下 SQLite 文件。若失败，保留临时目录用于排查；排查结束后可删除整个 `$SMOKE_ROOT`。

## 6. 常见 `node:sqlite` 版本问题

### `No such built-in module: node:sqlite`

当前 Node.js 太旧，或终端仍指向旧版本。切换到 Node.js 24 后重新执行 `node --version` 和安装命令。

### 提示 SQLite 为实验功能，或旧版本需要实验开关

部分旧 Node.js 22 版本的 SQLite API 和默认开关状态不同。本项目统一以 Node.js 24 验证，不通过额外实验开关兼容旧运行时，也不需要安装名为 `sqlite`、`sqlite3` 或 `better-sqlite3` 的 npm 包。

### 在 tarball 冒烟中找不到包元数据

确认 `npm pack` 的 tarball 文件名与版本一致、`npm install` 成功退出，并确认最后的 `node` 命令是在 `$SMOKE_ROOT/install` 中执行。不要在仓库根目录读取元数据，否则不能证明检查的是干净安装目录中的 tarball 内容。

### 切换 Node.js 后仍失败

在新的干净终端重新执行 `npm ci`。若问题仍在，记录 `node --version`、`npm --version`、完整错误和所用分支；不要粘贴 `.env` 或真实 API Key。
