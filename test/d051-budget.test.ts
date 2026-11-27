import { describe, expect, it } from 'vitest';

import { measureContextBudget, toolSchemaChars } from '../src/context/budget.ts';

describe('D051 统一上下文预算模型', () => {
  it('分别报告消息、工具 Schema、总量和剩余预算', () => {
    const messages = [{ role: 'user' as const, content: '查询天气' }];
    const tools = [{
      name: 'weather', description: '查询天气',
      parameters: { type: 'object', properties: {} },
    }];
    const report = measureContextBudget({ messages, tools, maxChars: 200 });

    expect(report.messageChars).toBe('查询天气'.length);
    expect(report.toolSchemaChars).toBe(toolSchemaChars(tools));
    expect(report.totalChars).toBe(report.messageChars + report.toolSchemaChars);
    expect(report.remainingChars).toBe(200 - report.totalChars);
    expect(report.fits).toBe(true);
  });

  it('工具 Schema 超预算时明确报告不适配，不静默截断', () => {
    const report = measureContextBudget({
      messages: [{ role: 'user', content: '目标' }],
      tools: [{
        name: 'large', description: '工具',
        parameters: { type: 'object', properties: { payload: { description: 'x'.repeat(100) } } },
      }],
      maxChars: 20,
    });
    expect(report.fits).toBe(false);
    expect(report.remainingChars).toBeLessThan(0);
  });

  it('拒绝零值、负数和非整数预算', () => {
    for (const maxChars of [0, -1, 1.5, Number.NaN]) {
      expect(() => measureContextBudget({ messages: [], maxChars })).toThrow('正整数');
    }
  });
});
