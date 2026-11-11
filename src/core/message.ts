/**
 * 领域层：消息是 runtime 与 Provider 之间最小的契约。
 * 这里只有数据，没有行为，也不允许 import 任何第三方库。
 */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/** 模型发起的工具调用。arguments 保留原始 JSON 字符串，解析交给工具层 */
export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: string;
}

export interface Message {
  readonly role: MessageRole;
  readonly content: string;
  /** role=assistant 且模型要求调工具时携带 */
  readonly toolCalls?: readonly ToolCall[];
  /** role=tool 时必填，用于把结果对回那一次调用 */
  readonly toolCallId?: string;
  /** role=tool 时的工具名，便于日志与回放 */
  readonly name?: string;
}
