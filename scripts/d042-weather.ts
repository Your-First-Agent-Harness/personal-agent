import { runD042Demo } from '../src/demo/d042.ts';

const output = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

try {
  await runD042Demo(output);
} catch (error: unknown) {
  process.stderr.write(
    `D042 FAIL: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
