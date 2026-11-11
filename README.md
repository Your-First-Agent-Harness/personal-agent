# D010 · 覆盖率关卡与周复盘

## 今天要做出的东西

- 用与 Vitest 5 匹配的 `@vitest/coverage-v8` 生成 V8 覆盖率报告，新增 `npm run test:coverage`。
- 统计 `src/**/*.ts`，只排除 CLI 入口 `src/cli/main.ts`；`src/runtime`、`src/context` 等核心目录不能被排除。
- 把 statements / lines / functions / branches 的最低阈值设为 **80 / 80 / 80 / 75**，低于任一阈值命令就失败。
- CI 保留 lint 和 typecheck，最后的测试步骤与本地一样执行 `npm run test:coverage`。
- 根据报告补核心可观察行为测试：非法配置形状、Session 嵌套 `toolCalls` 深复制、极小上下文预算、取消检查点和非取消异常、Logger 的 error 分支。已有 REPL 空输入/退出、system 超限、工具组截断及事件映射测试不重复添加。

## 怎么运行和阅读报告

```bash
git switch D010
npm install
npm run test:coverage
```

终端会输出文本表格，同时生成 `coverage/index.html`。`coverage/` 已被 Git 忽略，生成的报告不应提交。

| 指标 | 含义 | 最低阈值 |
|---|---|---|
| statements | 已执行的语句比例；一行可能包含多条语句 | 80% |
| lines | 至少执行过一次的源码行比例 | 80% |
| functions | 至少被调用过一次的函数比例 | 80% |
| branches | `if`、条件表达式等分支中实际走过的路径比例 | 75% |

表格中的 `Uncovered Line #s` 用来定位缺口，但补测试前要判断它是否对应规格中的可观察行为。覆盖率是回归下限，不是正确性的充分证明；不为凑数字测试 trivial getter，也不通过降低阈值或排除核心源码过关。

完整检查仍然是：

```bash
npm run check
npm run test:coverage
```

所有测试都使用脚本化 Provider 或本地假实现，不需要真实模型、密钥或 `.env`。

## 今天的边界

- **字符预算不等于 token。** D008 的上下文限制是字符级近似，不是精确 tokenizer 或模型计费口径。
- **内存 Session 不持久化。** D007 的历史随进程结束而消失，不支持跨进程恢复。
- **同步工具不能中途取消。** D009 只能在操作边界协作式响应取消，无法强断已经开始的同步文件读写；命令子进程终止属于 D013。

本周重排原因、D006–D010 的每日验证命令和后续入口见 [`docs/weekly/2026-w47.md`](docs/weekly/2026-w47.md)。D011 的 `write_file` 不在本日提前实现。
