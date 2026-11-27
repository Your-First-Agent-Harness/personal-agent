import { runToolsCli } from '../src/cli/tools-cli.ts';

const output = runToolsCli(['list']);
process.stdout.write(`${output}\n`);
if (!output.includes('read_file@') || output.split('\n').length !== 5) {
  process.stderr.write('D088 TOOLS CLI FAIL\n'); process.exitCode = 1;
} else process.stdout.write('D088 TOOLS CLI PASS\n');
