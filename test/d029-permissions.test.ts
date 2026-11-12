import { describe, expect, it, vi } from 'vitest';

import type { ChatRequest, ModelProvider } from '../src/adapters/model/provider.ts';
import type { Tool, ToolContext } from '../src/core/tool.ts';
import { runAgentLoop } from '../src/runtime/loop.ts';
import { ToolRegistry } from '../src/tools/registry.ts';

function spyTool(name = 'spy'): { tool: Tool; execute: ReturnType<typeof vi.fn> } {
  const execute = vi.fn((_args: unknown, _context: ToolContext) => Promise.resolve({ content: 'ok' }));
  return {
    tool: {
      name,
      description: `${name} 测试工具`,
      parameters: { type: 'object', properties: {} },
      execute,
    },
    execute,
  };
}

function call(name: string, args: unknown = {}, id = 'call-1') {
  return { id, name, arguments: JSON.stringify(args) };
}

describe('D029 工具白名单', () => {
  it('允许白名单内工具发现与执行，并保持默认上下文兼容', async () => {
    const registry = new ToolRegistry({ allowedTools: ['allowed'] });
    const allowed = spyTool('allowed');
    const blocked = spyTool('blocked');
    registry.register(allowed.tool);
    registry.register(blocked.tool);

    expect(registry.list().map((tool) => tool.name)).toEqual(['allowed']);
    const result = await registry.execute(call('allowed', { value: 1 }), { workspaceRoot: '.' });

    expect(result).toEqual({ content: 'ok' });
    expect(allowed.execute).toHaveBeenCalledWith({ value: 1 }, { workspaceRoot: '.' });
  });

  it('白名单外工具不可发现，且在 JSON 与 Schema 校验前拒绝', async () => {
    const registry = new ToolRegistry({ allowedTools: ['allowed'] });
    const allowed = spyTool('allowed');
    const blocked = spyTool('blocked');
    blocked.tool = {
      ...blocked.tool,
      parameters: {
        type: 'object',
        properties: { privateShape: { type: 'string' } },
        required: ['privateShape'],
      },
    };
    registry.register(allowed.tool);
    registry.register(blocked.tool);

    expect(registry.discover().map((tool) => tool.name)).toEqual(['allowed']);
    expect(registry.describe('blocked')).toBeUndefined();
    const result = await registry.execute(
      { id: 'call-blocked', name: 'blocked', arguments: '{bad json' },
      { workspaceRoot: '.' },
    );

    expect(result).toMatchObject({
      isError: true,
      error: { code: 'TOOL_NOT_ALLOWED', retryable: false },
    });
    expect(JSON.stringify(result)).not.toContain('privateShape');
    expect(blocked.execute).not.toHaveBeenCalled();
  });
});

describe('D029 租户隔离', () => {
  it('仅发现和执行共享工具与当前租户工具，并传入可信租户上下文', async () => {
    const registry = new ToolRegistry({ tenantId: 'tenant-a' });
    const shared = spyTool('shared');
    const tenantA = spyTool('tenant_a_tool');
    const tenantB = spyTool('tenant_b_tool');
    registry.register(shared.tool);
    registry.register(tenantA.tool, { tenantId: 'tenant-a' });
    registry.register(tenantB.tool, { tenantId: 'tenant-b' });

    expect(registry.list().map((tool) => tool.name)).toEqual(['shared', 'tenant_a_tool']);
    expect(registry.discover().map((tool) => tool.name)).toEqual(['shared', 'tenant_a_tool']);
    expect(registry.describe('tenant_b_tool')).toBeUndefined();
    expect(registry.size).toBe(2);

    const allowed = await registry.execute(call('tenant_a_tool'), {
      workspaceRoot: '.',
      tenantId: 'tenant-b',
    });
    const denied = await registry.execute(call('tenant_b_tool'), { workspaceRoot: '.' });

    expect(allowed.isError).toBeUndefined();
    expect(tenantA.execute).toHaveBeenCalledWith({}, { workspaceRoot: '.', tenantId: 'tenant-a' });
    expect(denied.error?.code).toBe('TOOL_NOT_ALLOWED');
    expect(JSON.stringify(denied)).not.toContain('tenant-b');
    expect(tenantB.execute).not.toHaveBeenCalled();
  });

  it('未配置租户时不会默认开放任何租户专属工具', async () => {
    const registry = new ToolRegistry();
    const shared = spyTool('shared');
    const scoped = spyTool('scoped');
    registry.register(shared.tool);
    registry.register(scoped.tool, { tenantId: 'tenant-a' });

    expect(registry.list().map((tool) => tool.name)).toEqual(['shared']);
    const result = await registry.execute(call('scoped'), { workspaceRoot: '.', tenantId: 'tenant-a' });

    expect(result.error?.code).toBe('TOOL_NOT_ALLOWED');
    expect(scoped.execute).not.toHaveBeenCalled();
  });
});

