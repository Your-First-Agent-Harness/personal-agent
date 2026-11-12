import { ToolError, type Tool, type ToolContext, type ToolResult } from '../core/tool.ts';
import type { ToolErrorCode } from '../core/tool.ts';
import { errorResult } from '../tools/errors.ts';
import {
  McpClientError,
  McpRpcError,
  type McpCallToolResult,
  type McpContentBlock,
  type McpRequestOptions,
  type McpTool,
} from './mcp-stdio-client.ts';

export interface McpToolClient {
  callTool(
    name: string,
    arguments_: Readonly<Record<string, unknown>>,
    options?: McpRequestOptions,
  ): Promise<McpCallToolResult>;
}

const toolErrorCodes = new Set<ToolErrorCode>([
  'UNKNOWN_TOOL',
  'INVALID_JSON',
  'INVALID_ARGUMENTS',
  'TOOL_NOT_ALLOWED',
  'TOOL_CONFIRMATION_REQUIRED',
  'TOOL_CONFIRMATION_FAILED',
  'PATH_OUTSIDE_WORKSPACE',
  'FILE_NOT_FOUND',
  'NOT_A_FILE',
  'DIRECTORY_NOT_FOUND',
  'NOT_A_DIRECTORY',
  'FILE_EXISTS',
  'PARENT_NOT_FOUND',
  'EDIT_NO_MATCH',
  'EDIT_MULTIPLE_MATCHES',
  'DIFF_TOO_LARGE',
  'COMMAND_FAILED',
  'COMMAND_TIMEOUT',
  'COMMAND_CANCELLED',
  'TOOL_TIMEOUT',
  'TOOL_CANCELLED',
  'TOOL_RATE_LIMITED',
  'TOOL_CIRCUIT_OPEN',
  'MCP_TOOL_ERROR',
  'MCP_RPC_ERROR',
  'MCP_TRANSPORT_ERROR',
  'INTERNAL_ERROR',
]);

function textContent(blocks: readonly McpContentBlock[]): string {
  return blocks.map((block) => (
    block.type === 'text' && typeof block.text === 'string'
      ? block.text
      : JSON.stringify(block)
  )).join('\n');
}

function mcpErrorResult(result: McpCallToolResult, content: string): ToolResult {
  const structured = result.structuredContent?.error;
  if (typeof structured === 'object' && structured !== null && !Array.isArray(structured)) {
    const candidate = structured as Record<string, unknown>;
    if (typeof candidate.code === 'string' && typeof candidate.message === 'string') {
      const code = toolErrorCodes.has(candidate.code as ToolErrorCode)
        ? candidate.code as ToolErrorCode
        : 'MCP_TOOL_ERROR';
      return {
        content,
        isError: true,
        error: {
          code,
          message: candidate.message,
          retryable: typeof candidate.retryable === 'boolean' ? candidate.retryable : true,
          ...(typeof candidate.hint === 'string' ? { hint: candidate.hint } : {}),
        },
      };
    }
  }
  return {
    content,
    isError: true,
    error: {
      code: 'MCP_TOOL_ERROR',
      message: content || 'MCP 工具返回 isError',
      retryable: true,
    },
  };
}

function transportError(error: unknown): ToolResult {
  if (error instanceof ToolError) return errorResult(error);
  const detail = error instanceof McpRpcError
    ? { code: 'MCP_RPC_ERROR' as const, retryable: true }
    : error instanceof McpClientError && error.code === 'TIMEOUT'
      ? { code: 'TOOL_TIMEOUT' as const, retryable: true }
      : error instanceof McpClientError && error.code === 'ABORTED'
        ? { code: 'TOOL_CANCELLED' as const, retryable: false }
        : { code: 'MCP_TRANSPORT_ERROR' as const, retryable: true };
  const message = error instanceof McpRpcError
    ? `MCP JSON-RPC ${error.rpcCode}：${error.message}`
    : error instanceof Error ? error.message : 'MCP 调用失败';
  return { content: message, isError: true, error: { ...detail, message } };
}

export interface McpToolProjection {
  readonly name?: string;
  readonly description?: string;
  readonly parameters?: Record<string, unknown>;
  readonly mapArguments?: (
    args: Readonly<Record<string, unknown>>,
    context: ToolContext,
  ) => Readonly<Record<string, unknown>>;
}

export function createMcpTool(
  remote: McpTool,
  client: McpToolClient,
  projection: McpToolProjection = {},
): Tool {
  return {
    name: projection.name ?? remote.name,
    description: projection.description ?? remote.description ?? `MCP 远端工具：${remote.name}`,
    parameters: projection.parameters ?? remote.inputSchema,
    async execute(args, context): Promise<ToolResult> {
      try {
        const localArgs = args as Readonly<Record<string, unknown>>;
        const remoteArgs = projection.mapArguments?.(localArgs, context) ?? localArgs;
        const result = await client.callTool(remote.name, remoteArgs, { signal: context.signal });
        const content = textContent(result.content);
        return result.isError === true
          ? mcpErrorResult(result, content)
          : { content };
      } catch (error) {
        return transportError(error);
      }
    },
  };
}
