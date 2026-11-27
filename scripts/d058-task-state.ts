import { TaskStateMachine } from '../src/runtime/task-state.ts';

const machine = new TaskStateMachine({ maxTurns: 100, maxNoProgressTurns: 2 });
const states = [machine.record(1, 'inspect'), machine.record(2, 'inspect'), machine.record(3, 'inspect')];
process.stdout.write(`${JSON.stringify(states, null, 2)}\n`);
if (states.at(-1)?.status !== 'stalled') {
  process.stderr.write('D058 TASK STATE FAIL\n'); process.exitCode = 1;
} else process.stdout.write('D058 TASK STATE PASS\n');
