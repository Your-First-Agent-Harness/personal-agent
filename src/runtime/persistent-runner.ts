import { RunStoreError, type RunRecord, type RunStore } from '../memory/run-store.ts';
import { Session } from '../memory/session.ts';
import type { SessionStore } from '../memory/session-store.ts';
import { runAgentLoop } from './loop.ts';
import type { AgentLoopOptions, AgentLoopResult } from './loop.ts';

export interface PersistentAgentServiceOptions {
  readonly sessionStore: SessionStore;
  readonly runStore: RunStore;
}

export interface PersistentAgentRunOptions extends Omit<AgentLoopOptions, 'messages'> {
  readonly runId?: string;
  readonly sessionId: string;
  readonly userMessage: string;
}

export interface PersistentAgentRunResult extends AgentLoopResult {
  readonly run: RunRecord;
  readonly session: Session;
}

export interface RecoveredSession {
  readonly session: Session;
  readonly interruptedRuns: RunRecord[];
}

export class PersistentAgentService {
  private readonly sessionStore: SessionStore;
  private readonly runStore: RunStore;

  constructor(options: PersistentAgentServiceOptions) {
    this.sessionStore = options.sessionStore;
    this.runStore = options.runStore;
    this.runStore.interruptRunning();
  }

  async run(options: PersistentAgentRunOptions): Promise<PersistentAgentRunResult> {
    const existing = options.runId === undefined ? undefined : this.runStore.get(options.runId);
    if (existing !== undefined) {
      if (existing.sessionId !== options.sessionId || existing.userMessage !== options.userMessage) {
        throw new RunStoreError(`Run "${existing.id}" 与请求输入冲突`);
      }
      if (existing.status === 'interrupted') {
        throw new RunStoreError(`Run "${existing.id}" 已中断；请核对副作用后用新 runId 显式重试`);
      }
      if (existing.status !== 'completed') {
        throw new RunStoreError(`Run "${existing.id}" 状态为 ${existing.status}，不能重复执行`);
      }
      if (existing.result === undefined) {
        throw new RunStoreError(`Run "${existing.id}" 缺少完成结果，不能安全重放`);
      }
      const completedSession = this.sessionStore.load(existing.sessionId);
      if (completedSession === undefined) {
        throw new RunStoreError(`Run "${existing.id}" 的 Session 不存在`);
      }
      return { ...existing.result, run: existing, session: completedSession };
    }

    const session = this.sessionStore.load(options.sessionId) ?? new Session(options.sessionId);
    session.append([{ role: 'user', content: options.userMessage }]);
    this.sessionStore.save(session);
    const running = this.runStore.start({
      id: options.runId,
      sessionId: options.sessionId,
      userMessage: options.userMessage,
    });
    const persistedMessageCount = session.snapshot().length;

    let result: AgentLoopResult;
    try {
      result = await runAgentLoop({ ...options, messages: session.snapshot() });
    } catch (error) {
      this.runStore.fail(running.id);
      throw error;
    }

    session.append(result.messages.slice(persistedMessageCount));
    this.sessionStore.save(session);
    const run = this.runStore.finish(running.id, result.stopReason, result);
    return { ...result, run, session };
  }

  recover(sessionId: string): RecoveredSession | undefined {
    const session = this.sessionStore.load(sessionId);
    if (session === undefined) {
      return undefined;
    }
    return {
      session,
      interruptedRuns: this.runStore.list(sessionId).filter((run) => run.status === 'interrupted'),
    };
  }
}
