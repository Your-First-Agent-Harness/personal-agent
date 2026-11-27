import { MemoryWriter } from '../src/memory/writer.ts';
import { searchMemory } from '../src/memory/retriever.ts';

const writer = new MemoryWriter();
writer.write([
  { key: 'language', entry: { layer: 'long_term', content: '回答使用中文', stable: true, source: 'user' } },
  { key: 'style', entry: { layer: 'long_term', content: '回答简洁', stable: true, source: 'user' } },
]);
const results = searchMemory(writer.list(), '中文');
process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
if (results[0]?.key !== 'language' || results[0]?.source !== 'user') {
  process.stderr.write('D063 MEMORY RETRIEVER FAIL\n'); process.exitCode = 1;
} else process.stdout.write('D063 MEMORY RETRIEVER PASS\n');
