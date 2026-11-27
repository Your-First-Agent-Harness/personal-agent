import type { Message } from '../core/message.ts';
import { CONTEXT_TRUNCATED, messageChars } from './build.ts';

export interface TruncationReport {
  readonly message: Message;
  readonly originalChars: number;
  readonly finalChars: number;
  readonly truncated: boolean;
  readonly preserved: 'head' | 'tail' | 'none';
}

function truncateText(content: string, budget: number, preserve: 'head' | 'tail'): string {
  if (content.length <= budget) return content;
  if (budget <= CONTEXT_TRUNCATED.length) return CONTEXT_TRUNCATED.slice(0, budget);
  return preserve === 'head'
    ? content.slice(0, budget - CONTEXT_TRUNCATED.length) + CONTEXT_TRUNCATED
    : CONTEXT_TRUNCATED + content.slice(-(budget - CONTEXT_TRUNCATED.length));
}

export function truncateToolResult(message: Message, maxChars: number): TruncationReport {
  if (message.role !== 'tool') throw new Error('只能截断 tool 消息');
  if (!Number.isSafeInteger(maxChars) || maxChars <= 0) throw new Error('maxChars 必须是正整数');
  const fixed = messageChars({ ...message, content: '' });
  const contentBudget = Math.max(0, maxChars - fixed);
  const nextContent = truncateText(message.content, contentBudget, 'head');
  const nextMessage = { ...message, content: nextContent };
  return {
    message: nextMessage,
    originalChars: messageChars(message),
    finalChars: messageChars(nextMessage),
    truncated: nextContent !== message.content,
    preserved: nextContent === message.content ? 'head' : 'head',
  };
}

export function truncateAssistantText(message: Message, maxChars: number): TruncationReport {
  if (message.role !== 'assistant') throw new Error('只能截断 assistant 消息');
  if (!Number.isSafeInteger(maxChars) || maxChars <= 0) throw new Error('maxChars 必须是正整数');
  const fixed = messageChars({ ...message, content: '' });
  const contentBudget = Math.max(0, maxChars - fixed);
  const nextContent = truncateText(message.content, contentBudget, 'tail');
  const nextMessage = { ...message, content: nextContent };
  return {
    message: nextMessage,
    originalChars: messageChars(message),
    finalChars: messageChars(nextMessage),
    truncated: nextContent !== message.content,
    preserved: nextContent === message.content ? 'tail' : 'tail',
  };
}
