import { IdempotencyStore } from '../src/runtime/idempotency.ts';

const store = new IdempotencyStore<string>();
const first = store.begin('tool-call-1');
const completed = store.complete('tool-call-1', 'committed');
const replay = store.complete('tool-call-1', 'duplicate');
const unknown = store.markUnknown('tool-call-2');
process.stdout.write(`${JSON.stringify({ first, completed, replay, unknown }, null, 2)}\n`);
if (replay.result !== 'committed' || unknown.status !== 'unknown') {
  process.stderr.write('D079 IDEMPOTENCY FAIL\n'); process.exitCode = 1;
} else process.stdout.write('D079 IDEMPOTENCY PASS\n');
