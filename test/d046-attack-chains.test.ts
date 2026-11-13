import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createJsonlAuditSink } from '../src/observability/audit-sink.ts';
import type { CommandAuditRecord } from '../src/observability/audit-sink.ts';
import { sandboxedCommandTool, type SandboxedCommandResult } from '../src/tools/sandboxed-command.ts';
import { createSecureCommandTool, type SecureCommandResult } from '../src/tools/secure-command.ts';

const directories: string[] = [];
const fakeSecret = 'FAKE_D046_HOST_SECRET_NOT_A_CREDENTIAL';
const previousSecret = process.env.D046_HOST_SECRET;

afterAll(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
  if (previousSecret === undefined) delete process.env.D046_HOST_SECRET;
  else process.env.D046_HOST_SECRET = previousSecret;
});

function lab(): { root: string; initialCwd: string; victims: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'd046-attack-test-')));
  directories.push(root);
  const initialCwd = join(root, 'initial-cwd');
  const victims = join(root, 'victims');
  mkdirSync(initialCwd, { recursive: true });
  mkdirSync(victims, { recursive: true });
  return { root, initialCwd, victims };
}

function nodeCommand(source: string): string {
  const singleLine = source.replace(/\s*\n\s*/g, ' ');
  return `${JSON.stringify(process.execPath)} -e ${JSON.stringify(singleLine)}`;
}

function payload<T>(result: { content: string }): T {
  return JSON.parse(result.content) as T;
}

