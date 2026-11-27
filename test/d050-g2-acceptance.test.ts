import { describe, expect, it } from 'vitest';

import { runD050G2Demo } from '../src/demo/d050.ts';

describe('D050 G2 阶段验收', () => {
  it('联合验证动态工具、外部 API 与 MCP 双后端，并报告真实证据', async () => {
    const output: string[] = [];
    const report = await runD050G2Demo((line) => output.push(line));

    expect(report.dynamicRetrieval).toEqual({
      passed: true,
      matchedTools: ['crm_lookup', 'weather_current'],
    });
    expect(report.externalSystem).toEqual({ passed: true, source: 'open-meteo', fetchCalls: 1 });
    expect(report.mcp).toMatchObject({
      passed: true,
      backends: ['local', 'mcp'],
      remoteTools: ['list_directory', 'read_file'],
    });
    expect(report.checks).toHaveLength(3);
    expect(output.join('\n')).toContain('D050 G2 ACCEPTANCE PASS');
  });
});
