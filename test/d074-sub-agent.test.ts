import { describe, expect, it } from 'vitest';

import { canUseSubAgentTool, createSubAgentSpec } from '../src/runtime/sub-agent.ts';

describe('D074 子 Agent 接口', () => {
  it('创建带父任务、工具白名单和预算的子 Agent', () => {
    const spec = createSubAgentSpec({ id: 'child', parentId: 'parent', task: '扫描文件', allowedTools: ['read_file'], budget: 10 });
    expect(spec.depth).toBe(0);
    expect(canUseSubAgentTool(spec, 'read_file')).toBe(true);
    expect(canUseSubAgentTool(spec, 'write_file')).toBe(false);
  });

  it('拒绝自引用和非法预算/深度', () => {
    expect(() => createSubAgentSpec({ id: 'x', parentId: 'x', task: 'x', allowedTools: [], budget: 1 })).toThrow('自己');
    expect(() => createSubAgentSpec({ id: 'x', parentId: 'p', task: 'x', allowedTools: [], budget: 0 })).toThrow('budget');
    expect(() => createSubAgentSpec({ id: 'x', parentId: 'p', task: 'x', allowedTools: [], budget: 1, depth: -1 })).toThrow('depth');
  });
});
