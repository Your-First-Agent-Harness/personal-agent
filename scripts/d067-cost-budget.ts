import { calculateCost } from '../src/runtime/cost.ts';
import { decideCostAction } from '../src/runtime/cost-budget.ts';

const decisions = [10, 80, 100].map((units) => decideCostAction(calculateCost([{ kind: 'model', units }]), 100));
process.stdout.write(`${JSON.stringify(decisions, null, 2)}\n`);
if (decisions.map(({ action }) => action).join(',') !== 'continue,degrade,stop') {
  process.stderr.write('D067 COST BUDGET FAIL\n'); process.exitCode = 1;
} else process.stdout.write('D067 COST BUDGET PASS\n');
