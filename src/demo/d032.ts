import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ChatRequest, ChatResult, ModelProvider } from '../adapters/model/provider.ts';
import type { Message } from '../core/message.ts';
import { runAgentLoop } from '../runtime/loop.ts';
import { ToolRegistry } from '../tools/registry.ts';
import { createD032Tools } from './d032-tools.ts';

const providerName = 'deterministic-d032-script';
const reportPath = 'release-report.md';
const qualityConfig = `${JSON.stringify({
  title: 'D032 多工具协作验收',
  minPass: 2,
  maxFail: 0,
}, null, 2)}\n`;
const mathSource = `export function add(left, right) {
  return left + right;
}

export function double(value) {
  return value * 2;
}
`;
const passingTestSource = `import assert from 'node:assert/strict';
import { test } from 'node:test';
import { add, double } from './math.js';

test('add returns the sum', () => {
  assert.equal(add(2, 3), 5);
});

test('double returns twice the value', () => {
  assert.equal(double(3), 6);
});
`;
const failingTestSource = passingTestSource.replace('assert.equal(double(3), 6);', 'assert.equal(double(3), 5);');

interface GateResult {
  readonly title: string;
  readonly tests: number;
  readonly pass: number;
  readonly fail: number;
  readonly exitCode: number | null;
  readonly passed: boolean;
  readonly reasons: readonly string[];
}

interface CommandFeedback {
  readonly exitCode: number | null;
  readonly stdout: string;
}

export interface D032DemoStep {
  readonly id: string;
  readonly name: string;
  readonly arguments: string;
  readonly result: string;
  readonly resultSummary: string;
  readonly isError: boolean;
}

export interface D032DemoReport {
  readonly provider: string;
  readonly registeredTools: readonly string[];
  readonly toolNames: readonly string[];
  readonly steps: readonly D032DemoStep[];
  readonly finalText: string;
  readonly finalReport: string;
  readonly sha256: string;
  readonly verificationMatched: boolean;
  readonly reportWritten: boolean;
  readonly stopReason: string;
  readonly turns: number;
  readonly workspace: string;
  readonly workspaceRemoved: boolean;
}

export interface D032DemoOptions {
  readonly fixture?: 'passing' | 'failing';
}

function toolResponse(id: string, name: string, args: unknown): ChatResult {
  return {
    text: '',
    model: providerName,
    toolCalls: [{ id, name, arguments: JSON.stringify(args) }],
  };
}

function textResponse(text: string): ChatResult {
  return { text, model: providerName };
}

function contentFromHistory(messages: readonly Message[], toolCallId: string): string {
  const message = messages.find(
    (candidate) => candidate.role === 'tool' && candidate.toolCallId === toolCallId,
  );
  if (message === undefined) throw new Error(`模型上下文缺少 ${toolCallId} 的真实工具结果`);
  return message.content;
}

