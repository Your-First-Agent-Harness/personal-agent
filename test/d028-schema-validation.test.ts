import { describe, expect, it, vi } from 'vitest';

import type { Tool } from '../src/core/tool.ts';
import { createBuiltinTools } from '../src/tools/builtin.ts';
import { ToolRegistry } from '../src/tools/registry.ts';
import { runCommandTool } from '../src/tools/run-command.ts';
import { validateArguments } from '../src/tools/schema.ts';

const parameters = {
  type: 'object',
  properties: {
    profile: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1 },
        age: { type: 'integer', minimum: 0, maximum: 150 },
      },
      required: ['name', 'age'],
      additionalProperties: false,
    },
    tags: {
      type: 'array',
      items: { type: 'string', minLength: 1 },
    },
    members: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string', minLength: 1 } },
        required: ['name'],
        additionalProperties: false,
      },
    },
  },
  required: ['profile', 'tags', 'members'],
  additionalProperties: false,
} as const;

function spyRegistry(): { registry: ToolRegistry; execute: ReturnType<typeof vi.fn> } {
  const registry = new ToolRegistry();
  const execute = vi.fn((args: unknown) => Promise.resolve({ content: JSON.stringify(args) }));
  registry.register({ name: 'spy', description: '记录合法入参', parameters, execute });
  return { registry, execute };
}

function toolWithParameters(value: unknown): Tool {
  return {
    name: 'schema_tool',
    description: 'Schema 注册测试',
    parameters: value as Record<string, unknown>,
    execute: () => Promise.resolve({ content: 'ok' }),
  };
}

describe('D028 参数在执行前校验', () => {
  it.each([
    { label: '根值 null', args: null, path: '$', expected: 'object' },
    { label: '根值数组', args: [], path: '$', expected: 'object' },
    { label: '根值字符串', args: 'root', path: '$', expected: 'object' },
    { label: '缺少嵌套对象', args: { tags: [], members: [] }, path: '$.profile', expected: '必填字段' },
    {
      label: '缺少对象内必填字段',
      args: { profile: { age: 20 }, tags: [], members: [] },
      path: '$.profile.name',
      expected: '必填字段',
    },
    {
      label: '嵌套对象类型错误',
      args: { profile: null, tags: [], members: [] },
      path: '$.profile',
      expected: 'object',
    },
    {
      label: '数组类型错误',
      args: { profile: { name: 'Ada', age: 20 }, tags: {}, members: [] },
      path: '$.tags',
      expected: 'array',
    },
    {
      label: '数组成员类型错误',
      args: { profile: { name: 'Ada', age: 20 }, tags: ['ai', 7], members: [] },
      path: '$.tags[1]',
      expected: 'string',
    },
    {
      label: '数组内对象的字段类型错误',
      args: { profile: { name: 'Ada', age: 20 }, tags: [], members: [{ name: 'Grace' }, { name: 9 }] },
      path: '$.members[1].name',
      expected: 'string',
    },
    {
      label: '字符串最小长度',
      args: { profile: { name: '', age: 20 }, tags: [], members: [] },
      path: '$.profile.name',
      expected: '长度 >= 1',
    },
    {
      label: '数值下界',
      args: { profile: { name: 'Ada', age: -1 }, tags: [], members: [] },
      path: '$.profile.age',
      expected: '>= 0',
    },
    {
      label: '数值上界',
      args: { profile: { name: 'Ada', age: 151 }, tags: [], members: [] },
      path: '$.profile.age',
      expected: '<= 150',
    },
    {
      label: 'integer 不接受小数',
      args: { profile: { name: 'Ada', age: 1.5 }, tags: [], members: [] },
      path: '$.profile.age',
      expected: 'integer',
    },
    {
      label: '数组内对象的额外字段',
      args: { profile: { name: 'Ada', age: 20 }, tags: [], members: [{ name: 'Grace', extra: true }] },
      path: '$.members[0].extra',
      expected: '仅允许 name',
    },
  ])('拦截 $label 并返回可读路径和修复提示，execute 不运行', async ({ args, path, expected }) => {
    const { registry, execute } = spyRegistry();

    const result = await registry.execute(
      { id: 'call-invalid', name: 'spy', arguments: JSON.stringify(args) },
      { workspaceRoot: '.' },
    );

    expect(result).toMatchObject({
      isError: true,
      error: { code: 'INVALID_ARGUMENTS', retryable: true },
    });
    expect(result.error?.message).toContain(path);
    expect(result.error?.message).toContain(expected);
    expect(result.error?.hint).toContain(`请修正 ${path}`);
    expect(execute).not.toHaveBeenCalled();
  });

  it('合法嵌套参数和约束边界保持可用，原始值交给 execute', async () => {
    const { registry, execute } = spyRegistry();
    const args = {
      profile: { name: 'Ada', age: 0 },
      tags: [],
      members: [{ name: 'Grace' }, { name: 'Linus' }],
    };

    const result = await registry.execute(
      { id: 'call-valid', name: 'spy', arguments: JSON.stringify(args) },
      { workspaceRoot: '.' },
    );

    expect(result).toEqual({ content: JSON.stringify(args) });
    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith(args, { workspaceRoot: '.' });
  });
});

