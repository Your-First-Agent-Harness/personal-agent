import { buildPrioritizedContext } from '../src/context/priority.ts';

const report = buildPrioritizedContext([
  { role: 'system', content: '安全规则：不得越权' },
  { role: 'user', content: '历史目标' },
  { role: 'assistant', content: '历史推理'.repeat(30) },
  { role: 'user', content: '当前目标：只读检查' },
], 100);

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.decisions.some((d) => d.priority === 'system' && d.kept)
  || !report.decisions.some((d) => d.priority === 'latest_user' && d.kept)) {
  process.stderr.write('D052 CONTEXT PRIORITY FAIL\n');
  process.exitCode = 1;
} else {
  process.stdout.write('D052 CONTEXT PRIORITY PASS\n');
}
