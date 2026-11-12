# D025：打包 v0.1.0，完成 G1 安装级验收

计划日期：2026-12-05
基线：D024 `483b48c`
任务卡：D25「打包 v0.1.0」——陌生人装包后，能跑通真实 read → edit → run_command 三工具 Demo。

> 结论：D024 的“源码 tarball 只能检查元数据”不再是终点。D025 输出编译后的原生 ESM 包，并实际完成 `npm pack` → 全新 `/tmp` 目录离线安装 → 从安装目录执行 bin → 读取、修改、测试及最终文件断言。

## 1. 发布阻断与 TDD RED

D024 包没有 bin，仍把 `src/**/*.ts` 作为运行入口。D025 开始前先原样执行其 tarball：

```bash
npm pack --pack-destination /tmp/personal-agent-d025-red
npm install --prefix /tmp/personal-agent-d025-red/install \
  /tmp/personal-agent-d025-red/personal-agent-0.1.0-dev.tgz
node /tmp/personal-agent-d025-red/install/node_modules/personal-agent/src/cli/main.ts "offline red"
```

安装可以完成，但 CLI 在业务逻辑前失败：

```text
node:internal/modules/typescript:70
throw new ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING(...)
Error [ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING]: Stripping types is currently
unsupported for files under node_modules, for "package/src/cli/main.ts"
```

随后先写两项自动化验收并观察失败：

1. `test/d025-offline-demo.test.ts` 要求无 API Key 的 `demo --json` 返回真实工具证据；RED 时旧 CLI 把 `demo` 当模型任务并以状态 `1` 退出。
2. `test/d025-package.test.ts` 要求独立安装验收脚本成功；RED 时脚本不存在，退出状态为 `1`。

只有这两个行为测试失败后，才开始生产改动。公开版本常量的测试也先观察到 `undefined ≠ 0.1.0`，再补实现。

## 2. 最小构建与打包方案

`tsconfig.build.json` 继承开发配置，只增加发布所需选项：

- `rootDir: src`、`outDir: dist`，输出原生 ESM JavaScript 和 `.d.ts`；
- `rewriteRelativeImportExtensions: true`，把 dist 内的相对 `.ts` 导入重写为 `.js`；
- 保持零运行时依赖、Node 24、ESM；没有 tsx、ts-node、bundler 或运行时 transpiler；
- 开发测试仍直接导入 `src/**/*.ts`，开发 typecheck 配置不改。

包配置：

| 项目 | v0.1.0 |
|---|---|
| 版本 | `0.1.0`；npm 仍为 `private`，不发布 registry |
| bin | `personal-agent` → `dist/cli/main.js` |
| exports | 根入口、`personal-agent/demo`、`package.json`，附类型声明 |
| scripts | `build`、`demo:g1`、`test:acceptance`、`prepack` |
| Node | `>=24` |
| 运行时依赖 | 无 |

`prepack` 自动构建，避免旧 dist 混入 tarball。

## 3. 包内容

允许进入 tarball：

- `dist/**/*.js` 与 `dist/**/*.d.ts`；
- `package.json`、README、LICENSE；
- `docs/install.md`、`docs/releases/v0.1.0.md`。

明确排除：`src`、`test`、`scripts`、`coverage`、`.env*`、SQLite/运行数据、仓库 dev `node_modules`、tarball 和临时目录。安装验收脚本会在安装后逐项检查这些边界，并通过根 exports 导入 `VERSION`、`ToolRegistry` 和五个内置工具。

## 4. G1 Demo 不是 mock 工具结果

入口：

```bash
personal-agent demo
# 或需要自动化断言时
personal-agent demo --json
```

模型侧是清楚标注的 `deterministic-offline-script`：固定发出四个工具调用，再给出最终文本，不请求网络，也不需要 API Key。工具侧没有替身：

1. 在 `/tmp/personal-agent-g1-demo-*` 写入有缺陷的真实 `math.js` 和 `math.test.js`；
2. Agent Loop 经 ToolRegistry 调用 `read_file`，读取磁盘源码；
3. `run_command` 通过 `/bin/sh -c` 执行真实 `node --test math.test.js`，得到 `exitCode=1`；
4. `edit_file` 校验 oldText 唯一，把 `return left - right;` 改成 `return left + right;`，返回真实 unified diff；
5. 第二次 `run_command` 得到 `exitCode=0`；
6. 从磁盘重新读取最终 `math.js`，断言内容、工具顺序、Loop `completed/5 turns`，最后删除临时工作区。

