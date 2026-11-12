import { createMcpTool, type McpToolClient } from '../adapters/mcp-tool.ts';
import type {
  McpInitializeResult,
  McpRequestOptions,
  McpTool,
} from '../adapters/mcp-stdio-client.ts';
import type { Tool, ToolContext } from '../core/tool.ts';
import { listDirTool, readFileTool } from './fs.ts';
import { ToolRegistry } from './registry.ts';
import { resolveInWorkspace } from './workspace.ts';

export interface McpFilesystemClient extends McpToolClient {
  connect(options?: McpRequestOptions): Promise<McpInitializeResult>;
  listAllTools(options?: McpRequestOptions): Promise<readonly McpTool[]>;
  close(): Promise<void>;
}

export interface FilesystemBackend {
  readonly backend: 'local' | 'mcp';
  readonly registry: ToolRegistry;
  readonly initialization?: McpInitializeResult;
  close(): Promise<void>;
}

export type FilesystemBackendOptions =
  | { readonly backend: 'local' }
  | { readonly backend: 'mcp'; readonly client: McpFilesystemClient };

function remoteTool(tools: readonly McpTool[], name: string): McpTool {
  const tool = tools.find((candidate) => candidate.name === name);
  if (tool === undefined) throw new Error(`MCP filesystem Server 缺少工具：${name}`);
  return tool;
}

function workspacePath(args: Readonly<Record<string, unknown>>, context: ToolContext): unknown {
  const path = args.path ?? '.';
  return typeof path === 'string' ? resolveInWorkspace(context, path) : path;
}

function filesystemArguments(
  args: Readonly<Record<string, unknown>>,
  context: ToolContext,
): Readonly<Record<string, unknown>> {
  return { path: workspacePath(args, context) };
}

export function createFilesystemMcpTools(
  remoteTools: readonly McpTool[],
  client: McpToolClient,
): Tool[] {
  return [
    createMcpTool(remoteTool(remoteTools, 'read_file'), client, {
      description: readFileTool.description,
      parameters: readFileTool.parameters,
      mapArguments: filesystemArguments,
    }),
    createMcpTool(remoteTool(remoteTools, 'list_directory'), client, {
      name: 'list_dir',
      description: listDirTool.description,
      parameters: listDirTool.parameters,
      mapArguments: filesystemArguments,
    }),
  ];
}

function localBackend(): FilesystemBackend {
  const registry = new ToolRegistry();
  registry.register(readFileTool);
  registry.register(listDirTool);
  return { backend: 'local', registry, close: () => Promise.resolve() };
}

export async function createFilesystemBackend(
  options: FilesystemBackendOptions,
): Promise<FilesystemBackend> {
  if (options.backend === 'local') return localBackend();
  const { client } = options;
  try {
    const initialization = await client.connect();
    const tools = await client.listAllTools();
    const registry = new ToolRegistry();
    for (const tool of createFilesystemMcpTools(tools, client)) registry.register(tool);
    let closed = false;
    return {
      backend: 'mcp',
      registry,
      initialization,
      close: async () => {
        if (closed) return;
        closed = true;
        await client.close();
      },
    };
  } catch (error) {
    await client.close();
    throw error;
  }
}
