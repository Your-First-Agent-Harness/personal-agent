import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  ChatRequest,
  ChatResult,
  ModelProvider,
} from '../src/adapters/model/provider.ts';
import type { AgentEvent } from '../src/core/event.ts';
import type { ToolCall } from '../src/core/message.ts';
import type { ToolContext, ToolResult } from '../src/core/tool.ts';
import { runAgentLoop } from '../src/runtime/loop.ts';
import { editFileTool } from '../src/tools/edit-file.ts';
import { readFileTool } from '../src/tools/fs.ts';
import { ToolRegistry } from '../src/tools/registry.ts';
import { runCommandTool } from '../src/tools/run-command.ts';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const productionLoopPath = join(repositoryRoot, 'src/runtime/loop.ts');

const repairedBlock = [
  '      });',
  '      if (options.signal?.aborted) {',
  '        return cancelled(turn);',
  '      }',
  '      consecutiveToolErrors = toolResult.isError === true ? consecutiveToolErrors + 1 : 0;',
].join('\n');
const defectiveBlock = [
  '      });',
  '      consecutiveToolErrors = toolResult.isError === true ? consecutiveToolErrors + 1 : 0;',
].join('\n');

const regressionTestSource = [
  "import assert from 'node:assert/strict';",
  "import { existsSync, mkdtempSync, rmSync } from 'node:fs';",
  "import { tmpdir } from 'node:os';",
  "import { join } from 'node:path';",
  "import { test } from 'node:test';",
  "import { runAgentLoop } from './src/runtime/loop.ts';",
  "import { ToolRegistry } from './src/tools/registry.ts';",
  "import { runCommandTool } from './src/tools/run-command.ts';",
  '',
  "class RecordingRegistry extends ToolRegistry {",
  '  results = [];',
  '  async execute(call, context) {',
  '    const result = await super.execute(call, context);',
  '    this.results.push(result);',
  '    return result;',
  '  }',
  '}',
  '',
  "test('工具执行期间外部取消优先于连续工具错误上限', async () => {",
  "  const root = mkdtempSync(join(tmpdir(), 'pa-d018-regression-'));",
  '  const controller = new AbortController();',
  '  const events = [];',
  '  const requests = [];',
  '  const registry = new RecordingRegistry();',
  '  registry.register(runCommandTool);',
  '  const command = `${JSON.stringify(process.execPath)} -e ${JSON.stringify(',
  '    "require(\'node:fs\').writeFileSync(\'started\',\'yes\');setTimeout(()=>{},5000)",',
  '  )}`;',
  '  const provider = {',
  "    name: 'scripted-d018-regression',",
  '    chat(request) {',
  '      requests.push(request);',
  '      return Promise.resolve({',
  "        text: '',",
  "        model: 'scripted-d018-regression',",
  '        toolCalls: [{',
  "          id: 'cancel-command',",
  "          name: 'run_command',",
  '          arguments: JSON.stringify({ command, timeoutMs: 10_000 }),',
  '        }],',
  '      });',
  '    },',
  '  };',
  '',
  '  try {',
  '    const running = runAgentLoop({',
  '      provider,',
  '      registry,',
  "      messages: [{ role: 'user', content: '执行命令，等待外部取消。' }],",
  '      maxTurns: 2,',
  '      maxTokens: 64,',
  '      maxConsecutiveToolErrors: 1,',
  '      workspaceRoot: root,',
  '      signal: controller.signal,',
  '      eventSink: { emit: (event) => events.push(event) },',
  '    });',
  "    for (let attempt = 0; attempt < 100 && !existsSync(join(root, 'started')); attempt += 1) {",
  '      await new Promise((resolve) => setTimeout(resolve, 10));',
  '    }',
  "    assert.equal(existsSync(join(root, 'started')), true);",
  '    controller.abort();',
  '    const result = await running;',
  '',
  "    assert.equal(result.stopReason, 'cancelled');",
  '    assert.equal(result.turns, 1);',
  '    assert.equal(requests.length, 1);',
  "    assert.equal(registry.results[0].error.code, 'COMMAND_CANCELLED');",
  "    assert.equal(result.messages.at(-1).role, 'tool');",
  "    assert.equal(JSON.parse(result.messages.at(-1).content).cancelled, true);",
  "    assert.deepEqual(events.at(-1), { type: 'run_cancelled', turn: 1 });",
  '    assert.equal(events.some((event) =>',
  "      event.type === 'run_completed' && event.stopReason === 'tool_errors'), false);",
  '  } finally {',
  '    controller.abort();',
  '    rmSync(root, { recursive: true, force: true });',
  '  }',
  '});',
  '',
].join('\n');

interface CommandFeedback {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

interface ToolOutcome {
  readonly name: string;
  readonly isError: boolean;
  readonly code?: string;
}

class RecordingToolRegistry extends ToolRegistry {
  readonly outcomes: ToolOutcome[] = [];

