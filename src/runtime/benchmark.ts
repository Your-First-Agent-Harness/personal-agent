export interface BenchmarkResult {
  readonly turns: number;
  readonly completed: boolean;
  readonly toolErrors: number;
  readonly totalUnits: number;
}

export interface BenchmarkSummary {
  readonly cases: readonly BenchmarkResult[];
  readonly completionRate: number;
  readonly averageUnits: number;
}

export function summarizeBenchmark(cases: readonly BenchmarkResult[]): BenchmarkSummary {
  if (cases.length === 0) throw new Error('Benchmark 至少需要一个用例');
  return {
    cases,
    completionRate: cases.filter(({ completed }) => completed).length / cases.length,
    averageUnits: cases.reduce((sum, { totalUnits }) => sum + totalUnits, 0) / cases.length,
  };
}
