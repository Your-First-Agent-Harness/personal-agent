export type AgentStopReason = 'completed' | 'max_turns' | 'cancelled' | 'tool_errors';

export type AgentEvent =
  | { readonly type: 'turn_started'; readonly turn: number; readonly messageCount: number }
  | {
      readonly type: 'assistant_responded';
      readonly turn: number;
      readonly textChars: number;
      readonly toolCallCount: number;
    }
  | {
      readonly type: 'tool_call_started';
      readonly turn: number;
      readonly toolCallId: string;
      readonly toolName: string;
    }
  | {
      readonly type: 'tool_call_finished';
      readonly turn: number;
      readonly toolCallId: string;
      readonly toolName: string;
      readonly isError: boolean;
      readonly contentChars: number;
    }
  | { readonly type: 'run_completed'; readonly turn: number; readonly stopReason: AgentStopReason }
  | { readonly type: 'run_cancelled'; readonly turn: number };

export interface EventSink {
  emit(event: AgentEvent): void;
}
