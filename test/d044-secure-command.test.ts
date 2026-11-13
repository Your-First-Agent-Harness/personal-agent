import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { afterEach, describe, expect, it } from 'vitest';

import * as publicApi from '../src/index.ts';
import type { CommandAuditRecord } from '../src/observability/audit-sink.ts';
import {
  createSecureCommandTool,
  type SecureCommandResult,
  type SecureCommandToolOptions,
} from '../src/tools/secure-command.ts';

const FAKE_SECRET = 'FAKE_D044_TEST_SECRET_NEVER_REAL';
const dirs: string[] = [];

function workspace(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'pa-d044-test-')));
  dirs.push(dir);
  return dir;
}

function recorder(): {
  records: CommandAuditRecord[];
  sink: SecureCommandToolOptions['auditSink'];
} {
  const records: CommandAuditRecord[] = [];
  return {
    records,
    sink: {
      append(record) {
        records.push(structuredClone(record));
        return Promise.resolve();
      },
    },
  };
}

function nodeRule(id: string, source: string, extraArgs: readonly string[] = []) {
  return { id, executable: process.execPath, args: ['-e', source, ...extraArgs] as const };
}

function makeTool(
  allowlist: SecureCommandToolOptions['allowlist'],
  auditSink: SecureCommandToolOptions['auditSink'],
  resources: SecureCommandToolOptions['resources'] = {},
) {
  return createSecureCommandTool({
    allowlist,
    auditSink,
    resources,
    sensitiveValues: [FAKE_SECRET],
  });
}

function parse(result: { content: string }): SecureCommandResult {
  return JSON.parse(result.content) as SecureCommandResult;
}

async function waitForReady(root: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    for (const entry of readdirSync(root)) {
      if (entry.startsWith('.d044-secure-') && existsSync(join(root, entry, 'ready'))) return;
    }
    await delay(10);
  }
  throw new Error('未等到安全子进程 ready 握手');
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

