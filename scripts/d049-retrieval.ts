import { runD049Demo } from '../src/demo/d049.ts';

try {
  await runD049Demo((line) => process.stdout.write(`${line}\n`));
} catch (error) {
  process.stderr.write(`D049 Demo FAIL: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
