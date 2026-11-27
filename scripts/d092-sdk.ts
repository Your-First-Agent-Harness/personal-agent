import { PersonalAgentClient } from '../src/sdk.ts';

const client = new PersonalAgentClient<{ prompt: string }>();
const handle = client.submit({ id: 'd092-task', payload: { prompt: 'SDK demo' } });
process.stdout.write(`${JSON.stringify({ id: handle.id, task: handle.get() }, null, 2)}\n`);
if (handle.get()?.status !== 'queued') {
  process.stderr.write('D092 SDK FAIL\n'); process.exitCode = 1;
} else process.stdout.write('D092 SDK PASS\n');
