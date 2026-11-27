import { DeterministicContextCompactor } from '../src/context/compactor.ts';

const result = await new DeterministicContextCompactor().compact([
  { role: 'system', content: '安全规则：不得越权' },
  { role: 'user', content: '历史问题：读取配置' },
  { role: 'tool', toolCallId: '1', name: 'read_file', content: '配置已读取，未发现密钥' },
  { role: 'user', content: '当前目标：生成摘要' },
], 180);

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (result.compactedChars > 180 || !result.summary.includes('未发现密钥')) {
  process.stderr.write('D054 COMPACTION FAIL\n');
  process.exitCode = 1;
} else {
  process.stdout.write('D054 COMPACTION PASS\n');
}
