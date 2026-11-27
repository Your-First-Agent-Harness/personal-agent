import { MemoryWriter } from '../src/memory/writer.ts';

const writer = new MemoryWriter();
const result = writer.write([
  { key: 'language', entry: { layer: 'long_term', content: '使用中文', stable: true, source: 'user' } },
  { key: 'tool-fact', entry: { layer: 'session', content: '工具结果', stable: false, source: 'tool' } },
]);
process.stdout.write(`${JSON.stringify({ result, stored: writer.list() }, null, 2)}\n`);
if (result.accepted.length !== 1 || result.rejected.length !== 1) {
  process.stderr.write('D062 MEMORY WRITER FAIL\n'); process.exitCode = 1;
} else process.stdout.write('D062 MEMORY WRITER PASS\n');
