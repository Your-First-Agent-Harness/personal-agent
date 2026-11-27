import { runContextPressureCases } from '../src/context/pressure.ts';

const results = runContextPressureCases([
  { name: 'short-history', messages: [{ role: 'user', content: 'status' }], tools: [], maxChars: 100 },
  { name: 'many-tools', messages: [{ role: 'user', content: 'status' }], tools: Array.from({ length: 50 }, (_, i) => ({ name: `tool_${i}`, description: 'large catalog entry', parameters: { type: 'object', properties: { value: { type: 'string' } } } })), maxChars: 512 },
  { name: 'large-result', messages: [{ role: 'tool', toolCallId: '1', name: 'read', content: 'x'.repeat(2048) }], tools: [], maxChars: 512 },
]);
process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
if (!results.some(({ report }) => !report.fits) || !results[0]?.report.fits) {
  process.stderr.write('D057 PRESSURE FAIL\n'); process.exitCode = 1;
} else process.stdout.write('D057 PRESSURE PASS\n');
