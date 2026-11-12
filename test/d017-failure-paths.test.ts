import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createOpenAICompatibleProvider,
  ModelError,
} from '../src/adapters/model/openai-compatible.ts';
import type {
  ChatRequest,
  ChatResult,
  ModelProvider,
} from '../src/adapters/model/provider.ts';
import type { AgentEvent } from '../src/core/event.ts';
import type { ToolCall } from '../src/core/message.ts';
import type { Tool, ToolContext, ToolResult } from '../src/core/tool.ts';
import { runAgentLoop } from '../src/runtime/loop.ts';
import { readFileTool } from '../src/tools/fs.ts';
import { ToolRegistry } from '../src/tools/registry.ts';
import { runCommandTool } from '../src/tools/run-command.ts';

const dirs: string[] = [];

function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pa-d017-'));
  dirs.push(dir);
  return dir;
}

function nodeCommand(source: string): string {
  return `${JSON.stringify(process.execPath)} -e ${JSON.stringify(source)}`;
}

class RecordingToolRegistry extends ToolRegistry {
  readonly results: ToolResult[] = [];

  override async execute(
    call: ToolCall,
    context: ToolContext,
  ): Promise<ToolResult> {
    const result = await super.execute(call, context);
    this.results.push(result);
    return result;
  }
}

function registryWith(tool: Tool): RecordingToolRegistry {
  const registry = new RecordingToolRegistry();
  registry.register(tool);
  return registry;
}

function scriptedProvider(results: readonly ChatResult[]): {
  provider: ModelProvider;
  requests: ChatRequest[];
} {
  const requests: ChatRequest[] = [];
  let index = 0;
  return {
    requests,
    provider: {
      name: 'scripted-d017',
      chat(request) {
        requests.push({ ...request, messages: [...request.messages] });
        const result = results[index];
        index += 1;
        return result === undefined
          ? Promise.reject(new Error('脚本里没有更多响应'))
          : Promise.resolve(result);
      },
    },
  };
}

function toolCall(name: string, args: unknown): ChatResult {
  return {
    text: '',
    model: 'scripted-d017',
    toolCalls: [{ id: `call-${name}`, name, arguments: JSON.stringify(args) }],
  };
}

function runLoop(
  provider: ModelProvider,
  registry: ToolRegistry,
  workspaceRoot: string,
  options: {
    signal?: AbortSignal;
    maxConsecutiveToolErrors?: number;
    eventSink?: { emit(event: AgentEvent): void };
  } = {},
) {
  return runAgentLoop({
    provider,
    registry,
    messages: [{ role: 'user', content: '执行失败路径矩阵场景' }],
    maxTurns: 4,
    maxTokens: 128,
    workspaceRoot,
    ...options,
  });
}

