import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { runD046Demo } from '../src/demo/d046.ts';

try {
  const report = await runD046Demo((line) => process.stdout.write(`${line}\n`));
  const evidenceRoot = resolve('evidence');
  await mkdir(evidenceRoot, { recursive: true });
  await writeFile(resolve(evidenceRoot, 'd046-audit.jsonl'), report.auditJsonl, 'utf8');
  process.stdout.write('auditEvidence=evidence/d046-audit.jsonl\n');
} catch (error) {
  const message = error instanceof Error ? error.message : 'unknown failure';
  process.stderr.write(`D046 Demo FAIL: ${message}\n`);
  process.exitCode = 1;
}
