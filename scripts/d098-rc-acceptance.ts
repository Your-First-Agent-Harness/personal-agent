import { runD098RcAcceptance } from '../src/demo/d098.ts';

try {
  process.stdout.write(`${runD098RcAcceptance(process.cwd())}\n`);
} catch (error) {
  process.stderr.write(`D098 RC ACCEPTANCE FAIL: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
