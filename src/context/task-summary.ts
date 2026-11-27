import type { Message } from '../core/message.ts';

export type TaskStepStatus = 'completed' | 'failed' | 'pending';

export interface TaskStepSummary {
  readonly description: string;
  readonly status: TaskStepStatus;
}

export interface TaskSummary {
  readonly goal: string;
  readonly completed: readonly string[];
  readonly failures: readonly string[];
  readonly pending: readonly string[];
  readonly constraints: readonly string[];
}

export function createTaskSummary(messages: readonly Message[]): TaskSummary {
  const goal = [...messages].reverse().find((message) => message.role === 'user')?.content ?? '未指定目标';
  const completed: string[] = [];
  const failures: string[] = [];
  const pending: string[] = [];
  const constraints = messages.filter((message) => message.role === 'system').map((message) => message.content);

  for (const message of messages) {
    if (message.role !== 'tool') continue;
    if (message.content.includes('"isError":true') || message.content.includes('失败')) failures.push(message.content);
    else completed.push(message.content);
  }
  if (completed.length === 0 && failures.length === 0) pending.push(goal);
  return { goal, completed, failures, pending, constraints };
}

export function formatTaskSummary(summary: TaskSummary): string {
  return [
    `目标：${summary.goal}`,
    `已完成：${summary.completed.join('；') || '无'}`,
    `失败：${summary.failures.join('；') || '无'}`,
    `待办：${summary.pending.join('；') || '无'}`,
    `约束：${summary.constraints.join('；') || '无'}`,
  ].join('\n');
}
