import { describe, expect, it } from 'vitest';
import type { CommandAuditRecord } from '../src/observability/audit-sink.ts';
import { runD046Demo } from '../src/demo/d046.ts';

describe('runD046Demo', () => {
  it('真实回放攻击链、失败门禁和审计并清理唯一实验根', async () => {
    const lines: string[] = [];
    const report = await runD046Demo((line) => lines.push(line));
    const byId = new Map(report.items.map((item) => [item.id, item]));

    expect(report.hostRootRemoved).toBe(true);
    expect(report.secureSpawnCount).toBe(3);
    expect(report.secureDeniedSpawnDelta).toBe(0);
    expect(report.items).toHaveLength(12);
    expect(report.items.every((item) => item.passed)).toBe(true);
    expect([...byId.keys()]).toEqual([
      'D043_ABSOLUTE_PATH', 'D043_SHELL_CD', 'D043_CONTROLLED_RM',
      'D044_EXECUTABLE', 'D044_ARGV', 'D044_SHELL_META',
      'D044_COMMAND_SUBSTITUTION', 'D044_REDIRECTION',
      'D043_ENV_CONTROL', 'D044_ENV_CONTROL',
      'D044_OUTPUT_BUDGET', 'D044_WALL_TIMEOUT',
    ]);
    expect(byId.get('D043_ABSOLUTE_PATH')?.attackResult).toContain('cwd-crossed');
    expect(byId.get('D043_CONTROLLED_RM')?.observed).toContain('victimExists=false');
    expect(byId.get('D044_ARGV')?.observed).toContain('spawnDelta=0');
    expect(byId.get('D044_ARGV')?.observed).toContain('audit=decision+completion');
    expect(byId.get('D044_OUTPUT_BUDGET')?.observed).toContain('stdoutBytes=64');
    expect(byId.get('D044_WALL_TIMEOUT')?.observed).toContain('TIMEOUT');

    const records = report.auditJsonl.trim().split('\n').map((line) => JSON.parse(line) as CommandAuditRecord);
    expect(records).toHaveLength(16);
    const operationIds = [...new Set(records.map((record) => record.operationId))];
    expect(operationIds).toHaveLength(8);
    for (const operationId of operationIds) {
      expect(records.filter((record) => record.operationId === operationId).map((record) => record.phase))
        .toEqual(['decision', 'completion']);
    }
    expect(records.filter((record) => record.decision === 'denied')).toHaveLength(10);
    expect(lines.at(-1)).toContain('D046 Demo PASS');
    expect(lines.filter((line) => line.startsWith('item='))).toHaveLength(12);
    expect(lines.filter((line) => line.startsWith('item=')).every((line) =>
      line.includes(' expected=') && line.includes(' observed=') &&
      line.includes(' control=') && line.includes(' attackResult='))).toBe(true);
    expect(JSON.stringify({ report, lines })).not.toContain('FAKE_D046_HOST_SECRET_NOT_A_CREDENTIAL');
  });
});
