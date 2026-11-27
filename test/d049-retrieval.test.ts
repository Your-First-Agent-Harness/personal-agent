import { describe, expect, it } from 'vitest';

import { runD049Demo } from '../src/demo/d049.ts';
import { DynamicToolRegistry } from '../src/tools/dynamic-registry.ts';
import type { Tool } from '../src/core/tool.ts';

const schema = (name: string, description: string) => ({
  name,
  description,
  parameters: { type: 'object', properties: {} },
});

describe('D049 动态工具检索生产化', () => {
  it('按标签返回稳定评分，并且不把 metadata 发给模型', () => {
    const registry = new DynamicToolRegistry({ limit: 2 });
    const crm = schema('crm_lookup', '查询客户');
    const calendar = schema('calendar_create', '创建日程');
    const crmTool: Tool = { ...crm, execute: () => Promise.resolve({ content: 'ok' }) };
    registry.register(crmTool, {
      metadata: { tags: ['外部系统'] },
    });
    const calendarTool: Tool = { ...calendar, execute: () => Promise.resolve({ content: 'ok' }) };
    registry.register(calendarTool, {
      metadata: { tags: ['工作流'] },
    });

    expect(registry.search('外部系统')).toMatchObject([
      { tool: { name: 'crm_lookup' }, score: 24 },
    ]);
    expect(registry.list('外部系统')[0]).toEqual(schema('crm_lookup', '查询客户'));
  });

  it('D049 Demo 验证检索事件可审计且检索阶段不加载 lazy 工具', async () => {
    const lines: string[] = [];
    const report = await runD049Demo((line) => lines.push(line));

    expect(report.matches[0]).toEqual({ name: 'crm_lookup', score: 36 });
    expect(report.retrievedEvents[0]).toMatchObject({
      type: 'tools_retrieved',
      query: '客户外部系统',
      toolNames: ['crm_lookup', 'weather_current'],
    });
    expect(report.loadedTools).toEqual([]);
    expect(lines.at(-1)).toContain('D049 Demo PASS');
  });
});
