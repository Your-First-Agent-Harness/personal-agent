import { describe, expect, it } from 'vitest';

import { createTaskSummary, formatTaskSummary } from '../src/context/task-summary.ts';

describe('D055 会话与任务状态摘要', () => {
  it('从消息历史提取目标、成功工具结果、失败结果和系统约束', () => {
    const summary = createTaskSummary([
      { role: 'system', content: '只读，不修改文件' },
      { role: 'user', content: '检查项目' },
      { role: 'tool', toolCallId: '1', name: 'git_status', content: '分支干净' },
      { role: 'tool', toolCallId: '2', name: 'run', content: '执行失败：exitCode=1' },
    ]);
    expect(summary.goal).toBe('检查项目');
    expect(summary.completed).toEqual(['分支干净']);
    expect(summary.failures).toEqual(['执行失败：exitCode=1']);
    expect(summary.constraints).toEqual(['只读，不修改文件']);
    expect(formatTaskSummary(summary)).toContain('目标：检查项目');
  });

  it('没有工具结果时标记目标为待办', () => {
    expect(createTaskSummary([{ role: 'user', content: '完成发布' }]).pending).toEqual(['完成发布']);
  });
});
