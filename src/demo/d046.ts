import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CommandAuditRecord } from '../observability/audit-sink.ts';
import { createJsonlAuditSink } from '../observability/audit-sink.ts';
import { sandboxedCommandTool, type SandboxedCommandResult } from '../tools/sandboxed-command.ts';
import { createSecureCommandTool, type SecureCommandResult } from '../tools/secure-command.ts';

export interface D046DemoItem {
  id: string;
  expected: string;
  observed: string;
  control: string;
  attackResult: string;
  passed: boolean;
}

export interface D046DemoReport {
  items: D046DemoItem[];
  auditJsonl: string;
  secureSpawnCount: number;
  secureDeniedSpawnDelta: number;
  hostRootRemoved: boolean;
}

const fakeSecret = 'FAKE_D046_HOST_SECRET_NOT_A_CREDENTIAL';
const envSource = "process.stdout.write(JSON.stringify({hostSecretPresent:Object.hasOwn(process.env,'D046_HOST_SECRET')}))";
const floodSource = "process.stdout.write('x'.repeat(256));setTimeout(()=>{},5000)";
const loopSource = 'setInterval(()=>{},1000)';

function nodeCommand(source: string): string {
  return `${JSON.stringify(process.execPath)} -e ${JSON.stringify(source.replace(/\s*\n\s*/g, ' '))}`;
}

function payload<T>(result: { content: string }): T {
  return JSON.parse(result.content) as T;
}

function phases(records: CommandAuditRecord[]): string {
  return records.map((record) => record.phase).join('+');
}

function formatItem(item: D046DemoItem): string {
  return `item=${item.id} expected=${JSON.stringify(item.expected)} observed=${JSON.stringify(item.observed)}`
    + ` control=${JSON.stringify(item.control)} attackResult=${JSON.stringify(item.attackResult)}`
    + ` gate=${item.passed ? 'ok' : 'fail'}`;
}

