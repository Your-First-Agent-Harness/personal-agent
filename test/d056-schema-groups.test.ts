import { describe, expect, it } from 'vitest';

import { expandToolSchemaGroup, groupToolSchemas } from '../src/tools/schema-groups.ts';

const tool = (name: string) => ({ name, description: name, parameters: { type: 'object' } });

describe('D056 工具 Schema 分组与按需展开', () => {
  it('按固定大小分组，并只展开指定组', () => {
    const groups = groupToolSchemas([tool('a'), tool('b'), tool('c')], 2);
    expect(groups.map((group) => group.name)).toEqual(['group-1', 'group-2']);
    expect(groups[0]?.tools.map(({ name }) => name)).toEqual(['a', 'b']);
    expect(expandToolSchemaGroup(groups, 'group-2').map(({ name }) => name)).toEqual(['c']);
    expect(expandToolSchemaGroup(groups, 'missing')).toEqual([]);
  });

  it('拒绝非法分组大小', () => {
    expect(() => groupToolSchemas([], 0)).toThrow('正整数');
  });
});
