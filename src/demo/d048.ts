import type { ChatRequest, ModelProvider } from '../adapters/model/provider.ts';
import type { Tool, ToolContext, ToolSchema } from '../core/tool.ts';
import { runAgentLoop } from '../runtime/loop.ts';
import { DynamicToolRegistry } from '../tools/dynamic-registry.ts';

export interface D048RequestReport {
  readonly turn: number;
  readonly tools: readonly string[];
  readonly schemaChars: number;
}

export interface D048DemoReport {
  readonly registeredTools: readonly string[];
  readonly fullSchemaChars: number;
  readonly requests: readonly D048RequestReport[];
  readonly factoryCounts: Readonly<Record<string, number>>;
  readonly executedTools: readonly string[];
  readonly toolResult: string;
  readonly finalText: string;
  readonly turns: number;
  readonly stopReason: string;
}

function objectSchema(
  name: string,
  description: string,
  properties: ToolSchema['parameters']['properties'],
  required: readonly string[] = [],
): ToolSchema {
  return {
    name,
    description,
    parameters: { type: 'object', properties, required, additionalProperties: false },
  };
}

export async function runD048Demo(output: (line: string) => void): Promise<D048DemoReport> {
  const schemas: readonly ToolSchema[] = [
    objectSchema(
      'weather_current',
      '查询指定城市的当前天气、温度与步行条件；current weather and walking conditions',
      { city: { type: 'string', description: '城市中文名称' } },
      ['city'],
    ),
    objectSchema(
      'weather_forecast',
      '获取未来七天的逐日天气预报、降雨概率与风力；daily forecast',
      { city: { type: 'string' }, days: { type: 'integer', minimum: 1, maximum: 7 } },
      ['city'],
    ),
    objectSchema(
      'calendar_create',
      '创建会议日程、设置参与人和提醒时间；calendar scheduling',
      { title: { type: 'string' }, startsAt: { type: 'string' }, attendees: { type: 'array' } },
      ['title', 'startsAt'],
    ),
    objectSchema(
      'expense_report',
      '整理差旅费用并生成报销单；expense reimbursement',
      { trip: { type: 'string' }, receipts: { type: 'array' }, currency: { type: 'string' } },
      ['trip', 'receipts'],
    ),
    objectSchema(
      'document_translate',
      '翻译技术文档并保留术语表；document translation',
      { text: { type: 'string' }, targetLanguage: { type: 'string' }, glossary: { type: 'object' } },
      ['text', 'targetLanguage'],
    ),
    objectSchema(
      'currency_convert',
      '按离线参考汇率换算货币金额；currency conversion',
      { amount: { type: 'number' }, from: { type: 'string' }, to: { type: 'string' } },
      ['amount', 'from', 'to'],
    ),
    objectSchema(
      'file_search',
      '在工作区文件中查找文件名与文本；file search',
      { pattern: { type: 'string' }, path: { type: 'string' }, maxResults: { type: 'integer' } },
      ['pattern'],
    ),
    objectSchema(
      'git_status',
      '检查版本库分支和工作树状态；repository status',
      { includeUntracked: { type: 'boolean' }, path: { type: 'string' } },
    ),
  ];

  const factoryCounts: Record<string, number> = Object.fromEntries(
    schemas.map((schema) => [schema.name, 0]),
  );
  const executedTools: string[] = [];
  const registry = new DynamicToolRegistry({ limit: 3 });

  for (const schema of schemas) {
    registry.registerLazy(schema, () => {
      factoryCounts[schema.name] = (factoryCounts[schema.name] ?? 0) + 1;
      const execute = (args: unknown, _context: ToolContext) => {
        executedTools.push(schema.name);
        if (schema.name === 'weather_current') {
          return Promise.resolve({
            content: JSON.stringify({
              city: (args as { city: string }).city,
              temperatureC: 24,
              condition: '晴',
              walking: '适合散步',
              source: 'tool-weather',
            }),
          });
        }
        return Promise.resolve({ content: `${schema.name} 已执行` });
      };
      const tool: Tool = { ...schema, execute };
      return tool;
    });
  }

  const requests: D048RequestReport[] = [];
  const provider: ModelProvider = {
    name: 'd048-offline-script',
    chat(request: ChatRequest) {
      const turn = requests.length + 1;
      requests.push({
        turn,
        tools: request.tools?.map((schema) => schema.name) ?? [],
        schemaChars: JSON.stringify(request.tools ?? []).length,
      });

      if (turn === 1) {
        if (request.tools?.some((schema) => schema.name === 'weather_current') !== true) {
          throw new Error('第一轮没有检索到 weather_current');
        }
        return Promise.resolve({
          text: '我需要调用当前天气工具。',
          model: 'd048-script',
          toolCalls: [{
            id: 'd048-weather-1',
            name: 'weather_current',
            arguments: JSON.stringify({ city: '上海' }),
          }],
        });
      }
      if (turn === 2) {
        const last = request.messages.at(-1);
        if (last?.role !== 'tool' || !last.content.includes('tool-weather')) {
          throw new Error('第二轮缺少完整工具结果');
        }
        return Promise.resolve({
          text: `上海当前 24°C，晴，适合散步。依据：tool-weather。完整结果：${last.content}`,
          model: 'd048-script',
        });
      }
      throw new Error(`脚本 provider 收到意外轮次：${turn}`);
    },
  };

  const result = await runAgentLoop({
    provider,
    registry,
    messages: [{ role: 'user', content: '请查询上海当前天气，并告诉我是否适合散步。' }],
    maxTurns: 4,
    maxTokens: 512,
    workspaceRoot: '.',
  });

  const registeredTools = registry.catalog().map((schema) => schema.name);
  const fullSchemaChars = JSON.stringify(registry.catalog()).length;
  const toolResult = result.messages.find((message) => message.role === 'tool')?.content ?? '';
  const loadedFactories = Object.values(factoryCounts).reduce((sum, count) => sum + count, 0);

  output(`全量目录工具 (${registeredTools.length}): ${registeredTools.join(', ')}`);
  output(`全量目录 Schema 字符数: ${fullSchemaChars}`);
  for (const request of requests) {
    output(`第 ${request.turn} 轮实际发送工具: ${request.tools.join(', ') || '(无)'}`);
    output(`第 ${request.turn} 轮实际发送 Schema 字符数: ${request.schemaChars}`);
  }
  output(`factory 加载计数: ${JSON.stringify(factoryCounts)}`);
  output(`实际执行工具: ${executedTools.join(', ') || '(无)'}`);
  output(`工具完整结果: ${toolResult}`);
  output(`最终回答: ${result.text}`);
  output('字符数只是可测量代理指标，不是 token 精确节省。');

  if (result.stopReason !== 'completed' || result.turns !== 2) {
    throw new Error(`Demo 未完成：${result.stopReason}/${result.turns}`);
  }
  if (registeredTools.length !== 8 || requests.length !== 2) {
    throw new Error('Demo 目录或请求轮次不符合预期');
  }
  if (requests.some((request) =>
    !request.tools.includes('weather_current') || request.schemaChars >= fullSchemaChars)) {
    throw new Error('Demo 没有形成有效的动态 Schema 子集');
  }
  if (loadedFactories !== 1 || factoryCounts['weather_current'] !== 1) {
    throw new Error('Demo lazy factory 没有按需加载并缓存');
  }
  if (executedTools.join(',') !== 'weather_current' || !toolResult.includes('"city":"上海"')) {
    throw new Error('Demo 工具执行或结果回喂不符合预期');
  }

  output('D048 Demo PASS');
  return {
    registeredTools,
    fullSchemaChars,
    requests,
    factoryCounts,
    executedTools,
    toolResult,
    finalText: result.text,
    turns: result.turns,
    stopReason: result.stopReason,
  };
}
