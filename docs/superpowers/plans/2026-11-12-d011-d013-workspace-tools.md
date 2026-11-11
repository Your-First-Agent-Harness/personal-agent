# D011–D013 Workspace Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 D010 之上依次交付安全写入、唯一匹配编辑与 unified diff、可超时和取消的工作区命令执行。

**Architecture:** 所有工具共享同一个工作区路径解析器；文件工具保持同步、可预测的 Node API；命令工具用 `spawn` 独立捕获 stdout/stderr，并响应 timeout 与 D009 的 AbortSignal。`builtin.ts` 只负责组合内置工具，避免工具实现文件互相引用。

**Tech Stack:** Node 24、`node:fs`、`node:path`、`node:child_process`、TypeScript、Vitest、零运行时依赖。

**前置：** 已完成 `2026-11-12-d005-d010-runtime-foundations.md`，D010 已合并 main。

**规格：** `docs/superpowers/specs/2026-11-12-d006-d015-course-design.md` D011–D013、统一错误与数据流、测试与交付策略。

---

## 文件结构

- `src/tools/workspace.ts`：唯一的工作区路径边界检查。
- `src/tools/fs.ts`：保留 read_file/list_dir，改为复用路径解析器。
- `src/tools/write-file.ts`：write_file，默认禁止覆盖。
- `src/tools/diff.ts`：零依赖行级 LCS unified diff。
- `src/tools/edit-file.ts`：edit_file，唯一精确匹配后写入并返回 diff。
- `src/tools/run-command.ts`：run_command，超时、取消、输出截断。
- `src/tools/builtin.ts`：稳定顺序组合全部内置工具。
- `src/cli/main.ts`：从 `builtin.ts` 注册工具。
- `test/{write-file,edit-file,run-command}.test.ts`：临时目录中的工具与 Loop 测试。

### Task 1：D011 write_file

**Files:**
- Create: `src/tools/workspace.ts`
- Create: `src/tools/write-file.ts`
- Create: `src/tools/builtin.ts`
- Modify: `src/tools/fs.ts`
- Modify: `src/cli/main.ts`
- Test: `test/write-file.test.ts`
- Modify: `README.md`

- [ ] **Step 1：创建 D011 并写失败测试**

```bash
git checkout D010
git checkout -b D011
```

`test/write-file.test.ts` 使用 `mkdtempSync(join(tmpdir(), 'pa-write-'))` 和 afterEach 清理。加入以下测试：

```ts
it('新建文件并返回路径和字符数', async () => {
  const root = workspace();
  const result = await writeFileTool.execute(
    { path: 'note.txt', content: '你好', overwrite: false },
    { workspaceRoot: root },
  );
  expect(result.isError).toBeUndefined();
  expect(result.content).toContain('note.txt');
  expect(result.content).toContain('2');
  expect(readFileSync(join(root, 'note.txt'), 'utf8')).toBe('你好');
});

it('默认拒绝覆盖，显式 overwrite 才替换', async () => {
  const root = workspace();
  writeFileSync(join(root, 'a.txt'), 'old');
  const rejected = await writeFileTool.execute({ path: 'a.txt', content: 'new' }, { workspaceRoot: root });
  expect(rejected.isError).toBe(true);
  expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('old');

  const written = await writeFileTool.execute({ path: 'a.txt', content: 'new', overwrite: true }, { workspaceRoot: root });
  expect(written.isError).toBeUndefined();
  expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('new');
});
```

再写三个独立测试：`../../outside.txt` 被路径保护拒绝；`missing/a.txt` 返回父目录不存在且不创建 `missing`；脚本化 Provider 依次调用 write_file、read_file、最终回答，Loop 第二轮和第三轮请求能看到写入与读取结果，最终文件内容正确。

- [ ] **Step 2：运行测试确认失败**

```bash
npx vitest run test/write-file.test.ts
```

预期：FAIL，找不到 `write-file.ts` / `builtin.ts`。

- [ ] **Step 3：提取共享路径保护**

创建 `src/tools/workspace.ts`：

```ts
import { resolve, sep } from 'node:path';
import type { ToolContext } from '../core/tool.ts';

export function resolveInWorkspace(context: ToolContext, input: unknown): string {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new Error('path 必须是非空字符串');
  }
  const root = resolve(context.workspaceRoot);
  const target = resolve(root, input);
  if (target !== root && !target.startsWith(root + sep)) {
    throw new Error(`路径越出工作区：${input}`);
  }
  return target;
}
```

