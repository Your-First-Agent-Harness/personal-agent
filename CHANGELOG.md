# Changelog

本项目的重要变更记录于此。

## [0.3.0] - 2027-01-12

### Added

- G3 上下文工程、记忆分层、长任务状态、恢复、成本和 Benchmark 能力。
- G3 组件级综合验收与 v0.3.0 发布说明。

### Verified

- 81 个测试文件、576 项测试通过。
- lint、typecheck、build 和 D069 G3 acceptance 全部通过。

### Notes

- 真实模型长任务成功率和成本下降 40% 尚未有外部证据，不在本版本中宣称完成。

## [0.2.0] - 2026-12-30

### Added

- D050 G2 联合验收：动态工具检索、Open-Meteo 外部 API、MCP local/MCP 双后端。
- `tools_retrieved` 检索审计事件与稳定匹配分数。
- `npm run demo:d050` 和 `docs/releases/v0.2.0.md`。

### Verified

- 62 个测试文件、537 项测试通过。
- lint、typecheck、build 和 D050 G2 acceptance 全部通过。

### Notes

- v0.2.0 仍不包含 G3 的 100 轮长任务、成本目标，也不包含 G4 的 trace/replay/eval CI 关卡。

## [0.1.0] - 2026-12-05

### Added

- 新增 `personal-agent demo` 与 `demo --json`：确定性离线 ModelProvider 驱动真实 `read_file`、`edit_file`、`run_command`，完成修复前失败、精确编辑、修复后通过及最终文件断言。
- 新增可重复安装验收 `npm run test:acceptance`，在全新 `/tmp` 目录完成 tarball 离线安装、公开导入与安装后 bin 的 G1 Demo。
- 新增 `tsconfig.build.json`，使用 TypeScript 原生 ESM 构建和 `rewriteRelativeImportExtensions` 输出 `.js` 与 `.d.ts`。
- 增加包入口 `VERSION`、Agent Loop、ToolRegistry、内置工具和离线 Demo 的类型化 exports。
- 增加完整安装教学、真实终端输出和本 Release Note。

### Changed

- 版本从 `0.1.0-dev` 改为 `0.1.0`；包继续标记为 npm `private`，发布载体为 GitHub Release tarball。
- npm `bin` 指向 `dist/cli/main.js`，`files` 仅允许构建产物与发布文档，排除源码测试、覆盖率、密钥和运行数据。
- 普通 CLI 行为保持兼容；只有首个参数为 `demo` 时进入无需密钥的离线路径。

### Fixed

- 修复 D024 源码 tarball 的发布阻断：Node 24 不再需要在 `node_modules` 中剥离 TypeScript，避免 `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`。

### Verified

- 30 个测试文件、234 项测试通过。
- 全库覆盖率：语句 `94.36%`、分支 `89.75%`、函数 `98.79%`、行 `95.13%`，全局阈值未降低。
- 新增 `src/demo/g1.ts` 达到 `98.03/75/100/100`，`src/index.ts` 四项均为 `100%`。
- 实际通过构建、打包、干净离线安装、安装目录 bin Demo 与最终文件检查。

### Notes

- 真实模型调用仍需用户自配 OpenAI 兼容服务和 API Key；离线 Demo 不请求网络。
- 本版本不包含 MCP，不提供进程恢复、托管运行等后续能力的发布级支持。
- 本日未制作视频，仅保存真实终端输出和可复现 Demo。
