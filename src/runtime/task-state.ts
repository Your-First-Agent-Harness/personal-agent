export type TaskRunStatus = 'running' | 'completed' | 'max_turns' | 'stalled';

export interface TaskTurnState {
  readonly turn: number;
  readonly progressKey: string;
  readonly status: TaskRunStatus;
}

export interface TaskStateMachineOptions {
  readonly maxTurns: number;
  readonly maxNoProgressTurns?: number;
}

export class TaskStateMachine {
  private readonly maxTurns: number;
  private readonly maxNoProgressTurns: number;
  private readonly states: TaskTurnState[] = [];
  private lastProgress?: string;
  private noProgressTurns = 0;

  constructor(options: TaskStateMachineOptions) {
    if (!Number.isSafeInteger(options.maxTurns) || options.maxTurns <= 0) throw new Error('maxTurns 必须是正整数');
    this.maxTurns = options.maxTurns;
    this.maxNoProgressTurns = options.maxNoProgressTurns ?? 3;
    if (!Number.isSafeInteger(this.maxNoProgressTurns) || this.maxNoProgressTurns <= 0) throw new Error('maxNoProgressTurns 必须是正整数');
  }

  record(turn: number, progressKey: string, completed = false): TaskTurnState {
    if (!Number.isSafeInteger(turn) || turn <= 0) throw new Error('turn 必须是正整数');
    if (completed) {
      const state = { turn, progressKey, status: 'completed' as const };
      this.states.push(state); return state;
    }
    if (progressKey === this.lastProgress) this.noProgressTurns += 1;
    else { this.lastProgress = progressKey; this.noProgressTurns = 0; }
    const status: TaskRunStatus = turn >= this.maxTurns
      ? 'max_turns'
      : this.noProgressTurns >= this.maxNoProgressTurns ? 'stalled' : 'running';
    const state = { turn, progressKey, status };
    this.states.push(state); return state;
  }

  snapshot(): readonly TaskTurnState[] { return this.states.slice(); }
}