从 `fs.ts` 删除私有同名函数并 import 此实现，现有 `test/tools.test.ts` 必须保持通过。

- [ ] **Step 4：实现 write_file**

创建 `src/tools/write-file.ts`：

```ts
import { statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Tool } from '../core/tool.ts';
import { resolveInWorkspace } from './workspace.ts';

export const writeFileTool: Tool = {
  name: 'write_file',
  description: '写入工作区内文本文件；默认不覆盖，父目录必须存在',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '相对工作区的文件路径' },
      content: { type: 'string', description: '要写入的完整文本' },
      overwrite: { type: 'boolean', description: '已存在时是否覆盖，默认 false' },
    },
    required: ['path', 'content'],
    additionalProperties: false,
  },

  execute(args, context) {
    return Promise.resolve().then(() => {
      const record = (args ?? {}) as Record<string, unknown>;
      const inputPath = record['path'];
      const content = record['content'];
      const overwrite = record['overwrite'] ?? false;
      if (typeof content !== 'string') throw new Error('content 必须是字符串');
      if (typeof overwrite !== 'boolean') throw new Error('overwrite 必须是布尔值');

      const target = resolveInWorkspace(context, inputPath);
      const exists = statSync(target, { throwIfNoEntry: false });
      if (exists !== undefined && !overwrite) {
        return { content: `文件已存在，默认不覆盖：${String(inputPath)}。确认后设置 overwrite: true`, isError: true };
      }
      const parent = statSync(dirname(target), { throwIfNoEntry: false });
      if (parent === undefined || !parent.isDirectory()) {
        return { content: `父目录不存在或不是目录：${String(inputPath)}`, isError: true };
      }

      writeFileSync(target, content, { encoding: 'utf8', flag: overwrite ? 'w' : 'wx' });
      return { content: `已写入 ${String(inputPath)}（${content.length} 字符）` };
    });
  },
};
```

创建 `builtin.ts`，按 `[readFileTool, listDirTool, writeFileTool]` 返回；删除 `fs.ts` 的 `createBuiltinTools`，CLI 改从 `builtin.ts` import。

- [ ] **Step 5：全量验证、教学 README 和每日合并**

```bash
npm run check
npm run test:coverage
```

README 展示新建、覆盖、父目录缺失示例，明确不自动 mkdir、不做原子写和版本历史。提交 `feat(D011): add guarded write_file tool`，推送 D011，合并 main；README 冲突保留索引版。索引日期 `2026-11-21`，产出写 `write_file、默认禁覆盖、共享路径保护`，进度改为 D011 / D100，提交并推送 main。

### Task 2：D012 edit_file 与零依赖 unified diff

**Files:**
- Create: `src/tools/diff.ts`
- Create: `src/tools/edit-file.ts`
- Modify: `src/tools/builtin.ts`
- Test: `test/edit-file.test.ts`
- Modify: `README.md`

- [ ] **Step 1：创建 D012，写唯一匹配与 diff 失败测试**

```bash
git checkout D011
git checkout -b D012
```

`test/edit-file.test.ts` 覆盖以下断言：

```ts
it('唯一匹配替换成功并返回 unified diff', async () => {
  const root = workspace();
  writeFileSync(join(root, 'a.ts'), 'const n = 1;\nconsole.log(n);\n');
  const result = await editFileTool.execute(
    { path: 'a.ts', oldText: 'const n = 1;', newText: 'const n = 2;' },
    { workspaceRoot: root },
  );
  expect(result.isError).toBeUndefined();
  expect(readFileSync(join(root, 'a.ts'), 'utf8')).toContain('const n = 2;');
  expect(result.content).toContain('--- a/a.ts');
  expect(result.content).toContain('+++ b/a.ts');
  expect(result.content).toContain('@@ -1,3 +1,3 @@');
  expect(result.content).toContain('-const n = 1;');
  expect(result.content).toContain('+const n = 2;');
});
```

另外分别测试：零匹配、两处匹配、路径越狱均失败且文件不变；在末尾插入一行出现 `+`；删除一行出现 `-`；新旧任一侧 2001 行返回超限错误且文件不变。diff 测试直接调用 `createUnifiedDiff('x.txt', 'a\nb\n', 'a\nc\n')`，精确比较输出中的 hunk 和增减行。

- [ ] **Step 2：运行测试确认失败**

```bash
npx vitest run test/edit-file.test.ts
```

预期：FAIL，找不到 `edit-file.ts` / `diff.ts`。

