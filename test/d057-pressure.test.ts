import { describe, expect, it } from 'vitest';

import { runContextPressureCases } from '../src/context/pressure.ts';

describe('D057 上下文预算压力测试', () => {
  it('覆盖短历史、大工具目录和超长工具结果三类压力', () => {
    const results = runContextPressureCases([
      { name: 'short', messages: [{ role: 'user', content: 'x' }], tools: [], maxChars: 10 },
      { name: 'many-tools', messages: [{ role: 'user', content: 'x' }], tools: Array.from({ length: 20 }, (_, i) => ({ name: `t${i}`, description: '工具', parameters: { type: 'object' } })), maxChars: 100 },
      { name: 'large-result', messages: [{ role: 'tool', toolCallId: '1', content: 'x'.repeat(1000) }], tools: [], maxChars: 100 },
    ]);
    expect(results.map(({ name }) => name)).toEqual(['short', 'many-tools', 'large-result']);
    expect(results[0]?.report.fits).toBe(true);
    expect(results[1]?.report.fits).toBe(false);
    expect(results[2]?.report.fits).toBe(false);
  });
});
