import { runD085G4Acceptance } from '../src/demo/d085.ts';

try {
  process.stdout.write(`${await runD085G4Acceptance()}\n`);
} catch (error) {
  process.stderr.write(`D085 G4 ACCEPTANCE FAIL: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