- [ ] **Step 3：实现完整文件单 hunk 的行级 LCS diff**

创建 `src/tools/diff.ts`：

```ts
export function createUnifiedDiff(path: string, before: string, after: string): string {
  const oldLines = before.split(/\r?\n/);
  const newLines = after.split(/\r?\n/);
  const table = Array.from({ length: oldLines.length + 1 }, () => new Uint32Array(newLines.length + 1));

  for (let i = oldLines.length - 1; i >= 0; i -= 1) {
    for (let j = newLines.length - 1; j >= 0; j -= 1) {
      table[i]![j] = oldLines[i] === newLines[j]
        ? table[i + 1]![j + 1]! + 1
        : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }

  const body: string[] = [];
  let i = 0;
  let j = 0;
  while (i < oldLines.length && j < newLines.length) {
    if (oldLines[i] === newLines[j]) {
      body.push(` ${oldLines[i]}`);
      i += 1;
      j += 1;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      body.push(`-${oldLines[i]}`);
      i += 1;
    } else {
      body.push(`+${newLines[j]}`);
      j += 1;
    }
  }
  while (i < oldLines.length) body.push(`-${oldLines[i++]}`);
  while (j < newLines.length) body.push(`+${newLines[j++]}`);

  return [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -1,${oldLines.length} +1,${newLines.length} @@`,
    ...body,
    '',
  ].join('\n');
}
```

这是全文件单 hunk unified diff；2000 行上限使 LCS 矩阵有界，不在 CLI 中生成超大 diff。

- [ ] **Step 4：实现 edit_file 的唯一匹配与写入顺序**

`edit-file.ts` Schema 为 object，required `path/oldText/newText`，additionalProperties false。执行顺序固定为：参数类型检查 → 工作区路径解析 → 读取 UTF-8 → `oldText` 非空 → 用 `before.split(oldText).length - 1` 计算匹配数 → 只有 1 才继续 → 检查 before/after 任一侧超过 2000 行则返回错误 → `writeFileSync` → 返回 `createUnifiedDiff(inputPath, before, after)`。

零匹配错误为 `没有找到唯一匹配：0 处，请读取文件后提供更长 oldText`；多匹配错误包含实际处数。所有失败都发生在写入前。`builtin.ts` 将 `editFileTool` 追加到 write_file 后。

- [ ] **Step 5：全量验证、README 和每日合并**

```bash
npm run check
npm run test:coverage
```

README 给出唯一匹配、插入、删除 diff 示例，说明不支持正则、不自动格式化、2000 行限制。提交 `feat(D012): add exact editing and unified diffs`，推送 D012，合并 main；索引日期 `2026-11-22`，产出写 `edit_file、唯一匹配、LCS unified diff`，进度改为 D012 / D100。

### Task 3：D013 run_command

**Files:**
- Create: `src/tools/run-command.ts`
- Modify: `src/tools/builtin.ts`
- Test: `test/run-command.test.ts`
- Modify: `README.md`

- [ ] **Step 1：创建 D013，写命令行为失败测试**

```bash
git checkout D012
git checkout -b D013
```

测试统一用 `JSON.stringify(process.execPath)` 生成 Node 可执行文件路径，避免依赖本机第三方命令。加入：

```ts
it('成功命令捕获 stdout、stderr 和退出码', async () => {
  const root = workspace();
  const command = `${JSON.stringify(process.execPath)} -e "process.stdout.write('out');process.stderr.write('err')"`;
  const result = await runCommandTool.execute({ command }, { workspaceRoot: root });
  const payload = JSON.parse(result.content) as Record<string, unknown>;
  expect(result.isError).toBeUndefined();
  expect(payload).toMatchObject({ stdout: 'out', stderr: 'err', exitCode: 0, timedOut: false, cancelled: false });
});
```

其他测试分别执行：`process.exit(7)`，断言 isError 和 exitCode 7；`setTimeout(() => {}, 5000)` 配 `timeoutMs: 50`，断言 timedOut；输出 9000 个 x，断言 stdout 不超过 8000 字符加截断标记且 stdoutTruncated true；在工作区写 `cwd.txt`，命令读取该文件成功以证明 cwd；创建 AbortController 后对长命令 abort，断言 cancelled 且进程结束；`timeoutMs: 30001` 返回参数错误。

- [ ] **Step 2：运行测试确认失败**

```bash
npx vitest run test/run-command.test.ts
```

预期：FAIL，找不到 `run-command.ts`。

- [ ] **Step 3：实现有界输出、超时和取消**

创建 `src/tools/run-command.ts`：

```ts
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import type { Tool, ToolResult } from '../core/tool.ts';

