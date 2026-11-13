import { describe, expect, it, vi } from 'vitest';

import type { ToolCall } from '../src/core/message.ts';
import type { Tool, ToolSchema } from '../src/core/tool.ts';
import { DynamicToolRegistry } from '../src/tools/dynamic-registry.ts';
import { ToolRegistry } from '../src/tools/registry.ts';

const weatherSchema: ToolSchema = {
  name: 'weather_current',
  description: '查询当前天气与温度 current weather',
  parameters: {
    type: 'object',
    properties: { city: { type: 'string' } },
    required: ['city'],
    additionalProperties: false,
  },
};

function weatherTool(execute = vi.fn((args: unknown) =>
  Promise.resolve({ content: JSON.stringify(args) }))): Tool {
  return { ...weatherSchema, execute };
}

function call(name: string, args: unknown = { city: '上海' }, id = 'call-1'): ToolCall {
  return { id, name, arguments: JSON.stringify(args) };
}

describe('D048 lazy tool 生命周期', () => {
  it('目录、检索和选中 Schema 都不实例化；有效执行时加载并缓存同一实例', async () => {
    const execute = vi.fn((args: unknown) => Promise.resolve({ content: JSON.stringify(args) }));
    const factory = vi.fn(() => weatherTool(execute));
    const registry = new DynamicToolRegistry();
    registry.registerLazy(weatherSchema, factory);

    expect(registry.catalog()).toHaveLength(1);
    expect(registry.list('天气').map((entry) => entry.name)).toEqual(['weather_current']);
    expect(factory).not.toHaveBeenCalled();

    const first = await registry.execute(call('weather_current', { city: '上海' }, 'first'), {
      workspaceRoot: '.',
    });
    const second = await registry.execute(call('weather_current', { city: '北京' }, 'second'), {
      workspaceRoot: '.',
    });

    expect(first.content).toBe('{"city":"上海"}');
    expect(second.content).toBe('{"city":"北京"}');
    expect(factory).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('异步 factory 的并发首次执行共享同一个加载 Promise', async () => {
    const factory = vi.fn(async () => {
      await Promise.resolve();
      return weatherTool();
    });
    const registry = new ToolRegistry();
    registry.registerLazy(weatherSchema, factory);

    const results = await Promise.all([
      registry.execute(call('weather_current', { city: '上海' }, 'a'), { workspaceRoot: '.' }),
      registry.execute(call('weather_current', { city: '北京' }, 'b'), { workspaceRoot: '.' }),
    ]);

    expect(results.every((result) => result.isError !== true)).toBe(true);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('factory 异常进入统一 ToolResult 边界、不泄露原错误，并可在后续调用重试', async () => {
    const secret = 'factory-secret-must-not-leak';
    const factory = vi.fn()
      .mockRejectedValueOnce(new Error(secret))
      .mockResolvedValueOnce(weatherTool());
    const registry = new ToolRegistry();
    registry.registerLazy(weatherSchema, factory);

    const failed = await registry.execute(call('weather_current', { city: '上海' }, 'failed'), {
      workspaceRoot: '.',
    });
    const recovered = await registry.execute(call('weather_current', { city: '上海' }, 'recovered'), {
      workspaceRoot: '.',
    });
    const cached = await registry.execute(call('weather_current', { city: '上海' }, 'cached'), {
      workspaceRoot: '.',
    });

    expect(failed).toMatchObject({ isError: true, error: { code: 'INTERNAL_ERROR' } });
    expect(JSON.stringify(failed)).not.toContain(secret);
    expect(recovered.isError).toBeUndefined();
    expect(cached.isError).toBeUndefined();
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('factory 返回名称不匹配的工具时安全失败，不缓存错误实例', async () => {
    const registry = new ToolRegistry();
    const factory = vi.fn()
      .mockReturnValueOnce({ ...weatherTool(), name: 'different_tool' })
      .mockReturnValueOnce(weatherTool());
    registry.registerLazy(weatherSchema, factory);

    const mismatch = await registry.execute(call('weather_current'), { workspaceRoot: '.' });
    const recovered = await registry.execute(call('weather_current'), { workspaceRoot: '.' });

    expect(mismatch).toMatchObject({ isError: true, error: { code: 'INTERNAL_ERROR' } });
    expect(recovered.isError).toBeUndefined();
    expect(factory).toHaveBeenCalledTimes(2);
  });
});

describe('D048 lazy tool 不绕过 Registry 安全顺序', () => {
  it('白名单或租户拒绝、JSON/Schema 错误、确认拒绝都不运行 factory', async () => {
    const confirm = vi.fn(() => false);
    const registry = new ToolRegistry({
      allowedTools: ['weather_current'],
      tenantId: 'tenant-a',
      confirmSensitiveTool: confirm,
    });
    const allowedFactory = vi.fn(() => weatherTool());
    const hiddenFactory = vi.fn(() => weatherTool());
    const deniedFactory = vi.fn(() => weatherTool());
    registry.registerLazy(weatherSchema, allowedFactory, { sensitive: true });
    registry.registerLazy(
      { ...weatherSchema, name: 'tenant_secret' },
      hiddenFactory,
      { tenantId: 'tenant-b' },
    );
    registry.registerLazy(
      { ...weatherSchema, name: 'denied_by_allowlist' },
      deniedFactory,
    );

    const deniedByTenant = await registry.execute(call('tenant_secret'), { workspaceRoot: '.' });
    const deniedByAllowlist = await registry.execute(
      call('denied_by_allowlist'), { workspaceRoot: '.' },
    );
    const invalidJson = await registry.execute(
      { id: 'bad-json', name: 'weather_current', arguments: '{bad json' }, { workspaceRoot: '.' },
    );
    const invalidArgs = await registry.execute(call('weather_current', {}), { workspaceRoot: '.' });
    const unconfirmed = await registry.execute(call('weather_current'), { workspaceRoot: '.' });

    expect(deniedByTenant.error?.code).toBe('TOOL_NOT_ALLOWED');
    expect(deniedByAllowlist.error?.code).toBe('TOOL_NOT_ALLOWED');
    expect(invalidJson.error?.code).toBe('INVALID_JSON');
    expect(invalidArgs.error?.code).toBe('INVALID_ARGUMENTS');
    expect(unconfirmed.error?.code).toBe('TOOL_CONFIRMATION_REQUIRED');
    expect(allowedFactory).not.toHaveBeenCalled();
    expect(hiddenFactory).not.toHaveBeenCalled();
    expect(deniedFactory).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('明确确认后才加载，已注册的 resilience 超时策略仍生效', async () => {
    const confirm = vi.fn()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const registry = new ToolRegistry({ confirmSensitiveTool: confirm });
    const factory = vi.fn(() => ({
      ...weatherTool(),
      execute: () => new Promise<never>(() => {}),
    }));
    registry.registerLazy(weatherSchema, factory, { sensitive: true, resilience: { timeoutMs: 5 } });

    const denied = await registry.execute(call('weather_current', { city: '上海' }, 'denied'), {
      workspaceRoot: '.',
    });
    expect(denied.error?.code).toBe('TOOL_CONFIRMATION_REQUIRED');
    expect(factory).not.toHaveBeenCalled();

    const timedOut = await registry.execute(call('weather_current', { city: '上海' }, 'approved'), {
      workspaceRoot: '.',
    });
    expect(timedOut.error?.code).toBe('TOOL_TIMEOUT');
    expect(factory).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it('搜索不可见不等于执行未授权：策略允许的直接调用仍按原语义执行', async () => {
    const registry = new DynamicToolRegistry();
    const factory = vi.fn(() => weatherTool());
    registry.registerLazy(weatherSchema, factory);

    expect(registry.list('日程')).toEqual([]);
    const result = await registry.execute(call('weather_current'), { workspaceRoot: '.' });

    expect(result.isError).toBeUndefined();
    expect(factory).toHaveBeenCalledTimes(1);
  });
});
