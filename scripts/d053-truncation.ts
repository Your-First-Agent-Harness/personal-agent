import { truncateToolResult } from '../src/context/truncate.ts';

const report = truncateToolResult({
  role: 'tool', toolCallId: 'demo', name: 'read_file',
  content: '文件头部：导出接口\n' + '实现细节\n'.repeat(100) + '文件尾部',
}, 120);

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.truncated || report.finalChars > 120 || !report.message.content.endsWith('…[已截断]')) {
  process.stderr.write('D053 TRUNCATION FAIL\n');
  process.exitCode = 1;
} else {
  process.stdout.write('D053 TRUNCATION PASS\n');
}
