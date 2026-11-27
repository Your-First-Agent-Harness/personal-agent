import { resolveMemoryVersions } from '../src/memory/conflicts.ts';

const result = resolveMemoryVersions([
  { key: 'language', entry: { layer: 'long_term', content: '中文', stable: true, source: 'user' }, version: 1, active: true },
  { key: 'language', entry: { layer: 'long_term', content: '英文', stable: true, source: 'user' }, version: 2, active: true },
]);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (result.conflicts.length !== 1) {
  process.stderr.write('D064 MEMORY CONFLICT FAIL\n'); process.exitCode = 1;
} else process.stdout.write('D064 MEMORY CONFLICT PASS\n');
