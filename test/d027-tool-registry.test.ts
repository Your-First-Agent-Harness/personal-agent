import { describe, expect, it } from 'vitest';

import {
  ToolRegistry,
  type Tool,
  type ToolDescriptor,
  type ToolRegistrationOptions,
} from '../src/index.ts';

function makeTool(name = 'adder', description = '加法工具', content = 'ok'): Tool {
  return {
    name,
    description,
    parameters: { type: 'object', properties: {} },
    execute: () => Promise.resolve({ content }),
  };
}

describe('D027 工具发现', () => {
  it('发现当前工具的版本和元数据，同时保持模型 Schema 不变', () => {
    const registry = new ToolRegistry();
    const tool = makeTool();
    registry.register(tool, {
      version: '1.2.0',
      metadata: { source: 'local', tags: ['math', 'stable'] },
    });

    const expected = {
      name: 'adder',
      description: '加法工具',
      parameters: { type: 'object', properties: {} },
      version: '1.2.0',
      metadata: { source: 'local', tags: ['math', 'stable'] },
    };
    const descriptor: ToolDescriptor | undefined = registry.describe('adder');
    expect(registry.discover()).toEqual([expected]);
    expect(descriptor).toEqual(expected);
    expect(registry.describe('missing')).toBeUndefined();
    expect(registry.list()).toEqual([{
      name: 'adder',
      description: '加法工具',
      parameters: { type: 'object', properties: {} },
    }]);
  });

  it('旧式注册保持可用，并以 unversioned 明示未声明版本', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool());

    expect(registry.describe('adder')).toMatchObject({
      version: 'unversioned',
      metadata: {},
    });
  });

  it('替换同名工具后发现和执行都使用新版本，拒绝替换不存在的名称', async () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('adder', '旧版加法', 'v1'), {
      version: '1.0.0',
      metadata: { source: 'builtin' },
    });

    expect(() => registry.replace(makeTool('missing'))).toThrow('未注册');
    registry.replace(makeTool('adder', '新版加法', 'v2'), {
      version: '2.0.0',
      metadata: { source: 'local' },
    });

    expect(registry.size).toBe(1);
    expect(registry.describe('adder')).toMatchObject({
      description: '新版加法',
      version: '2.0.0',
      metadata: { source: 'local' },
    });
    const result = await registry.execute(
      { id: 'call-1', name: 'adder', arguments: '{}' },
      { workspaceRoot: '.' },
    );
    expect(result.content).toBe('v2');
  });

  it.each([
    { label: '空名称', tool: { ...makeTool(), name: '  ' }, message: '工具名称' },
    { label: '空描述', tool: { ...makeTool(), description: '' }, message: '工具描述' },
    { label: '缺少参数 Schema', tool: { ...makeTool(), parameters: null }, message: 'parameters' },
    { label: '缺少执行函数', tool: { ...makeTool(), execute: null }, message: 'execute' },
  ])('拒绝非法注册：$label', ({ tool, message }) => {
    const registry = new ToolRegistry();

    expect(() => registry.register(tool as Tool)).toThrow(message);
    expect(registry.size).toBe(0);
  });

  it.each([
    { label: '空版本', options: { version: ' ' }, message: 'version' },
    { label: '非法元数据', options: { metadata: [] }, message: 'metadata' },
  ])('拒绝非法注册选项：$label', ({ options, message }) => {
    const registry = new ToolRegistry();

    expect(() => registry.register(
      makeTool(),
      options as unknown as ToolRegistrationOptions,
    )).toThrow(message);
    expect(registry.size).toBe(0);
  });

  it('非法替换不会破坏仍可用的旧版本', async () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('adder', '稳定版', 'v1'), { version: '1.0.0' });
    const broken = { ...makeTool('adder', '损坏版', 'v2'), execute: null } as unknown as Tool;

    expect(() => registry.replace(broken, { version: '2.0.0' })).toThrow('execute');
    expect(registry.describe('adder')).toMatchObject({ description: '稳定版', version: '1.0.0' });
    const result = await registry.execute(
      { id: 'call-1', name: 'adder', arguments: '{}' },
      { workspaceRoot: '.' },
    );
    expect(result.content).toBe('v1');
  });

  it('注销立即移除发现和执行能力，缺失名称返回 false', async () => {
    const registry = new ToolRegistry();
    registry.register(makeTool());

    expect(registry.unregister('missing')).toBe(false);
    expect(registry.size).toBe(1);
    expect(registry.unregister('adder')).toBe(true);
    expect(registry.unregister('adder')).toBe(false);
    expect(registry.size).toBe(0);
    expect(registry.discover()).toEqual([]);

    const result = await registry.execute(
      { id: 'call-1', name: 'adder', arguments: '{}' },
      { workspaceRoot: '.' },
    );
    expect(result.error?.code).toBe('UNKNOWN_TOOL');
  });
});