describe('D029 敏感工具逐次确认', () => {
  it('合法参数获得本次明确批准后执行，确认请求包含调用身份与租户', async () => {
    const confirm = vi.fn(() => Promise.resolve(true));
    const registry = new ToolRegistry({ tenantId: 'tenant-a', confirmSensitiveTool: confirm });
    const sensitive = spyTool('sensitive');
    registry.register(sensitive.tool, { tenantId: 'tenant-a', sensitive: true });

    const result = await registry.execute(call('sensitive', {}, 'call-approved'), { workspaceRoot: '.' });

    expect(result).toEqual({ content: 'ok' });
    expect(confirm).toHaveBeenCalledWith({
      callId: 'call-approved',
      toolName: 'sensitive',
      args: {},
      tenantId: 'tenant-a',
    });
    expect(sensitive.execute).toHaveBeenCalledOnce();
  });

  it('每次调用都重新确认，前一次批准不会成为永久开关', async () => {
    const confirm = vi.fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const registry = new ToolRegistry({ confirmSensitiveTool: confirm });
    const sensitive = spyTool('sensitive');
    registry.register(sensitive.tool, { sensitive: true });

    const first = await registry.execute(call('sensitive', {}, 'call-first'), { workspaceRoot: '.' });
    const second = await registry.execute(call('sensitive', {}, 'call-second'), { workspaceRoot: '.' });

    expect(first.isError).toBeUndefined();
    expect(second.error?.code).toBe('TOOL_CONFIRMATION_REQUIRED');
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(sensitive.execute).toHaveBeenCalledOnce();
  });

  it('未配置确认回调或回调拒绝时安全失败，execute 不运行', async () => {
    const withoutCallback = new ToolRegistry();
    const missing = spyTool('missing_callback');
    withoutCallback.register(missing.tool, { sensitive: true });
    const denied = await withoutCallback.execute(call('missing_callback'), { workspaceRoot: '.' });

    const registry = new ToolRegistry({ confirmSensitiveTool: () => false });
    const sensitive = spyTool('sensitive');
    registry.register(sensitive.tool, { sensitive: true });
    const rejected = await registry.execute(call('sensitive'), { workspaceRoot: '.' });

    expect(denied.error).toMatchObject({ code: 'TOOL_CONFIRMATION_REQUIRED', retryable: false });
    expect(rejected.error).toMatchObject({ code: 'TOOL_CONFIRMATION_REQUIRED', retryable: false });
    expect(missing.execute).not.toHaveBeenCalled();
    expect(sensitive.execute).not.toHaveBeenCalled();
  });

  it('确认回调异常被脱敏为标准错误，execute 不运行', async () => {
    const secret = 'confirmation-backend-secret';
    const registry = new ToolRegistry({
      confirmSensitiveTool: () => Promise.reject(new Error(secret)),
    });
    const sensitive = spyTool('sensitive');
    registry.register(sensitive.tool, { sensitive: true });

    const result = await registry.execute(call('sensitive'), { workspaceRoot: '.' });

    expect(result.error).toMatchObject({ code: 'TOOL_CONFIRMATION_FAILED', retryable: false });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(sensitive.execute).not.toHaveBeenCalled();
  });

  it('敏感工具先完成 JSON 与 Schema 校验，再请求确认', async () => {
    const confirm = vi.fn(() => true);
    const registry = new ToolRegistry({ confirmSensitiveTool: confirm });
    const sensitive = spyTool('sensitive');
    sensitive.tool = {
      ...sensitive.tool,
      parameters: {
        type: 'object',
        properties: { value: { type: 'string' } },
        required: ['value'],
      },
    };
    registry.register(sensitive.tool, { sensitive: true });

    const invalidJson = await registry.execute(
      { id: 'bad-json', name: 'sensitive', arguments: '{bad json' },
      { workspaceRoot: '.' },
    );
    const invalidArgs = await registry.execute(call('sensitive'), { workspaceRoot: '.' });

    expect(invalidJson.error?.code).toBe('INVALID_JSON');
    expect(invalidArgs.error?.code).toBe('INVALID_ARGUMENTS');
    expect(confirm).not.toHaveBeenCalled();
    expect(sensitive.execute).not.toHaveBeenCalled();

    const valid = await registry.execute(
      call('sensitive', { value: 'ok' }, 'valid-call'),
      { workspaceRoot: '.' },
    );
    expect(valid).toEqual({ content: 'ok' });
    expect(confirm).toHaveBeenCalledOnce();
    expect(sensitive.execute).toHaveBeenCalledOnce();
  });
});

describe('D029 Loop 错误回喂', () => {
  it('权限拒绝作为 tool 消息回喂，Loop 继续完成且不泄露隐藏工具', async () => {
    const registry = new ToolRegistry({ allowedTools: [], tenantId: 'tenant-a' });
    const hidden = spyTool('hidden');
    registry.register(hidden.tool, { tenantId: 'tenant-b' });
    const requests: ChatRequest[] = [];
    let turn = 0;
    const provider: ModelProvider = {
      name: 'permission-script',
      chat(request) {
        requests.push({ ...request, messages: [...request.messages] });
        turn += 1;
        return Promise.resolve(turn === 1
          ? { text: '', model: 'm', toolCalls: [call('hidden', {}, 'denied-call')] }
          : { text: '已收到拒绝结果', model: 'm' });
      },
    };

    const result = await runAgentLoop({
      provider,
      registry,
      messages: [{ role: 'user', content: '尝试调用' }],
      maxTurns: 2,
      maxTokens: 128,
      workspaceRoot: '.',
    });

    expect(result.stopReason).toBe('completed');
    expect(result.text).toBe('已收到拒绝结果');
    expect(requests).toHaveLength(2);
    expect(requests[0]?.tools).toEqual([]);
    expect(requests[1]?.messages.at(-1)).toMatchObject({ role: 'tool', toolCallId: 'denied-call' });
    expect(requests[1]?.messages.at(-1)?.content).toContain('当前策略不允许');
    expect(hidden.execute).not.toHaveBeenCalled();
  });
});
