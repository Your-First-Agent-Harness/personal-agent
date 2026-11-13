import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { afterEach, describe, expect, it } from 'vitest';

import * as publicApi from '../src/index.ts';
import { runCommandTool } from '../src/tools/run-command.ts';
import {
  sandboxedCommandTool,
  type SandboxedCommandResult,
} from '../src/tools/sandboxed-command.ts';

const dirs: string[] = [];

function workspace(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'pa-d043-test-')));
  dirs.push(dir);
  return dir;
}

function nodeCommand(source: string): string {
  return `${JSON.stringify(process.execPath)} -e ${JSON.stringify(source)}`;
}

function parse(result: { content: string }): SandboxedCommandResult {
  return JSON.parse(result.content) as SandboxedCommandResult;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function expectProcessExited(pid: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (!processIsAlive(pid)) return;
    await delay(20);
  }
  if (processIsAlive(pid)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // 测试清理时进程可能已经退出。
    }
  }
  expect(processIsAlive(pid)).toBe(false);
}

async function waitForPid(root: string, filename: string): Promise<number> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    for (const entry of readdirSync(root)) {
      if (!entry.startsWith('.d043-sandbox-')) continue;
      const path = join(root, entry, filename);
      if (!existsSync(path)) continue;
      const pid = Number(readFileSync(path, 'utf8'));
      if (Number.isInteger(pid) && pid > 0) return pid;
    }
    await delay(20);
  }
  throw new Error(`未等到 ${filename} PID 握手`);
}

