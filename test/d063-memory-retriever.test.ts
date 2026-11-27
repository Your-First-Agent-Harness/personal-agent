import { describe, expect, it } from 'vitest';

import { searchMemory } from '../src/memory/retriever.ts';

describe('D063 长期记忆检索', () => {
  it('按关键词稳定排序并返回来源', () => {
    const results = searchMemory([
      { key: 'language', entry: { layer: 'long_term', content: '回答使用中文', stable: true, source: 'user' } },
      { key: 'style', entry: { layer: 'long_term', content: '回答简洁', stable: true, source: 'user' } },
    ], '中文');
    expect(results).toEqual([{ key: 'language', content: '回答使用中文', score: 1, source: 'user' }]);
  });

  it('无匹配返回空，非法 limit 拒绝', () => {
    expect(searchMemory([], '不存在')).toEqual([]);
    expect(() => searchMemory([], 'x', -1)).toThrow('非负整数');
  });
});
