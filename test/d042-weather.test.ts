import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ToolErrorCode } from '../src/core/tool.ts';
import { ToolRegistry } from '../src/tools/registry.ts';
import {
  createWeatherCurrentTool,
  type WeatherCurrentToolOptions,
} from '../src/tools/weather.ts';

const successPayload = {
  latitude: 31.2304,
  longitude: 121.4737,
  timezone: 'Asia/Shanghai',
  current_units: {
    time: 'iso8601',
    interval: 'seconds',
    temperature_2m: '°C',
    wind_speed_10m: 'km/h',
    weather_code: 'wmo code',
  },
  current: {
    time: '2026-12-22T20:15',
    interval: 900,
    temperature_2m: 18.6,
    wind_speed_10m: 12.4,
    weather_code: 2,
  },
};

interface CapturedCall {
  readonly url: string;
  readonly init: RequestInit;
}

function urlOf(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...init.headers,
    },
  });
}

function registryWith(
  fetchImpl: typeof fetch,
  options: Omit<WeatherCurrentToolOptions, 'fetchImpl'> = {},
): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(createWeatherCurrentTool({ fetchImpl, ...options }));
  return registry;
}

function execute(
  registry: ToolRegistry,
  args: unknown,
  signal?: AbortSignal,
) {
  return registry.execute({
    id: 'call-weather',
    name: 'weather_current',
    arguments: JSON.stringify(args),
  }, { workspaceRoot: '.', signal });
}

function pendingFetch(onSignal?: (signal: AbortSignal | null) => void): typeof fetch {
  return (_input, init) => {
    const signal = init?.signal ?? null;
    onSignal?.(signal);
    return new Promise<Response>((_resolve, reject) => {
      const rejectForAbort = () => {
        const reason: unknown = signal?.reason;
        reject(reason instanceof Error ? reason : new Error('request aborted'));
      };
      if (signal?.aborted) {
        rejectForAbort();
      } else {
        signal?.addEventListener('abort', rejectForAbort, { once: true });
      }
    });
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('weather_current 成功请求', () => {
  it('使用固定 Open-Meteo URL、URLSearchParams、显式单位并返回结构化天气', async () => {
    const calls: CapturedCall[] = [];
    const fetchImpl: typeof fetch = (input, init) => {
      calls.push({ url: urlOf(input), init: init ?? {} });
      return Promise.resolve(jsonResponse(successPayload));
    };
    const registry = registryWith(fetchImpl);

    expect(registry.list()).toHaveLength(1);
    expect(registry.list()[0]).toMatchObject({
      name: 'weather_current',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['latitude', 'longitude'],
        properties: {
          latitude: { type: 'number', minimum: -90, maximum: 90 },
          longitude: { type: 'number', minimum: -180, maximum: 180 },
        },
      },
    });

    const result = await execute(registry, { latitude: 31.2304, longitude: 121.4737 });

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content) as unknown).toEqual({
      source: 'open-meteo',
      latitude: 31.2304,
      longitude: 121.4737,
      timezone: 'Asia/Shanghai',
      observed_at: '2026-12-22T20:15',
      temperature_2m: 18.6,
      temperature_unit: '°C',
      wind_speed_10m: 12.4,
      wind_speed_unit: 'km/h',
      weather_code: 2,
    });

    expect(calls).toHaveLength(1);
    const call = calls[0];
    const url = new URL(call?.url ?? '');
    expect(url.origin).toBe('https://api.open-meteo.com');
    expect(url.pathname).toBe('/v1/forecast');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      latitude: '31.2304',
      longitude: '121.4737',
      current: 'temperature_2m,wind_speed_10m,weather_code',
      timezone: 'auto',
      temperature_unit: 'celsius',
      wind_speed_unit: 'kmh',
    });
    expect(call?.init.method).toBe('GET');
    expect(call?.init.redirect).toBe('error');
    expect(call?.init.body).toBeUndefined();
    expect(new Headers(call?.init.headers).get('accept')).toBe('application/json');
    expect(call?.init.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    { latitude: -90, longitude: -180 },
    { latitude: 90, longitude: 180 },
    { latitude: 0, longitude: 0 },
  ])('接受经纬度边界 $latitude / $longitude', async ({ latitude, longitude }) => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = (input) => {
      calls.push(urlOf(input));
      return Promise.resolve(jsonResponse(successPayload));
    };

    const result = await execute(registryWith(fetchImpl), { latitude, longitude });

    expect(result.isError).toBeUndefined();
    const url = new URL(calls[0] ?? '');
    expect(url.searchParams.get('latitude')).toBe(String(latitude));
    expect(url.searchParams.get('longitude')).toBe(String(longitude));
  });
});

