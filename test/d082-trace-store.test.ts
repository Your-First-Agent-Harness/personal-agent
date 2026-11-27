import { describe, expect, it } from 'vitest';

import { createReplayInput, TraceStore } from '../src/observability/trace-store.ts';

describe('D082 Trace Store 与 Replay 输入', () => {
  it('保存 trace 快照并生成稳定的 replay 输入', () => {
    const store = new TraceStore();
    const snapshot = store.save('t1', [{ id: 's1', traceId: 't1', name: 'tool', startedAt: 1, endedAt: 2, attributes: { tool: 'read' } }]);
    expect(store.get('t1')).toEqual(snapshot);
    expect(createReplayInput(snapshot)).toEqual([{ name: 'tool', attributes: { tool: 'read' } }]);
  });

  it('保存时复制 span 容器，避免外部修改列表影响快照', () => {
    const store = new TraceStore();
    const spans = [{ id: 's1', traceId: 't1', name: 'task', startedAt: 1, attributes: {} }];
    const snapshot = store.save('t1', spans);
    spans.push({ id: 's2', traceId: 't1', name: 'late', startedAt: 2, attributes: {} });
    expect(snapshot.spans).toHaveLength(1);
  });
});
