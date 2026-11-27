import { createTaskSummary, formatTaskSummary } from '../src/context/task-summary.ts';

const summary = createTaskSummary([
  { role: 'system', content: '只读检查，禁止写入' },
  { role: 'user', content: '检查发布状态' },
  { role: 'tool', toolCallId: '1', name: 'git_status', content: '工作区干净' },
]);
process.stdout.write(`${formatTaskSummary(summary)}\n`);
if (summary.goal !== '检查发布状态' || summary.completed.length !== 1 || summary.constraints.length !== 1) {
  process.stderr.write('D055 TASK SUMMARY FAIL\n'); process.exitCode = 1;
} else process.stdout.write('D055 TASK SUMMARY PASS\n');
