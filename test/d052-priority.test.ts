import { describe, expect, it } from 'vitest';

import { buildPrioritizedContext } from '../src/context/priority.ts';

describe('D052 消息优先级与裁剪决策', () => {
  it('保留 system 和最新 user，并说明历史被裁剪的原因', () => {
    const result = buildPrioritizedContext([
      { role: 'system', content: '安全规则' },
      { role: 'user', content: '旧目标' },
      { role: 'assistant', content: 'x'.repeat(100) },
      { role: 'user', content: '当前目标' },
    ], 45);

    expect(result.messages[0]).toEqual({ role: 'system', content: '安全规则' });
    expect(result.messages.at(-1)).toEqual({ role: 'user', content: '当前目标' });
    expect(result.decisions.find((d) => d.priority === 'system')?.kept).toBe(true);
    expect(result.decisions.find((d) => d.priority === 'latest_user')?.kept).toBe(true);
    expect(result.decisions.some((d) => !d.kept && d.priority === 'history')).toBe(true);
  });

  it('工具 assistant/tool 组不会被拆开', () => {
    const result = buildPrioritizedContext([
      { role: 'system', content: '规则' },
      { role: 'assistant', content: '调用', toolCalls: [{ id: '1', name: 'read', arguments: '{}' }] },
      { role: 'tool', toolCallId: '1', name: 'read', content: '结果' },
      { role: 'user', content: '继续' },
    ], 100);
    const keptTool = result.messages.some((message) => message.role === 'tool');
    const keptAssistantCall = result.messages.some((message) => (message.toolCalls?.length ?? 0) > 0);
    expect(keptTool).toBe(keptAssistantCall);
  });
});
