import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { runTaskCli } from '../src/cli/task-cli.ts';

const temporaryDirectories: string[] = [];
afterEach(() => { for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe('D086 CLI 任务提交与查询', () => {
  it('创建任务并通过 status/list 查询', () => {
    const directory = mkdtempSync(join(tmpdir(), 'pa-d086-'));
    temporaryDirectories.push(directory);
    const environment = process.env.PA_TASK_STORE;
    process.env.PA_TASK_STORE = join(directory, 'tasks.json');
    try {
      const created = JSON.parse(runTaskCli(['create', 'task-1', '{"kind":"demo"}'])) as { status: string };
      const status = JSON.parse(runTaskCli(['status', 'task-1'])) as { payload: unknown };
      const list = JSON.parse(runTaskCli(['list'])) as unknown[];
      const stored = JSON.parse(readFileSync(join(directory, 'tasks.json'), 'utf8')) as { tasks: unknown[] };
      expect(created.status).toBe('queued');
      expect(status.payload).toEqual({ kind: 'demo' });
      expect(list).toHaveLength(1);
      expect(stored.tasks).toHaveLength(1);
    } finally {
      if (environment === undefined) delete process.env.PA_TASK_STORE;
      else process.env.PA_TASK_STORE = environment;
    }
  });

  it('拒绝重复和未知任务', () => {
    const directory = mkdtempSync(join(tmpdir(), 'pa-d086-'));
    temporaryDirectories.push(directory);
    const previous = process.env.PA_TASK_STORE;
    process.env.PA_TASK_STORE = join(directory, 'tasks.json');
    try {
      runTaskCli(['create', 'task-1']);
      expect(() => runTaskCli(['create', 'task-1'])).toThrow('已存在');
      expect(() => runTaskCli(['status', 'missing'])).toThrow('未知');
    } finally {
      if (previous === undefined) delete process.env.PA_TASK_STORE;
      else process.env.PA_TASK_STORE = previous;
    }
  });
});