describe('D044 精确 argv 白名单与无 shell 执行', () => {
  it('允许规则真实执行、使用一次性 cwd、不继承宿主 env 并记录两段审计', async () => {
    const root = workspace();
    const audit = recorder();
    const source = [
      "require('node:fs').writeFileSync('artifact','ok')",
      "process.stdout.write(JSON.stringify({artifact:require('node:fs').readFileSync('artifact','utf8'),hostSecret:process.env.D044_HOST_SECRET??null}))",
    ].join(';');
    const tool = makeTool([nodeRule('allowed-success', source, [FAKE_SECRET])], audit.sink);
    process.env.D044_HOST_SECRET = 'FAKE_D044_HOST_VALUE';
    try {
      const result = await tool.execute(
        { executable: process.execPath, args: ['-e', source, FAKE_SECRET] },
        { workspaceRoot: root },
      );
      const payload = parse(result);
      const child = JSON.parse(payload.stdout) as { artifact: string; hostSecret: string | null };

      expect(result.isError).toBeUndefined();
      expect(child).toEqual({ artifact: 'ok', hostSecret: null });
      expect(payload).toMatchObject({
        operationId: audit.records[0]?.operationId,
        ruleId: 'allowed-success',
        exitCode: 0,
        cleanedUp: true,
        stdoutBytes: Buffer.byteLength(payload.stdout),
      });
      expect(payload.args).toEqual(['-e', source, '[REDACTED]']);
      expect(existsSync(payload.sandboxRoot)).toBe(false);
      expect(audit.records.map((record) => record.phase)).toEqual(['decision', 'completion']);
      expect(audit.records[1]).toMatchObject({
        decision: 'allowed', status: 'succeeded', resultCode: 'OK', exitCode: 0,
      });
      expect(audit.records[0]?.argvSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.stringify(audit.records)).not.toContain(FAKE_SECRET);
      expect(result.content).not.toContain(FAKE_SECRET);
    } finally {
      delete process.env.D044_HOST_SECRET;
    }
  });

  it('未白名单的绝对路径宿主写在 spawn 前拒绝，危险 marker 不存在', async () => {
    const root = workspace();
    const marker = join(root, 'host-write-marker');
    const audit = recorder();
    const allowed = nodeRule('only-safe', "process.stdout.write('safe')");
    const tool = makeTool([allowed], audit.sink);
    const attack = `require('node:fs').writeFileSync(${JSON.stringify(marker)},${JSON.stringify(FAKE_SECRET)})`;

    const result = await tool.execute(
      { executable: process.execPath, args: ['-e', attack] },
      { workspaceRoot: root },
    );

    expect(result.error?.code).toBe('COMMAND_NOT_ALLOWED');
    expect(existsSync(marker)).toBe(false);
    expect(readdirSync(root)).toEqual([]);
    expect(audit.records).toHaveLength(1);
    expect(audit.records[0]).toMatchObject({
      phase: 'decision', decision: 'denied', status: 'denied', resultCode: 'COMMAND_NOT_ALLOWED',
    });
    expect(JSON.stringify(result)).not.toContain(FAKE_SECRET);
    expect(JSON.stringify(audit.records)).not.toContain(FAKE_SECRET);
  });

  it.each([';', '>', '|', '$(touch subshell-marker)', '`touch backtick-marker`'])(
    '精确 argv 后的 shell 元字符后缀 %s 不会改变允许决策',
    async (suffix) => {
      const root = workspace();
      const marker = join(root, 'bypass-marker');
      const audit = recorder();
      const source = "process.stdout.write('safe')";
      const tool = makeTool([nodeRule('only-exact', source)], audit.sink);
      const result = await tool.execute(
        {
          executable: process.execPath,
          args: ['-e', source, suffix, `require('node:fs').writeFileSync(${JSON.stringify(marker)},'bad')`],
        },
        { workspaceRoot: root },
      );

      expect(result.error?.code).toBe('COMMAND_NOT_ALLOWED');
      expect(existsSync(marker)).toBe(false);
      expect(readdirSync(root)).toEqual([]);
    },
  );

  it('即使白名单参数本身含元字符，也只作为字面 argv 传递而不解释', async () => {
    const root = workspace();
    const marker = join(root, 'literal-shell-marker');
    const literal = `safe; touch ${marker} > out | $(touch ${marker})`;
    const source = 'process.stdout.write(process.argv[1])';
    const audit = recorder();
    const tool = makeTool([nodeRule('literal', source, [literal])], audit.sink);

    const result = await tool.execute(
      { executable: process.execPath, args: ['-e', source, literal] },
      { workspaceRoot: root },
    );

    expect(result.isError).toBeUndefined();
    expect(parse(result).stdout).toBe(literal);
    expect(existsSync(marker)).toBe(false);
  });

  it('真实非零退出保留 stdout/stderr/exitCode，completion 审计为失败', async () => {
    const root = workspace();
    const audit = recorder();
    const source = "process.stdout.write('partial');process.stderr.write('bad');process.exit(7)";
    const tool = makeTool([nodeRule('exit-seven', source)], audit.sink);
    const result = await tool.execute(
      { executable: process.execPath, args: ['-e', source] },
      { workspaceRoot: root },
    );
    const payload = parse(result);

    expect(result.error?.code).toBe('COMMAND_FAILED');
    expect(payload).toMatchObject({ exitCode: 7, stdout: 'partial', stderr: 'bad', cleanedUp: true });
    expect(audit.records.at(-1)).toMatchObject({
      phase: 'completion', status: 'failed', resultCode: 'COMMAND_FAILED', exitCode: 7,
    });
  });

  it.each([
    null,
    [],
    {},
    { executable: 'node', args: [] },
    { executable: process.execPath, args: 'not-array' },
    { executable: process.execPath, args: ['ok', 42] },
    { executable: process.execPath, args: ['bad\0arg'] },
    { executable: process.execPath, args: [], extra: true },
  ])('非法结构化输入安全拒绝：%j', async (args) => {
    const audit = recorder();
    const tool = makeTool([nodeRule('safe', '')], audit.sink);
    const result = await tool.execute(args, { workspaceRoot: workspace() });
    expect(result.error?.code).toBe('INVALID_ARGUMENTS');
    expect(readdirSync(workspace())).toEqual([]);
  });

  it('Schema 和公共导出明确只接受结构化 executable/args', () => {
    const audit = recorder();
    const tool = makeTool([], audit.sink);
    expect(tool.name).toBe('secure_command');
    expect(tool.description).toContain('shell:false');
    expect(tool.parameters).toMatchObject({
      type: 'object',
      required: ['executable', 'args'],
      additionalProperties: false,
      properties: {
        executable: { type: 'string' },
        args: { type: 'array' },
        timeoutMs: { type: 'integer' },
      },
    });
    expect(publicApi.createSecureCommandTool).toBe(createSecureCommandTool);
    expect(publicApi.createJsonlAuditSink).toBeTypeOf('function');
  });
});

