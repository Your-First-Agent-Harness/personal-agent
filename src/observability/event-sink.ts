import type { AgentEvent, EventSink } from '../core/event.ts';
import type { Logger } from './logger.ts';

export function createLoggerEventSink(logger: Logger): EventSink {
  return {
    emit(event: AgentEvent): void {
      switch (event.type) {
        case 'turn_started':
          logger.info('loop.turn.start', {
            turn: event.turn,
            messageCount: event.messageCount,
          });
          break;
        case 'assistant_responded':
          logger.debug('loop.assistant', {
            turn: event.turn,
            textChars: event.textChars,
            toolCallCount: event.toolCallCount,
          });
          break;
        case 'tool_call_started':
          logger.info('tool.call', {
            turn: event.turn,
            tool: event.toolName,
            toolCallId: event.toolCallId,
          });
          break;
        case 'tool_call_finished':
          logger.info('tool.result', {
            turn: event.turn,
            tool: event.toolName,
            toolCallId: event.toolCallId,
            isError: event.isError,
            chars: event.contentChars,
          });
          break;
        case 'run_cancelled':
          logger.info('loop.cancelled', { turn: event.turn });
          break;
        case 'run_completed':
          if (event.stopReason === 'max_turns') {
            logger.warn('loop.max_turns', { turn: event.turn });
          } else {
            logger.info('loop.completed', { turn: event.turn });
          }
          break;
      }
    },
  };
}
