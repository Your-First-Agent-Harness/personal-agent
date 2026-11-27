import { runD069G3Acceptance } from '../src/demo/d069.ts';

try {
  runD069G3Acceptance((line) => process.stdout.write(`${line}\n`));
} catch (error) {
  process.stderr.write(`D069 G3 ACCEPTANCE FAIL: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
