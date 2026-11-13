import { describe, expect, it, vi } from 'vitest';

import type { Tool, ToolSchema } from '../src/core/tool.ts';
import { DynamicToolRegistry } from '../src/tools/dynamic-registry.ts';
import { searchToolSchemas } from '../src/tools/retrieval.ts';
import { ToolRegistry } from '../src/tools/registry.ts';

function schema(name: string, description: string): ToolSchema {
  return { name, description, parameters: { type: 'object', properties: {} } };
}

function tool(name: string, description: string): Tool {
  return {
    ...schema(name, description),
    execute: () => Promise.resolve({ content: name }),
  };
}

describe('D048 确定性词法工具检索', () => {
  it('名称命中排在仅描述命中之前，重复词不会重复计分', () => {
    const catalog = [
      schema('unrelated_helper', 'weather weather weather'),
      schema('weather', '通用工具'),
      schema('calendar', '日程管理'),
    ];

    const once = searchToolSchemas(catalog, 'weather');
    const repeated = searchToolSchemas(catalog, 'weather weather WEATHER');

    expect(once.map((entry) => entry.name)).toEqual(['weather', 'unrelated_helper']);
    expect(repeated).toEqual(once);
  });

  it('支持英文工具名分词、大小写归一和基本中文连续文本', () => {
    const catalog = [
      schema('expense_report', '生成费用报销单'),
      schema('weather_current', '查询当前天气与温度'),
      schema('calendar_create', '创建会议日程'),
    ];

    expect(searchToolSchemas(catalog, 'WEATHER').map((entry) => entry.name)).toEqual([
      'weather_current',
    ]);
    expect(searchToolSchemas(catalog, '请查询北京天气').map((entry) => entry.name)).toEqual([
      'weather_current',
    ]);
    expect(searchToolSchemas(catalog, '创建日程').map((entry) => entry.name)).toEqual([
      'calendar_create',
    ]);
  });

  it('同分保持目录顺序，limit 截断且默认最多返回五项', () => {
    const catalog = Array.from({ length: 7 }, (_, index) =>
      schema(`tool_${index}`, '共同 searchable 描述'));

    expect(searchToolSchemas(catalog, 'searchable', 3).map((entry) => entry.name)).toEqual([
      'tool_0', 'tool_1', 'tool_2',
    ]);
    expect(searchToolSchemas(catalog, 'searchable')).toHaveLength(5);
  });

  it('空查询、无匹配与零 limit 返回空数组，非法 limit 明确拒绝', () => {
    const catalog = [schema('weather', '天气')];

    expect(searchToolSchemas(catalog, '')).toEqual([]);
    expect(searchToolSchemas(catalog, '   ')).toEqual([]);
    expect(searchToolSchemas(catalog, '不存在的能力')).toEqual([]);
    expect(searchToolSchemas(catalog, '天气', 0)).toEqual([]);
    for (const limit of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => searchToolSchemas(catalog, '天气', limit)).toThrow('非负整数');
    }
  });
});

describe('D048 DynamicToolRegistry 目录与策略', () => {
  it('catalog 保留全量策略可见 Schema，list 只返回查询子集且不加载 eager 以外的行为', () => {
    const registry = new DynamicToolRegistry({ limit: 1 });
    registry.register(tool('weather_current', '查询当前天气'));
    registry.register(tool('calendar_create', '创建日程'));

    expect(registry.catalog().map((entry) => entry.name)).toEqual([
      'weather_current', 'calendar_create',
    ]);
    expect(registry.list('天气').map((entry) => entry.name)).toEqual(['weather_current']);
    expect(registry.list('')).toEqual([]);
    expect(registry.list('没有匹配')).toEqual([]);
  });

  it('检索发生在 allowlist 与 tenant 过滤之后，不暴露其他主体目录', () => {
    const registry = new DynamicToolRegistry({
      allowedTools: ['shared_weather', 'tenant_weather'],
      tenantId: 'tenant-a',
      limit: 5,
    });
    registry.register(tool('shared_weather', '共享天气'));
    registry.register(tool('tenant_weather', '租户天气'), { tenantId: 'tenant-a' });
    registry.register(tool('other_weather', '其他租户天气'), { tenantId: 'tenant-b' });
    registry.register(tool('denied_weather', '白名单外天气'));

    expect(registry.catalog().map((entry) => entry.name)).toEqual([
      'shared_weather', 'tenant_weather',
    ]);
    expect(registry.list('天气').map((entry) => entry.name)).toEqual([
      'shared_weather', 'tenant_weather',
    ]);
    expect(JSON.stringify(registry.list('天气'))).not.toContain('其他租户');
  });

  it('普通 ToolRegistry 忽略可选查询并继续返回全量，旧 Tool[] 用法不变', () => {
    const registry = new ToolRegistry();
    const execute = vi.fn(() => Promise.resolve({ content: 'ok' }));
    registry.register({ ...tool('weather', '天气'), execute });
    registry.register(tool('calendar', '日程'));

    expect(registry.list('天气').map((entry) => entry.name)).toEqual(['weather', 'calendar']);
    expect(registry.list().map((entry) => entry.name)).toEqual(['weather', 'calendar']);
  });
});
