import { runD041Demo } from '../src/demo/d041.ts';

const output = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

try {
  await runD041Demo(output);
} catch (error) {
  process.stderr.write(
    `D041 FAIL: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
