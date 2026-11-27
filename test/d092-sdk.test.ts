import { describe, expect, it } from 'vitest';

import { PersonalAgentClient } from '../src/sdk.ts';

describe('D092 编程式 SDK', () => {
  it('提交任务并通过 handle 查询', () => {
    const client = new PersonalAgentClient<{ prompt: string }>();
    const handle = client.submit({ id: 'sdk-task-1', payload: { prompt: 'hello' } });
    expect(handle.id).toBe('sdk-task-1');
    expect(handle.get()).toMatchObject({ id: 'sdk-task-1', status: 'queued', payload: { prompt: 'hello' } });
    expect(client.list()).toHaveLength(1);
  });

  it('拒绝重复显式任务 id', () => {
    const client = new PersonalAgentClient();
    client.submit({ id: 'same', payload: 1 });
    expect(() => client.submit({ id: 'same', payload: 2 })).toThrow('已存在');
  });
});
