import type { ChatRequest, ChatResult, ModelProvider, TokenUsage } from './provider.ts';

export interface OpenAICompatibleOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

/** 模型调用失败的唯一出口，调用方按 status 决定是否重试 */
export class ModelError extends Error {
  readonly status?: number;

  constructor(message: string, options: { status?: number; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = 'ModelError';
    this.status = options.status;
  }
}

const DEFAULT_TIMEOUT_MS = 60_000;

export function createOpenAICompatibleProvider(options: OpenAICompatibleOptions): ModelProvider {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    name: options.model,

    async chat(request: ChatRequest): Promise<ChatResult> {
      let response: Response;
      try {
        response = await fetchImpl(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${options.apiKey}`,
          },
          body: JSON.stringify({
            model: options.model,
            messages: request.messages,
            max_tokens: request.maxTokens,
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        throw new ModelError(`请求模型失败：${describeError(error)}`, { cause: error });
      }

      const raw = await response.text();
      if (!response.ok) {
        throw new ModelError(`模型返回 HTTP ${response.status}：${truncate(raw)}`, {
          status: response.status,
        });
      }

      const payload = parseJson(raw);
      const text = readText(payload);
      const model = readString(payload, 'model') ?? options.model;
      const usage = readUsage(payload);

      return usage === undefined ? { text, model } : { text, model, usage };
    },
  };
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw new ModelError(`模型响应不是合法 JSON：${truncate(raw)}`, { cause: error });
  }
}

/** 按协议形状取 choices[0].message.content，缺任何一层都显式失败 */
function readText(payload: unknown): string {
  const choices = readField(payload, 'choices');
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new ModelError('模型响应缺少 choices');
  }
  const message = readField(choices[0], 'message');
  const content = readField(message, 'content');
  if (typeof content !== 'string') {
    throw new ModelError('模型响应 content 不是字符串');
  }
  return content;
}

function readField(source: unknown, key: string): unknown {
  if (source === null || typeof source !== 'object') {
    throw new ModelError(`模型响应结构不合法，无法读取 ${key}`);
  }
  const value = (source as Record<string, unknown>)[key];
  if (value === undefined || value === null) {
    throw new ModelError(`模型响应缺少 ${key}`);
  }
  return value;
}

function readString(payload: unknown, key: string): string | undefined {
  if (payload === null || typeof payload !== 'object') {
    return undefined;
  }
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

function readUsage(payload: unknown): TokenUsage | undefined {
  if (payload === null || typeof payload !== 'object') {
    return undefined;
  }
  const usage = (payload as Record<string, unknown>)['usage'];
  if (usage === null || typeof usage !== 'object') {
    return undefined;
  }
  const record = usage as Record<string, unknown>;
  const inputTokens = record['prompt_tokens'];
  const outputTokens = record['completion_tokens'];
  if (typeof inputTokens !== 'number' || typeof outputTokens !== 'number') {
    return undefined;
  }
  return { inputTokens, outputTokens };
}

function truncate(text: string, max = 300): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
