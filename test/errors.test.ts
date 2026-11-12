import { describe, expect, it } from 'vitest';

import type { Tool } from '../src/core/tool.ts';
import { ToolRegistry } from '../src/tools/registry.ts';

function registryWithSchemaTool(): { registry: ToolRegistry; calls: number } {
  const registry = new ToolRegistry();
  const counter = { calls: 0 };
  registry.register({
    name: 'typed',
    description: '带参数校验的测试工具',
    parameters: {
      type: 'object',
      properties: {
        value: { type: 'string' },
        mode: { enum: ['fast', 'safe'] },
      },
      required: ['value'],
      additionalProperties: false,
    },
    execute(args) {
      counter.calls += 1;
      return Promise.resolve({ content: JSON.stringify(args) });
    },
  });
  return { registry, get calls() { return counter.calls; } };
}

function registerTool(registry: ToolRegistry, tool: Tool): void {
  registry.register(tool);
}

describe('ToolRegistry 标准错误', () => {
  it('缺少必填参数时不进入工具执行，并给出字段修复提示', async () => {
    const { registry, calls } = registryWithSchemaTool();

    const result = await registry.execute(
      { id: 'c1', name: 'typed', arguments: '{}' },
      { workspaceRoot: '.' },
    );

    expect(calls).toBe(0);
    expect(result.isError).toBe(true);
    expect(result.error).toMatchObject({ code: 'INVALID_ARGUMENTS', retryable: true });
    expect(result.error?.hint).toContain('$.value');
    expect(result.content).toContain('$.value');
    expect(result.content).toContain('必填');
  });

  it('错误类型、额外字段和 enum 均在执行前拒绝', async () => {
    const { registry, calls } = registryWithSchemaTool();

    for (const [index, args] of [
      { value: 1 },
      { value: 'x', extra: true },
      { value: 'x', mode: 'bad' },
    ].entries()) {
      const result = await registry.execute(
        { id: `c${index}`, name: 'typed', arguments: JSON.stringify(args) },
        { workspaceRoot: '.' },
      );
      expect(result.error?.code).toBe('INVALID_ARGUMENTS');
      expect(result.content).toContain('期望');
      expect(result.error?.hint).toContain('请');
    }
    expect(calls).toBe(0);
  });

  it('非法 JSON 不进入执行，并返回模型可读 hint', async () => {
    const { registry, calls } = registryWithSchemaTool();

    const result = await registry.execute(
      { id: 'c1', name: 'typed', arguments: '{bad json' },
      { workspaceRoot: '.' },
    );

    expect(calls).toBe(0);
    expect(result.error).toMatchObject({ code: 'INVALID_JSON', retryable: true });
    expect(result.content).toContain('合法 JSON');
    expect(result.error?.hint).toContain('JSON');
  });

  it('未知工具返回 UNKNOWN_TOOL 和可用工具提示', async () => {
    const { registry } = registryWithSchemaTool();

    const result = await registry.execute(
      { id: 'c1', name: 'missing', arguments: '{}' },
      { workspaceRoot: '.' },
    );

    expect(result.error).toMatchObject({ code: 'UNKNOWN_TOOL', retryable: true });
    expect(result.content).toContain('未知工具');
    expect(result.error?.hint).toContain('typed');
  });

  it('未知异常不泄露堆栈、伪造密钥或原始异常正文', async () => {
    const fakeSecret = 'sk-fake-D014-not-a-real-key';
    const registry = new ToolRegistry();
    registerTool(registry, {
      name: 'boom',
      description: '抛出未知异常',
      parameters: { type: 'object' },
      execute: () => Promise.reject(new Error(`stack trace ${fakeSecret}`)),
    });

    const result = await registry.execute(
      { id: 'c1', name: 'boom', arguments: '{}' },
      { workspaceRoot: '.' },
    );
    const serialized = JSON.stringify(result);

    expect(result.error).toMatchObject({ code: 'INTERNAL_ERROR', retryable: true });
    expect(result.error?.message).toBe('工具执行失败，请检查输入后重试');
    expect(serialized).not.toContain(fakeSecret);
    expect(serialized).not.toContain('stack trace');
    expect(serialized).not.toContain('Error:');
  });

  it('已知 ToolError 保留 code、message、retryable 和 hint', async () => {
    const { ToolError } = await import('../src/core/tool.ts');
    const registry = new ToolRegistry();
    registry.register({
      name: 'known',
      description: '抛出已知错误',
      parameters: { type: 'object' },
      execute: () => Promise.reject(new ToolError('EDIT_NO_MATCH', '没有匹配', false, '读取文件后重试')),
    });

    const result = await registry.execute(
      { id: 'c1', name: 'known', arguments: '{}' },
      { workspaceRoot: '.' },
    );

    expect(result).toEqual({
      content: '没有匹配\n提示：读取文件后重试',
      isError: true,
      error: {
        code: 'EDIT_NO_MATCH',
        message: '没有匹配',
        retryable: false,
        hint: '读取文件后重试',
      },
    });
  });

  it('空参数串按空对象处理，成功结果不附 error', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'ok',
      description: '成功工具',
      parameters: { type: 'object' },
      execute: (args) => Promise.resolve({ content: JSON.stringify(args) }),
    });

    const result = await registry.execute(
      { id: 'c1', name: 'ok', arguments: '  ' },
      { workspaceRoot: '.' },
    );

    expect(result).toEqual({ content: '{}' });
    expect(result.error).toBeUndefined();
  });
});

