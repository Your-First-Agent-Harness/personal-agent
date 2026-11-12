import type { Message, ToolCall } from '../../core/message.ts';
import { ModelCancelledError } from './provider.ts';
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
      if (request.signal?.aborted) {
        throw new ModelCancelledError();
      }

      const signals = [AbortSignal.timeout(timeoutMs)];
      if (request.signal !== undefined) {
        signals.push(request.signal);
      }

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
            messages: request.messages.map(toWireMessage),
            max_tokens: request.maxTokens,
            ...(request.tools !== undefined && request.tools.length > 0
              ? {
                  tools: request.tools.map((tool) => ({
                    type: 'function',
                    function: {
                      name: tool.name,
                      description: tool.description,
                      parameters: tool.parameters,
                    },
                  })),
                }
              : {}),
          }),
          signal: AbortSignal.any(signals),
        });
      } catch (error) {
        if (request.signal?.aborted) {
          throw new ModelCancelledError();
        }
        throw new ModelError(`请求模型失败：${describeError(error)}`, { cause: error });
      }

      const raw = await response.text();
      if (!response.ok) {
        throw new ModelError(`模型返回 HTTP ${response.status}：${truncate(raw)}`, {
          status: response.status,
        });
      }

      const payload = parseJson(raw);
      const { text, toolCalls } = readAssistantMessage(payload);
      const model = readString(payload, 'model') ?? options.model;
      const usage = readUsage(payload);

      return {
        text,
        model,
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
        ...(usage === undefined ? {} : { usage }),
      };
    },

    async streamChat(
      request: ChatRequest,
      onDelta: (delta: string) => void,
    ): Promise<ChatResult> {
      if (request.signal?.aborted) {
        throw new ModelCancelledError();
      }
      const signals = [AbortSignal.timeout(timeoutMs)];
      if (request.signal !== undefined) {
        signals.push(request.signal);
      }

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
            messages: request.messages.map(toWireMessage),
            max_tokens: request.maxTokens,
            stream: true,
            stream_options: { include_usage: true },
            ...(request.tools !== undefined && request.tools.length > 0
              ? {
                  tools: request.tools.map((tool) => ({
                    type: 'function',
                    function: {
                      name: tool.name,
                      description: tool.description,
                      parameters: tool.parameters,
                    },
                  })),
                }
              : {}),
          }),
          signal: AbortSignal.any(signals),
        });
      } catch (error) {
        if (request.signal?.aborted) {
          throw new ModelCancelledError();
        }
        throw new ModelError(`请求模型失败：${describeError(error)}`, { cause: error });
      }
      if (!response.ok) {
        throw new ModelError(`模型返回 HTTP ${response.status}：${truncate(await response.text())}`, {
          status: response.status,
        });
      }
      if (response.headers.get('content-type')?.includes('text/event-stream') !== true) {
        const payload = parseJson(await response.text());
        const { text, toolCalls } = readAssistantMessage(payload);
        const usage = readUsage(payload);
        return {
          text,
          model: readString(payload, 'model') ?? options.model,
          ...(toolCalls.length > 0 ? { toolCalls } : {}),
          ...(usage === undefined ? {} : { usage }),
        };
      }
      if (response.body === null) {
        throw new ModelError('模型流式响应缺少 body');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let text = '';
      let model = options.model;
      let usage: TokenUsage | undefined;
      const toolCallParts = new Map<number, { id: string; name: string; arguments: string }>();
      const consumeEvent = (event: string): void => {
        const data = event
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        if (data === '' || data === '[DONE]') {
          return;
        }
        const payload = parseJson(data);
        model = readString(payload, 'model') ?? model;
        usage = readUsage(payload) ?? usage;
        const choices = readField(payload, 'choices');
        if (!Array.isArray(choices) || (choices.length === 0 && usage === undefined)) {
          throw new ModelError('模型响应缺少 choices');
        }
        if (choices.length === 0) {
          return;
        }
        const delta = readField(choices[0], 'delta');
        const content = readOptionalField(delta, 'content');
        if (content !== null && typeof content !== 'string') {
          throw new ModelError('模型响应 content 不是字符串');
        }
        if (typeof content === 'string' && content !== '') {
          text += content;
          onDelta(content);
        }

        const rawToolCalls = readOptionalField(delta, 'tool_calls');
        if (rawToolCalls !== null && !Array.isArray(rawToolCalls)) {
          throw new ModelError('模型响应 tool_calls 不是数组');
        }
        for (const entry of rawToolCalls ?? []) {
          const index = readField(entry, 'index');
          if (typeof index !== 'number' || !Number.isInteger(index)) {
            throw new ModelError('流式工具调用缺少合法 index');
          }
          const parts = toolCallParts.get(index) ?? { id: '', name: '', arguments: '' };
          const id = readOptionalField(entry, 'id');
          if (id !== null) {
            if (typeof id !== 'string') {
              throw new ModelError('流式工具调用 id 不是字符串');
            }
            parts.id = id;
          }
          const fn = readOptionalField(entry, 'function');
          if (fn !== null) {
            const name = readOptionalField(fn, 'name');
            const args = readOptionalField(fn, 'arguments');
            if (name !== null) {
              if (typeof name !== 'string') {
                throw new ModelError('流式工具调用 name 不是字符串');
              }
              parts.name = name;
            }
            if (args !== null) {
              if (typeof args !== 'string') {
                throw new ModelError('流式工具调用 arguments 不是字符串');
              }
              parts.arguments += args;
            }
          }
          toolCallParts.set(index, parts);
        }
      };

      try {
        while (true) {
          const { done, value } = (await reader.read()) as {
            done: boolean;
            value?: Uint8Array;
          };
          if (done) {
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          let boundary = /\r?\n\r?\n/.exec(buffer);
          while (boundary !== null) {
            const event = buffer.slice(0, boundary.index);
            buffer = buffer.slice(boundary.index + boundary[0].length);
            consumeEvent(event);
            boundary = /\r?\n\r?\n/.exec(buffer);
          }
        }
        buffer += decoder.decode();
        if (buffer.trim() !== '') {
          consumeEvent(buffer);
        }
      } catch (error) {
        if (request.signal?.aborted) {
          throw new ModelCancelledError();
        }
        if (error instanceof ModelError) {
          throw error;
        }
        throw new ModelError(`读取模型流失败：${describeError(error)}`, { cause: error });
      }

      const toolCalls: ToolCall[] = [...toolCallParts.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, parts]) => {
          if (parts.id === '' || parts.name === '') {
            throw new ModelError('流式工具调用缺少 id 或 name');
          }
          return { id: parts.id, name: parts.name, arguments: parts.arguments };
        });
      return {
        text,
        model,
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
        ...(usage === undefined ? {} : { usage }),
      };
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

