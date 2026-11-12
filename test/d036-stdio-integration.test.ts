import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { StdioMcpClient, type StdioMcpClientOptions } from '../src/adapters/mcp-stdio-client.ts';

const clients: StdioMcpClient[] = [];

function createClient(options: Partial<StdioMcpClientOptions> = {}): StdioMcpClient {
  const client = new StdioMcpClient({
    command: process.execPath,
    args: [resolve('src/demo/d036-mcp-server.ts')],
    env: { PATH: process.env['PATH'] ?? '', HOME: process.env['HOME'] ?? '' },
    requestTimeoutMs: 3_000,
    closeTimeoutMs: 3_000,
    ...options,
  });
  clients.push(client);
  return client;
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map(async (client) => client.close()));
});

describe('D036 示例 Server 跨进程互通（自有 Client）', () => {
  it('完成握手、工具列表、真实 read_file 与工具错误，并通过 stdio 关闭', async () => {
    const client = createClient();
    const initialized = await client.connect();

    expect(initialized).toEqual({
      protocolVersion: '2025-11-25',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'personal-agent-safe-demo', version: '0.1.0' },
    });
    const tools = await client.listAllTools();
    expect(tools.map((tool) => tool.name)).toEqual(['read_file', 'list_dir']);
    expect(tools[0]?.inputSchema).toMatchObject({ type: 'object', required: ['path'] });

    const result = await client.callTool('read_file', { path: 'README.txt' });
    expect(result).toEqual({
      content: [{
        type: 'text',
        text: 'D036 safe MCP workspace\nOnly read_file and list_dir are exposed.\n',
      }],
      isError: false,
    });

    const missing = await client.callTool('read_file', { path: 'missing.txt' });
    expect(missing).toMatchObject({
      isError: true,
      structuredContent: { error: { code: 'FILE_NOT_FOUND' } },
    });
    const escape = await client.callTool('read_file', { path: '../secret.txt' });
    expect(escape.structuredContent).toMatchObject({
      error: { code: 'PATH_OUTSIDE_WORKSPACE' },
    });

    await expect(client.callTool('shell', { command: 'whoami' })).rejects.toMatchObject({
      name: 'McpRpcError',
      rpcCode: -32602,
    });
    await client.close();
    expect(client.getStderr()).toContain('workspace=');
  });

});
