import { describe, expect, it } from 'vitest';

import { TraceRecorder } from '../src/observability/trace.ts';

describe('D081 Trace/Span', () => {
  it('记录父子 span、时间和属性', () => {
    const trace = new TraceRecorder('trace-1');
    const root = trace.start('task', undefined, { taskId: 'task-1' });
    const child = trace.start('tool', root.id);
    const ended = trace.end(child.id, { ok: true });
    expect(ended.parentId).toBe(root.id);
    expect(ended.endedAt).toBeGreaterThanOrEqual(ended.startedAt);
    expect(ended.attributes).toEqual({ ok: true });
  });

  it('未知 span 结束时失败', () => {
    expect(() => new TraceRecorder('trace-1').end('missing')).toThrow('未知 span');
  });
});
