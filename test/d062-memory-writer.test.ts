import { describe, expect, it } from 'vitest';

import { MemoryWriter } from '../src/memory/writer.ts';

describe('D062 长期记忆写入策略', () => {
  it('接受稳定用户记忆，拒绝普通或非用户候选，并支持同 key 更新', () => {
    const writer = new MemoryWriter();
    const result = writer.write([
      { key: 'language', entry: { layer: 'long_term', content: '使用中文', stable: true, source: 'user' } },
      { key: 'weather', entry: { layer: 'session', content: '晴', stable: false, source: 'tool' } },
    ]);
    expect(result.accepted).toHaveLength(1);
    expect(result.rejected).toHaveLength(1);
    expect(writer.write([{ key: 'language', entry: { layer: 'long_term', content: '使用英文', stable: true, source: 'user' } }]).updated).toHaveLength(1);
    expect(writer.list()[0]?.entry.content).toBe('使用英文');
  });
});
