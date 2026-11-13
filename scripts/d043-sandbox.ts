import { runD043Demo } from '../src/demo/d043.ts';

const output = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

try {
  await runD043Demo(output);
} catch (error: unknown) {
  process.stderr.write(
    `D043 FAIL: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
