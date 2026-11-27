export type ApprovalDecision = 'approved' | 'denied';

export interface ApprovalRecord {
  readonly callId: string;
  readonly toolName: string;
  readonly decision: ApprovalDecision;
  readonly decidedAt: string;
}

export class ApprovalStore {
  private readonly records = new Map<string, ApprovalRecord>();

  decide(callId: string, toolName: string, decision: ApprovalDecision): ApprovalRecord {
    const record = { callId, toolName, decision, decidedAt: new Date().toISOString() };
    this.records.set(callId, record);
    return record;
  }
  get(callId: string): ApprovalRecord | undefined { return this.records.get(callId); }
  list(): readonly ApprovalRecord[] { return [...this.records.values()]; }
}

export function runApprovalCli(args: readonly string[], store: ApprovalStore): string {
  const command = args[0];
  if (command === 'approve' || command === 'deny') {
    const callId = args[1];
    const toolName = args[2];
    if (callId === undefined || toolName === undefined) throw new Error('用法：approval <approve|deny> <call-id> <tool-name>');
    return JSON.stringify(store.decide(callId, toolName, command === 'approve' ? 'approved' : 'denied'), null, 2);
  }
  if (command === 'list') return JSON.stringify(store.list(), null, 2);
  throw new Error('用法：approval <approve|deny|list> ...');
}
