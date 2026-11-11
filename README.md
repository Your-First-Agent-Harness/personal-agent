# D011 · 带保护的 write_file

## 今天要做出的东西

- 新增 `write_file`，让模型在工作区内创建文本文件，成功后返回输入路径和 JavaScript 字符数（`content.length`，不是 UTF-8 字节数）。
- 默认禁止覆盖已有文件；只有显式传入 `overwrite: true` 才替换内容。
- 父目录必须已经存在，缺失或不是目录时返回可读工具错误，不自动创建目录。
- 把工作区路径边界检查提取到 `src/tools/workspace.ts`，由 `read_file`、`list_dir` 和 `write_file` 共同复用。
- `src/tools/builtin.ts` 以 `read_file`、`list_dir`、`write_file` 的稳定顺序组合工具，CLI 只从这个入口注册。

## 工具参数与示例

```json
{
  "path": "note.txt",
  "content": "你好",
  "overwrite": false
}
```

`path` 和 `content` 必填，`overwrite` 可选且默认为 `false`，Schema 不接受额外字段。

| 场景 | 工具参数 | 结果 |
|---|---|---|
| 新建 | `{ "path": "note.txt", "content": "你好" }` | 返回 `已写入 note.txt（2 字符）`，文件内容为 `你好` |
| 默认覆盖已有文件 | `{ "path": "note.txt", "content": "新内容" }` | 返回“默认不覆盖”错误，原内容不变 |
| 显式覆盖 | `{ "path": "note.txt", "content": "新内容", "overwrite": true }` | 写入成功，文件内容变为 `新内容` |
| 父目录缺失 | `{ "path": "missing/a.txt", "content": "text" }` | 返回“父目录不存在或不是目录”错误，不创建 `missing/` |
| 路径越狱 | `{ "path": "../../outside.txt", "content": "text" }` | 路径保护拒绝执行，不写工作区外文件 |

## 怎么复现

```bash
git switch D011
npm install
npx vitest run test/write-file.test.ts
```

只复现某个教学示例：

```bash
npx vitest run test/write-file.test.ts -t "新建文件"
npx vitest run test/write-file.test.ts -t "默认拒绝覆盖"
npx vitest run test/write-file.test.ts -t "显式覆盖"
npx vitest run test/write-file.test.ts -t "父目录不存在"
npx vitest run test/write-file.test.ts -t "Loop 集成"
```

Loop 集成测试使用脚本化 Provider，依次发起 `write_file → read_file → 最终回答`。第二轮模型请求包含写入结果，第三轮包含写入和读取结果，同时断言临时工作区中的文件内容正确。所有文件测试都使用临时目录并在结束后清理，不需要真实模型、密钥或 `.env`。

完整验证：

```bash
npm run check
npm run test:coverage
```

## 今天的边界

- **不自动 mkdir。** 调用方必须先创建父目录；本工具不递归创建 `missing/`。
- **不做原子写入。** 当前直接调用 `writeFileSync`，没有临时文件替换、崩溃恢复或并发锁。
- **不做版本历史。** 显式覆盖会替换旧内容，不保留快照或撤销记录。
- **路径保护不等于命令沙箱。** 本日只实现文本写入；`edit_file`、`run_command` 和 D014 的结构化错误不在本日范围内。
