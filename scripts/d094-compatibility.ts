import { compareApiManifests } from '../src/api/compatibility.ts';

const comparison = compareApiManifests(
  { version: '0.4.0', exports: ['PersonalAgentClient', 'createHealthReport'] },
  { version: '0.4.1', exports: ['PersonalAgentClient', 'createHealthReport', 'compareApiManifests'] },
);
process.stdout.write(`${JSON.stringify(comparison, null, 2)}\n`);
if (!comparison.compatible || comparison.added[0] !== 'compareApiManifests') {
  process.stderr.write('D094 COMPATIBILITY FAIL\n'); process.exitCode = 1;
} else process.stdout.write('D094 COMPATIBILITY PASS\n');
