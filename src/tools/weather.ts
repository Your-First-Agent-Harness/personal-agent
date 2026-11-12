import { ToolError, type Tool, type ToolContext } from '../core/tool.ts';

const OPEN_METEO_ENDPOINT = 'https://api.open-meteo.com/v1/forecast';
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024;

export interface WeatherCurrentInput {
  readonly latitude: number;
  readonly longitude: number;
}

export interface WeatherCurrentResult {
  readonly source: 'open-meteo';
  readonly latitude: number;
  readonly longitude: number;
  readonly timezone: string;
  readonly observed_at: string;
  readonly temperature_2m: number;
  readonly temperature_unit: string;
  readonly wind_speed_10m: number;
  readonly wind_speed_unit: string;
  readonly weather_code: number;
}

export interface WeatherCurrentToolOptions {
  readonly fetchImpl?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
}

type OpenMeteoErrorKind =
  | 'http'
  | 'network'
  | 'timeout'
  | 'invalid_response'
  | 'response_too_large';

class OpenMeteoError extends Error {
  readonly kind: OpenMeteoErrorKind;
  readonly status: number | undefined;

  constructor(kind: OpenMeteoErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'OpenMeteoError';
    this.kind = kind;
    this.status = status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateInput(args: unknown): WeatherCurrentInput {
  if (!isRecord(args)) {
    throw new ToolError('INVALID_ARGUMENTS', 'weather_current 参数必须是对象', false);
  }
  if (Object.keys(args).some((key) => key !== 'latitude' && key !== 'longitude')) {
    throw new ToolError('INVALID_ARGUMENTS', 'weather_current 只接受 latitude 和 longitude', false);
  }
  const latitude = args['latitude'];
  const longitude = args['longitude'];
  if (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new ToolError('INVALID_ARGUMENTS', 'latitude 必须是 -90 到 90 的有限数值', false);
  }
  if (typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new ToolError('INVALID_ARGUMENTS', 'longitude 必须是 -180 到 180 的有限数值', false);
  }
  return { latitude, longitude };
}

function invalidResponse(message = 'Open-Meteo 返回了不符合约定的响应'): OpenMeteoError {
  return new OpenMeteoError('invalid_response', message);
}

function requiredNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw invalidResponse(`Open-Meteo 响应字段 ${key} 不是有限数值`);
  }
  return value;
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw invalidResponse(`Open-Meteo 响应字段 ${key} 不是非空字符串`);
  }
  return value;
}

function parseWeather(payload: unknown): WeatherCurrentResult {
  if (!isRecord(payload)) throw invalidResponse();
  const current = payload['current'];
  const units = payload['current_units'];
  if (!isRecord(current) || !isRecord(units)) {
    throw invalidResponse('Open-Meteo 响应缺少 current 或 current_units 对象');
  }
  const latitude = requiredNumber(payload, 'latitude');
  const longitude = requiredNumber(payload, 'longitude');
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    throw invalidResponse('Open-Meteo 响应经纬度超出有效范围');
  }
  return {
    source: 'open-meteo',
    latitude,
    longitude,
    timezone: requiredString(payload, 'timezone'),
    observed_at: requiredString(current, 'time'),
    temperature_2m: requiredNumber(current, 'temperature_2m'),
    temperature_unit: requiredString(units, 'temperature_2m'),
    wind_speed_10m: requiredNumber(current, 'wind_speed_10m'),
    wind_speed_unit: requiredString(units, 'wind_speed_10m'),
    weather_code: requiredNumber(current, 'weather_code'),
  };
}

function discardBody(response: Response): void {
  void response.body?.cancel().catch(() => undefined);
}

