import type { Message } from '../core/message.ts';
import { messageChars, totalChars } from './build.ts';
import type { ToolSchema } from '../core/tool.ts';

export interface ContextBudgetInput {
  readonly messages: readonly Message[];
  readonly tools?: readonly ToolSchema[];
  readonly maxChars: number;
}

export interface ContextBudgetReport {
  readonly maxChars: number;
  readonly messageChars: number;
  readonly toolSchemaChars: number;
  readonly totalChars: number;
  readonly remainingChars: number;
  readonly fits: boolean;
}

function validateMaxChars(maxChars: number): void {
  if (!Number.isSafeInteger(maxChars) || maxChars <= 0) {
    throw new Error('maxChars 必须是正整数');
  }
}

export function toolSchemaChars(tools: readonly ToolSchema[] = []): number {
  return tools.reduce((sum, tool) => sum + tool.name.length + tool.description.length
    + JSON.stringify(tool.parameters).length, 0);
}

export function measureContextBudget(input: ContextBudgetInput): ContextBudgetReport {
  validateMaxChars(input.maxChars);
  const messageCharsUsed = totalChars(input.messages);
  const schemaChars = toolSchemaChars(input.tools);
  const used = messageCharsUsed + schemaChars;
  return {
    maxChars: input.maxChars,
    messageChars: messageCharsUsed,
    toolSchemaChars: schemaChars,
    totalChars: used,
    remainingChars: input.maxChars - used,
    fits: used <= input.maxChars,
  };
}

export function messageBudget(messages: readonly Message[]): number {
  return messages.reduce((sum, message) => sum + messageChars(message), 0);
}
