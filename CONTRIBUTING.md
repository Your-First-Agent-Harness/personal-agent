# 贡献与协作约定

## 分支模型

`main` 只做索引，**每天的内容是一个独立分支**。

| 分支 | 作用 |
|---|---|
| `main` | 索引页 + 已完成内容的集合；不直接写当天内容 |
| `D001`、`D002`… | 第 N 天的完整快照，三位补零，与任务卡 Dn 一一对应 |

分支名不带日期：日期已经在 commit 正文里，分支名只需要和任务卡对得上。

## 每天的开始

从**上一日分支**拉出，不要从 `main` 拉——保证历史线性、可逐日回溯。

```bash
git checkout D002        # 上一天
git checkout -b D003     # 今天
```

## 每天的结束

```bash
git add -A
git commit -m "feat(D003): 加一句你在做什么"
git push -u origin D003
```

然后在 `main` 上合并，并更新索引表：

```bash
git checkout main
git merge --no-ff D003
```

## 合并时 README 冲突怎么处理

三份 README 承担不同职责，天然会冲突：

- `main` 的 README = 分支索引
- 每日分支的 README = 当天教学内容

**冲突一律取 `main` 版本**，不要把当天内容合并进索引：

```bash
git checkout --ours README.md
git add README.md
git commit
```

不要用 `-X ours` 一把梭：它会静默丢弃其他文件的改动，只适合确认过"仅 README 冲突"的场合。

合并完成后，在 `main` 上做两件事，缺一不可：

1. 顶部进度行改成当天：`**进度**：D003 / D100 · 未发布`
2. 「每日分支索引」表格追加一行：`| [D003](../../tree/D003) | 日期 | 主题 | 当日产出 |`

```bash
git commit -am "docs: index D003"
git push origin main
```

索引里的日期用**计划日期**（任务卡上的日期），不是实际提交日期——这样和 100 天规划对得上。

## Commit 规范

```text
<type>(<scope>): <做了什么>

<为什么这么做，两三行>
```

- `type`：`feat` / `fix` / `docs` / `refactor` / `test` / `chore`
- `scope`：当日分支号（`D003`）或模块名（`runtime`、`tools`）
- 正文写**原因**，不复述改动内容——改动本身看 diff 就够了

## 文档分层

| 位置 | 写什么 | 不该写什么 |
|---|---|---|
| `main` 的 README | 索引、阅读方式、当前进度 | 任何一天的教学内容 |
| 每日分支的 README | 当天产出了什么、讲了什么、怎么复现 | 与其他天重复的背景介绍 |
| `docs/architecture.md` | 分层、依赖方向、关键链路 | 逐日进度 |
| `docs/adr/` | 不可逆决策：背景、选项、结论、后果 | 可以随时改的细节 |

判断标准：**同一句话如果会在两个地方出现，它只属于其中一个**。

## 外部贡献

单人项目阶段不强制 PR。外部贡献请：

1. 从 `main` 拉分支，命名 `feat/<简述>` 或 `fix/<简述>`；
2. 保持 commit 规范；
3. 提 PR 到 `main`，说明动机与验证方式。

每个 PR 都要能回答：**这个改动让哪个关卡更接近可验证？**
