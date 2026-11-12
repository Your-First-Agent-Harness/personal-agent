import { runD037Demo } from '../src/demo/d037.ts';

const output = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

try {
  const report = await runD037Demo(output);
  for (const backend of report.backends) {
    output(
      `result backend=${backend.backend} turns=${backend.turns} stopReason=${backend.stopReason} final=${JSON.stringify(backend.finalText)}`,
    );
  }
  output(`D037 comparison passed; workspaceRemoved=${report.workspaceRemoved}`);
} catch (error) {
  process.stderr.write(`D037 comparison failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
}
