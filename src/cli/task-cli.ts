import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface CliTask {
  readonly id: string;
  readonly payload: unknown;
  readonly status: 'queued';
  readonly createdAt: string;
}

interface TaskFile { readonly tasks: readonly CliTask[]; }

function load(path: string): CliTask[] {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as TaskFile;
    return [...parsed.tasks];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new Error(`无法读取任务存储：${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

function save(path: string, tasks: readonly CliTask[]): void {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify({ tasks }, null, 2)}\n`, 'utf8');
  renameSync(temporary, path);
}

export function taskStorePath(workspace = process.cwd()): string {
  return process.env.PA_TASK_STORE ?? join(workspace, '.personal-agent-tasks.json');
}

export function runTaskCli(args: readonly string[], workspace = process.cwd()): string {
  const command = args[0];
  const path = taskStorePath(workspace);
  const tasks = load(path);
  if (command === 'create') {
    const id = args[1];
    if (id === undefined || id.trim() === '') throw new Error('用法：personal-agent task create <id> [payload-json]');
    if (tasks.some((task) => task.id === id)) throw new Error(`任务已存在：${id}`);
    const rawPayload = args.slice(2).join(' ');
    let payload: unknown = rawPayload;
    if (rawPayload !== '') {
      try { payload = JSON.parse(rawPayload) as unknown; } catch { /* 保留普通字符串 payload */ }
    }
    const task: CliTask = { id, payload, status: 'queued', createdAt: new Date().toISOString() };
    save(path, [...tasks, task]);
    return JSON.stringify(task, null, 2);
  }
  if (command === 'status') {
    const id = args[1];
    const task = tasks.find((candidate) => candidate.id === id);
    if (task === undefined) throw new Error(`未知任务：${id ?? '<missing>'}`);
    return JSON.stringify(task, null, 2);
  }
  if (command === 'list') return JSON.stringify(tasks, null, 2);
  throw new Error('用法：personal-agent task <create|status|list> ...');
}
