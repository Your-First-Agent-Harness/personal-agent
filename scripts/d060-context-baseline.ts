import { runContextPressureCases } from '../src/context/pressure.ts';

const results = runContextPressureCases([
  { name: 'baseline-short', messages: [{ role: 'user', content: 'x'.repeat(100) }], tools: [], maxChars: 1000 },
  { name: 'baseline-tools', messages: [{ role: 'user', content: '目标' }], tools: Array.from({ length: 10 }, (_, i) => ({ name: `tool_${i}`, description: '工具', parameters: { type: 'object' } })), maxChars: 1000 },
  { name: 'baseline-overflow', messages: [{ role: 'tool', toolCallId: '1', content: 'x'.repeat(2000) }], tools: [], maxChars: 1000 },
]);
const summary = {
  cases: results.length,
  fitting: results.filter(({ report }) => report.fits).length,
  overflowing: results.filter(({ report }) => !report.fits).length,
  maxObservedChars: Math.max(...results.map(({ report }) => report.totalChars)),
};
process.stdout.write(`${JSON.stringify({ results, summary }, null, 2)}\n`);
if (summary.cases !== 3 || summary.fitting !== 2 || summary.overflowing !== 1) {
  process.stderr.write('D060 CONTEXT BASELINE FAIL\n'); process.exitCode = 1;
} else process.stdout.write('D060 CONTEXT BASELINE PASS\n');