  override async execute(call: ToolCall, context: ToolContext): Promise<ToolResult> {
    const result = await super.execute(call, context);
    this.outcomes.push({
      name: call.name,
      isError: result.isError === true,
      ...(result.error === undefined ? {} : { code: result.error.code }),
    });
    return result;
  }
}

function toolCall(id: string, name: string, args: unknown): ChatResult {
  return {
    text: '',
    model: 'scripted-d018',
    toolCalls: [{ id, name, arguments: JSON.stringify(args) }],
  };
}

function scriptedProvider(results: readonly ChatResult[]): {
  readonly provider: ModelProvider;
  readonly requests: ChatRequest[];
} {
  const requests: ChatRequest[] = [];
  let index = 0;
  return {
    requests,
    provider: {
      name: 'scripted-d018',
      chat(request) {
        requests.push(request);
        const result = results[index];
        index += 1;
        return result === undefined
          ? Promise.reject(new Error('脚本里没有更多响应'))
          : Promise.resolve(result);
      },
    },
  };
}

async function runDemo(tempRoot: string) {
  const productionLoop = readFileSync(productionLoopPath, 'utf8');
  if (productionLoop.split(repairedBlock).length !== 2) {
    throw new Error('生产 loop.ts 中未找到唯一的 D017 取消检查定位块');
  }
  const defectiveLoop = productionLoop.replace(repairedBlock, defectiveBlock);
  cpSync(join(repositoryRoot, 'src'), join(tempRoot, 'src'), { recursive: true });
  writeFileSync(
    join(tempRoot, 'package.json'),
    `${JSON.stringify({ type: 'module' }, null, 2)}\n`,
  );
  writeFileSync(join(tempRoot, 'regression.test.ts'), regressionTestSource);
  writeFileSync(join(tempRoot, 'src/runtime/loop.ts'), defectiveLoop);

  const command = `${JSON.stringify(process.execPath)} --test regression.test.ts`;
  const { provider, requests } = scriptedProvider([
    toolCall('read-loop', 'read_file', { path: 'src/runtime/loop.ts' }),
    toolCall('test-before', 'run_command', { command, timeoutMs: 20_000 }),
    toolCall('repair-loop', 'edit_file', {
      path: 'src/runtime/loop.ts',
      oldText: defectiveBlock,
      newText: repairedBlock,
    }),
    toolCall('test-after', 'run_command', { command, timeoutMs: 20_000 }),
    {
      text: '仓库回归修复完成：缺陷版测试失败，补回取消检查后测试通过。',
      model: 'scripted-d018',
    },
  ]);
  const registry = new RecordingToolRegistry();
  for (const tool of [readFileTool, runCommandTool, editFileTool]) {
    registry.register(tool);
  }
  const events: AgentEvent[] = [];
  const result = await runAgentLoop({
    provider,
    registry,
    messages: [
      {
        role: 'system',
        content: '读取真实源码，先运行回归测试，再精确编辑并复测。不要跳过失败证据。',
      },
      {
        role: 'user',
        content: '回放 D017 取消优先级缺陷：证明临时副本先红，再补回取消检查并变绿。',
      },
    ],
    maxTurns: 5,
    maxTokens: 256,
    maxContextChars: 40_000,
    maxConsecutiveToolErrors: 3,
    workspaceRoot: tempRoot,
    eventSink: { emit: (event) => events.push(event) },
  });

  const commandFeedback = (toolCallId: string): CommandFeedback => {
    const message = result.messages.find(
      (candidate) => candidate.role === 'tool' && candidate.toolCallId === toolCallId,
    );
    if (message === undefined) throw new Error(`缺少 ${toolCallId} 的工具历史`);
    return JSON.parse(message.content) as CommandFeedback;
  };
  const before = commandFeedback('test-before');
  const after = commandFeedback('test-after');
  const finalLoopSource = readFileSync(join(tempRoot, 'src/runtime/loop.ts'), 'utf8');
  const productionLoopUnchanged = readFileSync(productionLoopPath, 'utf8') === productionLoop;
  if (
    before.exitCode !== 1 ||
    after.exitCode !== 0 ||
    result.stopReason !== 'completed' ||
    finalLoopSource !== productionLoop ||
    !productionLoopUnchanged
  ) {
    throw new Error('D018 回放未满足先红、精确修复、后绿和生产源码不变的条件');
  }
  const lastEvent = events.at(-1);
  if (lastEvent?.type !== 'run_completed') throw new Error('外层 Loop 未正常完成');

  return {
    beforeExitCode: before.exitCode,
    beforeStdout: before.stdout,
    beforeStderr: before.stderr,
    afterExitCode: after.exitCode,
    afterStdout: after.stdout,
    afterStderr: after.stderr,
    finalLoopSource,
    productionLoopUnchanged,
    injectedDefect: defectiveLoop !== productionLoop && defectiveLoop.includes(defectiveBlock),
    stopReason: result.stopReason,
    turns: result.turns,
    finalText: result.text,
    providerRequests: requests.length,
    history: result.messages.slice(2).map((message) => message.role === 'assistant'
      ? `assistant:${message.toolCalls?.[0]?.id ?? 'final'}`
      : `tool:${message.toolCallId ?? 'missing'}:${message.name ?? 'missing'}`),
    toolOutcomes: registry.outcomes,
    lastEvent: `run_completed:${String(lastEvent.turn)}:${lastEvent.stopReason}`,
    tempRoot,
  };
}

const tempRoot = mkdtempSync(join(tmpdir(), 'pa-d018-real-repair-'));
let report: Awaited<ReturnType<typeof runDemo>>;
try {
  report = await runDemo(tempRoot);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify({
  ...report,
  tempRemoved: !existsSync(tempRoot),
}, null, 2)}\n`);
