import { describe, expect, it } from 'vitest';

import {
  createMcpTool,
  type McpToolClient,
} from '../src/adapters/mcp-tool.ts';
import {
  McpClientError,
  McpRpcError,
  type McpCallToolResult,
  type McpRequestOptions,
  type McpTool,
} from '../src/adapters/mcp-stdio-client.ts';
import { ToolRegistry } from '../src/tools/registry.ts';

class FakeClient implements McpToolClient {
  readonly calls: Array<{ name: string; arguments: Readonly<Record<string, unknown>> }> = [];
  result: McpCallToolResult = { content: [{ type: 'text', text: 'ok' }] };
  error?: Error;

  callTool(
    name: string,
    arguments_: Readonly<Record<string, unknown>>,
    _options?: McpRequestOptions,
  ): Promise<McpCallToolResult> {
    this.calls.push({ name, arguments: arguments_ });
    return this.error === undefined ? Promise.resolve(this.result) : Promise.reject(this.error);
  }
}

const remoteTool: McpTool = {
  name: 'remote_echo',
  description: '远端回显',
  inputSchema: {
    type: 'object',
    properties: { message: { type: 'string' } },
    required: ['message'],
    additionalProperties: false,
  },
};

describe('D037 MCP remote Tool 适配', () => {
  it('把 inputSchema 投影为 parameters，并通过真实 Registry 传递对象参数与 content', async () => {
    const client = new FakeClient();
    client.result = {
      content: [
        { type: 'text', text: '第一行' },
        { type: 'text', text: '第二行' },
        { type: 'image', data: 'AA==', mimeType: 'image/png' },
      ],
      structuredContent: { value: 42 },
      isError: false,
    };
    const registry = new ToolRegistry();
    registry.register(createMcpTool(remoteTool, client));

    expect(registry.list()).toEqual([{
      name: 'remote_echo',
      description: '远端回显',
      parameters: remoteTool.inputSchema,
    }]);
    const result = await registry.execute(
      { id: 'call-1', name: 'remote_echo', arguments: '{"message":"你好"}' },
      { workspaceRoot: '/tmp' },
    );

    expect(client.calls).toEqual([{ name: 'remote_echo', arguments: { message: '你好' } }]);
    expect(result).toEqual({
      content: '第一行\n第二行\n{"type":"image","data":"AA==","mimeType":"image/png"}',
    });
  });

  it('显式别名保留本地 Schema，并在调用边界映射远端名称与参数', async () => {
    const client = new FakeClient();
    const localSchema = {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
      additionalProperties: false,
    };
    const tool = createMcpTool(remoteTool, client, {
      name: 'echo',
      description: '本地回显契约',
      parameters: localSchema,
      mapArguments: (args, context) => ({
        message: `${context.workspaceRoot}:${String(args.text)}`,
      }),
    });
    const registry = new ToolRegistry();
    registry.register(tool);

    expect(registry.list()[0]).toEqual({
      name: 'echo',
      description: '本地回显契约',
      parameters: localSchema,
    });
    await registry.execute(
      { id: 'alias-1', name: 'echo', arguments: '{"text":"hello"}' },
      { workspaceRoot: '/workspace' },
    );
    expect(client.calls).toEqual([{
      name: 'remote_echo',
      arguments: { message: '/workspace:hello' },
    }]);
  });

  it('MCP isError 保留文本和可识别的结构化 ToolError', async () => {
    const client = new FakeClient();
    client.result = {
      content: [{ type: 'text', text: 'missing.txt 不存在' }],
      structuredContent: {
        error: {
          code: 'FILE_NOT_FOUND',
          message: '文件不存在：missing.txt',
          retryable: true,
          hint: '请先列目录',
        },
      },
      isError: true,
    };
    const tool = createMcpTool(remoteTool, client);

    await expect(tool.execute({ message: 'x' }, { workspaceRoot: '/tmp' })).resolves.toEqual({
      content: 'missing.txt 不存在',
      isError: true,
      error: {
        code: 'FILE_NOT_FOUND',
        message: '文件不存在：missing.txt',
        retryable: true,
        hint: '请先列目录',
      },
    });
  });

  it('没有结构化详情的 MCP isError 仍有稳定的 MCP_TOOL_ERROR', async () => {
    const client = new FakeClient();
    client.result = { content: [{ type: 'text', text: 'remote failed' }], isError: true };
    const tool = createMcpTool(remoteTool, client);

    await expect(tool.execute({ message: 'x' }, { workspaceRoot: '/tmp' })).resolves.toMatchObject({
      content: 'remote failed',
      isError: true,
      error: { code: 'MCP_TOOL_ERROR', message: 'remote failed', retryable: true },
    });
  });

  it.each([
    {
      label: 'JSON-RPC',
      error: new McpRpcError(-32602, 'unknown tool', { name: 'missing' }),
      code: 'MCP_RPC_ERROR',
      message: 'MCP JSON-RPC -32602：unknown tool',
    },
    {
      label: '超时',
      error: new McpClientError('TIMEOUT', 'request timed out'),
      code: 'TOOL_TIMEOUT',
      message: 'request timed out',
    },
    {
      label: '取消',
      error: new McpClientError('ABORTED', 'request aborted'),
      code: 'TOOL_CANCELLED',
      message: 'request aborted',
    },
    {
      label: '进程/传输',
      error: new McpClientError('TRANSPORT_ERROR', 'server exited'),
      code: 'MCP_TRANSPORT_ERROR',
      message: 'server exited',
    },
  ])('$label 错误转换为结构化 ToolResult，不向 AgentLoop 抛出传输异常', async ({ error, code, message }) => {
    const client = new FakeClient();
    client.error = error;
    const tool = createMcpTool(remoteTool, client);

    await expect(tool.execute({ message: 'x' }, { workspaceRoot: '/tmp' })).resolves.toMatchObject({
      isError: true,
      error: { code, message },
    });
  });
});
