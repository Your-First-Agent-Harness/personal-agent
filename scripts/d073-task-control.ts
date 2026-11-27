import { TaskController } from '../src/runtime/task-control.ts';

const controller = new TaskController();
controller.create('task-1');
const states = [controller.start('task-1'), controller.pause('task-1'), controller.start('task-1'), controller.complete('task-1')];
process.stdout.write(`${JSON.stringify(states, null, 2)}\n`);
if (states.at(-1)?.status !== 'completed') {
  process.stderr.write('D073 TASK CONTROL FAIL\n'); process.exitCode = 1;
} else process.stdout.write('D073 TASK CONTROL PASS\n');
