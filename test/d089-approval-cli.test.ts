import { describe, expect, it } from 'vitest';

import { ApprovalStore, runApprovalCli } from '../src/cli/approval-cli.ts';

describe('D089 权限审批 CLI', () => {
  it('记录本次 tool call 的批准或拒绝', () => {
    const store = new ApprovalStore();
    const approved = JSON.parse(runApprovalCli(['approve', 'call-1', 'write_file'], store)) as { decision: string };
    const denied = JSON.parse(runApprovalCli(['deny', 'call-2', 'run_command'], store)) as { decision: string };
    expect(approved.decision).toBe('approved');
    expect(denied.decision).toBe('denied');
    expect(store.list()).toHaveLength(2);
  });

  it('缺少参数和未知命令失败', () => {
    const store = new ApprovalStore();
    expect(() => runApprovalCli(['approve'], store)).toThrow('用法');
    expect(() => runApprovalCli(['reset'], store)).toThrow('用法');
  });
});
