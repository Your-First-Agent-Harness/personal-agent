export interface ReplayStep { readonly name: string; readonly attributes: Readonly<Record<string, unknown>>; }
export interface ReplayResult { readonly steps: readonly string[]; readonly matched: boolean; }

export async function replayTrace(
  steps: readonly ReplayStep[],
  execute: (step: ReplayStep) => Promise<string>,
): Promise<ReplayResult> {
  const outputs: string[] = [];
  for (const step of steps) outputs.push(await execute(step));
  return { steps: outputs, matched: outputs.length === steps.length };
}
