import { describe, expect, it } from 'vitest';

import { createHealthReport } from '../src/runtime/health.ts';

describe('D093 健康检查', () => {
  it('所有检查通过时返回 ok', () => {
    expect(createHealthReport('0.4.0', { config: true, queue: true })).toEqual({ status: 'ok', version: '0.4.0', checks: { config: 'ok', queue: 'ok' } });
  });

  it('任一检查失败时返回 degraded', () => {
    expect(createHealthReport('0.4.0', { config: true, storage: false }).status).toBe('degraded');
  });
});
