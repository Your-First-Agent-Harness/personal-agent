import { describe, expect, it } from 'vitest';

import { acceptsLongTermMemory, classifyMemory } from '../src/memory/layers.ts';

describe('D061 记忆分层边界', () => {
  it('用户明确表达长期偏好时才分类为 long_term', () => {
    const entry = classifyMemory('记住：以后回答使用中文', 'user');
    expect(entry.layer).toBe('long_term');
    expect(acceptsLongTermMemory(entry)).toBe(true);
  });

  it('工具事实和普通对话只进入 session', () => {
    expect(classifyMemory('当前天气晴', 'tool').layer).toBe('session');
    expect(classifyMemory('帮我检查项目', 'user').layer).toBe('session');
  });

  it('非用户来源即使包含长期词也不能写入长期记忆', () => {
    const entry = classifyMemory('以后始终使用这个设置', 'agent');
    expect(entry.layer).toBe('session');
    expect(acceptsLongTermMemory(entry)).toBe(false);
  });
});
