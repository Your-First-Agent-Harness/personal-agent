export interface EvalCase { readonly id: string; readonly expected: readonly string[]; }
export interface EvalResult { readonly id: string; readonly actual: readonly string[]; readonly passed: boolean; readonly mismatches: readonly string[]; }

export function evaluateReplay(input: EvalCase, actual: readonly string[]): EvalResult {
  const mismatches: string[] = [];
  if (actual.length !== input.expected.length) mismatches.push(`长度 ${actual.length} != ${input.expected.length}`);
  const count = Math.max(actual.length, input.expected.length);
  for (let index = 0; index < count; index += 1) {
    if (actual[index] !== input.expected[index]) mismatches.push(`步骤 ${index}: ${actual[index] ?? '<missing>'} != ${input.expected[index] ?? '<missing>'}`);
  }
  return { id: input.id, actual, passed: mismatches.length === 0, mismatches };
}
