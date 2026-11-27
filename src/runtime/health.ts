export interface HealthReport {
  readonly status: 'ok' | 'degraded';
  readonly version: string;
  readonly checks: Readonly<Record<string, 'ok' | 'failed'>>;
}

export function createHealthReport(version: string, checks: Readonly<Record<string, boolean>>): HealthReport {
  const normalized = Object.fromEntries(Object.entries(checks).map(([name, ok]) => [name, ok ? 'ok' : 'failed'])) as Record<string, 'ok' | 'failed'>;
  return { status: Object.values(normalized).every((value) => value === 'ok') ? 'ok' : 'degraded', version, checks: normalized };
}
