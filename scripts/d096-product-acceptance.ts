import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const workspace = mkdtempSync(join(tmpdir(), 'pa-d096-acceptance-'));
try {
  const store = join(workspace, 'tasks.json');
  const env = { ...process.env, PA_TASK_STORE: store };
  const create = execFileSync('node', ['dist/cli/main.js', 'task', 'create', 'd096-task', '{"kind":"acceptance"}'], { encoding: 'utf8', env });
  const status = execFileSync('node', ['dist/cli/main.js', 'task', 'status', 'd096-task'], { encoding: 'utf8', env });
  const config = execFileSync('node', ['dist/cli/main.js', 'config', 'show', '--json'], { encoding: 'utf8', env });
  const tools = execFileSync('node', ['dist/cli/main.js', 'tools', 'list', '--json'], { encoding: 'utf8', env });
  const parsedCreate = JSON.parse(create) as { status: string };
  const parsedStatus = JSON.parse(status) as { id: string };
  const parsedConfig = JSON.parse(config) as { model: { apiKey?: string } };
  const parsedTools = JSON.parse(tools) as unknown[];
  const report = { taskCreated: parsedCreate.status === 'queued', statusFound: parsedStatus.id === 'd096-task', configRedacted: parsedConfig.model.apiKey !== 'not-for-output', tools: parsedTools.length };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.taskCreated || !report.statusFound || !report.configRedacted || report.tools !== 5) {
    process.stderr.write('D096 PRODUCT ACCEPTANCE FAIL\n'); process.exitCode = 1;
  } else process.stdout.write('D096 PRODUCT ACCEPTANCE PASS\n');
} finally { rmSync(workspace, { recursive: true, force: true }); }
