import { describe, expect, it } from 'vitest';

import { runD044Demo } from '../src/demo/d044.ts';
import type { CommandAuditRecord } from '../src/observability/audit-sink.ts';

describe('D044 安全加固 Demo', () => {
  it('真实展示允许、启动前拒绝、资源限制、fail-closed 与脱敏审计', async () => {
    const transcript: string[] = [];
    const report = await runD044Demo((line) => transcript.push(line));
    const text = transcript.join('\n');
    const records = report.auditJsonl.trimEnd().split('\n')
      .map((line) => JSON.parse(line) as CommandAuditRecord);

    expect(report).toMatchObject({
      allowedSucceeded: true,
      deniedCode: 'COMMAND_NOT_ALLOWED',
      shellBypassCode: 'COMMAND_NOT_ALLOWED',
      dangerousMarkersAbsent: true,
      outputLimitCode: 'COMMAND_OUTPUT_LIMIT',
      timeoutCode: 'COMMAND_TIMEOUT',
      failClosedCode: 'AUDIT_WRITE_FAILED',
      failClosedMarkerAbsent: true,
      fakeSecretRedacted: true,
      hostRootRemoved: true,
    });
    expect(records).toHaveLength(10);
    expect(records.some((record) => record.status === 'succeeded' && record.resultCode === 'OK')).toBe(true);
    expect(records.some((record) => record.status === 'denied')).toBe(true);
    expect(records.some((record) => record.resultCode === 'COMMAND_OUTPUT_LIMIT')).toBe(true);
    expect(records.some((record) => record.resultCode === 'COMMAND_TIMEOUT')).toBe(true);
    expect(records.every((record) => record.argvSha256.length === 64)).toBe(true);
    expect(report.auditJsonl).toContain('[REDACTED]');
    expect(report.auditJsonl).not.toContain('FAKE_D044_DEMO_SECRET_NEVER_REAL');
    expect(text).toContain('allowed=OK');
    expect(text).toContain('denied=COMMAND_NOT_ALLOWED markerCreated=false');
    expect(text).toContain('shellBypass=COMMAND_NOT_ALLOWED');
    expect(text).toContain('output=COMMAND_OUTPUT_LIMIT');
    expect(text).toContain('timeout=COMMAND_TIMEOUT');
    expect(text).toContain('auditFailure=AUDIT_WRITE_FAILED markerCreated=false');
    expect(text).toContain('D044 Demo PASS');
    expect(text).not.toContain('FAKE_D044_DEMO_SECRET_NEVER_REAL');
  }, 15_000);
});