const MAX_OUTPUT_CHARS = 8000;
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 30_000;

function limitedAppend(current: string, chunk: string): { text: string; truncated: boolean } {
  const combined = current + chunk;
  return { text: combined.slice(0, MAX_OUTPUT_CHARS), truncated: combined.length > MAX_OUTPUT_CHARS };
}

export const runCommandTool: Tool = {
  name: 'run_command',
  description: '在工作区根目录通过系统 shell 执行一条命令；不是安全沙箱',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: '要执行的单条 shell 命令' },
      timeoutMs: { type: 'integer', description: '超时毫秒数，默认 10000，最大 30000' },
    },
    required: ['command'],
    additionalProperties: false,
  },

  async execute(args, context) {
    const record = (args ?? {}) as Record<string, unknown>;
    const command = record['command'];
    const timeoutMs = record['timeoutMs'] ?? DEFAULT_TIMEOUT_MS;
    if (typeof command !== 'string' || command.trim() === '') throw new Error('command 必须是非空字符串');
    if (typeof timeoutMs !== 'number' || !Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT_MS) {
      throw new Error(`timeoutMs 必须是 1–${MAX_TIMEOUT_MS} 的整数`);
    }

    return new Promise<ToolResult>((resolveResult) => {
      const child = spawn(command, { cwd: resolve(context.workspaceRoot), shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      let stdoutTruncated = false;
      let stderrTruncated = false;
      let timedOut = false;
      let cancelled = false;
      let settled = false;

      const cleanup = (): void => {
        clearTimeout(timer);
        context.signal?.removeEventListener('abort', onAbort);
      };
      const finish = (exitCode: number | null): void => {
        if (settled) return;
        settled = true;
        cleanup();
        const body = {
          command,
          exitCode,
          timedOut,
          cancelled,
          stdout: stdoutTruncated ? `${stdout}\n…[stdout 已截断]` : stdout,
          stderr: stderrTruncated ? `${stderr}\n…[stderr 已截断]` : stderr,
          stdoutTruncated,
          stderrTruncated,
        };
        resolveResult({ content: JSON.stringify(body), ...(exitCode === 0 && !timedOut && !cancelled ? {} : { isError: true }) });
      };
      const onAbort = (): void => {
        cancelled = true;
        child.kill('SIGTERM');
      };
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, timeoutMs);

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        const next = limitedAppend(stdout, chunk);
        stdout = next.text;
        stdoutTruncated ||= next.truncated;
      });
      child.stderr.on('data', (chunk: string) => {
        const next = limitedAppend(stderr, chunk);
        stderr = next.text;
        stderrTruncated ||= next.truncated;
      });
      child.on('error', (error) => {
        stderr = error.message;
        finish(null);
      });
      child.on('close', (code) => finish(code));
      if (context.signal?.aborted === true) onAbort();
      else context.signal?.addEventListener('abort', onAbort, { once: true });
    });
  },
};
```

将 `runCommandTool` 追加到内置工具末尾。

- [ ] **Step 4：运行测试并检查无残留进程**

```bash
npx vitest run test/run-command.test.ts
npm run check
npm run test:coverage
```

预期：超时和 abort 用例都结束，Vitest 不因子进程挂起；8000 字符限制分别作用于 stdout/stderr。

- [ ] **Step 5：README 明确非沙箱并合并**

README 必须原样包含：`run_command 不是安全沙箱；命令白名单、环境清理、资源限制和进程隔离尚未实现。` 展示用 `npm run check` 失败输出回喂模型的流程。提交 `feat(D013): add cancellable workspace commands`，推送 D013，合并 main；索引日期 `2026-11-23`，产出写 `run_command、超时/取消、双通道输出截断`，进度改为 D013 / D100，提交并推送 main。

## 自检

- 规格覆盖：新建/覆盖/父目录、唯一/零/多匹配、修改/插入/删除 diff、成功/非零/超时/截断/cwd/取消均有测试任务。
- 文件边界：所有路径经 `resolveInWorkspace`；所有失败在写入前返回；测试只用临时目录并清理。
- 类型衔接：D009 的 `ToolContext.signal` 在 D013 被消费；工具结果仍使用 D005 的 `content/isError`，D014 再统一增加结构化 error，不在本计划提前实现。
- 简化约束：未引入原子写、正则替换、沙箱、白名单或第三方 diff/process 库。
