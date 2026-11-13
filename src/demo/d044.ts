import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createJsonlAuditSink, type CommandAuditRecord } from '../observability/audit-sink.ts';
import { createSecureCommandTool } from '../tools/secure-command.ts';

export interface D044DemoReport {
  allowedSucceeded: boolean;
  deniedCode: string;
  shellBypassCode: string;
  dangerousMarkersAbsent: boolean;
  outputLimitCode: string;
  timeoutCode: string;
  failClosedCode: string;
  failClosedMarkerAbsent: boolean;
  fakeSecretRedacted: boolean;
  hostRootRemoved: boolean;
  auditJsonl: string;
}

const FAKE_SECRET = 'FAKE_D044_DEMO_SECRET_NEVER_REAL';

function nodeRule(id: string, source: string, extraArgs: readonly string[] = []) {
  return { id, executable: process.execPath, args: ['-e', source, ...extraArgs] as const };
}

function code(result: { error?: { code: string } }): string {
  return result.error?.code ?? 'OK';
}

export async function runD044Demo(output: (line: string) => void): Promise<D044DemoReport> {
  const hostRoot = await mkdtemp(join(tmpdir(), 'pa-d044-security-demo-'));
  const auditPath = join(hostRoot, 'audit.jsonl');
  const deniedMarker = join(hostRoot, 'denied-marker');
  const bypassMarker = join(hostRoot, 'bypass-marker');
  const failClosedMarker = join(hostRoot, 'audit-fail-marker');
  let partial: Omit<D044DemoReport, 'hostRootRemoved'>;

  try {
    const successSource = "process.stdout.write('allowed-ok')";
    const outputSource = "process.stdout.write('x'.repeat(256));setTimeout(()=>{},5000)";
    const timeoutSource = 'setInterval(()=>{},1000)';
    const tool = createSecureCommandTool({
      allowlist: [
        nodeRule('demo-allowed', successSource, [FAKE_SECRET]),
        nodeRule('demo-output-limit', outputSource),
        nodeRule('demo-timeout', timeoutSource),
      ],
      auditSink: createJsonlAuditSink({ filePath: auditPath }),
      resources: {
        defaultTimeoutMs: 200,
        maxTimeoutMs: 200,
        maxOutputBytes: 64,
        maxConcurrent: 1,
        maxQueue: 0,
        maxQueueWaitMs: 50,
      },
      sensitiveValues: [FAKE_SECRET],
    });
    const execute = (source: string, extraArgs: readonly string[] = [], timeoutMs?: number) => tool.execute(
      {
        executable: process.execPath,
        args: ['-e', source, ...extraArgs],
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
      },
      { workspaceRoot: hostRoot },
    );

    output('D044 安全边界：realpath(executable) + 完整 argv 精确白名单；spawn shell:false');
    const allowed = await execute(successSource, [FAKE_SECRET]);
    const allowedSucceeded = allowed.isError !== true
      && (JSON.parse(allowed.content) as { stdout: string }).stdout === 'allowed-ok';
    output(`allowed=${code(allowed)} stdout=allowed-ok`);

    const deniedSource = `require('node:fs').writeFileSync(${JSON.stringify(deniedMarker)},${JSON.stringify(FAKE_SECRET)})`;
    const denied = await execute(deniedSource);
    const deniedMarkerCreated = existsSync(deniedMarker);
    output(`denied=${code(denied)} markerCreated=${String(deniedMarkerCreated)}`);

    const shellBypass = await execute(successSource, [
      FAKE_SECRET,
      ';',
      `require('node:fs').writeFileSync(${JSON.stringify(bypassMarker)},'bad')`,
      '>',
      '|',
      '$(true)',
    ]);
    const bypassMarkerCreated = existsSync(bypassMarker);
    output(`shellBypass=${code(shellBypass)} markerCreated=${String(bypassMarkerCreated)}`);

    const outputLimited = await execute(outputSource);
    const outputPayload = JSON.parse(outputLimited.content) as { stdoutBytes: number; stderrBytes: number };
    output(`output=${code(outputLimited)} capturedBytes=${outputPayload.stdoutBytes + outputPayload.stderrBytes} budget=64`);

    const timeout = await execute(timeoutSource, [], 40);
    output(`timeout=${code(timeout)} budgetMs=40`);

    const failClosedTool = createSecureCommandTool({
      allowlist: [nodeRule('demo-audit-down', `require('node:fs').writeFileSync(${JSON.stringify(failClosedMarker)},'bad')`)],
      auditSink: { append: () => Promise.reject(new Error('intentional demo audit outage')) },
      sensitiveValues: [FAKE_SECRET],
    });
    const auditFailure = await failClosedTool.execute(
      {
        executable: process.execPath,
        args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(failClosedMarker)},'bad')`],
      },
      { workspaceRoot: hostRoot },
    );
    const failClosedMarkerCreated = existsSync(failClosedMarker);
    output(`auditFailure=${code(auditFailure)} markerCreated=${String(failClosedMarkerCreated)}`);

    const auditJsonl = await readFile(auditPath, 'utf8');
    const records = auditJsonl.trimEnd().split('\n')
      .map((line) => JSON.parse(line) as CommandAuditRecord);
    const fakeSecretRedacted = !auditJsonl.includes(FAKE_SECRET) && auditJsonl.includes('[REDACTED]');
    partial = {
      allowedSucceeded,
      deniedCode: code(denied),
      shellBypassCode: code(shellBypass),
      dangerousMarkersAbsent: !deniedMarkerCreated && !bypassMarkerCreated,
      outputLimitCode: code(outputLimited),
      timeoutCode: code(timeout),
      failClosedCode: code(auditFailure),
      failClosedMarkerAbsent: !failClosedMarkerCreated,
      fakeSecretRedacted,
      auditJsonl,
    };
    output(`auditRecords=${records.length} redacted=${String(fakeSecretRedacted)} digest=sha256`);
  } finally {
    await rm(hostRoot, { recursive: true, force: true });
  }

  const report: D044DemoReport = { ...partial!, hostRootRemoved: !existsSync(hostRoot) };
  const passed = report.allowedSucceeded
    && report.deniedCode === 'COMMAND_NOT_ALLOWED'
    && report.shellBypassCode === 'COMMAND_NOT_ALLOWED'
    && report.dangerousMarkersAbsent
    && report.outputLimitCode === 'COMMAND_OUTPUT_LIMIT'
    && report.timeoutCode === 'COMMAND_TIMEOUT'
    && report.failClosedCode === 'AUDIT_WRITE_FAILED'
    && report.failClosedMarkerAbsent
    && report.fakeSecretRedacted
    && report.hostRootRemoved;
  if (!passed) throw new Error('D044 Demo 安全验收失败');
  output('D044 Demo PASS');
  return report;
}
