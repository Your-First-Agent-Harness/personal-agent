import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runCommandTool } from '../src/tools/run-command.ts';

const dirs: string[] = [];

function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pa-run-command-'));
  dirs.push(dir);
  return dir;
}

function nodeCommand(source: string): string {
  return `${JSON.stringify(process.execPath)} -e ${JSON.stringify(source)}`;
}

function expectProcessExited(pid: number): void {
  let alive = true;
  try {
    process.kill(pid, 0);
  } catch {
    alive = false;
  }
  if (alive) process.kill(pid, 'SIGTERM');
  expect(alive).toBe(false);
}

async function waitForPid(root: string): Promise<number> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (existsSync(join(root, 'child.pid'))) {
      return Number(readFileSync(join(root, 'child.pid'), 'utf8'));
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('子进程未启动');
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('run_command', () => {
  it('成功命令分别捕获 stdout、stderr 和退出状态', async () => {
    const root = workspace();
    const command = nodeCommand("process.stdout.write('out');process.stderr.write('err')");

    const result = await runCommandTool.execute({ command }, { workspaceRoot: root });
    const payload = JSON.parse(result.content) as Record<string, unknown>;

    expect(result.isError).toBeUndefined();
    expect(payload).toMatchObject({
      command,
      stdout: 'out',
      stderr: 'err',
      exitCode: 0,
      timedOut: false,
      cancelled: false,
      stdoutTruncated: false,
      stderrTruncated: false,
    });
  });

  it('非零退出作为 isError 工具结果回传并保留退出码', async () => {
    const root = workspace();

    const result = await runCommandTool.execute(
      { command: nodeCommand('process.exit(7)') },
      { workspaceRoot: root },
    );
    const payload = JSON.parse(result.content) as Record<string, unknown>;

    expect(result.isError).toBe(true);
    expect(payload).toMatchObject({ exitCode: 7, timedOut: false, cancelled: false });
  });

  it('超时终止长命令并回传 timedOut 错误结果', async () => {
    const root = workspace();
    const command = nodeCommand(
      "require('node:fs').writeFileSync('child.pid',String(process.pid));setTimeout(()=>{},5000)",
    );

    const result = await runCommandTool.execute(
      { command, timeoutMs: 50 },
      { workspaceRoot: root },
    );
    const payload = JSON.parse(result.content) as Record<string, unknown>;
    const pid = Number(readFileSync(join(root, 'child.pid'), 'utf8'));

    expectProcessExited(pid);
    expect(result.isError).toBe(true);
    expect(payload).toMatchObject({ timedOut: true, cancelled: false });
  });

  it('stdout 保留最多 8000 个原字符并明确标注截断', async () => {
    const root = workspace();

    const result = await runCommandTool.execute(
      { command: nodeCommand("process.stdout.write('x'.repeat(9000))") },
      { workspaceRoot: root },
    );
    const payload = JSON.parse(result.content) as Record<string, unknown>;

    expect(payload.stdoutTruncated).toBe(true);
    expect(payload.stdout).toBe(`${'x'.repeat(8000)}\n…[stdout 已截断]`);
    expect(result.isError).toBeUndefined();
  });

  it('stderr 独立应用 8000 字符限制和截断标记', async () => {
    const root = workspace();

    const result = await runCommandTool.execute(
      { command: nodeCommand("process.stderr.write('y'.repeat(9000))") },
      { workspaceRoot: root },
    );
    const payload = JSON.parse(result.content) as Record<string, unknown>;

    expect(payload.stdout).toBe('');
    expect(payload.stdoutTruncated).toBe(false);
    expect(payload.stderrTruncated).toBe(true);
    expect(payload.stderr).toBe(`${'y'.repeat(8000)}\n…[stderr 已截断]`);
    expect(result.isError).toBeUndefined();
  });

  it('在工作区根目录执行并可读取预写文件', async () => {
    const root = workspace();
    writeFileSync(join(root, 'cwd.txt'), 'from-workspace');

    const result = await runCommandTool.execute(
      {
        command: nodeCommand(
          "process.stdout.write(require('node:fs').readFileSync('cwd.txt','utf8'))",
        ),
      },
      { workspaceRoot: root },
    );
    const payload = JSON.parse(result.content) as Record<string, unknown>;

    expect(result.isError).toBeUndefined();
    expect(payload).toMatchObject({ stdout: 'from-workspace', exitCode: 0 });
  });

  it(
    'AbortSignal 取消长命令、终止进程并回传 cancelled',
    async () => {
      const root = workspace();
      const controller = new AbortController();
      const command = nodeCommand(
        "require('node:fs').writeFileSync('child.pid',String(process.pid));setTimeout(()=>{},5000)",
      );

      const running = runCommandTool.execute(
        { command, timeoutMs: 30_000 },
        { workspaceRoot: root, signal: controller.signal },
      );
      const pid = await waitForPid(root);
      controller.abort();
      const result = await running;
      const payload = JSON.parse(result.content) as Record<string, unknown>;

      expectProcessExited(pid);
      expect(result.isError).toBe(true);
      expect(payload).toMatchObject({ timedOut: false, cancelled: true });
    },
    7000,
  );

  it.each([0, -1, 1.5, 30_001, Number.NaN, Number.POSITIVE_INFINITY, '50'])(
    '拒绝非法 timeoutMs：%s',
    async (timeoutMs) => {
      const root = workspace();

      const result = await runCommandTool.execute(
        { command: nodeCommand(''), timeoutMs },
        { workspaceRoot: root },
      );

      expect(result.content).toContain('timeoutMs 必须是 1–30000 的整数');
      expect(result.error?.code).toBe('INVALID_ARGUMENTS');
    },
  );

  it.each([{}, { command: '' }, { command: '   ' }, { command: 42 }, { command: null }])(
    '拒绝缺失、空白或非字符串 command：%j',
    async (args) => {
      const root = workspace();

      const result = await runCommandTool.execute(args, { workspaceRoot: root });

      expect(result.content).toContain('command 必须是非空字符串');
      expect(result.error?.code).toBe('INVALID_ARGUMENTS');
    },
  );

  it('spawn error 作为带 stderr 的 isError 结果回传', async () => {
    const root = workspace();

    const result = await runCommandTool.execute(
      { command: nodeCommand('') },
      { workspaceRoot: join(root, 'missing') },
    );
    const payload = JSON.parse(result.content) as Record<string, unknown>;

    expect(result.isError).toBe(true);
    expect(payload).toMatchObject({
      exitCode: null,
      timedOut: false,
      cancelled: false,
    });
    expect(payload.stderr).toContain('ENOENT');
  });

  it('已预先取消的 signal 立即终止命令而不误报超时', async () => {
    const root = workspace();
    const controller = new AbortController();
    controller.abort();

    const result = await runCommandTool.execute(
      { command: nodeCommand('setTimeout(()=>{},5000)'), timeoutMs: 50 },
      { workspaceRoot: root, signal: controller.signal },
    );
    const payload = JSON.parse(result.content) as Record<string, unknown>;

    expect(result.isError).toBe(true);
    expect(payload).toMatchObject({ timedOut: false, cancelled: true });
  });

  it('Schema 声明 command 必填和可选整数 timeoutMs', () => {
    expect(runCommandTool.parameters).toMatchObject({
      type: 'object',
      properties: {
        command: { type: 'string' },
        timeoutMs: { type: 'integer' },
      },
      required: ['command'],
      additionalProperties: false,
    });
  });
});
