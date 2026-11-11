import type { Message } from '../core/message.ts';
import type { ModelProvider, TokenUsage } from '../adapters/model/provider.ts';
import type { Logger } from '../observability/logger.ts';
import type { ToolRegistry } from '../tools/registry.ts';

export interface AgentLoopOptions {
  readonly provider: ModelProvider;
  readonly registry: ToolRegistry;
  readonly messages: readonly Message[];
  readonly maxTurns: number;
  readonly maxTokens: number;
  readonly workspaceRoot: string;
  readonly logger?: Logger;
}

export type StopReason = 'completed' | 'max_turns';

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
  const tools = options.registry.list();
  const usage = { inputTokens: 0, outputTokens: 0 };

  for (let turn = 1; turn <= options.maxTurns; turn += 1) {
    options.logger?.info('loop.turn.start', { turn, messageCount: messages.length });

    const result = await options.provider.chat({
      messages,
      maxTokens: options.maxTokens,
      tools,
    });

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

    if (toolCalls.length === 0) {
      options.logger?.info('loop.completed', { turn, usage });
      return { messages, text: result.text, turns: turn, stopReason: 'completed', usage };
    }

    // 串行执行：同一轮里的多个调用按模型给出的顺序来，并行是后面单独的一天
    for (const call of toolCalls) {
      options.logger?.info('tool.call', { turn, tool: call.name, args: call.arguments });
      const toolResult = await options.registry.execute(call, {
        workspaceRoot: options.workspaceRoot,
      });
      options.logger?.info('tool.result', {
        turn,
        tool: call.name,
        isError: toolResult.isError === true,
        chars: toolResult.content.length,
      });
      messages.push({
        role: 'tool',
        toolCallId: call.id,
        name: call.name,
        content: toolResult.content,
      });
    }
  }

  options.logger?.warn('loop.max_turns', { maxTurns: options.maxTurns, usage });
  return { messages, text: '', turns: options.maxTurns, stopReason: 'max_turns', usage };
}
