import { describe, expect, it } from 'vitest';

import { runD048Demo } from '../src/demo/d048.ts';

describe('D048 动态工具检索离线 Demo', () => {
  it('真实 AgentLoop 只接收检索子集，按需加载并回喂真实天气结果', async () => {
    const lines: string[] = [];
    const report = await runD048Demo((line) => lines.push(line));

    expect(report.stopReason).toBe('completed');
    expect(report.turns).toBe(2);
    expect(report.registeredTools).toHaveLength(8);
    expect(report.fullSchemaChars).toBeGreaterThan(report.requests[0]?.schemaChars ?? 0);
    expect(report.requests).toHaveLength(2);
    expect(report.requests.every((request) =>
      request.tools.includes('weather_current') && request.tools.length < 8)).toBe(true);
    expect(report.executedTools).toEqual(['weather_current']);
    expect(report.factoryCounts['weather_current']).toBe(1);
    expect(Object.values(report.factoryCounts).reduce((sum, count) => sum + count, 0)).toBe(1);
    expect(report.toolResult).toContain('"city":"上海"');
    expect(report.finalText).toContain('上海');
    expect(report.finalText).toContain('24');
    expect(report.finalText).toContain('tool-weather');
    expect(lines.join('\n')).toContain('字符数只是可测量代理指标，不是 token 精确节省');
    expect(lines.at(-1)).toContain('D048 Demo PASS');
  });
});
