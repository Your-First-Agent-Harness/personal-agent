import { randomUUID } from 'node:crypto';
import type { Message } from '../core/message.ts';

function clone(message: Message): Message {
  return {
    ...message,
    ...(message.toolCalls === undefined
      ? {}
      : { toolCalls: message.toolCalls.map((call) => ({ ...call })) }),
  };
}

export class Session {
  readonly id: string;
  private readonly history: Message[];

  constructor(id: string = randomUUID(), messages: readonly Message[] = []) {
    this.id = id;
    this.history = messages.map(clone);
  }

  snapshot(): readonly Message[] {
    return this.history.map(clone);
  }

  append(messages: readonly Message[]): void {
    this.history.push(...messages.map(clone));
  }
}