describe('标准错误辅助函数', () => {
  it('toolError 生成 content、isError 与结构化详情', async () => {
    const { toolError } = await import('../src/tools/errors.ts');

    expect(toolError('FILE_NOT_FOUND', '文件不存在', true, '先列出目录')).toEqual({
      content: '文件不存在\n提示：先列出目录',
      isError: true,
      error: {
        code: 'FILE_NOT_FOUND',
        message: '文件不存在',
        retryable: true,
        hint: '先列出目录',
      },
    });
  });

  it('normalizeError 保留 ToolError，其他值统一脱敏', async () => {
    const { ToolError } = await import('../src/core/tool.ts');
    const { normalizeError } = await import('../src/tools/errors.ts');
    const known = new ToolError('NOT_A_FILE', '不是文件', true);

    expect(normalizeError(known)).toBe(known);
    expect(normalizeError('sk-fake-D014-not-a-real-key')).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: '工具执行失败，请检查输入后重试',
      retryable: true,
    });
    expect(normalizeError('sk-fake-D014-not-a-real-key').message).not.toContain('sk-fake');
  });
});

describe('validateArguments JSON Schema 子集', () => {
  it.each([
    { type: 'string', valid: 'x', invalid: 1 },
    { type: 'number', valid: 1.5, invalid: '1.5' },
    { type: 'integer', valid: 2, invalid: 2.5 },
    { type: 'boolean', valid: true, invalid: 0 },
    { type: 'object', valid: {}, invalid: [] },
  ])('直接校验 $type 类型', async ({ type, valid, invalid }) => {
    const { validateArguments } = await import('../src/tools/schema.ts');

    expect(validateArguments({ type }, valid)).toBeUndefined();
    expect(validateArguments({ type }, invalid)).toMatchObject({ path: '$', expected: type });
  });

  it('number 只接受有限数，object 拒绝 null', async () => {
    const { validateArguments } = await import('../src/tools/schema.ts');

    expect(validateArguments({ type: 'number' }, Number.NaN)).toMatchObject({ expected: 'number' });
    expect(validateArguments({ type: 'number' }, Number.POSITIVE_INFINITY)).toMatchObject({ expected: 'number' });
    expect(validateArguments({ type: 'object' }, null)).toMatchObject({ expected: 'object' });
  });

  it('直接报告 required 缺失字段路径', async () => {
    const { validateArguments } = await import('../src/tools/schema.ts');

    expect(validateArguments({ type: 'object', required: ['value'] }, {})).toEqual({
      path: '$.value',
      expected: '必填字段',
      message: '缺少必填字段',
    });
  });

  it('直接报告 additionalProperties 额外字段路径', async () => {
    const { validateArguments } = await import('../src/tools/schema.ts');

    expect(validateArguments({
      type: 'object',
      properties: { value: { type: 'string' } },
      additionalProperties: false,
    }, { value: 'x', extra: true })).toMatchObject({
      path: '$.extra',
      message: '存在额外字段',
    });
  });

  it('直接报告 enum 非允许值', async () => {
    const { validateArguments } = await import('../src/tools/schema.ts');

    expect(validateArguments({ enum: ['fast', 'safe'] }, 'bad')).toEqual({
      path: '$',
      expected: 'fast / safe',
      message: '不是允许的枚举值',
    });
  });

  it('嵌套 properties 报告完整路径 $.profile.name', async () => {
    const { validateArguments } = await import('../src/tools/schema.ts');
    const schema = {
      type: 'object',
      properties: {
        profile: {
          type: 'object',
          properties: { name: { type: 'string' } },
          required: ['name'],
          additionalProperties: false,
        },
      },
      required: ['profile'],
      additionalProperties: false,
    };

    expect(validateArguments(schema, { profile: { name: 7 } })).toMatchObject({
      path: '$.profile.name',
      expected: 'string',
    });
    expect(validateArguments(schema, { profile: {} })).toMatchObject({ path: '$.profile.name' });
    expect(validateArguments(schema, { profile: { name: 'Ada', extra: true } })).toMatchObject({
      path: '$.profile.extra',
    });
    expect(validateArguments(schema, { profile: { name: 'Ada' } })).toBeUndefined();
  });

  it('支持 minLength，其他未知 Schema 关键字仍直接忽略', async () => {
    const { validateArguments } = await import('../src/tools/schema.ts');

    expect(validateArguments({ type: 'string', minLength: 2 }, 'x')).toMatchObject({
      path: '$',
      expected: '长度 >= 2',
    });
    expect(validateArguments({ type: 'string', pattern: '^never$' }, 'x')).toBeUndefined();
  });
});
