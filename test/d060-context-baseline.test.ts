import { describe, expect, it } from 'vitest';

import { runContextPressureCases } from '../src/context/pressure.ts';

describe('D060 上下文工程阶段基线', () => {
  it('基线数据可重复，区分适配和溢出用例', () => {
    const results = runContextPressureCases([
      { name: 'short', messages: [{ role: 'user', content: '目标' }], tools: [], maxChars: 100 },
      { name: 'tools', messages: [{ role: 'user', content: '目标' }], tools: [{ name: 'x', description: '工具', parameters: { type: 'object' } }], maxChars: 100 },
      { name: 'overflow', messages: [{ role: 'tool', toolCallId: '1', content: 'x'.repeat(200) }], tools: [], maxChars: 100 },
    ]);
    expect(results.map(({ report }) => report.fits)).toEqual([true, true, false]);
  });
});
