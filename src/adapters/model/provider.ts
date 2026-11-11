import type { Message, ToolCall } from '../../core/message.ts';
import type { ToolSchema } from '../../core/tool.ts';

export interface ChatRequest {
  readonly messages: readonly Message[];
  readonly maxTokens: number;
  /** 空数组与不传等价：都不下发 tools 字段 */
  readonly tools?: readonly ToolSchema[];
}

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface ChatResult {
  /** 纯工具调用轮次里 content 可能为空串，这是合法的 */
  readonly text: string;
  readonly model: string;
  readonly toolCalls?: readonly ToolCall[];
  readonly usage?: TokenUsage;
}

/**
 * 能力层的模型契约：上层只认这个接口，换厂商、换 SDK 都不影响 runtime。
 */
export interface ModelProvider {
  readonly name: string;
  chat(request: ChatRequest): Promise<ChatResult>;
}
