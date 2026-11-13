import { runD048Demo } from '../src/demo/d048.ts';

try {
  await runD048Demo((line) => process.stdout.write(`${line}\n`));
} catch (error) {
  process.stderr.write(`D048 Demo FAIL: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