/** 领域消息 → OpenAI 线格式。字段名差异只许出现在这一处 */
function toWireMessage(message: Message): Record<string, unknown> {
  const wire: Record<string, unknown> = {
    role: message.role,
    content: message.content,
  };
  if (message.toolCalls !== undefined && message.toolCalls.length > 0) {
    wire['tool_calls'] = message.toolCalls.map((call) => ({
      id: call.id,
      type: 'function',
      function: { name: call.name, arguments: call.arguments },
    }));
  }
  if (message.role === 'tool') {
    wire['tool_call_id'] = message.toolCallId;
    wire['name'] = message.name;
  }
  return wire;
}

/** 按协议形状取 choices[0].message，缺任何一层都显式失败 */
function readAssistantMessage(payload: unknown): { text: string; toolCalls: ToolCall[] } {
  const choices = readField(payload, 'choices');
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new ModelError('模型响应缺少 choices');
  }
  const message = readField(choices[0], 'message');
  const content = readOptionalField(message, 'content');
  const toolCalls = readToolCalls(message);

  // 纯工具调用时 content 常为 null，这不是错误
  if (content !== null && typeof content !== 'string') {
    throw new ModelError('模型响应 content 不是字符串');
  }
  if (content === null && toolCalls.length === 0) {
    throw new ModelError('模型响应既没有 content 也没有 tool_calls');
  }
  return { text: typeof content === 'string' ? content : '', toolCalls };
}

function readToolCalls(message: unknown): ToolCall[] {
  const raw = readOptionalField(message, 'tool_calls');
  if (raw === null) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new ModelError('模型响应 tool_calls 不是数组');
  }
  return raw.map((entry) => {
    const id = readField(entry, 'id');
    const fn = readField(entry, 'function');
    const name = readField(fn, 'name');
    const args = readOptionalField(fn, 'arguments');
    if (typeof id !== 'string' || typeof name !== 'string') {
      throw new ModelError('工具调用缺少 id 或 name');
    }
    // 少数网关会把 arguments 直接给成对象，这里统一归一成字符串
    return {
      id,
      name,
      arguments: typeof args === 'string' ? args : JSON.stringify(args ?? {}),
    };
  });
}

function readOptionalField(source: unknown, key: string): unknown {
  if (source === null || typeof source !== 'object') {
    throw new ModelError(`模型响应结构不合法，无法读取 ${key}`);
  }
  return (source as Record<string, unknown>)[key] ?? null;
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
