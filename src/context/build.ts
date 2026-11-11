import type { Message } from '../core/message.ts';

export const CONTEXT_OMITTED = '…[更早的上下文已省略]';
export const CONTEXT_TRUNCATED = '…[已截断]';

interface Unit {
  readonly messages: readonly Message[];
  readonly toolGroup: boolean;
}

function clone(message: Message): Message {
  return {
    ...message,
    ...(message.toolCalls === undefined
      ? {}
      : { toolCalls: message.toolCalls.map((call) => ({ ...call })) }),
  };
}

export function messageChars(message: Message): number {
  return message.content.length
    + (message.toolCallId?.length ?? 0)
    + (message.name?.length ?? 0)
    + (message.toolCalls ?? []).reduce(
      (sum, call) => sum + call.id.length + call.name.length + call.arguments.length,
      0,
    );
}

export function totalChars(messages: readonly Message[]): number {
  return messages.reduce((sum, message) => sum + messageChars(message), 0);
}

function unitChars(unit: Unit): number {
  return totalChars(unit.messages);
}

function groupUnits(messages: readonly Message[]): Unit[] {
  const units: Unit[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]!;
    if (message.role === 'assistant' && (message.toolCalls?.length ?? 0) > 0) {
      const ids = new Set(message.toolCalls!.map((call) => call.id));
      const group = [message];
      while (index + 1 < messages.length) {
        const next = messages[index + 1]!;
        if (next.role !== 'tool' || next.toolCallId === undefined || !ids.has(next.toolCallId)) break;
        group.push(next);
        index += 1;
      }
      units.push({ messages: group, toolGroup: true });
    } else if (message.role !== 'tool') {
      // 没有 assistant 配对的孤立 tool 不进入模型请求。
      units.push({ messages: [message], toolGroup: false });
    }
  }
  return units;
}

function truncateHead(content: string, budget: number): string {
  if (budget <= 0) return '';
  if (content.length <= budget) return content;
  if (budget <= CONTEXT_TRUNCATED.length) return CONTEXT_TRUNCATED.slice(0, budget);
  return content.slice(0, budget - CONTEXT_TRUNCATED.length) + CONTEXT_TRUNCATED;
}

function truncateLatestUser(message: Message, budget: number): Message {
  const metadataChars = messageChars({ ...message, content: '' });
  const contentBudget = Math.max(0, budget - metadataChars);
  if (contentBudget <= CONTEXT_TRUNCATED.length) {
    return { ...message, content: CONTEXT_TRUNCATED.slice(0, contentBudget) };
  }
  return {
    ...message,
    content: CONTEXT_TRUNCATED + message.content.slice(-(contentBudget - CONTEXT_TRUNCATED.length)),
  };
}

function fitToolGroup(unit: Unit, budget: number): Unit | undefined {
  const fixedChars = unit.messages.reduce(
    (sum, message) => sum + (message.role === 'tool' ? messageChars({ ...message, content: '' }) : messageChars(message)),
    0,
  );
  if (fixedChars > budget) return undefined;
  let remaining = budget - fixedChars;
  const fitted = unit.messages.map(clone);
  for (let index = fitted.length - 1; index >= 0; index -= 1) {
    const message = fitted[index]!;
    if (message.role !== 'tool') continue;
    fitted[index] = { ...message, content: truncateHead(message.content, remaining) };
    remaining = Math.max(0, remaining - message.content.length);
  }
  return { messages: fitted, toolGroup: true };
}

export function buildContext(messages: readonly Message[], maxChars: number): Message[] {
  if (!Number.isInteger(maxChars) || maxChars <= 0) throw new Error('maxChars 必须是正整数');
  const copy = messages.map(clone);
  if (totalChars(copy) <= maxChars) return copy;

  const system = copy.filter((message) => message.role === 'system');
  const systemChars = totalChars(system);
  if (systemChars > maxChars) throw new Error('system 消息本身超过上下文预算');

  const marker: Message = { role: 'system', content: CONTEXT_OMITTED };
  const available = maxChars - systemChars - messageChars(marker);
  if (available <= 0) throw new Error('预算不足以同时保留 system 和最新消息');

  const units = groupUnits(copy.filter((message) => message.role !== 'system'));
  const latestUserIndex = units.findLastIndex(
    (unit) => unit.messages.length === 1 && unit.messages[0]?.role === 'user',
  );
  const selected = new Map<number, Unit>();
  let used = 0;

  if (latestUserIndex >= 0) {
    const latest = units[latestUserIndex]!;
    if (unitChars(latest) <= available) {
      selected.set(latestUserIndex, latest);
      used = unitChars(latest);
    } else {
      const message = truncateLatestUser(latest.messages[0]!, available);
      selected.set(latestUserIndex, { messages: [message], toolGroup: false });
      used = messageChars(message);
    }
  }

  for (let index = units.length - 1; index >= 0 && used < available; index -= 1) {
    if (selected.has(index)) continue;
    const unit = units[index]!;
    const remaining = available - used;
    if (unitChars(unit) <= remaining) {
      selected.set(index, unit);
      used += unitChars(unit);
      continue;
    }
    if (unit.toolGroup) {
      const fitted = fitToolGroup(unit, remaining);
      if (fitted !== undefined) {
        selected.set(index, fitted);
      }
    }
    break;
  }

  return [
    ...system,
    marker,
    ...[...selected.entries()]
      .sort(([left], [right]) => left - right)
      .flatMap(([, unit]) => unit.messages),
  ];
}
