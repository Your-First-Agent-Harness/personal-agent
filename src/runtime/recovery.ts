export type RecoveryAction = 'retry' | 'resume' | 'stop';

export interface RecoveryDecision {
  readonly action: RecoveryAction;
  readonly reason: string;
}

export function decideRecovery(input: {
  readonly retryable: boolean;
  readonly interrupted: boolean;
  readonly attempts: number;
  readonly maxAttempts: number;
}): RecoveryDecision {
  if (input.interrupted) return { action: 'resume', reason: '任务被中断，保留状态后恢复' };
  if (input.retryable && input.attempts < input.maxAttempts) {
    return { action: 'retry', reason: `可恢复错误，允许第 ${input.attempts + 1} 次尝试` };
  }
  return { action: 'stop', reason: '错误不可恢复或已达到尝试上限' };
}
