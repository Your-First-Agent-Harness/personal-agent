import { describe, expect, it } from 'vitest';

import { DeterministicContextCompactor } from '../src/context/compactor.ts';

describe('D054 上下文压缩接口', () => {
  it('保留系统约束和最新用户目标，压缩历史为可解释摘要', async () => {
    const result = await new DeterministicContextCompactor().compact([
      { role: 'system', content: '安全规则' },
      { role: 'user', content: '旧目标' },
      { role: 'tool', toolCallId: '1', name: 'read', content: '读取结果' },
      { role: 'user', content: '当前目标' },
    ], 100);
    expect(result.messages[0]).toEqual({ role: 'system', content: '安全规则' });
    expect(result.messages.at(-1)).toEqual({ role: 'user', content: '当前目标' });
    expect(result.summary).toContain('tool: 读取结果');
    expect(result.compactedChars).toBeLessThanOrEqual(100);
    expect(result.removedMessages).toBeGreaterThan(0);
  });

  it('压缩失败时明确报告目标不可满足', async () => {
    await expect(new DeterministicContextCompactor().compact([
      { role: 'system', content: '必须保留的安全规则'.repeat(20) },
    ], 10)).rejects.toThrow('压缩结果仍超过目标');
  });
});
