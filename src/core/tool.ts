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
}

export interface ToolResult {
  readonly content: string;
  /** 失败也作为正常消息回喂给模型，而不是抛异常中断 loop */
  readonly isError?: boolean;
}

export interface Tool extends ToolSchema {
  execute(args: unknown, context: ToolContext): Promise<ToolResult>;
}