describe('D046 工具沙箱攻防链', () => {
  it('D043 的绝对路径、shell cd 与受控删除都能穿过初始 cwd', async () => {
    const workspace = lab();
    const absoluteVictim = join(workspace.victims, 'absolute.txt');
    const cdVictim = join(workspace.victims, 'cd.txt');
    const deleteVictim = join(workspace.victims, 'delete.txt');
    writeFileSync(absoluteVictim, 'ABSOLUTE_ORIGINAL');
    writeFileSync(cdVictim, 'CD_ORIGINAL');
    writeFileSync(deleteVictim, 'CONTROLLED_DELETE');

    const absoluteResult = await sandboxedCommandTool.execute({
      command: nodeCommand(`
        const fs = require('node:fs');
        const file = ${JSON.stringify(absoluteVictim)};
        const before = fs.readFileSync(file, 'utf8');
        fs.appendFileSync(file, '|ABSOLUTE_CHANGED');
        process.stdout.write(JSON.stringify({ before, after: fs.readFileSync(file, 'utf8') }));
      `),
      timeoutMs: 2_000,
    }, { workspaceRoot: workspace.initialCwd });
    expect(absoluteResult.isError, absoluteResult.content).not.toBe(true);
    const absolute = payload<SandboxedCommandResult>(absoluteResult);
    expect(JSON.parse(absolute.stdout)).toEqual({
      before: 'ABSOLUTE_ORIGINAL', after: 'ABSOLUTE_ORIGINAL|ABSOLUTE_CHANGED',
    });
    expect(absolute.cwd.startsWith(workspace.initialCwd)).toBe(true);
    expect(absoluteVictim.startsWith(absolute.cwd)).toBe(false);
    expect(absoluteVictim.startsWith(workspace.root)).toBe(true);

    const cdResult = await sandboxedCommandTool.execute({
      command: `cd ${JSON.stringify(workspace.victims)} && printf '|CD_CHANGED' >> cd.txt && /bin/cat cd.txt`,
      timeoutMs: 2_000,
    }, { workspaceRoot: workspace.initialCwd });
    expect(cdResult.isError).not.toBe(true);
    expect(payload<SandboxedCommandResult>(cdResult).stdout.trim()).toBe('CD_ORIGINAL|CD_CHANGED');
    expect(readFileSync(cdVictim, 'utf8')).toBe('CD_ORIGINAL|CD_CHANGED');

    const removedResult = await sandboxedCommandTool.execute({
      command: `/bin/rm ${JSON.stringify(deleteVictim)}`, timeoutMs: 2_000,
    }, { workspaceRoot: workspace.initialCwd });
    expect(removedResult.isError).not.toBe(true);
    expect(existsSync(deleteVictim)).toBe(false);
    expect(existsSync(workspace.victims)).toBe(true);
  });

  it('D044 在 spawn 前拒绝五类绕过且每次拒绝都有 decision/completion', async () => {
    const workspace = lab();
    const marker = join(workspace.root, 'denial-marker');
    const victim = join(workspace.victims, 'secure-victim.txt');
    writeFileSync(victim, 'SECURE_ORIGINAL');
    const records: CommandAuditRecord[] = [];
    const auditSink = { append: (record: CommandAuditRecord) => { records.push(record); return Promise.resolve(); } };
    const safeSource = "process.stdout.write('CONTROL_OK')";
    const safeArgs = ['-e', safeSource];
    let spawnCount = 0;
    const spawnImplementation: typeof spawn = ((...args: Parameters<typeof spawn>) => {
      spawnCount += 1;
      return spawn(...args);
    }) as typeof spawn;
    const tool = createSecureCommandTool({
      allowlist: [{ id: 'control', executable: process.execPath, args: safeArgs }],
      auditSink,
      spawnImplementation,
    });

    const control = await tool.execute(
      { executable: process.execPath, args: safeArgs }, { workspaceRoot: workspace.root },
    );
    expect(control.isError).not.toBe(true);
    expect(payload<SecureCommandResult>(control).stdout).toBe('CONTROL_OK');
    const afterControl = spawnCount;
    const attackCommand = `/bin/printf COMPROMISED > ${JSON.stringify(marker)}`;
    const attacks = [
      { id: 'executable', executable: '/bin/sh', args: ['-c', attackCommand] },
      {
        id: 'argv', executable: process.execPath,
        args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(victim)}, 'COMPROMISED')`],
      },
      { id: 'shell', executable: process.execPath, args: [...safeArgs, ';', '/bin/sh', '-c', attackCommand] },
      {
        id: 'substitution', executable: process.execPath,
        args: [...safeArgs, `$(/bin/sh -c ${JSON.stringify(attackCommand)})`],
      },
      { id: 'redirection', executable: process.execPath, args: [...safeArgs, '>', marker] },
    ];
    const observations: Array<Record<string, unknown>> = [];
    for (const attack of attacks) {
      const recordStart = records.length;
      const result = await tool.execute(
        { executable: attack.executable, args: attack.args }, { workspaceRoot: workspace.root },
      );
      const ownRecords = records.slice(recordStart);
      observations.push({
        id: attack.id,
        code: result.error?.code,
        phases: ownRecords.map((record) => record.phase),
        decisions: ownRecords.map((record) => record.decision),
        statuses: ownRecords.map((record) => record.status),
      });
    }

    expect({
      afterControl,
      deniedSpawnDelta: spawnCount - afterControl,
      recordCount: records.length,
      observations,
      markerCreated: existsSync(marker),
      victim: readFileSync(victim, 'utf8'),
    }).toEqual({
      afterControl: 1,
      deniedSpawnDelta: 0,
      recordCount: 12,
      observations: attacks.map((attack) => ({
        id: attack.id,
        code: 'COMMAND_NOT_ALLOWED',
        phases: ['decision', 'completion'],
        decisions: ['denied', 'denied'],
        statuses: ['denied', 'denied'],
      })),
      markerCreated: false,
      victim: 'SECURE_ORIGINAL',
    });
  });

  it('D043/D044 子进程都看不到伪造宿主秘密且日志不包含原值', async () => {
    const workspace = lab();
    process.env.D046_HOST_SECRET = fakeSecret;
    const envSource = "process.stdout.write(JSON.stringify({hostSecretPresent:Object.hasOwn(process.env,'D046_HOST_SECRET')}))";
    const d043Result = await sandboxedCommandTool.execute(
      { command: nodeCommand(envSource) }, { workspaceRoot: workspace.initialCwd },
    );
    const d043 = payload<SandboxedCommandResult>(d043Result);
    expect(JSON.parse(d043.stdout)).toEqual({ hostSecretPresent: false });
    expect(JSON.stringify(d043Result)).not.toContain(fakeSecret);

    const records: CommandAuditRecord[] = [];
    const d044 = createSecureCommandTool({
      allowlist: [{ id: 'env-control', executable: process.execPath, args: ['-e', envSource] }],
      auditSink: { append: (record: CommandAuditRecord) => { records.push(record); return Promise.resolve(); } },
      sensitiveValues: [fakeSecret],
    });
    const controlled = await d044.execute(
      { executable: process.execPath, args: ['-e', envSource] }, { workspaceRoot: workspace.root },
    );
    expect(controlled.isError).not.toBe(true);
    expect(JSON.parse(payload<SecureCommandResult>(controlled).stdout)).toEqual({ hostSecretPresent: false });
    expect(process.env.D046_HOST_SECRET).toBe(fakeSecret);
    expect(JSON.stringify({ controlled, records })).not.toContain(fakeSecret);
  });

  it('D044 输出 flood 与短循环分别被共享字节预算和 wall timeout 终止', async () => {
    const workspace = lab();
    const floodSource = "process.stdout.write('x'.repeat(256));setTimeout(()=>{},5000)";
    const loopSource = 'setInterval(()=>{},1000)';
    const records: CommandAuditRecord[] = [];
    const tool = createSecureCommandTool({
      allowlist: [
        { id: 'flood', executable: process.execPath, args: ['-e', floodSource] },
        { id: 'loop', executable: process.execPath, args: ['-e', loopSource] },
      ],
      auditSink: { append: (record: CommandAuditRecord) => { records.push(record); return Promise.resolve(); } },
      resources: { maxOutputBytes: 64, defaultTimeoutMs: 80, maxTimeoutMs: 200 },
    });
    const floodResult = await tool.execute(
      { executable: process.execPath, args: ['-e', floodSource] }, { workspaceRoot: workspace.root },
    );
    const loopResult = await tool.execute(
      { executable: process.execPath, args: ['-e', loopSource], timeoutMs: 30 },
      { workspaceRoot: workspace.root },
    );
    const flood = payload<SecureCommandResult>(floodResult);
    const loop = payload<SecureCommandResult>(loopResult);
    expect(floodResult.error?.code).toBe('COMMAND_OUTPUT_LIMIT');
    expect(flood).toMatchObject({
      outputLimitExceeded: true, stdoutBytes: 64, stderrBytes: 0, cleanedUp: true,
    });
    expect(loopResult.error?.code).toBe('COMMAND_TIMEOUT');
    expect(loop).toMatchObject({ timedOut: true, cleanedUp: true });
    expect(records.map((record) => [record.phase, record.resultCode])).toEqual([
      ['decision', 'SPAWN_PENDING'], ['completion', 'COMMAND_OUTPUT_LIMIT'],
      ['decision', 'SPAWN_PENDING'], ['completion', 'COMMAND_TIMEOUT'],
    ]);
  });

  it('JSONL sink 保留 D046 拒绝链的真实审计行', async () => {
    const workspace = lab();
    const sink = createJsonlAuditSink({ filePath: join(workspace.root, 'audit.jsonl') });
    const tool = createSecureCommandTool({ allowlist: [], auditSink: sink });
    const denied = await tool.execute(
      { executable: '/bin/sh', args: ['-c', 'true'] }, { workspaceRoot: workspace.root },
    );
    expect(denied.error?.code).toBe('COMMAND_NOT_ALLOWED');
    const lines = readFileSync(join(workspace.root, 'audit.jsonl'), 'utf8').trim().split('\n')
      .map((line) => JSON.parse(line) as CommandAuditRecord);
    expect(lines.map((record: CommandAuditRecord) => record.phase)).toEqual(['decision', 'completion']);
  });
});
