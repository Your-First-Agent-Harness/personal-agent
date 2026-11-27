import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runTaskCli } from '../src/cli/task-cli.ts';

const directory = mkdtempSync(join(tmpdir(), 'pa-d086-demo-'));
process.env.PA_TASK_STORE = join(directory, 'tasks.json');
try {
  const created = JSON.parse(runTaskCli(['create', 'demo-task', '{"source":"d086"}'])) as { status: string };
  const status = JSON.parse(runTaskCli(['status', 'demo-task'])) as { id: string };
  process.stdout.write(`${JSON.stringify({ created, status }, null, 2)}\n`);
  if (created.status !== 'queued' || status.id !== 'demo-task') {
    process.stderr.write('D086 TASK CLI FAIL\n'); process.exitCode = 1;
  } else process.stdout.write('D086 TASK CLI PASS\n');
} finally { rmSync(directory, { recursive: true, force: true }); }