export async function runD046Demo(
  output: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
): Promise<D046DemoReport> {
  const hostRoot = await realpath(await mkdtemp(join(tmpdir(), 'd046-security-lab-')));
  const initialCwd = join(hostRoot, 'initial-cwd');
  const victims = join(hostRoot, 'victims');
  const marker = join(hostRoot, 'denial-marker');
  const auditPath = join(hostRoot, 'd046-audit.jsonl');
  const previousSecret = process.env.D046_HOST_SECRET;
  const records: CommandAuditRecord[] = [];
  const d043Items: D046DemoItem[] = [];
  const denialItems: D046DemoItem[] = [];
  const resourceItems: D046DemoItem[] = [];
  let d043EnvItem: D046DemoItem;
  let d044EnvItem: D046DemoItem;
  let auditJsonl: string;
  let secureSpawnCount = 0;
  let secureDeniedSpawnDelta: number;

  output('D046 安全演示：仅一次性 mkdtemp 实验根、伪造秘密、零外网；未录屏，使用真实终端 transcript。');
  try {
    await mkdir(initialCwd, { recursive: true });
    await mkdir(victims, { recursive: true });
    const absoluteVictim = join(victims, 'absolute.txt');
    const cdVictim = join(victims, 'cd.txt');
    const deleteVictim = join(victims, 'delete.txt');
    const secureVictim = join(victims, 'secure-victim.txt');
    await Promise.all([
      writeFile(absoluteVictim, 'ABSOLUTE_ORIGINAL', 'utf8'),
      writeFile(cdVictim, 'CD_ORIGINAL', 'utf8'),
      writeFile(deleteVictim, 'CONTROLLED_DELETE', 'utf8'),
      writeFile(secureVictim, 'SECURE_ORIGINAL', 'utf8'),
    ]);
    process.env.D046_HOST_SECRET = fakeSecret;

    const executeD043 = async (command: string) => {
      const result = await sandboxedCommandTool.execute(
        { command, timeoutMs: 2_000 }, { workspaceRoot: initialCwd },
      );
      return { result, data: payload<SandboxedCommandResult>(result) };
    };

    const absoluteAttack = await executeD043(nodeCommand(`
      const fs = require('node:fs');
      const file = ${JSON.stringify(absoluteVictim)};
      const before = fs.readFileSync(file, 'utf8');
      fs.appendFileSync(file, '|ABSOLUTE_CHANGED');
      process.stdout.write(JSON.stringify({ before, after: fs.readFileSync(file, 'utf8') }));
    `));
    const absoluteOutput = JSON.parse(absoluteAttack.data.stdout) as { before: string; after: string };
    const absolutePassed = absoluteAttack.result.isError !== true
      && absoluteAttack.data.exitCode === 0 && absoluteAttack.data.cleanedUp
      && absoluteOutput.before === 'ABSOLUTE_ORIGINAL'
      && absoluteOutput.after === 'ABSOLUTE_ORIGINAL|ABSOLUTE_CHANGED'
      && !absoluteVictim.startsWith(absoluteAttack.data.cwd) && absoluteVictim.startsWith(hostRoot);
    d043Items.push({
      id: 'D043_ABSOLUTE_PATH',
      expected: '绝对路径读取并修改初始 cwd 外、实验根内的 victim',
      observed: `before=${absoluteOutput.before};after=${absoluteOutput.after};cwdOutside=true`,
      control: 'D043 使用自己的一次性 cwd；victim 位于该 cwd 外但仍在 hostRoot 内',
      attackResult: 'cwd-crossed;hostRoot-contained',
      passed: absolutePassed,
    });

    const cdAttack = await executeD043(
      `cd ${JSON.stringify(victims)} && printf '|CD_CHANGED' >> cd.txt && /bin/cat cd.txt`,
    );
    const cdOutput = cdAttack.data.stdout.trim();
    const cdPassed = cdAttack.result.isError !== true && cdAttack.data.exitCode === 0
      && cdAttack.data.cleanedUp && cdOutput === 'CD_ORIGINAL|CD_CHANGED'
      && await readFile(cdVictim, 'utf8') === 'CD_ORIGINAL|CD_CHANGED';
    d043Items.push({
      id: 'D043_SHELL_CD',
      expected: '开放 shell 通过 cd 修改初始 cwd 外的受控 victim',
      observed: `stdout=${cdOutput};victim=CD_ORIGINAL|CD_CHANGED`,
      control: '目标目录仍在同一 hostRoot；没有访问真实用户目录',
      attackResult: 'cwd-crossed;hostRoot-contained',
      passed: cdPassed,
    });

    const removeAttack = await executeD043(`/bin/rm ${JSON.stringify(deleteVictim)}`);
    const removePassed = removeAttack.result.isError !== true && removeAttack.data.exitCode === 0
      && removeAttack.data.cleanedUp && !existsSync(deleteVictim) && existsSync(victims);
    d043Items.push({
      id: 'D043_CONTROLLED_RM',
      expected: '只允许删除专门为攻击创建且位于 hostRoot 内的 delete victim',
      observed: `victimExists=${existsSync(deleteVictim)};victimsDirectoryExists=${existsSync(victims)}`,
      control: 'rm 目标是预先创建的单一文件；未使用通配符，未指向实验根外',
      attackResult: 'controlled-victim-removed',
      passed: removePassed,
    });

    const d043Env = await executeD043(nodeCommand(envSource));
    const d043EnvOutput = JSON.parse(d043Env.data.stdout) as { hostSecretPresent: boolean };
    const d043EnvLeak = JSON.stringify(d043Env.result).includes(fakeSecret);
    d043EnvItem = {
      id: 'D043_ENV_CONTROL',
      expected: '伪造宿主 SECRET 不进入 D043 子进程 env，结果不含原秘密',
      observed: `parentSecretPresent=${process.env.D046_HOST_SECRET === fakeSecret};childSecretPresent=${d043EnvOutput.hostSecretPresent};resultLeak=${d043EnvLeak}`,
      control: '父进程显式设置伪造秘密；子进程只报告布尔值，不打印秘密原值',
      attackResult: 'not-disclosed',
      passed: d043Env.result.isError !== true && d043EnvOutput.hostSecretPresent === false && !d043EnvLeak,
    };

    const jsonlSink = createJsonlAuditSink({ filePath: auditPath });
    const spawnImplementation: typeof spawn = ((...args: Parameters<typeof spawn>) => {
      secureSpawnCount += 1;
      return spawn(...args);
    }) as typeof spawn;
    const secure = createSecureCommandTool({
      allowlist: [
        { id: 'env-control', executable: process.execPath, args: ['-e', envSource] },
        { id: 'flood', executable: process.execPath, args: ['-e', floodSource] },
        { id: 'loop', executable: process.execPath, args: ['-e', loopSource] },
      ],
      auditSink: {
        async append(record) {
          records.push(record);
          await jsonlSink.append(record);
        },
      },
      resources: { maxOutputBytes: 64, defaultTimeoutMs: 80, maxTimeoutMs: 200 },
      sensitiveValues: [fakeSecret],
      spawnImplementation,
    });
    const controlStart = records.length;
    const d044Env = await secure.execute(
      { executable: process.execPath, args: ['-e', envSource] }, { workspaceRoot: hostRoot },
    );
    const d044EnvRecords = records.slice(controlStart);
    const d044EnvData = payload<SecureCommandResult>(d044Env);
    const d044EnvOutput = JSON.parse(d044EnvData.stdout) as { hostSecretPresent: boolean };
    const afterControl = secureSpawnCount;
    const d044EnvLeak = JSON.stringify({ result: d044Env, records: d044EnvRecords }).includes(fakeSecret);
    d044EnvItem = {
      id: 'D044_ENV_CONTROL',
      expected: '允许的正向控制真实启动一次，伪造宿主 SECRET 不进入 env 或审计',
      observed: `childSecretPresent=${d044EnvOutput.hostSecretPresent};spawnCount=${afterControl};audit=${phases(d044EnvRecords)};resultLeak=${d044EnvLeak}`,
      control: '同一 Node executable 与精确 env argv 已单独加入白名单',
      attackResult: 'allowed-control;not-disclosed',
      passed: d044Env.isError !== true && d044EnvOutput.hostSecretPresent === false
        && afterControl === 1 && phases(d044EnvRecords) === 'decision+completion' && !d044EnvLeak,
    };

    const attackCommand = `/bin/printf COMPROMISED > ${JSON.stringify(marker)}`;
    const attacks = [
      { id: 'D044_EXECUTABLE', executable: '/bin/sh', args: ['-c', attackCommand], label: '未允许 executable' },
      {
        id: 'D044_ARGV', executable: process.execPath, label: '未允许 argv',
        args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(secureVictim)}, 'COMPROMISED')`],
      },
      {
        id: 'D044_SHELL_META', executable: process.execPath, label: 'shell 元字符后缀',
        args: ['-e', envSource, ';', '/bin/sh', '-c', attackCommand],
      },
      {
        id: 'D044_COMMAND_SUBSTITUTION', executable: process.execPath, label: '命令替换后缀',
        args: ['-e', envSource, `$(/bin/sh -c ${JSON.stringify(attackCommand)})`],
      },
      {
        id: 'D044_REDIRECTION', executable: process.execPath, label: '重定向后缀',
        args: ['-e', envSource, '>', marker],
      },
    ];
    for (const attack of attacks) {
      const recordStart = records.length;
      const beforeDenied = secureSpawnCount;
      const denied = await secure.execute(
        { executable: attack.executable, args: attack.args }, { workspaceRoot: hostRoot },
      );
      const ownRecords = records.slice(recordStart);
      const spawnDelta = secureSpawnCount - beforeDenied;
      const auditPair = phases(ownRecords) === 'decision+completion'
        && ownRecords.every((record) => record.decision === 'denied' && record.status === 'denied');
      const markerAbsent = !existsSync(marker);
      const victimUnchanged = await readFile(secureVictim, 'utf8') === 'SECURE_ORIGINAL';
      denialItems.push({
        id: attack.id,
        expected: `${attack.label} 在 spawn 前拒绝，marker/victim 不变且有双阶段审计`,
        observed: `code=${denied.error?.code};spawnDelta=${spawnDelta};audit=${phases(ownRecords)};markerAbsent=${markerAbsent};victimUnchanged=${victimUnchanged}`,
        control: `正向控制 spawnCount=${afterControl}；拒绝前后使用同一 marker/victim 对照`,
        attackResult: 'blocked-before-spawn',
        passed: denied.error?.code === 'COMMAND_NOT_ALLOWED' && spawnDelta === 0
          && auditPair && markerAbsent && victimUnchanged,
      });
    }
    secureDeniedSpawnDelta = secureSpawnCount - afterControl;

    const floodStart = records.length;
    const floodResult = await secure.execute(
      { executable: process.execPath, args: ['-e', floodSource] }, { workspaceRoot: hostRoot },
    );
    const flood = payload<SecureCommandResult>(floodResult);
    const floodRecords = records.slice(floodStart);
    resourceItems.push({
      id: 'D044_OUTPUT_BUDGET',
      expected: '256 字节输出在 stdout+stderr 共享 64 字节预算处被 SIGKILL',
      observed: `code=${floodResult.error?.code};stdoutBytes=${flood.stdoutBytes};stderrBytes=${flood.stderrBytes};outputLimitExceeded=${flood.outputLimitExceeded};cleanedUp=${flood.cleanedUp};audit=${phases(floodRecords)}`,
      control: '仅向 pipe 写入 256 个 x；无文件、网络或危险负载',
      attackResult: 'terminated-by-output-budget',
      passed: floodResult.error?.code === 'COMMAND_OUTPUT_LIMIT' && flood.stdoutBytes === 64
        && flood.stderrBytes === 0 && flood.outputLimitExceeded && flood.cleanedUp
        && phases(floodRecords) === 'decision+completion',
    });

    const loopStart = records.length;
    const loopResult = await secure.execute(
      { executable: process.execPath, args: ['-e', loopSource], timeoutMs: 30 }, { workspaceRoot: hostRoot },
    );
    const loop = payload<SecureCommandResult>(loopResult);
    const loopRecords = records.slice(loopStart);
    resourceItems.push({
      id: 'D044_WALL_TIMEOUT',
      expected: '无害短循环在 30ms wall timeout 被 SIGKILL',
      observed: `code=${loopResult.error?.code};timedOut=${loop.timedOut};cleanedUp=${loop.cleanedUp};audit=${phases(loopRecords)}`,
      control: '负载只有 setInterval；严格短上限，不监听端口、不消耗文件或网络',
      attackResult: 'terminated-by-wall-timeout',
      passed: loopResult.error?.code === 'COMMAND_TIMEOUT' && loop.timedOut && loop.cleanedUp
        && phases(loopRecords) === 'decision+completion',
    });

    auditJsonl = await readFile(auditPath, 'utf8');
  } finally {
    if (previousSecret === undefined) delete process.env.D046_HOST_SECRET;
    else process.env.D046_HOST_SECRET = previousSecret;
    await rm(hostRoot, { recursive: true, force: true });
  }

  const hostRootRemoved = !existsSync(hostRoot);
  const items = [
    ...d043Items, ...denialItems, d043EnvItem, d044EnvItem, ...resourceItems,
  ];
  const itemLines = items.map(formatItem);
  for (const line of itemLines) output(line);
  const operationIds = new Set(records.map((record) => record.operationId));
  const auditPairsComplete = records.length === 16 && operationIds.size === 8
    && [...operationIds].every((id) => phases(records.filter((record) => record.operationId === id)) === 'decision+completion');
  const secretLeakFree = !JSON.stringify({ items, auditJsonl }).includes(fakeSecret);
  output(`summary auditRecords=${records.length} operations=${operationIds.size} secureSpawnCount=${secureSpawnCount} secureDeniedSpawnDelta=${secureDeniedSpawnDelta} hostRootRemoved=${hostRootRemoved} recording=none`);

  const gate = items.every((item) => item.passed) && items.length === 12
    && secureSpawnCount === 3 && secureDeniedSpawnDelta === 0
    && auditPairsComplete && secretLeakFree && hostRootRemoved;
  if (!gate) {
    throw new Error(`D046 Demo FAIL: ${items.filter((item) => !item.passed).map((item) => item.id).join(',') || 'summary-gate'}`);
  }
  output('D046 Demo PASS: 12 项门禁成立；攻击未离开实验根；明确未录屏。');
  return { items, auditJsonl, secureSpawnCount, secureDeniedSpawnDelta, hostRootRemoved };
}
