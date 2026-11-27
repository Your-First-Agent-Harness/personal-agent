import { runD050G2Demo } from '../src/demo/d050.ts';

try {
  await runD050G2Demo((line) => process.stdout.write(`${line}\n`));
} catch (error) {
  process.stderr.write(`D050 G2 ACCEPTANCE FAIL: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
