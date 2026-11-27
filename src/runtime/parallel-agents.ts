export interface ParallelAgentResult<T> {
  readonly id: string;
  readonly value?: T;
  readonly error?: string;
}

export async function runParallelAgents<T>(
  tasks: readonly { id: string; run: () => Promise<T> }[],
): Promise<ParallelAgentResult<T>[]> {
  return Promise.all(tasks.map(async ({ id, run }) => {
    try { return { id, value: await run() }; }
    catch (error) { return { id, error: error instanceof Error ? error.message : String(error) }; }
  }));
}

export function aggregateParallelResults<T>(results: readonly ParallelAgentResult<T>[]): {
  readonly succeeded: readonly T[];
  readonly failed: readonly string[];
} {
  return {
    succeeded: results.flatMap(({ value }) => value === undefined ? [] : [value]),
    failed: results.flatMap(({ id, error }) => error === undefined ? [] : [`${id}: ${error}`]),
  };
}
