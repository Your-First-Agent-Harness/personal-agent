/**
 * 领域层：工具契约。
 * 工具的 Schema 给模型看，execute 给 runtime 用，两者必须在同一个对象里，
 * 否则"模型看到的参数说明"和"实际执行的参数"会漂移。
 */

/** 直接对应 OpenAI tools 参数里的 function 字段 */
export interface ToolSchema {
  readonly name: string;
  readonly description: string;
  /** JSON Schema，必须是 type: object */
  readonly parameters: Record<string, unknown>;
}

export interface ToolContext {
  readonly workspaceRoot: string;
  readonly signal?: AbortSignal;
  /** 由 Registry 的租户策略写入，调用方不能直接借此越权 */
  readonly tenantId?: string;
}

export type ToolErrorCode =
  | 'UNKNOWN_TOOL'
  | 'INVALID_JSON'
  | 'INVALID_ARGUMENTS'
  | 'TOOL_NOT_ALLOWED'
  | 'TOOL_CONFIRMATION_REQUIRED'
  | 'TOOL_CONFIRMATION_FAILED'
  | 'PATH_OUTSIDE_WORKSPACE'
  | 'FILE_NOT_FOUND'
  | 'NOT_A_FILE'
  | 'DIRECTORY_NOT_FOUND'
  | 'NOT_A_DIRECTORY'
  | 'FILE_EXISTS'
  | 'PARENT_NOT_FOUND'
  | 'EDIT_NO_MATCH'
  | 'EDIT_MULTIPLE_MATCHES'
  | 'DIFF_TOO_LARGE'
  | 'COMMAND_FAILED'
  | 'COMMAND_TIMEOUT'
  | 'COMMAND_CANCELLED'
  | 'COMMAND_NOT_ALLOWED'
  | 'COMMAND_OUTPUT_LIMIT'
  | 'COMMAND_RESOURCE_LIMIT'
  | 'AUDIT_WRITE_FAILED'
  | 'TOOL_TIMEOUT'
  | 'TOOL_CANCELLED'
  | 'TOOL_RATE_LIMITED'
  | 'TOOL_CIRCUIT_OPEN'
  | 'MCP_TOOL_ERROR'
  | 'MCP_RPC_ERROR'
  | 'MCP_TRANSPORT_ERROR'
  | 'UPSTREAM_HTTP_ERROR'
  | 'UPSTREAM_NETWORK_ERROR'
  | 'UPSTREAM_INVALID_RESPONSE'
  | 'UPSTREAM_RESPONSE_TOO_LARGE'
  | 'INTERNAL_ERROR';

export interface ToolErrorDetail {
  readonly code: ToolErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly hint?: string;
}

export class ToolError extends Error {
  readonly code: ToolErrorCode;
  readonly retryable: boolean;
  readonly hint?: string;

  constructor(code: ToolErrorCode, message: string, retryable: boolean, hint?: string) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
    this.retryable = retryable;
    this.hint = hint;
  }
}

export interface ToolResult {
  readonly content: string;
  /** 失败也作为正常消息回喂给模型，而不是抛异常中断 loop */
  readonly isError?: boolean;
  readonly error?: ToolErrorDetail;
}

export interface Tool extends ToolSchema {
  execute(args: unknown, context: ToolContext): Promise<ToolResult>;
}