describe('weather_current 输入与第三方错误边界', () => {
  it.each([
    { longitude: 121.4737 },
    { latitude: 90.001, longitude: 121.4737 },
    { latitude: -90.001, longitude: 121.4737 },
    { latitude: 31.2304, longitude: 180.001 },
    { latitude: 31.2304, longitude: -180.001 },
    { latitude: '31.2304', longitude: 121.4737 },
    { latitude: 31.2304, longitude: 121.4737, url: 'http://169.254.169.254/' },
  ])('拒绝缺失、越界、非数值或额外 URL 参数 %#', async (args) => {
    let calls = 0;
    const fetchImpl: typeof fetch = () => {
      calls += 1;
      return Promise.resolve(jsonResponse(successPayload));
    };

    const result = await execute(registryWith(fetchImpl), args);

    expect(result).toMatchObject({
      isError: true,
      error: { code: 'INVALID_ARGUMENTS', retryable: true },
    });
    expect(calls).toBe(0);
  });

  it.each([
    { status: 400, retryable: false },
    { status: 429, retryable: true },
    { status: 503, retryable: true },
  ])('HTTP $status 映射为上游错误且不透出响应体', async ({ status, retryable }) => {
    let calls = 0;
    const fetchImpl: typeof fetch = () => {
      calls += 1;
      return Promise.resolve(new Response('secret upstream body: do-not-leak', {
        status,
        headers: { 'content-type': 'application/json' },
      }));
    };

    const result = await execute(
      registryWith(fetchImpl),
      { latitude: 31.2304, longitude: 121.4737 },
    );

    expect(result).toMatchObject({
      isError: true,
      error: { code: 'UPSTREAM_HTTP_ERROR', retryable },
    });
    expect(result.content).toContain(String(status));
    expect(result.content).not.toContain('do-not-leak');
    expect(result.error?.hint).not.toContain('do-not-leak');
    expect(calls).toBe(1);
  });

  it('网络错误使用安全摘要，不自动重试也不泄露底层错误', async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = () => {
      calls += 1;
      return Promise.reject(new Error('socket failed with secret-token=do-not-leak'));
    };

    const result = await execute(
      registryWith(fetchImpl),
      { latitude: 31.2304, longitude: 121.4737 },
    );

    expect(result).toMatchObject({
      isError: true,
      error: { code: 'UPSTREAM_NETWORK_ERROR', retryable: true },
    });
    expect(result.content).not.toContain('secret-token');
    expect(result.content).not.toContain('do-not-leak');
    expect(calls).toBe(1);
  });

  it('内部超时会中止请求并映射为 TOOL_TIMEOUT', async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | null = null;
    const registry = registryWith(pendingFetch((signal) => {
      requestSignal = signal;
    }), { timeoutMs: 25 });

    const running = execute(registry, { latitude: 31.2304, longitude: 121.4737 });
    await vi.advanceTimersByTimeAsync(25);
    const result = await running;

    expect((requestSignal as AbortSignal | null)?.aborted).toBe(true);
    expect(result).toMatchObject({
      isError: true,
      error: { code: 'TOOL_TIMEOUT', retryable: true },
    });
    expect(result.content).toContain('25');
  });

  it('等待期间外部取消映射为 TOOL_CANCELLED', async () => {
    let requestSignal: AbortSignal | null = null;
    const controller = new AbortController();
    const registry = registryWith(pendingFetch((signal) => {
      requestSignal = signal;
    }), { timeoutMs: 5_000 });

    const running = execute(
      registry,
      { latitude: 31.2304, longitude: 121.4737 },
      controller.signal,
    );
    controller.abort(new Error('caller secret reason'));
    const result = await running;

    expect((requestSignal as AbortSignal | null)?.aborted).toBe(true);
    expect(result).toMatchObject({
      isError: true,
      error: { code: 'TOOL_CANCELLED', retryable: false },
    });
    expect(result.content).not.toContain('caller secret reason');
  });

  it('fetch 前已经取消时不访问网络', async () => {
    let calls = 0;
    const controller = new AbortController();
    controller.abort();
    const fetchImpl: typeof fetch = () => {
      calls += 1;
      return Promise.resolve(jsonResponse(successPayload));
    };

    const result = await execute(
      registryWith(fetchImpl),
      { latitude: 31.2304, longitude: 121.4737 },
      controller.signal,
    );

    expect(result.error?.code).toBe('TOOL_CANCELLED');
    expect(calls).toBe(0);
  });
});

