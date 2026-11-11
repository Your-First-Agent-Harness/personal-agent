/**
 * 领域层：消息是 runtime 与 Provider 之间最小的契约。
 * 这里只有数据，没有行为，也不允许 import 任何第三方库。
 */
export type MessageRole = 'system' | 'user' | 'assistant';

export interface Message {
  readonly role: MessageRole;
  readonly content: string;
}
