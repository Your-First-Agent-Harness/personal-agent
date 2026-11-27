import { classifyMemory } from '../src/memory/layers.ts';

const entries = [
  classifyMemory('记住：以后使用中文', 'user'),
  classifyMemory('当前工具结果', 'tool'),
  classifyMemory('以后始终这样做', 'agent'),
];
process.stdout.write(`${JSON.stringify(entries, null, 2)}\n`);
if (entries.map(({ layer }) => layer).join(',') !== 'long_term,session,session') {
  process.stderr.write('D061 MEMORY LAYERS FAIL\n'); process.exitCode = 1;
} else process.stdout.write('D061 MEMORY LAYERS PASS\n');
