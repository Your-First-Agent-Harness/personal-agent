import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import type { ChatResult, ModelProvider } from '../adapters/model/provider.ts';
import type { Message } from '../core/message.ts';
import { runAgentLoop } from '../runtime/loop.ts';
import { createKnowledgeTools } from '../tools/knowledge.ts';
import { ToolRegistry } from '../tools/registry.ts';

const providerName = 'deterministic-d041-script';

export interface D041DemoStep {
  readonly id: string;
  readonly name: string;
  readonly arguments: string;
  readonly result: string;
  readonly resultSummary: string;
  readonly isError: boolean;
}

export interface D041Source {
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

export interface D041DemoReport {
  readonly provider: string;
  readonly registeredTools: readonly string[];
  readonly toolNames: readonly string[];
  readonly steps: readonly D041DemoStep[];
  readonly sources: readonly D041Source[];
  readonly finalText: string;
  readonly stopReason: string;
  readonly turns: number;
  readonly workspace: string;
  readonly workspaceRemoved: boolean;
}

interface SearchPayload {
  readonly results: readonly { readonly path: string; readonly line: number }[];
}

interface ReadPayload {
  readonly path: string;
  readonly lines: readonly { readonly line: number; readonly text: string }[];
}

function toolResponse(id: string, name: string, args: unknown): ChatResult {
  return {
    text: '',
    model: providerName,
    toolCalls: [{ id, name, arguments: JSON.stringify(args) }],
  };
}

function toolContent(messages: readonly Message[], toolCallId: string): string {
  const message = messages.find(
    (candidate) => candidate.role === 'tool' && candidate.toolCallId === toolCallId,
  );
  if (message === undefined) throw new Error(`模型上下文缺少 ${toolCallId} 的真实工具结果`);
  return message.content;
}

function createProvider(): ModelProvider {
  let turn = 0;
  return {
    name: providerName,
    chat(request) {
      turn += 1;
      if (turn === 1) {
        return Promise.resolve(toolResponse('d041-search', 'knowledge_search', { query: '发布窗口' }));
      }
      if (turn === 2) {
        const search = JSON.parse(toolContent(request.messages, 'd041-search')) as SearchPayload;
        const match = search.results[0];
        if (match === undefined) throw new Error('D041 搜索没有返回可读取的来源');
        return Promise.resolve(toolResponse('d041-read', 'knowledge_read', {
          path: match.path,
          startLine: match.line,
          endLine: match.line,
        }));
      }
      if (turn === 3) {
        const read = JSON.parse(toolContent(request.messages, 'd041-read')) as ReadPayload;
        const source = read.lines[0];
        if (source === undefined) throw new Error('D041 读取没有返回可引用的行');
        return Promise.resolve({
          text: `${source.text}（来源：${read.path}:${source.line}）`,
          model: providerName,
        });
      }
      return Promise.reject(new Error('D041 脚本没有更多响应'));
    },
  };
}

function summarize(content: string): string {
  const compact = content.replace(/\s+/g, ' ').trim();
  return compact.length <= 220 ? compact : `${compact.slice(0, 217)}...`;
}

export async function runD041Demo(output: (line: string) => void): Promise<D041DemoReport> {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'personal-agent-d041-demo-')));
  let pending: Omit<D041DemoReport, 'workspaceRemoved'>;
  try {
    const releasePath = join(workspace, 'operations', 'release.md');
    mkdirSync(dirname(releasePath), { recursive: true });
    writeFileSync(releasePath, [
      '# 发布约定',
      '本文件是 D041 Demo 的临时教学资料，不是真实第三方知识库。',
      '发布窗口为每周二 14:00，发布前必须完成全量测试。',
      '引用时必须保留相对路径与行号。',
      '',
    ].join('\n'), 'utf8');
    writeFileSync(join(workspace, 'overview.md'), [
      '# D041 教学知识库',
      '本快照只包含本地 Markdown，搜索采用确定性的子串匹配。',
      '',
    ].join('\n'), 'utf8');

    const registry = new ToolRegistry();
    for (const tool of createKnowledgeTools(workspace)) registry.register(tool);
    const registeredTools = registry.list().map((tool) => tool.name);
    output('D041 确定性离线 Demo：不请求网络、不需要 API Key；临时目录是明确构造的教学知识库。');
    output('快照在 createKnowledgeTools 工厂调用时建立；搜索是子串匹配，不是 embedding、RAG 或语义搜索。');
    output(`注册工具：${registeredTools.join('、')}`);

    const errorByCallId = new Map<string, boolean>();
    const result = await runAgentLoop({
      provider: createProvider(),
      registry,
      messages: [
        { role: 'system', content: '先用 knowledge_search 找资料，再从真实工具结果选择路径和行号调用 knowledge_read，最后附来源回答。' },
        { role: 'user', content: '发布窗口是什么时候，发布前要做什么？' },
      ],
      maxTurns: 3,
      maxTokens: 256,
      workspaceRoot: workspace,
      eventSink: {
        emit(event) {
          if (event.type === 'tool_call_finished') {
            errorByCallId.set(event.toolCallId, event.isError);
          }
        },
      },
    });

    const steps: D041DemoStep[] = [];
    for (const message of result.messages) {
      if (message.role !== 'assistant') continue;
      for (const call of message.toolCalls ?? []) {
        const content = toolContent(result.messages, call.id);
        steps.push({
          id: call.id,
          name: call.name,
          arguments: call.arguments,
          result: content,
          resultSummary: summarize(content),
          isError: errorByCallId.get(call.id) === true,
        });
      }
    }
    const searchStep = steps[0];
    const readStep = steps[1];
    if (searchStep === undefined || readStep === undefined) throw new Error('D041 缺少 search/read 调用记录');
    const search = JSON.parse(searchStep.result) as SearchPayload;
    const match = search.results[0];
    if (match === undefined) throw new Error('D041 Demo 没有搜索命中');
    const readArguments = JSON.parse(readStep.arguments) as Record<string, unknown>;
    const read = JSON.parse(readStep.result) as ReadPayload;
    const sources = read.lines.map((line) => ({ path: read.path, line: line.line, text: line.text }));
    const assertionsPassed = result.stopReason === 'completed'
      && result.turns === 3
      && steps.map((step) => step.name).join(',') === 'knowledge_search,knowledge_read'
      && steps.every((step) => !step.isError)
      && readArguments['path'] === match.path
      && readArguments['startLine'] === match.line
      && readArguments['endLine'] === match.line
      && sources.length > 0
      && result.text.includes(`${read.path}:${String(sources[0]?.line)}`);
    if (!assertionsPassed) throw new Error('D041 Demo 的真实工具顺序、数据依赖、引用或完成状态断言未通过');

    for (const [index, step] of steps.entries()) {
      output(`[${String(index + 1).padStart(2, '0')}] ${step.name}`);
      output(`  参数：${step.arguments}`);
      output(`  结果摘要：${step.resultSummary}`);
    }
    pending = {
      provider: providerName,
      registeredTools,
      toolNames: steps.map((step) => step.name),
      steps,
      sources,
      finalText: result.text,
      stopReason: result.stopReason,
      turns: result.turns,
      workspace,
    };
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }

  const report: D041DemoReport = { ...pending, workspaceRemoved: !existsSync(workspace) };
  if (!report.workspaceRemoved) throw new Error('D041 Demo 临时知识库清理失败');
  for (const source of report.sources) {
    output(`来源：${source.path}:${source.line} ${source.text}`);
  }
  output(`最终回答：${report.finalText}`);
  output(`stopReason=${report.stopReason} turns=${report.turns}`);
  output(`workspaceRemoved=${report.workspaceRemoved}`);
  output('D041 Demo PASS：search → 真实 tool 消息取路径/行号 → read → 带行号来源回答；临时知识库已清理。');
  return report;
}
