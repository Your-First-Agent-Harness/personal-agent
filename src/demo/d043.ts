import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';

import {
  sandboxedCommandTool,
  type SandboxedCommandResult,
} from '../tools/sandboxed-command.ts';

const HOST_SECRET_NAME = 'D043_DEMO_HOST_SECRET';
const FAKE_HOST_SECRET = 'FAKE_D043_DEMO_HOST_SECRET_VALUE';

export interface D043DemoReport {
  readonly hostSecretLeaked: boolean;
  readonly isolatedCwd: boolean;
  readonly workingDirectoryWritable: boolean;
  readonly allowedEnvVisible: boolean;
  readonly sandboxCleanedUp: boolean;
  readonly dangerousArtifactRemoved: boolean;
  readonly escapeBlocked: boolean;
  readonly escapeErrorCode: string;
  readonly hostRootRemoved: boolean;
}

interface IsolationOutput {
  readonly cwd: string;
  readonly artifact: string;
  readonly hostSecret: string | null;
  readonly allowedEnv: string | null;
}

function nodeCommand(source: string): string {
  return `${JSON.stringify(process.execPath)} -e ${JSON.stringify(source)}`;
}

function parsePayload(content: string): SandboxedCommandResult {
  return JSON.parse(content) as SandboxedCommandResult;
}

export async function runD043Demo(output: (line: string) => void): Promise<D043DemoReport> {
  const hostRoot = realpathSync(mkdtempSync(join(tmpdir(), 'pa-d043-demo-')));
  const previousSecret = process.env[HOST_SECRET_NAME];
  const escapeMarker = join(hostRoot, 'escape-attempt-marker');
  let evidence: Omit<D043DemoReport, 'hostRootRemoved'> | undefined;
  process.env[HOST_SECRET_NAME] = FAKE_HOST_SECRET;

  output('D043 Demo：一次性 cwd、最小 env、独立进程组与结构化 ToolResult。');
  output('边界=进程/临时工作目录/env 最小隔离；不是容器、seccomp、权限降级或网络隔离。');
  try {
    const isolationSource = [
      "const fs=require('node:fs')",
      "fs.writeFileSync('artifact.txt','writable')",
      'process.stdout.write(JSON.stringify({cwd:process.cwd(),artifact:fs.readFileSync(\'artifact.txt\',\'utf8\'),hostSecret:process.env.D043_DEMO_HOST_SECRET??null,allowedEnv:process.env.D043_DEMO_PUBLIC??null}))',
    ].join(';');
    const isolationResult = await sandboxedCommandTool.execute(
      {
        command: nodeCommand(isolationSource),
        env: { D043_DEMO_PUBLIC: 'explicit-public-value' },
      },
      { workspaceRoot: hostRoot },
    );
    if (isolationResult.isError) throw new Error(`安全命令失败：${isolationResult.content}`);
    const isolation = parsePayload(isolationResult.content);
    const isolationOutput = JSON.parse(isolation.stdout) as IsolationOutput;
    const isolatedCwd = isolation.sandboxRoot.startsWith(hostRoot + sep)
      && isolation.cwd === isolation.sandboxRoot
      && isolationOutput.cwd === isolation.cwd;
    const hostSecretLeaked = isolationOutput.hostSecret !== null
      || isolationResult.content.includes(FAKE_HOST_SECRET);
    const workingDirectoryWritable = isolationOutput.artifact === 'writable';
    const allowedEnvVisible = isolationOutput.allowedEnv === 'explicit-public-value';
    const sandboxCleanedUp = isolation.cleanedUp && !existsSync(isolation.sandboxRoot);
    output(`hostSecret=${String(isolationOutput.hostSecret)} allowedEnv=${String(isolationOutput.allowedEnv)}`);
    output(`isolatedCwd=${String(isolatedCwd)} writable=${String(workingDirectoryWritable)} cleanedUp=${String(sandboxCleanedUp)}`);

    const dangerSource = [
      "const fs=require('node:fs')",
      "fs.writeFileSync('controlled-danger.txt','disposable')",
      "fs.rmSync('controlled-danger.txt')",
      "process.stdout.write(fs.existsSync('controlled-danger.txt')?'still-present':'removed-inside-sandbox')",
    ].join(';');
    const dangerResult = await sandboxedCommandTool.execute(
      { command: nodeCommand(dangerSource) },
      { workspaceRoot: hostRoot },
    );
    if (dangerResult.isError) throw new Error(`受控危险命令失败：${dangerResult.content}`);
    const danger = parsePayload(dangerResult.content);
    const dangerousArtifactRemoved = danger.stdout === 'removed-inside-sandbox'
      && danger.cleanedUp
      && !existsSync(danger.sandboxRoot);
    output(`controlledDanger=${danger.stdout} cleanedUp=${String(danger.cleanedUp)}`);

    const escapeResult = await sandboxedCommandTool.execute(
      {
        command: nodeCommand(`require('node:fs').writeFileSync(${JSON.stringify(escapeMarker)},'bad')`),
        cwd: '../outside',
      },
      { workspaceRoot: hostRoot },
    );
    const escapeBlocked = escapeResult.isError === true
      && escapeResult.error?.code === 'PATH_OUTSIDE_WORKSPACE'
      && !existsSync(escapeMarker);
    output(`cwdEscape=${escapeResult.error?.code ?? 'NOT_BLOCKED'} markerCreated=${String(existsSync(escapeMarker))}`);

    evidence = {
      hostSecretLeaked,
      isolatedCwd,
      workingDirectoryWritable,
      allowedEnvVisible,
      sandboxCleanedUp,
      dangerousArtifactRemoved,
      escapeBlocked,
      escapeErrorCode: escapeResult.error?.code ?? '',
    };
    if (
      hostSecretLeaked
      || !isolatedCwd
      || !workingDirectoryWritable
      || !allowedEnvVisible
      || !sandboxCleanedUp
      || !dangerousArtifactRemoved
      || !escapeBlocked
      || readdirSync(hostRoot).length !== 0
    ) {
      throw new Error('D043 Demo 安全断言未全部满足');
    }
  } finally {
    if (previousSecret === undefined) delete process.env[HOST_SECRET_NAME];
    else process.env[HOST_SECRET_NAME] = previousSecret;
    rmSync(hostRoot, { recursive: true, force: true });
  }

  if (evidence === undefined) throw new Error('D043 Demo 未生成证据');
  const report: D043DemoReport = { ...evidence, hostRootRemoved: !existsSync(hostRoot) };
  output(`hostRootRemoved=${String(report.hostRootRemoved)}`);
  if (!report.hostRootRemoved) throw new Error('D043 Demo 宿主临时目录清理失败');
  output('D043 Demo PASS：伪造宿主秘密未泄漏，临时目录可写且已清理，cwd 越权在启动前被拒绝。');
  return report;
}
