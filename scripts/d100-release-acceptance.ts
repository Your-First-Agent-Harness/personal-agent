import { runD100ReleaseAcceptance } from '../src/demo/d100.ts';

try {
  process.stdout.write(`${runD100ReleaseAcceptance(process.cwd())}\n`);
} catch (error) {
  process.stderr.write(`D100 V1.0.0 RELEASE ACCEPTANCE FAIL: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
