import { describe, expect, it } from 'vitest';

import { resolveMemoryVersions } from '../src/memory/conflicts.ts';

describe('D064 记忆冲突和过期处理', () => {
  const entry = (content: string) => ({ layer: 'long_term' as const, content, stable: true, source: 'user' as const });

  it('保留未过期版本并报告同 key 冲突，不静默覆盖', () => {
    const result = resolveMemoryVersions([
      { key: 'language', entry: entry('中文'), version: 1, active: true },
      { key: 'language', entry: entry('英文'), version: 2, active: true },
    ]);
    expect(result.active).toHaveLength(2);
    expect(result.conflicts).toEqual([{ key: 'language', values: ['中文', '英文'] }]);
  });

  it('过滤已过期和显式失活版本', () => {
    const result = resolveMemoryVersions([
      { key: 'old', entry: entry('旧'), version: 1, active: true, expiresAt: 10 },
      { key: 'disabled', entry: entry('禁用'), version: 1, active: false },
    ], 20);
    expect(result.active).toEqual([]);
    expect(result.conflicts).toEqual([]);
  });
});