describe('weather_current 响应边界', () => {
  async function expectResponseError(
    response: Response,
    code: ToolErrorCode,
    options: Omit<WeatherCurrentToolOptions, 'fetchImpl'> = {},
  ) {
    const result = await execute(
      registryWith(() => Promise.resolve(response), options),
      { latitude: 31.2304, longitude: 121.4737 },
    );
    expect(result).toMatchObject({
      isError: true,
      error: { code, retryable: false },
    });
    expect(result.content).not.toContain('do-not-leak');
  }

  it('拒绝非 JSON Content-Type', async () => {
    await expectResponseError(new Response('{"secret":"do-not-leak"}', {
      headers: { 'content-type': 'text/plain' },
    }), 'UPSTREAM_INVALID_RESPONSE');
  });

  it('拒绝无效 JSON 且不返回原始响应体', async () => {
    await expectResponseError(new Response('{ invalid json do-not-leak', {
      headers: { 'content-type': 'application/json' },
    }), 'UPSTREAM_INVALID_RESPONSE');
  });

  it('按流式读取上限拒绝过大响应，而不是无限读取', async () => {
    await expectResponseError(new Response('x'.repeat(129), {
      headers: { 'content-type': 'application/json' },
    }), 'UPSTREAM_RESPONSE_TOO_LARGE', { maxResponseBytes: 128 });
  });

  it('Content-Length 已超限时在读取正文前拒绝', async () => {
    const body = new ReadableStream<Uint8Array>({});
    const getReader = vi.spyOn(body, 'getReader');
    await expectResponseError(new Response(body, {
      headers: {
        'content-type': 'application/json',
        'content-length': '100000',
      },
    }), 'UPSTREAM_RESPONSE_TOO_LARGE', { maxResponseBytes: 128 });
    expect(getReader).not.toHaveBeenCalled();
  });

  it.each([
    { ...successPayload, current: null },
    { ...successPayload, current: { ...successPayload.current, temperature_2m: 'hot' } },
    { ...successPayload, current_units: null },
    { ...successPayload, current_units: { ...successPayload.current_units, temperature_2m: '' } },
    { ...successPayload, timezone: '' },
    { ...successPayload, latitude: 'not-a-number' },
    { ...successPayload, current: { ...successPayload.current, weather_code: null } },
  ])('拒绝字段缺失或类型错误的响应 %#', async (payload) => {
    await expectResponseError(jsonResponse(payload), 'UPSTREAM_INVALID_RESPONSE');
  });

  it('拒绝无效的超时和响应上限配置', () => {
    expect(() => createWeatherCurrentTool({ timeoutMs: 0 })).toThrow('timeoutMs');
    expect(() => createWeatherCurrentTool({ maxResponseBytes: 0 })).toThrow('maxResponseBytes');
  });
});
