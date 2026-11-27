import { ApprovalStore, runApprovalCli } from '../src/cli/approval-cli.ts';

const store = new ApprovalStore();
const approval = JSON.parse(runApprovalCli(['approve', 'call-d089', 'write_file'], store)) as { decision: string };
process.stdout.write(`${JSON.stringify({ approval, records: store.list() }, null, 2)}\n`);
if (approval.decision !== 'approved') {
  process.stderr.write('D089 APPROVAL CLI FAIL\n'); process.exitCode = 1;
} else process.stdout.write('D089 APPROVAL CLI PASS\n');
