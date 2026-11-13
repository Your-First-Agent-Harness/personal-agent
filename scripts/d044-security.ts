import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { runD044Demo } from '../src/demo/d044.ts';

try {
  const report = await runD044Demo((line) => process.stdout.write(`${line}\n`));
  const evidenceRoot = resolve('evidence');
  await mkdir(evidenceRoot, { recursive: true });
  await writeFile(resolve(evidenceRoot, 'd044-audit.jsonl'), report.auditJsonl, 'utf8');
  process.stdout.write('auditEvidence=evidence/d044-audit.jsonl\n');
} catch {
  process.stderr.write('D044 Demo FAIL\n');
  process.exitCode = 1;
}
