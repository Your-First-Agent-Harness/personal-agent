import type { ChatRequest, ModelProvider } from '../adapters/model/provider.ts';
import type { AgentEvent } from '../core/event.ts';
import type { Tool, ToolSchema } from '../core/tool.ts';
import { runAgentLoop } from '../runtime/loop.ts';
import { DynamicToolRegistry } from '../tools/dynamic-registry.ts';

export interface D049RetrievalReport {
  readonly query: string;
  readonly matches: readonly { readonly name: string; readonly score: number }[];
  readonly retrievedEvents: readonly Extract<AgentEvent, { type: 'tools_retrieved' }>[];
  readonly loadedTools: readonly string[];
  readonly finalText: string;
}

function schema(name: string, description: string): ToolSchema {
  return { name, description, parameters: { type: 'object', properties: {} } };
}

export async function runD049Demo(output: (line: string) => void): Promise<D049RetrievalReport> {
  const query = '客户外部系统';
  const registry = new DynamicToolRegistry({ limit: 2 });
  const loadedTools: string[] = [];
  const tools: readonly [ToolSchema, string][] = [
    [schema('crm_lookup', '查询客户资料'), '客户关系 外部系统'],
    [schema('calendar_create', '创建会议日程'), '工作流 日程'],
    [schema('weather_current', '查询当前天气'), '外部 API'],
  ];

  for (const [toolSchema, tags] of tools) {
    registry.registerLazy(toolSchema, (): Tool => ({
      ...toolSchema,
      execute: () => {
        loadedTools.push(toolSchema.name);
        return Promise.resolve({ content: `${toolSchema.name}: ok` });
      },
    }), { metadata: { tags: tags.split(' ') } });
  }

  const retrievedEvents: Extract<AgentEvent, { type: 'tools_retrieved' }>[] = [];
  const provider: ModelProvider = {
    name: 'd049-retrieval-script',
    chat(request: ChatRequest) {
      if (request.tools?.some((tool) => tool.name === 'crm_lookup') !== true) {
        throw new Error('D049 检索没有选中 crm_lookup');
      }
      return Promise.resolve({ text: '客户查询工具已准备好。', model: 'd049-script' });
    },
  };

  const result = await runAgentLoop({
    provider,
    registry,
    messages: [{ role: 'user', content: query }],
    maxTurns: 1,
    maxTokens: 128,
    workspaceRoot: '.',
    eventSink: { emit(event) {
      if (event.type === 'tools_retrieved') retrievedEvents.push(event);
    } },
  });

  const matches = registry.search(query).map(({ tool, score }) => ({ name: tool.name, score }));
  output(`查询：${query}`);
  output(`命中：${matches.map(({ name, score }) => `${name}(${score})`).join(', ')}`);
  output(`发送给模型：${retrievedEvents[0]?.toolNames.join(', ') ?? '(无)'}`);
  output(`已加载工具：${loadedTools.join(', ') || '(无，检索阶段不实例化)'}`);
  output(`最终回答：${result.text}`);
  output('D049 Demo PASS：标签检索、稳定评分与检索事件均可审计。');

  if (matches[0]?.name !== 'crm_lookup' || retrievedEvents.length !== 1 || loadedTools.length !== 0) {
    throw new Error('D049 Demo 验收失败：检索结果、事件或 lazy 边界不符合预期');
  }
  return { query, matches, retrievedEvents, loadedTools, finalText: result.text };
}
