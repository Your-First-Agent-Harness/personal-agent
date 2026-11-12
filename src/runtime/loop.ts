import { buildContext } from '../context/build.ts';
import type { Message } from '../core/message.ts';
import type { AgentStopReason, EventSink } from '../core/event.ts';
import { ModelCancelledError } from '../adapters/model/provider.ts';
import type { ChatResult, ModelProvider, TokenUsage } from '../adapters/model/provider.ts';
import type { ToolRegistry } from '../tools/registry.ts';

export interface AgentLoopOptions {
  readonly provider: ModelProvider;
  readonly registry: ToolRegistry;
  readonly messages: readonly Message[];
  readonly maxTurns: number;
  readonly maxTokens: number;
  readonly maxContextChars?: number;
  readonly maxConsecutiveToolErrors?: number;
  readonly workspaceRoot: string;
  readonly eventSink?: EventSink;
  readonly signal?: AbortSignal;
  readonly streaming?: boolean;
}

export type StopReason = AgentStopReason;

export interface AgentLoopResult {
  /** 完整消息历史，包含每一轮 assistant 与 tool 消息，可直接落盘回放 */
  readonly messages: readonly Message[];
  readonly text: string;
  readonly turns: number;
  readonly stopReason: StopReason;
  readonly usage: TokenUsage;
}

/**
 * 整个 Harness 的心脏，只有一件事：
 * 模型说要用工具 → 执行 → 把结果喂回去 → 再问一次，直到模型不再要工具。
 *
 * 两条硬约束：
 * 1. 每一轮都必须有终止条件，maxTurns 是最后的保险丝
 * 2. 工具失败不中断循环，错误作为 tool 消息回喂，让模型自己决定怎么办
 */
export async function runAgentLoop(options: AgentLoopOptions): Promise<AgentLoopResult> {
  const messages: Message[] = [...options.messages];
  const usage = { inputTokens: 0, outputTokens: 0 };
  const maxConsecutiveToolErrors = options.maxConsecutiveToolErrors ?? 3;
  let consecutiveToolErrors = 0;
  const cancelled = (turn: number): AgentLoopResult => {
    options.eventSink?.emit({ type: 'run_cancelled', turn });
    return { messages, text: '', turns: turn, stopReason: 'cancelled', usage };
  };

  if (options.signal?.aborted) {
    return cancelled(0);
  }

  for (let turn = 1; turn <= options.maxTurns; turn += 1) {
    options.eventSink?.emit({ type: 'turn_started', turn, messageCount: messages.length });

    if (options.signal?.aborted) {
      return cancelled(turn);
    }

    // 每轮重新发现：同一请求内保留快照，跨轮替换、注册和注销立即生效。
    const tools = options.registry.list();
    const requestMessages = buildContext(messages, options.maxContextChars ?? 24_000);
    const request = {
      messages: requestMessages,
      maxTokens: options.maxTokens,
      tools,
      signal: options.signal,
    };
    let result: ChatResult;
    try {
      if (options.streaming === true && options.provider.streamChat !== undefined) {
        result = await options.provider.streamChat(request, (delta) => {
          options.eventSink?.emit({ type: 'assistant_delta', turn, delta });
        });
      } else {
        result = await options.provider.chat(request);
      }
    } catch (error) {
      if (error instanceof ModelCancelledError) {
        return cancelled(turn);
      }
      throw error;
    }

    if (result.usage !== undefined) {
      usage.inputTokens += result.usage.inputTokens;
      usage.outputTokens += result.usage.outputTokens;
    }

    const toolCalls = result.toolCalls ?? [];
    messages.push({
      role: 'assistant',
      content: result.text,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    });
    options.eventSink?.emit({
      type: 'assistant_responded',
      turn,
      textChars: result.text.length,
      toolCallCount: toolCalls.length,
    });

    if (toolCalls.length === 0) {
      options.eventSink?.emit({ type: 'run_completed', turn, stopReason: 'completed' });
      return { messages, text: result.text, turns: turn, stopReason: 'completed', usage };
    }

    // 串行执行：同一轮里的多个调用按模型给出的顺序来，并行是后面单独的一天
    for (const call of toolCalls) {
      if (options.signal?.aborted) {
        return cancelled(turn);
      }
      options.eventSink?.emit({
        type: 'tool_call_started',
        turn,
        toolCallId: call.id,
        toolName: call.name,
      });
      const toolResult = await options.registry.execute(call, {
        workspaceRoot: options.workspaceRoot,
        signal: options.signal,
      });
      options.eventSink?.emit({
        type: 'tool_call_finished',
        turn,
        toolCallId: call.id,
        toolName: call.name,
        isError: toolResult.isError === true,
        contentChars: toolResult.content.length,
      });
      messages.push({
        role: 'tool',
        toolCallId: call.id,
        name: call.name,
        content: toolResult.content,
      });
      if (options.signal?.aborted) {
        return cancelled(turn);
      }
      consecutiveToolErrors = toolResult.isError === true ? consecutiveToolErrors + 1 : 0;
      if (consecutiveToolErrors >= maxConsecutiveToolErrors) {
        options.eventSink?.emit({ type: 'run_completed', turn, stopReason: 'tool_errors' });
        return { messages, text: '', turns: turn, stopReason: 'tool_errors', usage };
      }
    }
  }

  options.eventSink?.emit({
    type: 'run_completed',
    turn: options.maxTurns,
    stopReason: 'max_turns',
  });
  return { messages, text: '', turns: options.maxTurns, stopReason: 'max_turns', usage };
}