测试还使用不存在的 Node 命令走真实失败路径，证明不符合“先红后绿”的证据会抛错，而不会打印成功。

## 5. 陌生人安装验收

```bash
RELEASE_DIR="$(mktemp -d /tmp/personal-agent-v010.XXXXXX)"
npm pack --pack-destination "$RELEASE_DIR"
npm install --offline --ignore-scripts \
  --prefix "$RELEASE_DIR/install" \
  "$RELEASE_DIR/personal-agent-0.1.0.tgz"
(cd "$RELEASE_DIR/install" && ./node_modules/.bin/personal-agent demo)
```

成功输出包含修复前失败、修复后通过、真实 diff、最终加法源码，以及：

```text
G1 Demo PASS：真实 read_file → edit_file → run_command 工具链完成；临时工作区已清理。
```

完整教学见 [docs/install.md](docs/install.md)。真实模型调用才需要用户自己的 OpenAI 兼容 baseUrl、API Key 和模型名；离线 Demo 不需要。

## 6. 可重复自动化证据

```bash
npm run test:acceptance
```

`scripts/verify-g1-install.ts` 独立执行完整流程，不使用仓库源码或仓库 `node_modules` 来冒充安装后的运行：

1. `npm pack`，由 prepack 构建 dist；
2. 在新的 `/tmp` 目录 `npm install --offline --ignore-scripts <tarball>`；
3. 检查版本、零运行时依赖、dist 入口和排除内容；
4. 从安装目录解析根 package exports 并注册五个真实工具；
5. 从安装目录执行 `.bin/personal-agent demo --json`；
6. 验证四个工具结果、前后退出码、最终文件与工作区清理；
7. 打印 `G1_INSTALL_ACCEPTANCE_PASS`，并在 `finally` 删除安装临时目录。

该脚本本身也由 `test/d025-package.test.ts` 在全量测试中实际执行，不是只写在文档里的命令。

## 7. 测试与覆盖率

本分支实际执行：

| 命令 | 结果 |
|---|---|
| `npm run check` | ESLint、typecheck、30 个测试文件 / 234 项测试通过 |
| `npm run test:coverage` | 全部通过，阈值未降低 |
| `npm run build` | dist ESM 与声明文件生成成功 |
| `npm run test:acceptance` | 全新目录离线安装及安装后 bin Demo 通过 |

全库覆盖率（语句 / 分支 / 函数 / 行）：

```text
94.36% / 89.75% / 98.79% / 95.13%
全局阈值：88 / 88 / 90 / 88（未修改）
```

新生产文件复审：

| 文件 | 语句 | 分支 | 函数 | 行 |
|---|---:|---:|---:|---:|
| `src/demo/g1.ts` | 98.03% | 75% | 100% | 100% |
| `src/index.ts` | 100% | 100% | 100% | 100% |

`src/cli/main.ts` 沿用现有 coverage exclude；其 Demo 行为由子进程安装级与源码级测试验证，而非借排除规避三工具核心覆盖率。

## 8. Release Note 与录屏真实状态

- 可直接用于 GitHub Release 的说明：[docs/releases/v0.1.0.md](docs/releases/v0.1.0.md)。
- 变更索引：[CHANGELOG.md](CHANGELOG.md)。
- 本机检查发现 `/usr/bin/script`，没有 asciinema；因此保存的是[真实终端输出](docs/demos/v0.1.0-terminal.log)，不是 `.cast` 或视频。
- **本日未制作视频**，没有 mp4、截图、观看量或外部视频链接。终端记录来自已安装 tarball 的 bin，可用上述命令复现。

## 9. 限制与发布边界

- 离线 Demo 证明 Loop、工具与发布包可运行，不证明外部模型质量。
- 普通 CLI 仅适配 OpenAI 兼容协议，真实调用需要用户自配服务与密钥。
- 第一周版本不包含 MCP，不提供进程恢复、托管运行等后续能力的发布级支持。
- D025 不合并 main、不提前创建 tag 或 GitHub Release。主代理合并后需从 main 重新验收、pack，创建 `v0.1.0` tag，再用 `gh` 把 tarball 和 Release Note 发布。