function providerWithFetch(
  fetchImpl: typeof fetch,
  timeoutMs?: number,
): ModelProvider {
  return createOpenAICompatibleProvider({
    baseUrl: 'http://provider.invalid/v1',
    apiKey: 'sk-fake-D017-not-a-real-key',
    model: 'scripted-provider',
    fetchImpl,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
}

async function expectProviderFailure(
  provider: ModelProvider,
  events: AgentEvent[],
): Promise<unknown> {
  const failure = await runLoop(provider, new ToolRegistry(), workspace(), {
    eventSink: { emit: (event) => events.push(event) },
  }).then(
    () => {
      throw new Error('预期 Provider 失败');
    },
    (error: unknown) => error,
  );

  expect(failure).toBeInstanceOf(ModelError);
  expect(events).toEqual([{ type: 'turn_started', turn: 1, messageCount: 1 }]);
  return failure;
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

describe('D017 失败路径测试矩阵：新增集成证据', () => {
  it('FP-01 文件失败保留 FILE_NOT_FOUND，错误回喂后正常完成', async () => {
    const { provider, requests } = scriptedProvider([
      toolCall('read_file', { path: 'missing.txt' }),
      { text: '已看到文件不存在', model: 'scripted-d017' },
    ]);
    const registry = registryWith(readFileTool);

    const result = await runLoop(provider, registry, workspace());

    expect(result.stopReason).toBe('completed');
    expect(registry.results[0]).toMatchObject({
      isError: true,
      error: { code: 'FILE_NOT_FOUND', retryable: true },
    });
    expect(requests[1]?.messages.at(-1)).toMatchObject({
      role: 'tool',
      toolCallId: 'call-read_file',
      name: 'read_file',
    });
    expect(requests[1]?.messages.at(-1)?.content).toContain(
      '文件不存在：missing.txt',
    );
    expect(requests[1]?.messages.at(-1)?.content).toContain('提示：请检查路径');
  });

  it('FP-02 命令非零退出保留 COMMAND_FAILED 与 JSON 输出并回喂', async () => {
    const command = nodeCommand("process.stdout.write('out');process.exit(7)");
    const { provider, requests } = scriptedProvider([
      toolCall('run_command', { command }),
      { text: '已看到命令退出码', model: 'scripted-d017' },
    ]);
    const registry = registryWith(runCommandTool);

    const result = await runLoop(provider, registry, workspace());

    expect(result.stopReason).toBe('completed');
    expect(registry.results[0]).toMatchObject({
      isError: true,
      error: { code: 'COMMAND_FAILED', retryable: true },
    });
    const feedback = requests[1]?.messages.at(-1);
    expect(feedback).toMatchObject({ role: 'tool', name: 'run_command' });
    expect(JSON.parse(feedback?.content ?? '{}')).toMatchObject({
      command,
      exitCode: 7,
      stdout: 'out',
      timedOut: false,
      cancelled: false,
    });
  });

  it('FP-03 未知工具异常脱敏为 INTERNAL_ERROR，不抛穿 Loop 或进入 Provider 历史', async () => {
    const fakeSecret = 'sk-fake-D017-tool-secret';
    const fragileTool: Tool = {
      name: 'fragile',
      description: '抛出带伪造敏感信息的未知异常',
      parameters: { type: 'object', properties: {} },
      execute: () => Promise.reject(new Error(`stack trace ${fakeSecret}`)),
    };
    const { provider, requests } = scriptedProvider([
      toolCall('fragile', {}),
      { text: '已看到脱敏错误', model: 'scripted-d017' },
    ]);
    const registry = registryWith(fragileTool);

    const result = await runLoop(provider, registry, workspace());

    expect(result.stopReason).toBe('completed');
    expect(registry.results[0]).toMatchObject({
      isError: true,
      error: {
        code: 'INTERNAL_ERROR',
        message: '工具执行失败，请检查输入后重试',
        retryable: true,
      },
    });
    expect(requests[1]?.messages.at(-1)?.content).toContain(
      '工具执行失败，请检查输入后重试',
    );
    expect(JSON.stringify(requests)).not.toContain(fakeSecret);
    expect(JSON.stringify(requests)).not.toContain('stack trace');
  });

  it('FP-04 Provider HTTP 失败以带 status 的 ModelError 抛穿，不生成工具结果', async () => {
    const events: AgentEvent[] = [];
    const provider = providerWithFetch(() =>
      Promise.resolve(new Response('unavailable', { status: 503 })),
    );

    const failure = await expectProviderFailure(provider, events);

    expect(failure).toMatchObject({ name: 'ModelError', status: 503 });
  });

  it('FP-05 Provider 协议失败保持 ModelError，不伪装成工具错误', async () => {
    const events: AgentEvent[] = [];
    const provider = providerWithFetch(() =>
      Promise.resolve(new Response('{ not json', { status: 200 })),
    );

    const failure = await expectProviderFailure(provider, events);

    expect(failure).toMatchObject({ name: 'ModelError' });
    expect((failure as Error).message).toContain('模型响应不是合法 JSON');
  });

  it('FP-06 Provider 内部超时保持 ModelError，而不是 cancelled 或 tool_errors', async () => {
    const events: AgentEvent[] = [];
    const pendingFetch: typeof fetch = (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => {
            const reason: unknown = init.signal?.reason;
            reject(
              reason instanceof Error ? reason : new Error(String(reason)),
            );
          },
          { once: true },
        );
      });
    const provider = providerWithFetch(pendingFetch, 5);

    const failure = await expectProviderFailure(provider, events);

    expect(failure).toMatchObject({ name: 'ModelError' });
    expect((failure as ModelError).cause).toBeDefined();
  });

  it('FP-07 工具执行期间外部取消优先于连续错误上限，以 cancelled 停止', async () => {
    const root = workspace();
    const controller = new AbortController();
    const events: AgentEvent[] = [];
    const command = nodeCommand(
      "require('node:fs').writeFileSync('started','yes');setTimeout(()=>{},5000)",
    );
    const { provider, requests } = scriptedProvider([
      toolCall('run_command', { command, timeoutMs: 30_000 }),
      { text: '不应请求第二轮', model: 'scripted-d017' },
    ]);
    const registry = registryWith(runCommandTool);

    const running = runLoop(provider, registry, root, {
      signal: controller.signal,
      maxConsecutiveToolErrors: 1,
      eventSink: { emit: (event) => events.push(event) },
    });
    for (
      let attempt = 0;
      attempt < 100 && !existsSync(join(root, 'started'));
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(existsSync(join(root, 'started'))).toBe(true);
    controller.abort();
    const result = await running;

    expect(result).toMatchObject({
      stopReason: 'cancelled',
      turns: 1,
      text: '',
    });
    expect(requests).toHaveLength(1);
    expect(registry.results[0]).toMatchObject({
      isError: true,
      error: { code: 'COMMAND_CANCELLED', retryable: false },
    });
    expect(JSON.parse(result.messages.at(-1)?.content ?? '{}')).toMatchObject({
      timedOut: false,
      cancelled: true,
    });
    expect(events.at(-1)).toEqual({ type: 'run_cancelled', turn: 1 });
    expect(events).not.toContainEqual({
      type: 'run_completed',
      turn: 1,
      stopReason: 'tool_errors',
    });
  });
});
