import { describe, expect, it, vi } from 'vitest';

import type { ChatRequest, ModelProvider } from '../src/adapters/model/provider.ts';
import type { ToolSchema } from '../src/core/tool.ts';
import { runAgentLoop } from '../src/runtime/loop.ts';
import { DynamicToolRegistry } from '../src/tools/dynamic-registry.ts';

function lazySchema(name: string, description: string): ToolSchema {
  return { name, description, parameters: { type: 'object', properties: {} } };
}

describe('D048 AgentLoop 动态工具子集集成', () => {
  it('每轮按明确查询重新检索，先前发现的工具仍可执行且完整结果回喂', async () => {
    const registry = new DynamicToolRegistry({ limit: 2 });
    const weatherFactory = vi.fn(() => ({
      ...lazySchema('weather_current', '查询当前天气'),
      execute: (args: unknown) => Promise.resolve({
        content: JSON.stringify({ source: 'real-tool', args }),
      }),
    }));
    const calendarFactory = vi.fn(() => ({
      ...lazySchema('calendar_create', '创建日程'),
      execute: () => Promise.resolve({ content: 'calendar-created' }),
    }));
    registry.registerLazy(lazySchema('weather_current', '查询当前天气'), weatherFactory);
    registry.registerLazy(lazySchema('calendar_create', '创建日程'), calendarFactory);

    const requests: ChatRequest[] = [];
    let turn = 0;
    const provider: ModelProvider = {
      name: 'd048-loop-script',
      chat(request) {
        requests.push({ ...request, messages: [...request.messages] });
        turn += 1;
        if (turn === 1 || turn === 2) {
          return Promise.resolve({
            text: '',
            model: 'script',
            toolCalls: [{
              id: `weather-${turn}`,
              name: 'weather_current',
              arguments: JSON.stringify({ turn }),
            }],
          });
        }
        const last = request.messages.at(-1);
        return Promise.resolve({
          text: `最终回答：${last?.content ?? 'missing'}`,
          model: 'script',
        });
      },
    };

    const result = await runAgentLoop({
      provider,
      registry,
      messages: [{ role: 'user', content: '先查天气，再考虑日程' }],
      getToolQuery: (_messages, currentTurn) => currentTurn === 1 ? '天气' : '日程',
      maxTurns: 3,
      maxTokens: 256,
      workspaceRoot: '.',
    });

    expect(requests).toHaveLength(3);
    expect(requests.map((request) => request.tools?.map((entry) => entry.name))).toEqual([
      ['weather_current'],
      ['calendar_create'],
      ['calendar_create'],
    ]);
    expect(requests[1]?.messages.at(-1)).toMatchObject({
      role: 'tool', toolCallId: 'weather-1', name: 'weather_current',
    });
    expect(requests[2]?.messages.at(-1)).toMatchObject({
      role: 'tool', toolCallId: 'weather-2', name: 'weather_current',
    });
    expect(result.text).toContain('"source":"real-tool"');
    expect(result.text).toContain('"turn":2');
    expect(result.stopReason).toBe('completed');
    expect(weatherFactory).toHaveBeenCalledTimes(1);
    expect(calendarFactory).not.toHaveBeenCalled();
  });

  it('默认使用最新用户消息作为每轮检索查询，空用户查询不下发工具', async () => {
    const registry = new DynamicToolRegistry();
    registry.registerLazy(lazySchema('weather_current', '查询当前天气'), () => ({
      ...lazySchema('weather_current', '查询当前天气'),
      execute: () => Promise.resolve({ content: 'sunny' }),
    }));
    const requests: ChatRequest[] = [];
    const provider: ModelProvider = {
      name: 'd048-query-script',
      chat(request) {
        requests.push(request);
        return Promise.resolve({ text: 'done', model: 'script' });
      },
    };

    await runAgentLoop({
      provider,
      registry,
      messages: [
        { role: 'user', content: '旧请求：日程' },
        { role: 'assistant', content: '好的' },
        { role: 'user', content: '现在查询天气' },
      ],
      maxTurns: 1,
      maxTokens: 128,
      workspaceRoot: '.',
    });
    await runAgentLoop({
      provider,
      registry,
      messages: [{ role: 'system', content: '没有用户查询' }],
      maxTurns: 1,
      maxTokens: 128,
      workspaceRoot: '.',
    });

    expect(requests[0]?.tools?.map((entry) => entry.name)).toEqual(['weather_current']);
    expect(requests[1]?.tools).toEqual([]);
  });
});
