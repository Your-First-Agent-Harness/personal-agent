import { describe, expect, it } from 'vitest';

import { compareApiManifests } from '../src/api/compatibility.ts';

describe('D094 API 兼容性', () => {
  it('新增导出保持兼容', () => {
    expect(compareApiManifests({ version: '1', exports: ['A'] }, { version: '2', exports: ['A', 'B'] })).toEqual({ removed: [], added: ['B'], compatible: true });
  });

  it('移除导出标记为不兼容', () => {
    expect(compareApiManifests({ version: '1', exports: ['A', 'B'] }, { version: '2', exports: ['A'] })).toEqual({ removed: ['B'], added: [], compatible: false });
  });
});
