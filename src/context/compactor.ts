import type { Message } from '../core/message.ts';

export interface ContextCompactionResult {
  readonly messages: readonly Message[];
  readonly summary: string;
  readonly originalChars: number;
  readonly compactedChars: number;
  readonly removedMessages: number;
}

export interface ContextCompactor {
  compact(messages: readonly Message[], targetChars: number): Promise<ContextCompactionResult>;
}

function chars(messages: readonly Message[]): number {
  return messages.reduce((sum, message) => sum + message.content.length
    + (message.toolCalls ?? []).reduce((n, call) => n + call.id.length + call.name.length + call.arguments.length, 0), 0);
}

function deterministicSummary(messages: readonly Message[], latestUser: Message | undefined): string {
  const facts = messages
    .filter((message) => message !== latestUser && (message.role === 'user' || message.role === 'tool'))
    .map((message) => `${message.role}: ${message.content.replace(/\s+/g, ' ').trim()}`)
    .filter(Boolean);
  return facts.length === 0 ? '无可压缩的历史事实。' : `历史摘要：\n${facts.join('\n')}`;
}

export class DeterministicContextCompactor implements ContextCompactor {
  async compact(messages: readonly Message[], targetChars: number): Promise<ContextCompactionResult> {
    await Promise.resolve();
    if (!Number.isSafeInteger(targetChars) || targetChars <= 0) throw new Error('targetChars 必须是正整数');
    const originalChars = chars(messages);
    const latestUser = [...messages].reverse().find((message) => message.role === 'user');
    const summary = deterministicSummary(messages, latestUser);
    const system = messages.filter((message) => message.role === 'system');
    const compacted: Message[] = [...system, { role: 'system', content: summary }];
    if (latestUser !== undefined && !system.includes(latestUser)) compacted.push(latestUser);
    const compactedChars = chars(compacted);
    if (compactedChars > targetChars) throw new Error(`压缩结果仍超过目标：${compactedChars}/${targetChars}`);
    return {
      messages: compacted,
      summary,
      originalChars,
      compactedChars,
      removedMessages: Math.max(0, messages.length - compacted.length),
    };
  }
}
