import { describe, expect, it } from 'vitest';

import { runD042Demo } from '../src/demo/d042.ts';

describe('D042 weather_current AgentLoop Demo', () => {
  it('离线模型只从真实 Tool 消息组织最终回答，并输出完整运行报告', async () => {
    let fetchCalls = 0;
    const fetchImpl: typeof fetch = () => {
      fetchCalls += 1;
      return Promise.resolve(new Response(JSON.stringify({
        latitude: 31.25,
        longitude: 121.5,
        timezone: 'Asia/Shanghai',
        current_units: {
          time: 'iso8601',
          temperature_2m: '°C',
          wind_speed_10m: 'km/h',
          weather_code: 'wmo code',
        },
        current: {
          time: '2026-12-22T20:00',
          temperature_2m: 7.25,
          wind_speed_10m: 3.5,
          weather_code: 3,
        },
      }), { headers: { 'content-type': 'application/json' } }));
    };
    const transcript: string[] = [];

    const report = await runD042Demo((line) => transcript.push(line), {
      mode: 'offline',
      fetchImpl,
    });

    expect(report).toMatchObject({
      mode: 'offline',
      host: 'api.open-meteo.com',
      provider: 'deterministic-d042-script',
      registeredTools: ['weather_current'],
      toolNames: ['weather_current'],
      turns: 2,
      stopReason: 'completed',
      weather: {
        source: 'open-meteo',
        latitude: 31.25,
        longitude: 121.5,
        timezone: 'Asia/Shanghai',
        observed_at: '2026-12-22T20:00',
        temperature_2m: 7.25,
        temperature_unit: '°C',
        wind_speed_10m: 3.5,
        wind_speed_unit: 'km/h',
        weather_code: 3,
      },
    });
    expect(JSON.parse(report.toolArguments) as unknown).toEqual({
      latitude: 31.2304,
      longitude: 121.4737,
    });
    expect(report.finalText).toContain('7.25°C');
    expect(report.finalText).toContain('3.5km/h');
    expect(report.finalText).toContain('weather_code=3');
    expect(report.finalText).toContain('open-meteo');
    expect(fetchCalls).toBe(1);
    expect(transcript.join('\n')).toContain('host=api.open-meteo.com');
    expect(transcript.join('\n')).toContain('输入={"latitude":31.2304,"longitude":121.4737}');
    expect(transcript.join('\n')).toContain('温度=7.25°C');
    expect(transcript.join('\n')).toContain('风速=3.5km/h');
    expect(transcript.join('\n')).toContain('turns=2 stopReason=completed');
    expect(transcript.join('\n')).toContain('D042 Demo PASS');
    expect(transcript.join('\n')).toContain('不请求外网');
  });
});
