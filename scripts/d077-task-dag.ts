import { readyDagNodes } from '../src/runtime/task-dag.ts';

const nodes = [
  { id: 'plan', dependsOn: [] },
  { id: 'run-tests', dependsOn: ['plan'] },
  { id: 'publish', dependsOn: ['run-tests'] },
];
const ready = readyDagNodes(nodes, new Set(['plan']));
process.stdout.write(`${JSON.stringify({ nodes, completed: ['plan'], ready }, null, 2)}\n`);
if (ready[0]?.id !== 'run-tests') {
  process.stderr.write('D077 TASK DAG FAIL\n'); process.exitCode = 1;
} else process.stdout.write('D077 TASK DAG PASS\n');
