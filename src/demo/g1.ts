import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ChatResult, ModelProvider } from '../adapters/model/provider.ts';
import { runAgentLoop } from '../runtime/loop.ts';
import { editFileTool } from '../tools/edit-file.ts';
import { readFileTool } from '../tools/fs.ts';
import { ToolRegistry } from '../tools/registry.ts';
import { runCommandTool } from '../tools/run-command.ts';

const providerName = 'deterministic-offline-script';
const defectiveSource = `export function add(left, right) {
  return left - right;
}
`;
const repairedSource = defectiveSource.replace('left - right', 'left + right');
const testSource = `import assert from 'node:assert/strict';
import { test } from 'node:test';
import { add } from './math.js';

test('add returns the sum', () => {
  assert.equal(add(2, 3), 5);
});
`;

interface CommandFeedback {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export interface G1DemoReport {
  readonly provider: string;
  readonly toolNames: readonly string[];
  readonly beforeExitCode: number | null;
  readonly beforeStdout: string;
  readonly afterExitCode: number | null;
  readonly afterStdout: string;
  readonly readContent: string;
  readonly editDiff: string;
  readonly finalSource: string;
  readonly stopReason: string;
  readonly turns: number;
  readonly workspace: string;
  readonly workspaceRemoved: boolean;
}

function toolResponse(id: string, name: string, args: unknown): ChatResult {
  return {
    text: '',
    model: providerName,
    toolCalls: [{ id, name, arguments: JSON.stringify(args) }],
  };
}

export async function runG1Demo(
  output: (line: string) => void,
): Promise<G1DemoReport> {
  const workspace = mkdtempSync(join(tmpdir(), 'personal-agent-g1-demo-'));
  let pendingReport!: Omit<G1DemoReport, 'workspaceRemoved'>;
  try {
    writeFileSync(join(workspace, 'package.json'), '{"type":"module"}\n', 'utf8');
    writeFileSync(join(workspace, 'math.js'), defectiveSource, 'utf8');
    writeFileSync(join(workspace, 'math.test.js'), testSource, 'utf8');

    const command = `${JSON.stringify(process.execPath)} --test math.test.js`;
    const responses: readonly ChatResult[] = [
      toolResponse('read-sample', 'read_file', { path: 'math.js' }),
      toolResponse('test-before', 'run_command', { command, timeoutMs: 10_000 }),
      toolResponse('repair-sample', 'edit_file', {
        path: 'math.js',
        oldText: 'return left - right;',
        newText: 'return left + right;',
      }),
      toolResponse('test-after', 'run_command', { command, timeoutMs: 10_000 }),
      {
        text: '离线修复完成：测试已从失败转为通过。',
        model: providerName,
      },
    ];
    let requestCount = 0;
    const provider: ModelProvider = {
      name: providerName,
      chat() {
        const response = responses[requestCount]!;
        requestCount += 1;
        return Promise.resolve(response);
      },
    };
    const registry = new ToolRegistry();
    for (const tool of [readFileTool, editFileTool, runCommandTool]) {
      registry.register(tool);
    }

    output('确定性离线 Demo：脚本化 ModelProvider 不请求网络、不需要 API Key；所有文件和命令均由真实工具执行。');
    const result = await runAgentLoop({
      provider,
      registry,
      messages: [
        { role: 'system', content: '按脚本读取、复现失败、精确修复并复测。' },
        { role: 'user', content: '修复临时工作区 math.js 的加法。' },
      ],
      maxTurns: 5,
      maxTokens: 256,
      workspaceRoot: workspace,
    });
    const toolMessages = result.messages.filter((message) => message.role === 'tool');
    const contentFor = (toolCallId: string): string => {
      return toolMessages.find((candidate) => candidate.toolCallId === toolCallId)!.content;
    };
    const readContent = contentFor('read-sample');
    const before = JSON.parse(contentFor('test-before')) as CommandFeedback;
    const editDiff = contentFor('repair-sample');
    const after = JSON.parse(contentFor('test-after')) as CommandFeedback;
    const finalSource = readFileSync(join(workspace, 'math.js'), 'utf8');
    const toolNames = toolMessages.map((message) => message.name!);
    const expectedTools = 'read_file,run_command,edit_file,run_command';
    const assertionsPassed = [
      result.stopReason === 'completed',
      toolNames.join(',') === expectedTools,
      readContent === defectiveSource,
      before.exitCode === 1,
      after.exitCode === 0,
      finalSource === repairedSource,
    ].every(Boolean);
    if (!assertionsPassed) {
      throw new Error('G1 Demo 未满足真实读取、先红、编辑、后绿与最终文件断言');
    }

    output(`[1/4] read_file 读取 math.js：\n${readContent.trimEnd()}`);
    output(`[2/4] run_command 修复前测试，exitCode=${String(before.exitCode)}（预期失败）：\n${before.stdout.trimEnd()}`);
    output(`[3/4] edit_file 真实修改：\n${editDiff.trimEnd()}`);
    output(`[4/4] run_command 修复后测试，exitCode=${String(after.exitCode)}（预期通过）：\n${after.stdout.trimEnd()}`);
    pendingReport = {
      provider: providerName,
      toolNames,
      beforeExitCode: before.exitCode,
      beforeStdout: before.stdout,
      afterExitCode: after.exitCode,
      afterStdout: after.stdout,
      readContent,
      editDiff,
      finalSource,
      stopReason: result.stopReason,
      turns: result.turns,
      workspace,
    };
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }

  const report: G1DemoReport = {
    ...pendingReport,
    workspaceRemoved: !existsSync(workspace),
  };
  if (!report.workspaceRemoved) throw new Error('G1 Demo 临时工作区清理失败');
  output(`最终 math.js：\n${report.finalSource.trimEnd()}`);
  output('断言通过：修复前测试 exitCode=1，修复后 exitCode=0，最终文件已改为加法。');
  output('G1 Demo PASS：真实 read_file → edit_file → run_command 工具链完成；临时工作区已清理。');
  return report;
}
