import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runConfigCli } from '../src/cli/config-cli.ts';

const directory = mkdtempSync(join(tmpdir(), 'pa-d087-demo-'));
try {
  writeFileSync(join(directory, 'agent.config.json'), JSON.stringify({ agent: { maxTurns: 7 }, model: { apiKey: 'not-for-output' } }));
  const output = runConfigCli(['show'], directory, { PA_MAX_TURNS: '9' });
  process.stdout.write(`${output}\n`);
  if (!output.includes('agent.maxTurns=9') || !output.includes('model.apiKey=[REDACTED]')) {
    process.stderr.write('D087 CONFIG CLI FAIL\n'); process.exitCode = 1;
  } else process.stdout.write('D087 CONFIG CLI PASS\n');
} finally { rmSync(directory, { recursive: true, force: true }); }
