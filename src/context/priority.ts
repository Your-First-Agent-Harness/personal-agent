import type { Message } from '../core/message.ts';
import { buildContext, messageChars } from './build.ts';

export type ContextPriority = 'system' | 'latest_user' | 'tool_group' | 'history';

export interface ContextDecision {
  readonly priority: ContextPriority;
  readonly kept: boolean;
  readonly chars: number;
  readonly reason: string;
}

export interface PrioritizedContext {
  readonly messages: readonly Message[];
  readonly decisions: readonly ContextDecision[];
}

function priorityOf(message: Message, latestUser: Message | undefined): ContextPriority {
  if (message.role === 'system') return 'system';
  if (message === latestUser) return 'latest_user';
  if (message.role === 'tool' || (message.role === 'assistant' && (message.toolCalls?.length ?? 0) > 0)) {
    return 'tool_group';
  }
  return 'history';
}

export function buildPrioritizedContext(
  messages: readonly Message[],
  maxChars: number,
): PrioritizedContext {
  const result = buildContext(messages, maxChars);
  const latestUser = [...messages].reverse().find((message) => message.role === 'user');
  const keptKeys = new Set(result.map((message) => JSON.stringify(message)));
  const decisions: ContextDecision[] = messages.map((message) => {
    const kept = keptKeys.has(JSON.stringify(message));
    const priority = priorityOf(message, latestUser);
    return {
      priority,
      kept,
      chars: messageChars(message),
      reason: kept
        ? `保留：${priority} 优先级满足当前预算`
        : `裁剪：${priority} 优先级低于当前预算或工具组无法完整容纳`,
    };
  });
  return { messages: result, decisions };
}
