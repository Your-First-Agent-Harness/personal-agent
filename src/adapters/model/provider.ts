import type { Message } from '../../core/message.ts';

export interface ChatRequest {
  readonly messages: readonly Message[];
  readonly maxTokens: number;
}

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface ChatResult {
  readonly text: string;
  readonly model: string;
  readonly usage?: TokenUsage;
}

/**
 * 能力层的模型契约：上层只认这个接口，换厂商、换 SDK 都不影响 runtime。
 */
export interface ModelProvider {
  readonly name: string;
  chat(request: ChatRequest): Promise<ChatResult>;
}