function processTreeCommand(): string {
  const childSource = "require('node:fs').writeFileSync('grandchild.pid',String(process.pid));setTimeout(()=>{},30000)";
  const parentSource = [
    "const fs=require('node:fs')",
    "const {spawn}=require('node:child_process')",
    `const child=spawn(process.execPath,['-e',${JSON.stringify(childSource)}],{stdio:'ignore'})`,
    "fs.writeFileSync('parent.pid',String(process.pid))",
    "fs.writeFileSync('grandchild.pid',String(child.pid))",
    "process.stdout.write('ready')",
    'setTimeout(()=>{},30000)',
  ].join(';');
  return `printf '%s' "$$" > shell.pid; ${nodeCommand(parentSource)}`;
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

describe('D043 sandboxed_command', () => {
  it('在独立临时目录执行，捕获结构化输出、允许写入并清理目录', async () => {
    const root = workspace();
    const command = nodeCommand([
      "const fs=require('node:fs')",
      "fs.writeFileSync('artifact.txt','writable')",
      "process.stdout.write(JSON.stringify({cwd:process.cwd(),artifact:fs.readFileSync('artifact.txt','utf8')}))",
      "process.stderr.write('diagnostic')",
    ].join(';'));

    const result = await sandboxedCommandTool.execute({ command }, { workspaceRoot: root });
    const payload = parse(result);
    const childOutput = JSON.parse(payload.stdout) as { cwd: string; artifact: string };

    expect(result.isError).toBeUndefined();
    expect(payload).toMatchObject({
      command,
      exitCode: 0,
      signal: null,
      timedOut: false,
      cancelled: false,
      stderr: 'diagnostic',
      cleanedUp: true,
      stdoutTruncated: false,
      stderrTruncated: false,
    });
    expect(childOutput).toEqual({ cwd: payload.cwd, artifact: 'writable' });
    expect(payload.sandboxRoot.startsWith(root + sep)).toBe(true);
    expect(payload.cwd).toBe(payload.sandboxRoot);
    expect(existsSync(payload.sandboxRoot)).toBe(false);
    expect(readdirSync(root)).toEqual([]);
  });

  it('支持沙箱内相对 cwd，拒绝 cwd 越狱且绝不启动命令', async () => {
    const root = workspace();
    const nested = await sandboxedCommandTool.execute(
      { command: nodeCommand("process.stdout.write(process.cwd())"), cwd: 'nested/work' },
      { workspaceRoot: root },
    );
    const nestedPayload = parse(nested);
    expect(nestedPayload.cwd).toBe(join(nestedPayload.sandboxRoot, 'nested', 'work'));
    expect(nestedPayload.stdout).toBe(nestedPayload.cwd);

    const marker = join(root, 'escape-attempt-marker');
    const escaped = await sandboxedCommandTool.execute(
      {
        command: nodeCommand(`require('node:fs').writeFileSync(${JSON.stringify(marker)},'bad')`),
        cwd: '../outside',
      },
      { workspaceRoot: root },
    );

    expect(escaped.isError).toBe(true);
    expect(escaped.error?.code).toBe('PATH_OUTSIDE_WORKSPACE');
    expect(existsSync(marker)).toBe(false);
    expect(readdirSync(root)).toEqual([]);
  });

  it('不继承宿主环境秘密，只提供固定变量和显式非敏感变量', async () => {
    const root = workspace();
    const fakeSecret = 'FAKE_D043_HOST_SECRET_VALUE';
    process.env.D043_TEST_HOST_SECRET = fakeSecret;
    try {
      const result = await sandboxedCommandTool.execute(
        {
          command: nodeCommand("process.stdout.write(JSON.stringify({hostSecret:process.env.D043_TEST_HOST_SECRET??null,allowed:process.env.D043_TEST_PUBLIC??null,path:process.env.PATH,home:process.env.HOME,tmp:process.env.TMPDIR,pwd:process.env.PWD}))"),
          env: { D043_TEST_PUBLIC: 'explicit-public-value' },
        },
        { workspaceRoot: root },
      );
      const payload = parse(result);
      const childEnv = JSON.parse(payload.stdout) as Record<string, unknown>;

      expect(childEnv).toEqual({
        hostSecret: null,
        allowed: 'explicit-public-value',
        path: '/usr/bin:/bin:/usr/sbin:/sbin',
        home: payload.sandboxRoot,
        tmp: payload.sandboxRoot,
        pwd: payload.cwd,
      });
      expect(result.content).not.toContain(fakeSecret);
    } finally {
      delete process.env.D043_TEST_HOST_SECRET;
    }
  });

  it('拒绝敏感或可导致代码注入的环境变量名', async () => {
    const root = workspace();
    for (const name of ['AWS_SECRET_ACCESS_KEY', 'NODE_OPTIONS', 'DYLD_INSERT_LIBRARIES']) {
      const result = await sandboxedCommandTool.execute(
        { command: nodeCommand(''), env: { [name]: 'fake-test-value' } },
        { workspaceRoot: root },
      );
      expect(result.isError).toBe(true);
      expect(result.error?.code).toBe('INVALID_ARGUMENTS');
    }
    expect(readdirSync(root)).toEqual([]);
  });

  it('非零退出保留退出码、stdout 与 stderr', async () => {
    const root = workspace();
    const result = await sandboxedCommandTool.execute(
      { command: nodeCommand("process.stdout.write('partial');process.stderr.write('bad');process.exit(7)") },
      { workspaceRoot: root },
    );
    const payload = parse(result);

    expect(result.isError).toBe(true);
    expect(result.error?.code).toBe('COMMAND_FAILED');
    expect(payload).toMatchObject({ exitCode: 7, stdout: 'partial', stderr: 'bad', cleanedUp: true });
  });

  it('超时终止 shell、子进程和同组孙进程，不遗留进程', async () => {
    const root = workspace();
    const running = sandboxedCommandTool.execute(
      { command: processTreeCommand(), timeoutMs: 3_000 },
      { workspaceRoot: root },
    );
    const [shellPid, parentPid, grandchildPid] = await Promise.all([
      waitForPid(root, 'shell.pid'),
      waitForPid(root, 'parent.pid'),
      waitForPid(root, 'grandchild.pid'),
    ]);
    const result = await running;
    const payload = parse(result);

    expect(result.isError).toBe(true);
    expect(result.error?.code).toBe('COMMAND_TIMEOUT');
    expect(payload).toMatchObject({ timedOut: true, cancelled: false, cleanedUp: true });
    await Promise.all([
      expectProcessExited(shellPid),
      expectProcessExited(parentPid),
      expectProcessExited(grandchildPid),
    ]);
  }, 10_000);

  it('AbortSignal 终止整个子进程组并返回 cancelled', async () => {
    const root = workspace();
    const controller = new AbortController();
    const running = sandboxedCommandTool.execute(
      { command: processTreeCommand(), timeoutMs: 10_000 },
      { workspaceRoot: root, signal: controller.signal },
    );
    const [shellPid, parentPid, grandchildPid] = await Promise.all([
      waitForPid(root, 'shell.pid'),
      waitForPid(root, 'parent.pid'),
      waitForPid(root, 'grandchild.pid'),
    ]);
    controller.abort();
    const result = await running;
    const payload = parse(result);

    expect(result.isError).toBe(true);
    expect(result.error?.code).toBe('COMMAND_CANCELLED');
    expect(payload).toMatchObject({ timedOut: false, cancelled: true, cleanedUp: true });
    await Promise.all([
      expectProcessExited(shellPid),
      expectProcessExited(parentPid),
      expectProcessExited(grandchildPid),
    ]);
  }, 10_000);

  it('正常退出的父进程也不能留下同组后台孙进程', async () => {
    const root = workspace();
    const source = [
      "const {spawn}=require('node:child_process')",
      "const child=spawn(process.execPath,['-e','setTimeout(()=>{},30000)'],{stdio:'ignore'})",
      'child.unref()',
      "process.stdout.write(String(child.pid))",
    ].join(';');
    const result = await sandboxedCommandTool.execute(
      { command: nodeCommand(source) },
      { workspaceRoot: root },
    );
    const payload = parse(result);
    const grandchildPid = Number(payload.stdout);

    expect(result.isError).toBeUndefined();
    expect(Number.isInteger(grandchildPid)).toBe(true);
    await expectProcessExited(grandchildPid);
  }, 10_000);

  it('预先取消的 signal 不执行命令并返回结构化取消结果', async () => {
    const root = workspace();
    const controller = new AbortController();
    controller.abort();
    const marker = join(root, 'pre-aborted-marker');
    const result = await sandboxedCommandTool.execute(
      { command: nodeCommand(`require('node:fs').writeFileSync(${JSON.stringify(marker)},'bad')`) },
      { workspaceRoot: root, signal: controller.signal },
    );
    const payload = parse(result);

    expect(result.error?.code).toBe('COMMAND_CANCELLED');
    expect(payload).toMatchObject({ exitCode: null, cancelled: true, timedOut: false, cleanedUp: true });
    expect(existsSync(marker)).toBe(false);
  });

  it('分别截断 stdout 与 stderr，避免无上限输出', async () => {
    const root = workspace();
    const result = await sandboxedCommandTool.execute(
      { command: nodeCommand("process.stdout.write('x'.repeat(9000));process.stderr.write('y'.repeat(9000))") },
      { workspaceRoot: root },
    );
    const payload = parse(result);

    expect(payload.stdoutTruncated).toBe(true);
    expect(payload.stderrTruncated).toBe(true);
    expect(payload.stdout).toBe(`${'x'.repeat(8000)}\n…[stdout 已截断]`);
    expect(payload.stderr).toBe(`${'y'.repeat(8000)}\n…[stderr 已截断]`);
  });

  it.each([null, [], 'command', 42])('拒绝非对象参数：%j', async (args) => {
    const result = await sandboxedCommandTool.execute(args, { workspaceRoot: workspace() });
    expect(result.isError).toBe(true);
    expect(result.error?.code).toBe('INVALID_ARGUMENTS');
  });

  it.each([
    {},
    { command: '' },
    { command: '   ' },
    { command: 42 },
    { command: 'ok', extra: true },
    { command: 'ok', timeoutMs: 0 },
    { command: 'ok', timeoutMs: 1.5 },
    { command: 'ok', timeoutMs: 30_001 },
    { command: 'ok', cwd: '' },
    { command: 'ok', env: [] },
    { command: 'ok', env: { PUBLIC: 42 } },
    { command: 'ok', env: { 'BAD-NAME': 'value' } },
  ])('非法输入统一返回 ToolResult 错误：%j', async (args) => {
    const result = await sandboxedCommandTool.execute(args, { workspaceRoot: workspace() });
    expect(result.isError).toBe(true);
    expect(result.error?.code).toBe('INVALID_ARGUMENTS');
    expect(result.content).not.toContain('PASS');
  });

  it('工作区不可用时返回错误而不是抛出异常', async () => {
    const root = workspace();
    const result = await sandboxedCommandTool.execute(
      { command: nodeCommand('') },
      { workspaceRoot: join(root, 'missing') },
    );
    expect(result.isError).toBe(true);
    expect(result.error?.code).toBe('COMMAND_FAILED');
  });

  it('通过公共入口导出同一个独立 Tool，不改变 run_command', () => {
    expect(publicApi.sandboxedCommandTool).toBe(sandboxedCommandTool);
    expect(runCommandTool).not.toBe(sandboxedCommandTool);
  });

  it('Schema 声明 command、相对 cwd、env 与 timeoutMs', () => {
    expect(sandboxedCommandTool.name).toBe('sandboxed_command');
    expect(sandboxedCommandTool.parameters).toMatchObject({
      type: 'object',
      properties: {
        command: { type: 'string', minLength: 1 },
        cwd: { type: 'string', minLength: 1 },
        timeoutMs: { type: 'integer', minimum: 1, maximum: 30_000 },
        env: { type: 'object' },
      },
      required: ['command'],
      additionalProperties: false,
    });
  });
});
