import { describe, expect, it } from 'vitest';

import { createOpenAICompatibleProvider, ModelError } from '../src/adapters/model/openai-compatible.ts';
import type { ChatRequest } from '../src/adapters/model/provider.ts';

const request: ChatRequest = {
  messages: [{ role: 'user', content: '你好' }],
  maxTokens: 64,
};

function sseResponse(chunks: readonly string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
}

function sseBytesResponse(chunks: readonly Uint8Array[]): Response {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  }), { headers: { 'content-type': 'text/event-stream' } });
}

describe('OpenAI-compatible 流式响应', () => {
  it('开启 stream，按顺序交付文本增量并聚合最终结果', async () => {
    let requestBody: Record<string, unknown> | undefined;
    const provider = createOpenAICompatibleProvider({
      baseUrl: 'https://example.com/v1',
      apiKey: 'test-key',
      model: 'test-model',
      fetchImpl: (_input, init) => {
        requestBody = JSON.parse(init?.body as string) as Record<string, unknown>;
        return Promise.resolve(
          sseResponse([
            'data: {"model":"stream-model","choices":[{"delta":{"content":"你好"}}]}\n\n',
            'data: {"model":"stream-model","choices":[{"delta":{"content":"，世界"}}]}\n\n',
            'data: [DONE]\n\n',
          ]),
        );
      },
    });
    const deltas: string[] = [];

    const result = await provider.streamChat!(request, (delta) => deltas.push(delta));

    expect(requestBody).toMatchObject({ stream: true });
    expect(deltas).toEqual(['你好', '，世界']);
    expect(result).toEqual({ text: '你好，世界', model: 'stream-model' });
  });

  it('跨任意字节边界解析 CRLF、注释、多行 data 与末尾 DONE', async () => {
    const raw = [
      ': keep-alive\r\n',
      'data: {"model":"stream-model",\r\n',
      'data: "choices":[{"delta":{"content":"你好"}}]}\r\n\r\n',
      'data: {"choices":[{"delta":{"content":"，世界"}}]}\r\n\r\n',
      'data: [DONE]',
    ].join('');
    const bytes = new TextEncoder().encode(raw);
    const sizes = [1, 2, 5, 3, 8];
    const chunks: Uint8Array[] = [];
    for (let offset = 0, index = 0; offset < bytes.length; index += 1) {
      const end = Math.min(offset + (sizes[index % sizes.length] ?? 1), bytes.length);
      chunks.push(bytes.slice(offset, end));
      offset = end;
    }
    const provider = createOpenAICompatibleProvider({
      baseUrl: 'https://example.com/v1',
      apiKey: 'test-key',
      model: 'test-model',
      fetchImpl: () => Promise.resolve(sseBytesResponse(chunks)),
    });
    const deltas: string[] = [];

    const result = await provider.streamChat!(request, (delta) => deltas.push(delta));

    expect(deltas).toEqual(['你好', '，世界']);
    expect(result).toEqual({ text: '你好，世界', model: 'stream-model' });
  });

  it('按 index 聚合交错的工具调用参数片段', async () => {
    const events = [
      { index: 0, id: 'call_weather', type: 'function', function: { name: 'weather', arguments: '{"city":' } },
      { index: 1, id: 'call_time', type: 'function', function: { name: 'time', arguments: '{"zone":' } },
      { index: 0, function: { arguments: '"杭州"}' } },
      { index: 1, function: { arguments: '"UTC"}' } },
    ];
    const provider = createOpenAICompatibleProvider({
      baseUrl: 'https://example.com/v1',
      apiKey: 'test-key',
      model: 'test-model',
      fetchImpl: () => Promise.resolve(sseResponse([
        ...events.map((toolCall) => `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [toolCall] } }] })}\n\n`),
        'data: [DONE]\n\n',
      ])),
    });

    const result = await provider.streamChat!(request, () => undefined);

    expect(result).toEqual({
      text: '',
      model: 'test-model',
      toolCalls: [
        { id: 'call_weather', name: 'weather', arguments: '{"city":"杭州"}' },
        { id: 'call_time', name: 'time', arguments: '{"zone":"UTC"}' },
      ],
    });
  });

  it('请求末尾 usage，并接受 choices 为空的用量事件', async () => {
    let requestBody: Record<string, unknown> | undefined;
    const provider = createOpenAICompatibleProvider({
      baseUrl: 'https://example.com/v1',
      apiKey: 'test-key',
      model: 'test-model',
      fetchImpl: (_input, init) => {
        requestBody = JSON.parse(init?.body as string) as Record<string, unknown>;
        return Promise.resolve(sseResponse([
          'data: {"choices":[{"delta":{"content":"done"}}]}\n\n',
          'data: {"model":"stream-model","choices":[],"usage":{"prompt_tokens":7,"completion_tokens":11}}\n\n',
          'data: [DONE]\n\n',
        ]));
      },
    });

    const result = await provider.streamChat!(request, () => undefined);

    expect(requestBody).toMatchObject({ stream: true, stream_options: { include_usage: true } });
    expect(result).toEqual({
      text: 'done',
      model: 'stream-model',
      usage: { inputTokens: 7, outputTokens: 11 },
    });
  });

  it('流式请求同样下发工具定义', async () => {
    let requestBody: Record<string, unknown> | undefined;
    const provider = createOpenAICompatibleProvider({
      baseUrl: 'https://example.com/v1',
      apiKey: 'test-key',
      model: 'test-model',
      fetchImpl: (_input, init) => {
        requestBody = JSON.parse(init?.body as string) as Record<string, unknown>;
        return Promise.resolve(sseResponse(['data: [DONE]\n\n']));
      },
    });
    const tools = [{
      name: 'read_file',
      description: '读文件',
      parameters: { type: 'object', properties: {} },
    }];

    await provider.streamChat!({ ...request, tools }, () => undefined);

    expect(requestBody?.['tools']).toEqual([{
      type: 'function',
      function: {
        name: 'read_file',
        description: '读文件',
        parameters: { type: 'object', properties: {} },
      },
    }]);
  });

  it('流式网络错误与 HTTP 错误都收敛为 ModelError', async () => {
    const network = createOpenAICompatibleProvider({
      baseUrl: 'https://example.com/v1',
      apiKey: 'test-key',
      model: 'test-model',
      fetchImpl: () => Promise.reject(new Error('connection reset')),
    });
    const http = createOpenAICompatibleProvider({
      baseUrl: 'https://example.com/v1',
      apiKey: 'test-key',
      model: 'test-model',
      fetchImpl: () => Promise.resolve(new Response('rate limited', { status: 429 })),
    });

    await expect(network.streamChat!(request, () => undefined)).rejects.toBeInstanceOf(ModelError);
    await expect(http.streamChat!(request, () => undefined)).rejects.toMatchObject({
      name: 'ModelError',
      status: 429,
    });
  });

  it('流式请求发出前已外部取消时不发请求', async () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    const provider = createOpenAICompatibleProvider({
      baseUrl: 'https://example.com/v1',
      apiKey: 'test-key',
      model: 'test-model',
      fetchImpl: () => {
        calls += 1;
        return Promise.resolve(sseResponse(['data: [DONE]\n\n']));
      },
    });

    await expect(provider.streamChat!(
      { ...request, signal: controller.signal },
      () => undefined,
    )).rejects.toMatchObject({ name: 'ModelCancelledError' });
    expect(calls).toBe(0);
  });

  it('读取响应体期间外部取消抛 ModelCancelledError', async () => {
    const controller = new AbortController();
    let observedSignal: AbortSignal | null | undefined;
    const provider = createOpenAICompatibleProvider({
      baseUrl: 'https://example.com/v1',
      apiKey: 'test-key',
      model: 'test-model',
      fetchImpl: (_input, init) => {
        observedSignal = init?.signal;
        const body = new ReadableStream<Uint8Array>({
          start(bodyController) {
            bodyController.enqueue(new TextEncoder().encode(
              'data: {"choices":[{"delta":{"content":"first"}}]}\n\n',
            ));
            controller.signal.addEventListener('abort', () => {
              bodyController.error(controller.signal.reason);
            }, { once: true });
          },
        });
        return Promise.resolve(new Response(body, { headers: { 'content-type': 'text/event-stream' } }));
      },
    });
    let markDelta!: () => void;
    const firstDelta = new Promise<void>((resolve) => {
      markDelta = resolve;
    });

    const pending = provider.streamChat!(
      { ...request, signal: controller.signal },
      () => markDelta(),
    );
    const rejection = expect(pending).rejects.toMatchObject({ name: 'ModelCancelledError' });
    await firstDelta;
    controller.abort();
    await rejection;
    expect(observedSignal).toBeInstanceOf(AbortSignal);
  });

  it('读取响应体期间内部超时抛带原因的 ModelError', async () => {
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
    const provider = createOpenAICompatibleProvider({
      baseUrl: 'https://example.com/v1',
      apiKey: 'test-key',
      model: 'test-model',
      timeoutMs: 5,
      fetchImpl: (_input, init) => {
        const body = new ReadableStream<Uint8Array>({
          start(bodyController) {
            bodyController.enqueue(new TextEncoder().encode(
              'data: {"choices":[{"delta":{"content":"first"}}]}\n\n',
            ));
            const abort = () => bodyController.error(init?.signal?.reason);
            if (init?.signal?.aborted) {
              abort();
            } else {
              init?.signal?.addEventListener('abort', abort, { once: true });
            }
            fallbackTimer = setTimeout(() => bodyController.error(new Error('test timeout fallback')), 30);
          },
        });
        return Promise.resolve(new Response(body, { headers: { 'content-type': 'text/event-stream' } }));
      },
    });

    try {
      await provider.streamChat!(request, () => undefined);
      throw new Error('预期内部超时');
    } catch (error) {
      expect(error).toBeInstanceOf(ModelError);
      expect((error as ModelError).cause).toBeDefined();
    } finally {
      clearTimeout(fallbackTimer);
    }
  });
});
