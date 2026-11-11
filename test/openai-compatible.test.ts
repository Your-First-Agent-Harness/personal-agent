import { describe, expect, it } from 'vitest';

import {
  createOpenAICompatibleProvider,
  ModelError,
} from '../src/adapters/model/openai-compatible.ts';
import type { ModelProvider } from '../src/adapters/model/provider.ts';

interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

type FetchInput = Parameters<typeof fetch>[0];

function urlOf(input: FetchInput): string {
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

function fakeFetch(response: Response, calls: Call[] = []): typeof fetch {
  return (input, init) => {
    calls.push({ url: urlOf(input), init: init ?? {} });
    return Promise.resolve(response);
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function providerWith(response: Response, calls: Call[] = []): ModelProvider {
  return createOpenAICompatibleProvider({
    baseUrl: 'https://example.com/v1/',
    apiKey: 'test-key',
    model: 'test-model',
    fetchImpl: fakeFetch(response, calls),
  });
}

const request = {
  messages: [{ role: 'user' as const, content: '你好' }],
  maxTokens: 64,
};

describe('createOpenAICompatibleProvider', () => {
  it('按协议组装请求，并解析文本、模型与用量', async () => {
    const calls: Call[] = [];
    const provider = providerWith(
      jsonResponse({
        model: 'test-model',
        choices: [{ message: { content: '你好，我是模型' } }],
        usage: { prompt_tokens: 3, completion_tokens: 5 },
      }),
      calls,
    );

    const result = await provider.chat(request);

    expect(result).toEqual({
      text: '你好，我是模型',
      model: 'test-model',
      usage: { inputTokens: 3, outputTokens: 5 },
    });

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.url).toBe('https://example.com/v1/chat/completions');
    expect(call?.init.method).toBe('POST');

    const headers = new Headers(call?.init.headers);
    expect(headers.get('authorization')).toBe('Bearer test-key');
    expect(headers.get('content-type')).toBe('application/json');

    const body = call?.init.body;
    expect(typeof body).toBe('string');
    expect(JSON.parse(body as string) as unknown).toEqual({
      model: 'test-model',
      messages: [{ role: 'user', content: '你好' }],
      max_tokens: 64,
    });
  });

  it('响应没有 usage 时不编造数据', async () => {
    const provider = providerWith(
      jsonResponse({ choices: [{ message: { content: 'ok' } }] }),
    );

    const result = await provider.chat(request);

    expect(result.usage).toBeUndefined();
    expect(result.model).toBe('test-model');
  });

  it('HTTP 错误转成带状态码的 ModelError', async () => {
    const provider = providerWith(new Response('rate limited', { status: 429 }));

    await expect(provider.chat(request)).rejects.toMatchObject({
      name: 'ModelError',
      status: 429,
    });
  });

  it('响应不是合法 JSON 时报错', async () => {
    const provider = providerWith(new Response('{ not json', { status: 200 }));

    await expect(provider.chat(request)).rejects.toBeInstanceOf(ModelError);
  });

  it('choices 为空或 content 非字符串时报错', async () => {
    const empty = providerWith(jsonResponse({ choices: [] }));
    const notString = providerWith(
      jsonResponse({ choices: [{ message: { content: null } }] }),
    );

    await expect(empty.chat(request)).rejects.toThrow('choices');
    await expect(notString.chat(request)).rejects.toThrow('content');
  });

  it('网络异常也收敛成 ModelError', async () => {
    const provider = createOpenAICompatibleProvider({
      baseUrl: 'https://example.com/v1',
      apiKey: 'test-key',
      model: 'test-model',
      fetchImpl: () => Promise.reject(new Error('ECONNREFUSED')),
    });

    await expect(provider.chat(request)).rejects.toThrow('ECONNREFUSED');
  });

  it('下发 tools，并把 content 为 null 的工具调用解析出来', async () => {
    const calls: Call[] = [];
    const provider = providerWith(
      jsonResponse({
        model: 'test-model',
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'read_file', arguments: '{"path":"README.md"}' },
                },
              ],
            },
          },
        ],
      }),
      calls,
    );

    const result = await provider.chat({
      ...request,
      tools: [
        {
          name: 'read_file',
          description: '读文件',
          parameters: { type: 'object', properties: {} },
        },
      ],
    });

    expect(result.text).toBe('');
    expect(result.toolCalls).toEqual([
      { id: 'call_1', name: 'read_file', arguments: '{"path":"README.md"}' },
    ]);

    const body = JSON.parse(calls[0]?.init.body as string) as Record<string, unknown>;
    expect(body['tools']).toEqual([
      {
        type: 'function',
        function: {
          name: 'read_file',
          description: '读文件',
          parameters: { type: 'object', properties: {} },
        },
      },
    ]);
  });

  it('assistant 的 tool_calls 与 tool 消息按线格式回传', async () => {
    const calls: Call[] = [];
    const provider = providerWith(jsonResponse({ choices: [{ message: { content: 'done' } }] }), calls);

    await provider.chat({
      messages: [
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'call_1', name: 'read_file', arguments: '{}' }],
        },
        { role: 'tool', toolCallId: 'call_1', name: 'read_file', content: '文件内容' },
      ],
      maxTokens: 64,
    });

    const body = JSON.parse(calls[0]?.init.body as string) as Record<string, unknown>;
    expect(body['messages']).toEqual([
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{}' } },
        ],
      },
      { role: 'tool', content: '文件内容', tool_call_id: 'call_1', name: 'read_file' },
    ]);
  });

  function pendingFetch(onRequest: () => void): typeof fetch {
    return (_input, init) => {
      onRequest();
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        const rejection = () => {
          const reason: unknown = signal?.reason;
          return reason instanceof Error ? reason : new Error(String(reason));
        };
        if (signal?.aborted) {
          reject(rejection());
          return;
        }
        signal?.addEventListener('abort', () => reject(rejection()), { once: true });
      });
    };
  }

  it('fetch 前已外部取消时不发请求，并抛 ModelCancelledError', async () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    const provider = createOpenAICompatibleProvider({
      baseUrl: 'https://example.com/v1',
      apiKey: 'test-key',
      model: 'test-model',
      fetchImpl: pendingFetch(() => {
        calls += 1;
      }),
    });

    await expect(
      provider.chat({ ...request, signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'ModelCancelledError' });
    expect(calls).toBe(0);
  });

  it('fetch 等待期间外部取消时抛 ModelCancelledError', async () => {
    const controller = new AbortController();
    let markFetchStarted!: () => void;
    const fetchStarted = new Promise<void>((resolve) => {
      markFetchStarted = resolve;
    });
    const provider = createOpenAICompatibleProvider({
      baseUrl: 'https://example.com/v1',
      apiKey: 'test-key',
      model: 'test-model',
      fetchImpl: pendingFetch(markFetchStarted),
    });

    const pending = provider.chat({ ...request, signal: controller.signal });
    const rejection = expect(pending).rejects.toMatchObject({ name: 'ModelCancelledError' });
    await fetchStarted;
    controller.abort();
    await rejection;
  });

  it('内部 AbortSignal.timeout 仍转成带原因的 ModelError', async () => {
    const provider = createOpenAICompatibleProvider({
      baseUrl: 'https://example.com/v1',
      apiKey: 'test-key',
      model: 'test-model',
      timeoutMs: 5,
      fetchImpl: pendingFetch(() => undefined),
    });

    try {
      await provider.chat(request);
      throw new Error('预期内部超时');
    } catch (error) {
      expect(error).toBeInstanceOf(ModelError);
      expect(error).toMatchObject({ name: 'ModelError' });
      expect((error as ModelError).cause).toBeDefined();
    }
  });
});
