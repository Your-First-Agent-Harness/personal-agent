import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import type { ChatRequest, ChatResult, ModelProvider } from '../src/adapters/model/provider.ts';
import type { AgentEvent } from '../src/core/event.ts';
import type { Tool, ToolResult } from '../src/core/tool.ts';
import { createLoggerEventSink } from '../src/observability/event-sink.ts';
import { createLogger } from '../src/observability/logger.ts';
import { runAgentLoop } from '../src/runtime/loop.ts';
import { editFileTool } from '../src/tools/edit-file.ts';
import { listDirTool, readFileTool } from '../src/tools/fs.ts';
import { ToolRegistry } from '../src/tools/registry.ts';
import { runCommandTool } from '../src/tools/run-command.ts';
import { writeFileTool } from '../src/tools/write-file.ts';

const dirs: string[] = [];

function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pa-tool-errors-'));
  dirs.push(dir);
  return dir;
}

function nodeCommand(source: string): string {
  return `${JSON.stringify(process.execPath)} -e ${JSON.stringify(source)}`;
}

async function executeInRegistry(tool: Tool, args: unknown, root: string): Promise<ToolResult> {
  const registry = new ToolRegistry();
  registry.register(tool);
  return registry.execute(
    { id: 'c1', name: tool.name, arguments: JSON.stringify(args) },
    { workspaceRoot: root },
  );
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

describe('文件与目录标准错误', () => {
  it('路径越界由 Registry 转成 PATH_OUTSIDE_WORKSPACE', async () => {
    const root = workspace();

    await expect(readFileTool.execute({ path: '../outside.txt' }, { workspaceRoot: root }))
      .rejects.toMatchObject({ name: 'ToolError', code: 'PATH_OUTSIDE_WORKSPACE' });
    const result = await executeInRegistry(readFileTool, { path: '../outside.txt' }, root);

    expect(result.error).toMatchObject({ code: 'PATH_OUTSIDE_WORKSPACE', retryable: true });
    expect(result.content).toContain('越出工作区');
    expect(result.error?.hint).toContain('工作区');
  });

  it('空路径是 INVALID_ARGUMENTS 而不是 INTERNAL_ERROR', async () => {
    const result = await executeInRegistry(readFileTool, { path: '' }, workspace());

    expect(result.error).toMatchObject({ code: 'INVALID_ARGUMENTS', retryable: true });
    expect(result.content).toContain('path');
  });

  it('read_file 区分文件不存在与非普通文件', async () => {
    const root = workspace();

    const missing = await readFileTool.execute({ path: 'missing.txt' }, { workspaceRoot: root });
    const directory = await readFileTool.execute({ path: '.' }, { workspaceRoot: root });

    expect(missing.error).toMatchObject({ code: 'FILE_NOT_FOUND', retryable: true });
    expect(missing.error?.hint).toContain('路径');
    expect(directory.error).toMatchObject({ code: 'NOT_A_FILE', retryable: true });
  });

  it('list_dir 区分目录不存在与非目录', async () => {
    const root = workspace();
    writeFileSync(join(root, 'a.txt'), 'a');

    const missing = await listDirTool.execute({ path: 'missing' }, { workspaceRoot: root });
    const file = await listDirTool.execute({ path: 'a.txt' }, { workspaceRoot: root });

    expect(missing.error).toMatchObject({ code: 'DIRECTORY_NOT_FOUND', retryable: true });
    expect(file.error).toMatchObject({ code: 'NOT_A_DIRECTORY', retryable: true });
  });

  it('write_file 默认覆盖返回 FILE_EXISTS 且原内容不变', async () => {
    const root = workspace();
    writeFileSync(join(root, 'a.txt'), 'old');

    const result = await writeFileTool.execute(
      { path: 'a.txt', content: 'new' },
      { workspaceRoot: root },
    );

    expect(result.error).toMatchObject({ code: 'FILE_EXISTS', retryable: true });
    expect(result.error?.hint).toContain('overwrite');
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('old');
  });

  it('write_file 父目录缺失或不是目录均为 PARENT_NOT_FOUND', async () => {
    const root = workspace();
    writeFileSync(join(root, 'parent.txt'), 'parent');

    const missing = await writeFileTool.execute(
      { path: 'missing/a.txt', content: 'new' },
      { workspaceRoot: root },
    );
    const notDirectory = await writeFileTool.execute(
      { path: 'parent.txt/a.txt', content: 'new' },
      { workspaceRoot: root },
    );

    expect(missing.error).toMatchObject({ code: 'PARENT_NOT_FOUND', retryable: true });
    expect(notDirectory.error).toMatchObject({ code: 'PARENT_NOT_FOUND', retryable: true });
    expect(readFileSync(join(root, 'parent.txt'), 'utf8')).toBe('parent');
  });
});

describe('edit_file 标准错误', () => {
  it('文件不存在与非文件不泄漏为 INTERNAL_ERROR', async () => {
    const root = workspace();

    const missing = await editFileTool.execute(
      { path: 'missing.txt', oldText: 'old', newText: 'new' },
      { workspaceRoot: root },
    );
    const directory = await editFileTool.execute(
      { path: '.', oldText: 'old', newText: 'new' },
      { workspaceRoot: root },
    );

    expect(missing.error?.code).toBe('FILE_NOT_FOUND');
    expect(directory.error?.code).toBe('NOT_A_FILE');
  });

  it('空 oldText 返回 INVALID_ARGUMENTS 且不改文件', async () => {
    const root = workspace();
    writeFileSync(join(root, 'a.txt'), 'old');

    const result = await editFileTool.execute(
      { path: 'a.txt', oldText: '', newText: 'new' },
      { workspaceRoot: root },
    );

    expect(result.error).toMatchObject({ code: 'INVALID_ARGUMENTS', retryable: true });
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('old');
  });

  it('零匹配和多匹配使用不同错误码且不改文件', async () => {
    const root = workspace();
    writeFileSync(join(root, 'a.txt'), 'same\nsame\n');

    const none = await editFileTool.execute(
      { path: 'a.txt', oldText: 'missing', newText: 'new' },
      { workspaceRoot: root },
    );
    const multiple = await editFileTool.execute(
      { path: 'a.txt', oldText: 'same', newText: 'new' },
      { workspaceRoot: root },
    );

    expect(none.error).toMatchObject({ code: 'EDIT_NO_MATCH', retryable: true });
    expect(multiple.error).toMatchObject({ code: 'EDIT_MULTIPLE_MATCHES', retryable: true });
    expect(multiple.error?.hint).toContain('oldText');
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('same\nsame\n');
  });

  it('超过 2000 行返回不可重试 DIFF_TOO_LARGE 且不改文件', async () => {
    const root = workspace();
    const before = Array.from({ length: 2001 }, (_, index) => `line${index}`).join('\n');
    writeFileSync(join(root, 'a.txt'), before);

    const result = await editFileTool.execute(
      { path: 'a.txt', oldText: before, newText: 'new' },
      { workspaceRoot: root },
    );

    expect(result.error).toMatchObject({ code: 'DIFF_TOO_LARGE', retryable: false });
    expect(result.error?.hint).toContain('2000');
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe(before);
  });
});

describe('run_command 标准错误', () => {
  it('非零退出返回 COMMAND_FAILED，Provider content 保留原 JSON 字段', async () => {
    const root = workspace();

    const result = await runCommandTool.execute(
      { command: nodeCommand("process.stdout.write('out');process.exit(7)") },
      { workspaceRoot: root },
    );
    const payload = JSON.parse(result.content) as Record<string, unknown>;

    expect(result.error).toMatchObject({ code: 'COMMAND_FAILED', retryable: true });
    expect(payload).toMatchObject({
      exitCode: 7,
      timedOut: false,
      cancelled: false,
      stdout: 'out',
      stdoutTruncated: false,
      stderrTruncated: false,
    });
    expect(payload).not.toHaveProperty('code');
    expect(payload).not.toHaveProperty('error');
  });

  it('spawn failure 返回 COMMAND_FAILED 并保留 stderr', async () => {
    const root = workspace();

    const result = await runCommandTool.execute(
      { command: nodeCommand('') },
      { workspaceRoot: join(root, 'missing') },
    );
    const payload = JSON.parse(result.content) as Record<string, unknown>;

    expect(result.error?.code).toBe('COMMAND_FAILED');
    expect(payload).toMatchObject({ exitCode: null, timedOut: false, cancelled: false });
    expect(payload.stderr).toContain('ENOENT');
  });

  it('超时返回 COMMAND_TIMEOUT', async () => {
    const result = await runCommandTool.execute(
      { command: nodeCommand('setTimeout(()=>{},5000)'), timeoutMs: 50 },
      { workspaceRoot: workspace() },
    );

    expect(result.error).toMatchObject({ code: 'COMMAND_TIMEOUT', retryable: true });
    expect(JSON.parse(result.content)).toMatchObject({ timedOut: true, cancelled: false });
  });

  it('外部取消返回不可重试 COMMAND_CANCELLED', async () => {
    const controller = new AbortController();
    const running = runCommandTool.execute(
      { command: nodeCommand('setTimeout(()=>{},5000)'), timeoutMs: 30_000 },
      { workspaceRoot: workspace(), signal: controller.signal },
    );
    controller.abort();
    const result = await running;

    expect(result.error).toMatchObject({ code: 'COMMAND_CANCELLED', retryable: false });
    expect(JSON.parse(result.content)).toMatchObject({ timedOut: false, cancelled: true });
  });

  it.each([0, 30_001])('timeoutMs 超出 Schema 能力时返回 INVALID_ARGUMENTS：%s', async (timeoutMs) => {
    const result = await runCommandTool.execute(
      { command: nodeCommand(''), timeoutMs },
      { workspaceRoot: workspace() },
    );

    expect(result.error).toMatchObject({ code: 'INVALID_ARGUMENTS', retryable: true });
  });

  it('空 command 返回 INVALID_ARGUMENTS', async () => {
    const result = await runCommandTool.execute(
      { command: '   ' },
      { workspaceRoot: workspace() },
    );

    expect(result.error?.code).toBe('INVALID_ARGUMENTS');
  });
});

function scriptedProvider(results: ChatResult[]): { provider: ModelProvider; requests: ChatRequest[] } {
  const requests: ChatRequest[] = [];
  let index = 0;
  return {
    requests,
    provider: {
      name: 'scripted',
      chat(request) {
        requests.push({ ...request, messages: [...request.messages] });
        const result = results[Math.min(index, results.length - 1)];
        index += 1;
        return result === undefined
          ? Promise.reject(new Error('脚本里没有更多响应'))
          : Promise.resolve(result);
      },
    },
  };
}

describe('连续工具错误保险丝', () => {
  it('默认连续三次错误后恰好请求 Provider 三次并以 tool_errors 停止', async () => {
    const { provider, requests } = scriptedProvider([{
      text: '',
      model: 'scripted',
      toolCalls: [{ id: 'c1', name: 'always_fail', arguments: '{}' }],
      usage: { inputTokens: 2, outputTokens: 1 },
    }]);
    const registry = new ToolRegistry();
    let executions = 0;
    registry.register({
      name: 'always_fail',
      description: '总是失败',
      parameters: { type: 'object' },
      execute: () => {
        executions += 1;
        return Promise.resolve({
          content: 'expected failure',
          isError: true,
          error: { code: 'COMMAND_FAILED', message: 'expected failure', retryable: true },
        });
      },
    });
    const events: AgentEvent[] = [];

    const result = await runAgentLoop({
      provider,
      registry,
      messages: [{ role: 'user', content: 'go' }],
      maxTurns: 10,
      maxTokens: 128,
      workspaceRoot: '.',
      eventSink: { emit: (event) => events.push(event) },
    });

    expect(result.stopReason).toBe('tool_errors');
    expect(result.turns).toBe(3);
    expect(result.text).toBe('');
    expect(result.usage).toEqual({ inputTokens: 6, outputTokens: 3 });
    expect(requests).toHaveLength(3);
    expect(executions).toBe(3);
    expect(result.messages).toHaveLength(7);
    expect(requests[1]?.messages.at(-1)).toMatchObject({
      role: 'tool',
      content: 'expected failure',
    });
    expect(events.at(-1)).toEqual({ type: 'run_completed', turn: 3, stopReason: 'tool_errors' });
  });

  it('同一轮成功工具清零，fail fail success fail fail fail 全部执行后停止', async () => {
    const sequence = ['fail', 'fail', 'success', 'fail', 'fail', 'fail'] as const;
    const { provider, requests } = scriptedProvider([{
      text: '',
      model: 'scripted',
      toolCalls: sequence.map((outcome, index) => ({
        id: `c${index}`,
        name: 'scripted_tool',
        arguments: JSON.stringify({ outcome }),
      })),
    }]);
    const registry = new ToolRegistry();
    const executions: string[] = [];
    registry.register({
      name: 'scripted_tool',
      description: '按参数成功或失败',
      parameters: {
        type: 'object',
        properties: { outcome: { enum: ['fail', 'success'] } },
        required: ['outcome'],
        additionalProperties: false,
      },
      execute(args) {
        const outcome = (args as { outcome: string }).outcome;
        executions.push(outcome);
        return Promise.resolve(outcome === 'fail'
          ? {
              content: `failure ${executions.length}`,
              isError: true,
              error: { code: 'COMMAND_FAILED', message: 'failure', retryable: true },
            }
          : { content: 'ok' });
      },
    });

    const result = await runAgentLoop({
      provider,
      registry,
      messages: [{ role: 'user', content: 'go' }],
      maxTurns: 10,
      maxTokens: 128,
      workspaceRoot: '.',
    });

    expect(executions).toEqual(sequence);
    expect(requests).toHaveLength(1);
    expect(result.stopReason).toBe('tool_errors');
    expect(result.turns).toBe(1);
    expect(result.text).toBe('');
    expect(result.messages.filter((message) => message.role === 'tool')).toHaveLength(6);
  });
});

describe('tool_errors 日志', () => {
  it('记录 loop.tool_errors warning，而不是正常 completed', () => {
    const lines: string[] = [];
    const logger = createLogger({ sink: (line) => lines.push(line) });
    const eventSink = createLoggerEventSink(logger);

    eventSink.emit({ type: 'run_completed', turn: 3, stopReason: 'tool_errors' });

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      level: 'warn',
      message: 'loop.tool_errors',
      turn: 3,
    });
    expect(lines[0]).not.toContain('loop.completed');
  });
});