function createD032Provider(command: string): ModelProvider {
  let turn = 0;
  return {
    name: providerName,
    chat(request: ChatRequest) {
      turn += 1;
      switch (turn) {
        case 1:
          return Promise.resolve(toolResponse('list-workspace', 'list_dir', { path: '.' }));
        case 2:
          return Promise.resolve(toolResponse('read-gate', 'read_file', { path: 'quality-gate.json' }));
        case 3:
          return Promise.resolve(toolResponse('run-tests', 'run_command', { command, timeoutMs: 10_000 }));
        case 4:
          return Promise.resolve(toolResponse('parse-tests', 'parse_tap_output', {
            commandResultJson: contentFromHistory(request.messages, 'run-tests'),
          }));
        case 5:
          return Promise.resolve(toolResponse('evaluate-gate', 'evaluate_test_gate', {
            configJson: contentFromHistory(request.messages, 'read-gate'),
            summaryJson: contentFromHistory(request.messages, 'parse-tests'),
          }));
        case 6: {
          const gate = JSON.parse(contentFromHistory(request.messages, 'evaluate-gate')) as GateResult;
          return Promise.resolve(gate.passed
            ? toolResponse('render-report', 'render_release_report', {
                gateResultJson: contentFromHistory(request.messages, 'evaluate-gate'),
              })
            : textResponse(`发布门禁未通过：${gate.reasons.join('；')}。未生成报告。`));
        }
        case 7:
          return Promise.resolve(toolResponse('hash-report', 'sha256_text', {
            text: contentFromHistory(request.messages, 'render-report'),
          }));
        case 8:
          return Promise.resolve(toolResponse('write-report', 'write_file', {
            path: reportPath,
            content: contentFromHistory(request.messages, 'render-report'),
          }));
        case 9: {
          const hash = JSON.parse(contentFromHistory(request.messages, 'hash-report')) as { sha256: string };
          return Promise.resolve(toolResponse('verify-report', 'verify_file_sha256', {
            path: reportPath,
            expectedSha256: hash.sha256,
          }));
        }
        case 10: {
          const gate = JSON.parse(contentFromHistory(request.messages, 'evaluate-gate')) as GateResult;
          const hash = JSON.parse(contentFromHistory(request.messages, 'hash-report')) as { sha256: string };
          return Promise.resolve(textResponse(
            `发布门禁通过：${gate.pass}/${gate.tests} 项测试通过，${reportPath} 已写入并校验 SHA-256（${hash.sha256}）。`,
          ));
        }
        default:
          return Promise.reject(new Error('D032 脚本没有更多响应'));
      }
    },
  };
}

function summarize(content: string): string {
  const compact = content.replace(/\s+/g, ' ').trim();
  return compact.length <= 240 ? compact : `${compact.slice(0, 237)}...`;
}

