import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  McpClientError,
  type McpCallToolResult,
  type McpInitializeResult,
  type McpRequestOptions,
  type McpTool,
} from '../src/adapters/mcp-stdio-client.ts';
import {
  createFilesystemBackend,
  createFilesystemMcpTools,
  type FilesystemBackend,
  type McpFilesystemClient,
} from '../src/tools/filesystem-backend.ts';
import { listDirTool, readFileTool } from '../src/tools/fs.ts';
import { ToolRegistry } from '../src/tools/registry.ts';

const initialization: McpInitializeResult = {
  protocolVersion: '2025-11-25',
  capabilities: { tools: {} },
  serverInfo: { name: 'fixture-filesystem', version: '1.0.0' },
};

const remoteTools: McpTool[] = [
  {
    name: 'read_file',
    description: 'official read',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'absolute path' } },
      required: ['path'],
    },
  },
  {
    name: 'list_directory',
    description: 'official list',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'absolute path' } },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: '危险写工具，不应投影',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
  },
];

class FakeFilesystemClient implements McpFilesystemClient {
  readonly calls: Array<{ name: string; arguments: Readonly<Record<string, unknown>> }> = [];
  connected = false;
  closed = false;
  closeCount = 0;
  tools = remoteTools;

  connect(): Promise<McpInitializeResult> {
    this.connected = true;
    return Promise.resolve(initialization);
  }

  listAllTools(): Promise<McpTool[]> {
    return Promise.resolve(this.tools);
  }

  callTool(
    name: string,
    arguments_: Readonly<Record<string, unknown>>,
    _options?: McpRequestOptions,
  ): Promise<McpCallToolResult> {
    this.calls.push({ name, arguments: arguments_ });
    if (this.closed) {
      return Promise.reject(new McpClientError('TRANSPORT_ERROR', 'stdio 已关闭'));
    }
    return Promise.resolve({
      content: [{ type: 'text', text: `${name}:${String(arguments_.path)}` }],
    });
  }

  close(): Promise<void> {
    this.closed = true;
    this.closeCount += 1;
    return Promise.resolve();
  }
}

describe('D037 filesystem 后端', () => {
  let workspace: string;
  let backend: FilesystemBackend | undefined;

  beforeEach(() => {
    workspace = realpathSync(mkdtempSync(join(tmpdir(), 'personal-agent-d037-test-')));
    writeFileSync(join(workspace, 'note.txt'), 'filesystem backend\n', 'utf8');
  });

  afterEach(async () => {
    await backend?.close();
    rmSync(workspace, { recursive: true, force: true });
  });

  it('只投影 read_file/list_dir，并显式映射 list_directory 与绝对路径', async () => {
    const client = new FakeFilesystemClient();
    const registry = new ToolRegistry();
    for (const tool of createFilesystemMcpTools(client.tools, client)) registry.register(tool);

    expect(registry.list()).toEqual([
      {
        name: 'read_file',
        description: readFileTool.description,
        parameters: readFileTool.parameters,
      },
      {
        name: 'list_dir',
        description: listDirTool.description,
        parameters: listDirTool.parameters,
      },
    ]);
    await registry.execute(
      { id: 'read', name: 'read_file', arguments: '{"path":"note.txt"}' },
      { workspaceRoot: workspace },
    );
    await registry.execute(
      { id: 'list', name: 'list_dir', arguments: '{}' },
      { workspaceRoot: workspace },
    );

    expect(client.calls).toEqual([
      { name: 'read_file', arguments: { path: join(workspace, 'note.txt') } },
      { name: 'list_directory', arguments: { path: workspace } },
    ]);
  });

  it('路径逃逸和未开放写工具不会到达外部 Server', async () => {
    const client = new FakeFilesystemClient();
    const registry = new ToolRegistry();
    for (const tool of createFilesystemMcpTools(client.tools, client)) registry.register(tool);

    const escape = await registry.execute(
      { id: 'escape', name: 'read_file', arguments: '{"path":"../secret"}' },
      { workspaceRoot: workspace },
    );
    const write = await registry.execute(
      { id: 'write', name: 'write_file', arguments: '{"path":"note.txt","content":"bad"}' },
      { workspaceRoot: workspace },
    );

    expect(escape.error?.code).toBe('PATH_OUTSIDE_WORKSPACE');
    expect(write.error?.code).toBe('UNKNOWN_TOOL');
    expect(client.calls).toEqual([]);
  });

  it('local 与 mcp 暴露同一 Registry 工具契约，关闭幂等且关闭后错误可观察', async () => {
    const local = await createFilesystemBackend({ backend: 'local' });
    const localRead = await local.registry.execute(
      { id: 'local-read', name: 'read_file', arguments: '{"path":"note.txt"}' },
      { workspaceRoot: workspace },
    );
    expect(localRead.content).toBe('filesystem backend\n');
    expect(local.registry.list().map((tool) => tool.name)).toEqual(['read_file', 'list_dir']);

    const client = new FakeFilesystemClient();
    backend = await createFilesystemBackend({ backend: 'mcp', client });
    expect(client.connected).toBe(true);
    expect(backend.backend).toBe('mcp');
    expect(backend.initialization).toEqual(initialization);
    expect(backend.registry.list()).toEqual(local.registry.list());

    await backend.close();
    await backend.close();
    expect(client.closeCount).toBe(1);
    const closed = await backend.registry.execute(
      { id: 'closed', name: 'read_file', arguments: '{"path":"note.txt"}' },
      { workspaceRoot: workspace },
    );
    expect(closed).toMatchObject({
      isError: true,
      error: { code: 'MCP_TRANSPORT_ERROR', message: 'stdio 已关闭' },
    });
    await local.close();
  });

  it('缺少必要远端能力时关闭连接并拒绝构造不完整后端', async () => {
    const client = new FakeFilesystemClient();
    client.tools = remoteTools.filter((tool) => tool.name !== 'list_directory');

    await expect(createFilesystemBackend({ backend: 'mcp', client })).rejects.toThrow(
      'MCP filesystem Server 缺少工具：list_directory',
    );
    expect(client.closeCount).toBe(1);
  });
});
