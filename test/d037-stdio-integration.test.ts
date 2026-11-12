import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { StdioMcpClient } from '../src/adapters/mcp-stdio-client.ts';
import {
  createFilesystemBackend,
  type FilesystemBackend,
} from '../src/tools/filesystem-backend.ts';

const fixture = fileURLToPath(new URL('./fixtures/d037-filesystem-server.ts', import.meta.url));

describe('D037 离线 stdio filesystem 集成', () => {
  let workspace: string;
  let backend: FilesystemBackend | undefined;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'personal-agent-d037-stdio-'));
    mkdirSync(join(workspace, 'nested'));
    writeFileSync(join(workspace, 'note.txt'), 'stdio fixture\n', 'utf8');
  });

  afterEach(async () => {
    await backend?.close();
    rmSync(workspace, { recursive: true, force: true });
  });

  function connect(scenario = 'normal'): Promise<FilesystemBackend> {
    const client = new StdioMcpClient({
      command: process.execPath,
      args: [fixture, workspace, scenario],
      requestTimeoutMs: 1_000,
      closeTimeoutMs: 200,
    });
    return createFilesystemBackend({ backend: 'mcp', client });
  }

  it('经真实 ToolRegistry + stdio 完成读取、list_directory 别名和初始化协商', async () => {
    backend = await connect();
    expect(backend.initialization).toMatchObject({
      protocolVersion: '2025-11-25',
      serverInfo: { name: 'd037-offline-filesystem-fixture' },
    });

    const read = await backend.registry.execute(
      { id: 'read', name: 'read_file', arguments: '{"path":"note.txt"}' },
      { workspaceRoot: workspace },
    );
    const list = await backend.registry.execute(
      { id: 'list', name: 'list_dir', arguments: '{}' },
      { workspaceRoot: workspace },
    );
    const write = await backend.registry.execute(
      { id: 'write', name: 'write_file', arguments: '{}' },
      { workspaceRoot: workspace },
    );

    expect(read).toEqual({ content: 'stdio fixture\n' });
    expect(list.content.split('\n').sort()).toEqual(['[DIR] nested', '[FILE] note.txt']);
    expect(write.error?.code).toBe('UNKNOWN_TOOL');
  });

  it('远端调用超时变成 TOOL_TIMEOUT，不悬挂 AgentLoop', async () => {
    backend = await connect('hang-read');
    const startedAt = Date.now();
    const result = await backend.registry.execute(
      { id: 'timeout', name: 'read_file', arguments: '{"path":"note.txt"}' },
      { workspaceRoot: workspace },
    );

    expect(Date.now() - startedAt).toBeLessThan(2_000);
    expect(result).toMatchObject({ isError: true, error: { code: 'TOOL_TIMEOUT' } });
  });

  it('子进程退出变成 MCP_TRANSPORT_ERROR，之后仍能可靠关闭', async () => {
    backend = await connect('exit-read');
    const result = await backend.registry.execute(
      { id: 'exit', name: 'read_file', arguments: '{"path":"note.txt"}' },
      { workspaceRoot: workspace },
    );

    expect(result).toMatchObject({ isError: true, error: { code: 'MCP_TRANSPORT_ERROR' } });
    await backend.close();
    await backend.close();
  });
});
