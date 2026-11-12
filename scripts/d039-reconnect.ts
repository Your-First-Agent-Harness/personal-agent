import { runD039Demo } from '../src/demo/d039.ts';

const output = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

try {
  await runD039Demo(output);
} catch (error) {
  process.stderr.write(
    `D039 FAIL: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
