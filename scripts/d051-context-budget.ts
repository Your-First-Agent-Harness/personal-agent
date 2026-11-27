import { measureContextBudget } from '../src/context/budget.ts';

const report = measureContextBudget({
  messages: [{ role: 'system', content: '你是安全的 Personal Agent。' }, { role: 'user', content: '读取项目状态' }],
  tools: [{ name: 'git_status', description: '检查版本库状态', parameters: { type: 'object', properties: {} } }],
  maxChars: 512,
});

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.fits) {
  process.stderr.write('D051 CONTEXT BUDGET FAIL\n');
  process.exitCode = 1;
} else {
  process.stdout.write('D051 CONTEXT BUDGET PASS\n');
}
