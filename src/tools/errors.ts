import { ToolError, type ToolErrorCode, type ToolResult } from '../core/tool.ts';

export function errorResult(error: ToolError): ToolResult {
  return {
    content: error.hint === undefined ? error.message : `${error.message}\n提示：${error.hint}`,
    isError: true,
    error: {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      ...(error.hint === undefined ? {} : { hint: error.hint }),
    },
  };
}

export function toolError(
  code: ToolErrorCode,
  message: string,
  retryable: boolean,
  hint?: string,
): ToolResult {
  return errorResult(new ToolError(code, message, retryable, hint));
}

export function normalizeError(error: unknown): ToolError {
  return error instanceof ToolError
    ? error
    : new ToolError('INTERNAL_ERROR', '工具执行失败，请检查输入后重试', true, '可读取相关文件或修正参数后重试');
}