describe('D044 资源预算与排队取消', () => {
  it('wall timeout 终止真实进程并记录耗时、signal 与资源审计', async () => {
    const root = workspace();
    const audit = recorder();
    const source = 'setInterval(()=>{},1000)';
    const tool = makeTool([nodeRule('forever', source)], audit.sink, { maxTimeoutMs: 100 });
    const result = await tool.execute(
      { executable: process.execPath, args: ['-e', source], timeoutMs: 40 },
      { workspaceRoot: root },
    );
    const payload = parse(result);

    expect(result.error?.code).toBe('COMMAND_TIMEOUT');
    expect(payload).toMatchObject({ timedOut: true, cancelled: false, exitCode: null });
    expect(audit.records.at(-1)).toMatchObject({
      resultCode: 'COMMAND_TIMEOUT',
      resource: { timeoutMs: 40, outputTruncated: false, cleanedUp: true },
    });
    expect(audit.records.at(-1)?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('stdout/stderr 共用字节预算，多字节输出超限会终止而非无限截断', async () => {
    const root = workspace();
    const audit = recorder();
    const source = "process.stdout.write('界'.repeat(100));process.stderr.write('abc');setTimeout(()=>{},5000)";
    const tool = makeTool([nodeRule('flood', source)], audit.sink, { maxOutputBytes: 32 });
    const result = await tool.execute(
      { executable: process.execPath, args: ['-e', source] },
      { workspaceRoot: root },
    );
    const payload = parse(result);

    expect(result.error?.code).toBe('COMMAND_OUTPUT_LIMIT');
    expect(payload.outputLimitExceeded).toBe(true);
    expect(payload.stdoutBytes + payload.stderrBytes).toBeLessThanOrEqual(32);
    expect(Buffer.byteLength(payload.stdout)).toBeLessThanOrEqual(32);
    expect(audit.records.at(-1)?.resource).toMatchObject({
      maxOutputBytes: 32,
      outputTruncated: true,
    });
  });

  it('maxConcurrent=1 且 maxQueue=0 时第二调用在启动前拒绝', async () => {
    const root = workspace();
    const audit = recorder();
    const source = "require('node:fs').writeFileSync('ready','1');setInterval(()=>{},1000)";
    const tool = makeTool([nodeRule('slow', source)], audit.sink, {
      maxConcurrent: 1,
      maxQueue: 0,
      maxTimeoutMs: 5_000,
    });
    const controller = new AbortController();
    const firstRunning = tool.execute(
      { executable: process.execPath, args: ['-e', source], timeoutMs: 5_000 },
      { workspaceRoot: root, signal: controller.signal },
    );
    await waitForReady(root);
    const second = await tool.execute(
      { executable: process.execPath, args: ['-e', source] },
      { workspaceRoot: root },
    );

    expect(second.error?.code).toBe('COMMAND_RESOURCE_LIMIT');
    controller.abort();
    expect((await firstRunning).error?.code).toBe('COMMAND_CANCELLED');
    expect(audit.records.some((record) => (
      record.phase === 'completion' && record.resultCode === 'COMMAND_RESOURCE_LIMIT'
    ))).toBe(true);
  });

  it('排队调用可取消并被移除，后续有界等待者仍能获得许可', async () => {
    const root = workspace();
    const audit = recorder();
    const source = "require('node:fs').writeFileSync('ready','1');setInterval(()=>{},1000)";
    const tool = makeTool([nodeRule('queued', source)], audit.sink, {
      maxConcurrent: 1,
      maxQueue: 2,
      maxQueueWaitMs: 1_000,
      maxTimeoutMs: 5_000,
    });
    const firstController = new AbortController();
    const cancelledController = new AbortController();
    const call = (signal?: AbortSignal) => tool.execute(
      { executable: process.execPath, args: ['-e', source], timeoutMs: 5_000 },
      { workspaceRoot: root, ...(signal === undefined ? {} : { signal }) },
    );
    const first = call(firstController.signal);
    await waitForReady(root);
    const cancelled = call(cancelledController.signal);
    const survivorController = new AbortController();
    const survivor = call(survivorController.signal);
    await delay(20);
    cancelledController.abort();
    expect((await cancelled).error?.code).toBe('COMMAND_CANCELLED');
    firstController.abort();
    expect((await first).error?.code).toBe('COMMAND_CANCELLED');
    survivorController.abort();
    expect((await survivor).error?.code).toBe('COMMAND_CANCELLED');
    expect(audit.records.filter((record) => record.resultCode === 'COMMAND_CANCELLED').length)
      .toBeGreaterThanOrEqual(3);
  }, 10_000);

  it('排队超过 maxQueueWaitMs 返回资源错误而不是无界等待', async () => {
    const root = workspace();
    const source = "require('node:fs').writeFileSync('ready','1');setInterval(()=>{},1000)";
    const audit = recorder();
    const tool = makeTool([nodeRule('queue-timeout', source)], audit.sink, {
      maxConcurrent: 1,
      maxQueue: 1,
      maxQueueWaitMs: 30,
      maxTimeoutMs: 5_000,
    });
    const controller = new AbortController();
    const first = tool.execute(
      { executable: process.execPath, args: ['-e', source], timeoutMs: 5_000 },
      { workspaceRoot: root, signal: controller.signal },
    );
    await waitForReady(root);
    const queued = await tool.execute(
      { executable: process.execPath, args: ['-e', source] },
      { workspaceRoot: root },
    );
    expect(queued.error?.code).toBe('COMMAND_RESOURCE_LIMIT');
    controller.abort();
    await first;
  });

  it('预先取消的允许调用不会创建沙箱或进程，但有取消完成审计', async () => {
    const root = workspace();
    const marker = join(root, 'pre-cancel-marker');
    const source = `require('node:fs').writeFileSync(${JSON.stringify(marker)},'bad')`;
    const audit = recorder();
    const tool = makeTool([nodeRule('cancel-before', source)], audit.sink);
    const controller = new AbortController();
    controller.abort();
    const result = await tool.execute(
      { executable: process.execPath, args: ['-e', source] },
      { workspaceRoot: root, signal: controller.signal },
    );

    expect(result.error?.code).toBe('COMMAND_CANCELLED');
    expect(existsSync(marker)).toBe(false);
    expect(readdirSync(root)).toEqual([]);
    expect(audit.records.at(-1)).toMatchObject({ resultCode: 'COMMAND_CANCELLED' });
  });

  it.each([
    { defaultTimeoutMs: 0 },
    { defaultTimeoutMs: 20, maxTimeoutMs: 10 },
    { maxTimeoutMs: 1.5 },
    { maxOutputBytes: 0 },
    { maxConcurrent: 0 },
    { maxQueue: -1 },
    { maxQueueWaitMs: 0 },
  ])('非法资源配置在工厂边界抛错：%j', (resources) => {
    const audit = recorder();
    expect(() => makeTool([nodeRule('safe', '')], audit.sink, resources)).toThrow(TypeError);
  });

  it('空白名单默认全拒绝；相对规则路径、重复 id 和 NUL 配置不可构造', async () => {
    const audit = recorder();
    const denyAll = makeTool([], audit.sink);
    const denied = await denyAll.execute(
      { executable: process.execPath, args: ['-e', ''] },
      { workspaceRoot: workspace() },
    );
    expect(denied.error?.code).toBe('COMMAND_NOT_ALLOWED');
    expect(() => makeTool([{ id: 'relative', executable: 'node', args: [] }], audit.sink))
      .toThrow(TypeError);
    expect(() => makeTool([
      nodeRule('duplicate', ''),
      nodeRule('duplicate', 'process.exit(0)'),
    ], audit.sink)).toThrow(TypeError);
    expect(() => makeTool([{ id: 'nul', executable: process.execPath, args: ['x\0y'] }], audit.sink))
      .toThrow(TypeError);
  });
});

describe('D044 审计 fail-closed 语义', () => {
  it('decision 审计写失败时不启动允许命令', async () => {
    const root = workspace();
    const marker = join(root, 'audit-fail-closed-marker');
    const source = `require('node:fs').writeFileSync(${JSON.stringify(marker)},'bad')`;
    const tool = makeTool([nodeRule('audit-down', source)], {
      append: () => Promise.reject(new Error(FAKE_SECRET)),
    });

    const result = await tool.execute(
      { executable: process.execPath, args: ['-e', source] },
      { workspaceRoot: root },
    );

    expect(result.error?.code).toBe('AUDIT_WRITE_FAILED');
    expect(existsSync(marker)).toBe(false);
    expect(JSON.stringify(result)).not.toContain(FAKE_SECRET);
  });

  it('拒绝决策的审计写失败也显式报 AUDIT_WRITE_FAILED，且绝不执行', async () => {
    const root = workspace();
    const marker = join(root, 'denied-audit-marker');
    const source = `require('node:fs').writeFileSync(${JSON.stringify(marker)},'bad')`;
    const tool = makeTool([], { append: () => Promise.reject(new Error('disk full')) });
    const result = await tool.execute(
      { executable: process.execPath, args: ['-e', source] },
      { workspaceRoot: root },
    );

    expect(result.error?.code).toBe('AUDIT_WRITE_FAILED');
    expect(existsSync(marker)).toBe(false);
  });

  it('completion 审计失败显式报错但不谎称已执行操作可回滚', async () => {
    const root = workspace();
    const marker = join(root, 'completion-before-audit-failure');
    const source = `require('node:fs').writeFileSync(${JSON.stringify(marker)},'ran')`;
    let writes = 0;
    const tool = makeTool([nodeRule('completion-audit-down', source)], {
      append: () => {
        writes += 1;
        return writes === 1 ? Promise.resolve() : Promise.reject(new Error('disk full'));
      },
    });
    const result = await tool.execute(
      { executable: process.execPath, args: ['-e', source] },
      { workspaceRoot: root },
    );

    expect(result.error?.code).toBe('AUDIT_WRITE_FAILED');
    expect(existsSync(marker)).toBe(true);
    expect(readFileSync(marker, 'utf8')).toBe('ran');
  });
});
