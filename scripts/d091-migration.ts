import { migrateRecord } from '../src/runtime/migration.ts';
import type { Migration } from '../src/runtime/migration.ts';

type TaskData = Record<string, unknown> & { status: string; attempts: number };
const migrations = new Map<number, Migration<TaskData>>([
  [1, (data) => ({ ...data, schema: 'v2' })],
  [2, (data) => ({ ...data, attempts: data.attempts + 1 })],
]);

const record = migrateRecord(
  { version: 1, data: { status: 'queued', attempts: 0 } },
  3,
  migrations,
);
process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
if (record.version !== 3 || record.data.attempts !== 1) {
  process.stderr.write('D091 MIGRATION FAIL\n'); process.exitCode = 1;
} else process.stdout.write('D091 MIGRATION PASS\n');