describe('CLI 连续错误输出', () => {
  it('把配置传给 Loop，并在 tool_errors 时输出未收敛提示', async () => {
    let requests = 0;
    const server = createServer((request, response) => {
      request.resume();
      request.on('end', () => {
        requests += 1;
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({
          choices: [{
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [{
                id: `call-${requests}`,
                type: 'function',
                function: { name: 'missing_tool', arguments: '{}' },
              }],
            },
          }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('测试服务器未监听 TCP 端口');
    }

    const child = spawn(
      process.execPath,
      [fileURLToPath(new URL('../src/cli/main.ts', import.meta.url)), 'go'],
      {
        cwd: workspace(),
        env: {
          PATH: process.env['PATH'] ?? '',
          PA_LOG_LEVEL: 'error',
          PA_MODEL_API_KEY: 'sk-fake-D014-not-a-real-key',
          PA_MODEL_BASE_URL: `http://127.0.0.1:${address.port}`,
          PA_MODEL_NAME: 'scripted',
          PA_MAX_CONSECUTIVE_TOOL_ERRORS: '2',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error === undefined ? resolve() : reject(error));
    });

    expect({ exitCode, stdout, stderr }).toEqual({
      exitCode: 0,
      stdout: '连续工具错误达到上限，任务未收敛，请检查最后的工具错误。\n',
      stderr: '',
    });
    expect(requests).toBe(2);
  });
});