export async function runD032Demo(
  output: (line: string) => void,
  options: D032DemoOptions = {},
): Promise<D032DemoReport> {
  const fixture = options.fixture ?? 'passing';
  const workspace = mkdtempSync(join(tmpdir(), 'personal-agent-d032-demo-'));
  let pendingReport!: Omit<D032DemoReport, 'workspaceRemoved'>;
  try {
    writeFileSync(join(workspace, 'package.json'), '{"type":"module"}\n', 'utf8');
    writeFileSync(join(workspace, 'math.js'), mathSource, 'utf8');
    writeFileSync(
      join(workspace, 'release.test.js'),
      fixture === 'failing' ? failingTestSource : passingTestSource,
      'utf8',
    );
    writeFileSync(join(workspace, 'quality-gate.json'), qualityConfig, 'utf8');

    const registry = new ToolRegistry();
    for (const tool of createD032Tools()) registry.register(tool);
    const registeredTools = registry.list().map((tool) => tool.name);
    if (registeredTools.length !== 10) throw new Error('D032 必须恰好注册 10 个工具');

    const command = `${JSON.stringify(process.execPath)} --test --test-reporter=tap release.test.js`;
    const errorByCallId = new Map<string, boolean>();
    output('D032 确定性离线 Demo：不请求网络、不需要 API Key；ModelProvider 只编排调用，工具结果全部来自真实 AgentLoop + ToolRegistry。');
    output(`注册工具（10）：${registeredTools.join('、')}`);
    const result = await runAgentLoop({
      provider: createD032Provider(command),
      registry,
      messages: [
        { role: 'system', content: '读取门禁配置，运行测试；只有门禁通过才能渲染、写入并校验发布报告。' },
        { role: 'user', content: '完成临时项目的发布验收，展示工具之间真实的数据依赖。' },
      ],
      maxTurns: 10,
      maxTokens: 512,
      workspaceRoot: workspace,
      eventSink: {
        emit(event) {
          if (event.type === 'tool_call_finished') {
            errorByCallId.set(event.toolCallId, event.isError);
          }
        },
      },
    });

    const toolMessages = result.messages.filter((message) => message.role === 'tool');
    const steps: D032DemoStep[] = [];
    for (const message of result.messages) {
      if (message.role !== 'assistant') continue;
      for (const call of message.toolCalls ?? []) {
        const toolMessage = toolMessages.find((candidate) => candidate.toolCallId === call.id);
        if (toolMessage === undefined) throw new Error(`缺少 ${call.id} 的工具结果消息`);
        steps.push({
          id: call.id,
          name: call.name,
          arguments: call.arguments,
          result: toolMessage.content,
          resultSummary: summarize(toolMessage.content),
          isError: errorByCallId.get(call.id) === true,
        });
      }
    }
    const toolNames = steps.map((step) => step.name);
    const contentFor = (id: string): string => {
      const step = steps.find((candidate) => candidate.id === id);
      if (step === undefined) throw new Error(`缺少 ${id} 的步骤记录`);
      return step.result;
    };
    const commandFeedback = JSON.parse(contentFor('run-tests')) as CommandFeedback;
    const gate = JSON.parse(contentFor('evaluate-gate')) as GateResult;
    const absoluteReportPath = join(workspace, reportPath);
    const reportWritten = existsSync(absoluteReportPath);
    const finalReport = reportWritten ? readFileSync(absoluteReportPath, 'utf8') : '';
    const hash = fixture === 'passing'
      ? (JSON.parse(contentFor('hash-report')) as { sha256: string }).sha256
      : '';
    const verificationMatched = fixture === 'passing'
      ? (JSON.parse(contentFor('verify-report')) as { matched: boolean }).matched
      : false;

    const expectedTools = fixture === 'passing'
      ? 'list_dir,read_file,run_command,parse_tap_output,evaluate_test_gate,render_release_report,sha256_text,write_file,verify_file_sha256'
      : 'list_dir,read_file,run_command,parse_tap_output,evaluate_test_gate';
    const assertionsPassed = fixture === 'passing'
      ? result.stopReason === 'completed'
        && result.turns === 10
        && toolNames.join(',') === expectedTools
        && commandFeedback.exitCode === 0
        && gate.passed
        && reportWritten
        && finalReport === contentFor('render-report')
        && verificationMatched
        && result.text.includes(hash)
      : result.stopReason === 'completed'
        && result.turns === 6
        && toolNames.join(',') === expectedTools
        && commandFeedback.exitCode === 1
        && !gate.passed
        && !reportWritten
        && finalReport === ''
        && result.text.includes('未生成报告');
    if (!assertionsPassed) throw new Error('D032 Demo 的真实工具顺序、数据依赖或发布门禁断言未通过');

    for (const [index, step] of steps.entries()) {
      output(`[${String(index + 1).padStart(2, '0')}] ${step.name}`);
      output(`  参数摘要：${summarize(step.arguments)}`);
      output(`  结果摘要：${step.resultSummary}${step.isError ? '（工具错误已回喂 Loop）' : ''}`);
    }
    output(`最终回答：${result.text}`);
    if (fixture === 'passing') {
      output(`发布报告内容：\n${finalReport.trimEnd()}`);
      output('D032 Demo PASS：9 个不同工具完成真实串联，报告已写入并通过 SHA-256 校验；临时工作区已清理。');
    } else {
      output('质量门禁未通过，未写入报告；失败命令与门禁原因已保留，临时工作区已清理。');
    }
    pendingReport = {
      provider: providerName,
      registeredTools,
      toolNames,
      steps,
      finalText: result.text,
      finalReport,
      sha256: hash,
      verificationMatched,
      reportWritten,
      stopReason: result.stopReason,
      turns: result.turns,
      workspace,
    };
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }

  const report: D032DemoReport = { ...pendingReport, workspaceRemoved: !existsSync(workspace) };
  if (!report.workspaceRemoved) throw new Error('D032 Demo 临时工作区清理失败');
  return report;
}