describe('D028 validateArguments 递归与约束', () => {
  it('直接报告数组元素及数组内对象的完整索引路径', () => {
    expect(validateArguments(
      { type: 'array', items: { type: 'boolean' } },
      [true, 0],
    )).toMatchObject({ path: '$[1]', expected: 'boolean' });

    expect(validateArguments(parameters, {
      profile: { name: 'Ada', age: 150 },
      tags: ['agent'],
      members: [{ name: 'Grace' }, {}],
    })).toMatchObject({ path: '$.members[1].name', expected: '必填字段' });
  });

  it('支持 array 与 null 类型，合法数组原样通过', () => {
    expect(validateArguments({ type: 'array', items: { type: 'number' } }, [1, 2.5])).toBeUndefined();
    expect(validateArguments({ type: 'array' }, {})).toMatchObject({ path: '$', expected: 'array' });
    expect(validateArguments({ type: 'null' }, null)).toBeUndefined();
    expect(validateArguments({ type: 'null' }, {})).toMatchObject({ path: '$', expected: 'null' });
  });

  it('minLength 按 Unicode 字符计数，minimum/maximum 包含边界', () => {
    expect(validateArguments({ type: 'string', minLength: 2 }, '🤖')).toMatchObject({
      path: '$',
      expected: '长度 >= 2',
    });
    expect(validateArguments({ type: 'string', minLength: 2 }, '🤖a')).toBeUndefined();
    expect(validateArguments({ type: 'number', minimum: 1, maximum: 2 }, 1)).toBeUndefined();
    expect(validateArguments({ type: 'number', minimum: 1, maximum: 2 }, 2)).toBeUndefined();
  });
});

describe('D028 注册期 Schema 校验', () => {
  it.each([
    { label: '根类型不是 object', value: { type: 'array' }, path: '$.type' },
    { label: '缺少根类型', value: { properties: {} }, path: '$.type' },
    { label: '未知类型', value: { type: 'object', properties: { value: { type: 'text' } } }, path: '$.properties.value.type' },
    { label: 'properties 不是对象', value: { type: 'object', properties: [] }, path: '$.properties' },
    { label: '属性 Schema 不是对象', value: { type: 'object', properties: { value: null } }, path: '$.properties.value' },
    { label: 'required 不是数组', value: { type: 'object', required: 'value' }, path: '$.required' },
    { label: 'required 含非字符串', value: { type: 'object', required: [1] }, path: '$.required[0]' },
    { label: 'additionalProperties 不是布尔值', value: { type: 'object', additionalProperties: 'false' }, path: '$.additionalProperties' },
    { label: '数组 items 不是 Schema', value: { type: 'object', properties: { values: { type: 'array', items: [] } } }, path: '$.properties.values.items' },
    { label: 'minLength 不是非负整数', value: { type: 'object', properties: { value: { type: 'string', minLength: -1 } } }, path: '$.properties.value.minLength' },
    { label: 'minLength 用在非字符串上', value: { type: 'object', properties: { value: { type: 'number', minLength: 1 } } }, path: '$.properties.value.minLength' },
    { label: 'minimum 不是有限数', value: { type: 'object', properties: { value: { type: 'number', minimum: Number.NaN } } }, path: '$.properties.value.minimum' },
    { label: 'minimum 用在非数值上', value: { type: 'object', properties: { value: { type: 'string', minimum: 1 } } }, path: '$.properties.value.minimum' },
    { label: '数值范围颠倒', value: { type: 'object', properties: { value: { type: 'integer', minimum: 2, maximum: 1 } } }, path: '$.properties.value.maximum' },
    { label: 'enum 为空', value: { type: 'object', properties: { value: { enum: [] } } }, path: '$.properties.value.enum' },
  ])('拒绝 $label，错误包含 Schema 路径', ({ value, path }) => {
    const registry = new ToolRegistry();

    expect(() => registry.register(toolWithParameters(value))).toThrow(TypeError);
    expect(() => registry.register(toolWithParameters(value))).toThrow(`非法工具注册：parameters ${path}`);
    expect(registry.size).toBe(0);
  });

  it('非法 Schema 的 replace 不破坏旧工具', async () => {
    const registry = new ToolRegistry();
    registry.register(toolWithParameters({ type: 'object' }), { version: '1.0.0' });

    expect(() => registry.replace(
      { ...toolWithParameters({ type: 'array' }), description: 'broken v2' },
      { version: '2.0.0' },
    )).toThrow('parameters $.type');

    expect(registry.describe('schema_tool')).toMatchObject({
      description: 'Schema 注册测试',
      version: '1.0.0',
    });
    const result = await registry.execute(
      { id: 'call-stable', name: 'schema_tool', arguments: '{}' },
      { workspaceRoot: '.' },
    );
    expect(result.content).toBe('ok');
  });

  it('所有内置工具的新 Schema 均可注册，run_command 范围错误在 spawn 前拦截', async () => {
    const registry = new ToolRegistry();
    for (const tool of createBuiltinTools()) registry.register(tool);
    expect(registry.size).toBe(5);

    const execute = vi.fn((args: unknown, context: Parameters<Tool['execute']>[1]) =>
      runCommandTool.execute(args, context),
    );
    const commandRegistry = new ToolRegistry();
    commandRegistry.register({ ...runCommandTool, execute });
    expect(commandRegistry.list()[0]?.parameters).toMatchObject({
      properties: {
        command: { type: 'string', minLength: 1 },
        timeoutMs: { type: 'integer', minimum: 1, maximum: 30_000 },
      },
    });

    for (const args of [{ command: '' }, { command: 'pwd', timeoutMs: 0 }, { command: 'pwd', timeoutMs: 30_001 }]) {
      const result = await commandRegistry.execute(
        { id: 'call-command', name: 'run_command', arguments: JSON.stringify(args) },
        { workspaceRoot: '.' },
      );
      expect(result.error?.code).toBe('INVALID_ARGUMENTS');
    }
    expect(execute).not.toHaveBeenCalled();
  });
});
