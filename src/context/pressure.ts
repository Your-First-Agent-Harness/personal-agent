import type { Message } from '../core/message.ts';
import type { ToolSchema } from '../core/tool.ts';
import { measureContextBudget } from './budget.ts';

export interface ContextPressureCase {
  readonly name: string;
  readonly messages: readonly Message[];
  readonly tools: readonly ToolSchema[];
  readonly maxChars: number;
}

export interface ContextPressureResult {
  readonly name: string;
  readonly report: ReturnType<typeof measureContextBudget>;
}

export function runContextPressureCases(cases: readonly ContextPressureCase[]): ContextPressureResult[] {
  return cases.map((testCase) => ({
    name: testCase.name,
    report: measureContextBudget(testCase),
  }));
}