async function readLimitedBody(response: Response, maxResponseBytes: number): Promise<Uint8Array> {
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null && /^\d+$/.test(contentLength) && Number(contentLength) > maxResponseBytes) {
    discardBody(response);
    throw new OpenMeteoError(
      'response_too_large',
      `Open-Meteo 响应超过 ${maxResponseBytes} 字节上限`,
    );
  }
  if (response.body === null) throw invalidResponse('Open-Meteo 响应正文为空');

  const reader = response.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxResponseBytes) {
        try {
          await reader.cancel();
        } catch {
          // 保留更明确的响应过大错误。
        }
        throw new OpenMeteoError(
          'response_too_large',
          `Open-Meteo 响应超过 ${maxResponseBytes} 字节上限`,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function mapToToolError(error: unknown): ToolError {
  if (error instanceof ToolError) return error;
  if (!(error instanceof OpenMeteoError)) {
    return new ToolError('UPSTREAM_NETWORK_ERROR', 'Open-Meteo 请求失败', true);
  }
  switch (error.kind) {
    case 'http': {
      const status = error.status ?? 0;
      const retryable = status === 429 || status >= 500;
      return new ToolError(
        'UPSTREAM_HTTP_ERROR',
        `Open-Meteo 返回 HTTP ${status}`,
        retryable,
        '保留第三方 HTTP 状态；不读取或透出上游响应正文。',
      );
    }
    case 'network':
      return new ToolError('UPSTREAM_NETWORK_ERROR', error.message, true, '检查网络后重新运行。');
    case 'timeout':
      return new ToolError('TOOL_TIMEOUT', error.message, true, '可稍后重试，或检查网络连接。');
    case 'invalid_response':
      return new ToolError('UPSTREAM_INVALID_RESPONSE', error.message, false);
    case 'response_too_large':
      return new ToolError('UPSTREAM_RESPONSE_TOO_LARGE', error.message, false);
  }
}

async function requestWeather(
  input: WeatherCurrentInput,
  context: ToolContext,
  fetchImpl: typeof globalThis.fetch,
  timeoutMs: number,
  maxResponseBytes: number,
): Promise<WeatherCurrentResult> {
  if (context.signal?.aborted) {
    throw new ToolError('TOOL_CANCELLED', 'weather_current 已被调用方取消', false);
  }

  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort(context.signal?.reason);
  context.signal?.addEventListener('abort', abortFromCaller, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error('Open-Meteo request timeout'));
  }, timeoutMs);

  try {
    const endpoint = new URL(OPEN_METEO_ENDPOINT);
    endpoint.search = new URLSearchParams({
      latitude: String(input.latitude),
      longitude: String(input.longitude),
      current: 'temperature_2m,wind_speed_10m,weather_code',
      timezone: 'auto',
      temperature_unit: 'celsius',
      wind_speed_unit: 'kmh',
    }).toString();
    const response = await fetchImpl(endpoint, {
      method: 'GET',
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.ok) {
      discardBody(response);
      throw new OpenMeteoError('http', `Open-Meteo HTTP ${response.status}`, response.status);
    }
    const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
    if (contentType !== 'application/json') {
      discardBody(response);
      throw invalidResponse('Open-Meteo 响应 Content-Type 不是 application/json');
    }

    const bytes = await readLimitedBody(response, maxResponseBytes);
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw invalidResponse('Open-Meteo 响应不是有效 UTF-8');
    }
    let payload: unknown;
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      throw invalidResponse('Open-Meteo 响应不是有效 JSON');
    }
    return parseWeather(payload);
  } catch (error: unknown) {
    if (error instanceof ToolError || error instanceof OpenMeteoError) throw error;
    if (context.signal?.aborted) {
      throw new ToolError('TOOL_CANCELLED', 'weather_current 已被调用方取消', false);
    }
    if (timedOut) {
      throw new OpenMeteoError('timeout', `Open-Meteo 请求超过 ${timeoutMs}ms`);
    }
    throw new OpenMeteoError('network', 'Open-Meteo 网络请求或响应读取失败');
  } finally {
    clearTimeout(timer);
    context.signal?.removeEventListener('abort', abortFromCaller);
  }
}

export function createWeatherCurrentTool(options: WeatherCurrentToolOptions = {}): Tool {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('timeoutMs 必须是正整数');
  }
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes <= 0) {
    throw new TypeError('maxResponseBytes 必须是正整数');
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);

  return {
    name: 'weather_current',
    description: '读取 Open-Meteo 当前天气：摄氏温度、风速、WMO weather_code 与观测时间。只读，无需 API Key。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        latitude: { type: 'number', minimum: -90, maximum: 90, description: '纬度，-90 到 90' },
        longitude: { type: 'number', minimum: -180, maximum: 180, description: '经度，-180 到 180' },
      },
      required: ['latitude', 'longitude'],
    },
    async execute(args, context) {
      try {
        const input = validateInput(args);
        const weather = await requestWeather(input, context, fetchImpl, timeoutMs, maxResponseBytes);
        return { content: JSON.stringify(weather) };
      } catch (error: unknown) {
        throw mapToToolError(error);
      }
    },
  };
}
