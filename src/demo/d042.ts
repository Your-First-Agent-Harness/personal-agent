import type { ModelProvider } from '../adapters/model/provider.ts';
import { runAgentLoop } from '../runtime/loop.ts';
import { ToolRegistry } from '../tools/registry.ts';
import {
  createWeatherCurrentTool,
  type WeatherCurrentResult,
  type WeatherCurrentToolOptions,
} from '../tools/weather.ts';

const PROVIDER = 'deterministic-d042-script';
const CALL_ID = 'd042-weather';
const WEATHER_INPUT = { latitude: 31.2304, longitude: 121.4737 } as const;

export type D042DemoMode = 'live' | 'offline';

export interface D042DemoOptions extends WeatherCurrentToolOptions {
  readonly mode?: D042DemoMode;
}

export interface D042DemoReport {
  readonly mode: D042DemoMode;
  readonly host: 'api.open-meteo.com';
  readonly provider: typeof PROVIDER;
  readonly registeredTools: string[];
  readonly toolNames: string[];
  readonly toolArguments: string;
  readonly turns: number;
  readonly stopReason: string;
  readonly weather: WeatherCurrentResult;
  readonly finalText: string;
}

function createScriptedProvider(): ModelProvider {
  let turn = 0;
  return {
    name: PROVIDER,
    chat(request) {
      turn += 1;
      if (turn === 1) {
        return Promise.resolve({
          text: '',
          model: PROVIDER,
          toolCalls: [{
            id: CALL_ID,
            name: 'weather_current',
            arguments: JSON.stringify(WEATHER_INPUT),
          }],
        });
      }
      const toolMessage = request.messages.find((message) => (
        message.role === 'tool' && message.toolCallId === CALL_ID
      ));
      if (turn !== 2 || toolMessage === undefined) {
        throw new Error('D042 脚本模型收到了超出预期的消息序列');
      }
      try {
        const weather = JSON.parse(toolMessage.content) as WeatherCurrentResult;
        if (weather.source !== 'open-meteo') throw new Error('unknown source');
        return Promise.resolve({
          text: `Open-Meteo 当前天气：${weather.timezone}，观测时间 ${weather.observed_at}，温度 ${weather.temperature_2m}${weather.temperature_unit}，风速 ${weather.wind_speed_10m}${weather.wind_speed_unit}，weather_code=${weather.weather_code}。来源：${weather.source}。`,
          model: PROVIDER,
        });
      } catch {
        return Promise.resolve({
          text: `天气查询失败：${toolMessage.content}`,
          model: PROVIDER,
        });
      }
    },
  };
}

export async function runD042Demo(
  output: (line: string) => void,
  options: D042DemoOptions = {},
): Promise<D042DemoReport> {
  const mode = options.mode ?? 'live';
  if (mode === 'offline' && options.fetchImpl === undefined) {
    throw new Error('offline Demo 必须显式注入确定性 fetchImpl');
  }
  const registry = new ToolRegistry();
  registry.register(createWeatherCurrentTool(options));
  const provider = createScriptedProvider();
  const errors = new Map<string, boolean>();

  output('D042 Demo：真实 AgentLoop + 离线确定性模型 + weather_current。');
  output(mode === 'live'
    ? 'transport=live：真实 Open-Meteo HTTPS API，无 API Key。'
    : 'transport=offline：注入确定性 fetch，不请求外网；这不是第三方真实调用证据。');
  output('host=api.open-meteo.com');
  output(`输入=${JSON.stringify(WEATHER_INPUT)}`);

  const result = await runAgentLoop({
    provider,
    registry,
    messages: [
      { role: 'system', content: '调用 weather_current 后，只依据该工具消息回答，不编造天气。' },
      { role: 'user', content: '查询上海当前天气。' },
    ],
    maxTurns: 2,
    maxTokens: 256,
    workspaceRoot: process.cwd(),
    eventSink: {
      emit(event) {
        if (event.type === 'tool_call_finished') {
          errors.set(event.toolCallId, event.isError);
        }
      },
    },
  });
  const toolCall = result.messages
    .filter((message) => message.role === 'assistant')
    .flatMap((message) => message.toolCalls ?? [])
    .find((call) => call.id === CALL_ID);
  const toolMessage = result.messages.find((message) => (
    message.role === 'tool' && message.toolCallId === CALL_ID
  ));
  const finalMessage = result.messages.at(-1);
  if (!toolCall || !toolMessage || finalMessage?.role !== 'assistant') {
    throw new Error('D042 Demo 没有形成 assistant toolCall → tool → final assistant 链');
  }

  output(`工具调用=${toolCall.name} 参数=${toolCall.arguments}`);
  const toolError = errors.get(CALL_ID) === true;
  if (toolError) output(`工具错误=${toolMessage.content}`);
  output(`最终回答=${finalMessage.content}`);
  output(`turns=${result.turns} stopReason=${result.stopReason}`);

  let weather: WeatherCurrentResult | undefined;
  if (!toolError) {
    try {
      weather = JSON.parse(toolMessage.content) as WeatherCurrentResult;
    } catch {
      weather = undefined;
    }
  }
  if (!weather || weather.source !== 'open-meteo') {
    output('D042 Demo FAIL：weather_current 未返回可确认的结构化天气。');
    throw new Error('D042 Demo 失败：第三方天气调用或响应校验未通过');
  }

  output(`天气来源=${weather.source} 经纬度=${weather.latitude},${weather.longitude} 时区=${weather.timezone} observed_at=${weather.observed_at}`);
  output(`温度=${weather.temperature_2m}${weather.temperature_unit} 风速=${weather.wind_speed_10m}${weather.wind_speed_unit} weather_code=${weather.weather_code}`);
  if (result.turns !== 2 || result.stopReason !== 'completed') {
    throw new Error(`D042 Demo 停止状态异常：${result.turns}/${result.stopReason}`);
  }
  output('D042 Demo PASS：真实 Loop 已完成 toolCall → tool → final，最终回答只使用工具消息。');

  return {
    mode,
    host: 'api.open-meteo.com',
    provider: PROVIDER,
    registeredTools: registry.list().map((tool) => tool.name),
    toolNames: [toolMessage.name ?? 'weather_current'],
    toolArguments: toolCall.arguments,
    turns: result.turns,
    stopReason: result.stopReason,
    weather,
    finalText: finalMessage.content,
  };
}
