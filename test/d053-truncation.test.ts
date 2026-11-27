import { describe, expect, it } from 'vitest';

import { truncateAssistantText, truncateToolResult } from '../src/context/truncate.ts';

describe('D053 工具结果分层截断', () => {
  it('工具结果保留开头并添加截断标记，不超过消息预算', () => {
    const report = truncateToolResult({
      role: 'tool', toolCallId: '1', name: 'read_file', content: '关键头部' + 'x'.repeat(100) + '无关尾部',
    }, 30);
    expect(report.truncated).toBe(true);
    expect(report.message.content.startsWith('关键头部')).toBe(true);
    expect(report.message.content.endsWith('…[已截断]')).toBe(true);
    expect(report.finalChars).toBeLessThanOrEqual(30);
  });

  it('assistant 说明保留尾部，适合保留最新结论', () => {
    const report = truncateAssistantText({ role: 'assistant', content: '旧说明'.repeat(20) + '最终结论' }, 24);
    expect(report.truncated).toBe(true);
    expect(report.message.content.startsWith('…[已截断]')).toBe(true);
    expect(report.message.content.endsWith('最终结论')).toBe(true);
  });

  it('拒绝错误角色和非法预算', () => {
    expect(() => truncateToolResult({ role: 'user', content: 'x' }, 5)).toThrow('tool');
    expect(() => truncateAssistantText({ role: 'assistant', content: 'x' }, 0)).toThrow('正整数');
  });
});
