# D012 · edit_file 与零依赖 unified diff

## 今天要做出的东西

- 新增 `edit_file`，用精确字符串匹配替换工作区内文本；只有 `oldText` 唯一匹配时才写入。
- 零匹配和多处匹配都会返回可读错误与实际匹配处数，原文件不变；`oldText` 不能为空，`newText` 可以为空。
- 新增零运行时依赖的行级 LCS diff，返回 `---`、`+++`、全文件单个 `@@` hunk 以及上下文、删除和新增行。
- 编辑前或编辑后任一侧超过 2000 行时拒绝写入，避免 LCS 矩阵和 CLI diff 失控。
- 复用共享工作区路径保护，并在写入前再次检查边界；`src/tools/builtin.ts` 将 `edit_file` 稳定追加在 `write_file` 后。

## 工具参数

```json
{
  "path": "a.ts",
  "oldText": "const n = 1;",
  "newText": "const n = 2;"
}
```

`path`、`oldText`、`newText` 都是必填字符串，Schema 不接受额外字段。匹配采用普通字符串，不是正则表达式；`oldText` 必须非空，`newText: ""` 表示删除匹配文本。

### 唯一匹配替换

原文件：

```ts
const n = 1;
console.log(n);
```

使用上面的参数后，文件中的第一行变为 `const n = 2;`，工具返回：

```diff
--- a/a.ts
+++ b/a.ts
@@ -1,3 +1,3 @@
-const n = 1;
+const n = 2;
 console.log(n);

```

最后一个上下文空行来自原文件末尾的换行。这里是全文件单 hunk，因此 hunk 行数为 `-1,3 +1,3`。

### 末尾插入一行

把 `first\n` 替换为 `first\nsecond\n`：

```json
{
  "path": "a.txt",
  "oldText": "first\n",
  "newText": "first\nsecond\n"
}
```

返回 diff：

```diff
--- a/a.txt
+++ b/a.txt
@@ -1,2 +1,3 @@
 first
+second

```

### 删除一行

从 `first\nsecond\n` 中删除 `second\n`：

```json
{
  "path": "a.txt",
  "oldText": "second\n",
  "newText": ""
}
```

返回 diff：

```diff
--- a/a.txt
+++ b/a.txt
@@ -1,3 +1,2 @@
 first
-second

```

## 失败时为什么不改文件

工具按以下顺序执行：参数类型检查 → 工作区路径解析 → UTF-8 读取 → 非空 `oldText` 检查 → 匹配计数 → 唯一匹配确认 → 新旧行数检查 → 写入前再次路径检查 → 写入 → 生成并返回 diff。

因此，零匹配、多匹配、空 `oldText`、路径越狱和行数超限都发生在写入前。零匹配的提示为：

```text
没有找到唯一匹配：0 处，请读取文件后提供更长 oldText
```

多处匹配使用同一提示并填入实际处数。调用方应读取文件，扩大 `oldText` 的上下文后再试，而不是改用模糊替换。

## 怎么复现

```bash
git switch D012
npm install
npx vitest run test/edit-file.test.ts
```

只复现某个教学示例：

```bash
npx vitest run test/edit-file.test.ts -t "唯一匹配替换"
npx vitest run test/edit-file.test.ts -t "末尾插入"
npx vitest run test/edit-file.test.ts -t "删除一行"
npx vitest run test/edit-file.test.ts -t "零匹配"
npx vitest run test/edit-file.test.ts -t "多处匹配"
npx vitest run test/edit-file.test.ts -t "2001 行"
```

测试也直接调用 `createUnifiedDiff('x.txt', 'a\nb\n', 'a\nc\n')`，精确比较完整 hunk 和增减行。所有文件用例都使用临时目录并在 `afterEach` 清理，不需要真实模型、密钥或 `.env`。

完整验证：

```bash
npm run check
npm run test:coverage
```

## 今天的边界

- **不支持正则。** `oldText` 是普通字符串，且必须在文件中恰好出现一次。
- **不自动格式化。** 工具只替换唯一匹配文本，不运行 formatter，也不重写未匹配内容或换行。
- **2000 行上限。** 编辑前或编辑后任一侧为 2001 行或更多都会失败；这不是超大文件编辑器。
- **全文件单 hunk。** diff 使用行级 LCS，输出整个文件的一个 hunk，不做上下文裁剪、多 hunk 合并或 Git 补丁应用。
- **不做命令执行或结构化错误。** `run_command` 和 D014 的标准错误语义不在本日范围内。
