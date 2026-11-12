import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it } from 'vitest';

import { McpStdioServer } from '../src/adapters/mcp-stdio-server.ts';
import type { ToolCall } from '../src/core/message.ts';
import type { Tool, ToolContext, ToolResult } from '../src/core/tool.ts';
import { ToolRegistry } from '../src/tools/registry.ts';

type JsonObject = Record<string, unknown>;

class ServerHarness {
  readonly input = new PassThrough();
  readonly output = new PassThrough();
  readonly errorOutput = new PassThrough();
  readonly server: McpStdioServer;
  readonly running: Promise<void>;
  private wire = '';

  constructor(registry = new ToolRegistry(), toolNames: readonly string[] = []) {
    this.output.setEncoding('utf8');
    this.output.on('data', (chunk: string) => {
      this.wire += chunk;
    });
    this.server = new McpStdioServer({
      registry,
      toolNames,
      workspaceRoot: '/tmp/d036-test-workspace',
      input: this.input,
      output: this.output,
      errorOutput: this.errorOutput,
      serverInfo: { name: 'd036-test-server', version: '0.1.0' },
    });
    this.running = this.server.start();
  }

  send(message: JsonObject): void {
    this.raw(`${JSON.stringify(message)}\n`);
  }

  raw(frame: string): void {
    this.input.write(frame);
  }

  async flush(): Promise<void> {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  messages(): JsonObject[] {
    return this.wire
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as JsonObject);
  }

  takeMessages(): JsonObject[] {
    const messages = this.messages();
    this.wire = '';
    return messages;
  }

  async close(): Promise<void> {
    if (!this.input.destroyed) this.input.end();
    await this.running;
  }
}

const harnesses: ServerHarness[] = [];

function createHarness(registry?: ToolRegistry, toolNames?: readonly string[]): ServerHarness {
  const harness = new ServerHarness(registry, toolNames);
  harnesses.push(harness);
  return harness;
}

function initialize(id: number | string = 1, protocolVersion = '2025-11-25'): JsonObject {
  return {
    jsonrpc: '2.0',
    id,
    method: 'initialize',
    params: {
      protocolVersion,
      capabilities: {},
      clientInfo: { name: 'raw-test-client', version: '1.0.0' },
    },
  };
}

async function ready(harness: ServerHarness): Promise<void> {
  harness.send(initialize());
  harness.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  await harness.flush();
  harness.takeMessages();
}

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map(async (harness) => harness.close()));
});

describe('D036 MCP stdio Server 生命周期', () => {
  it('initialize 返回协商版本、tools capabilities 与 serverInfo，initialized 不回复', async () => {
    const harness = createHarness();

    harness.send(initialize('init-1'));
    harness.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    await harness.flush();

    expect(harness.messages()).toEqual([
      {
        jsonrpc: '2.0',
        id: 'init-1',
        result: {
          protocolVersion: '2025-11-25',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'd036-test-server', version: '0.1.0' },
        },
      },
    ]);
  });

  it('不支持客户端版本时返回本 Server 支持的 2025-11-25，ping 可在初始化前使用', async () => {
    const harness = createHarness();

    harness.send(initialize(1, '2024-11-05'));
    harness.send({ jsonrpc: '2.0', id: 'ping-1', method: 'ping' });
    await harness.flush();

    const messages = harness.messages();
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ id: 1, result: { protocolVersion: '2025-11-25' } });
    expect(messages[1]).toEqual({ jsonrpc: '2.0', id: 'ping-1', result: {} });
  });

  it('initialized 之前拒绝业务请求，重复 initialize 返回 Invalid Request', async () => {
    const harness = createHarness();

    harness.send({ jsonrpc: '2.0', id: 'early', method: 'tools/list', params: {} });
    await harness.flush();
    const earlyResponse = harness.takeMessages();
    await ready(harness);
    harness.send(initialize('duplicate'));
    await harness.flush();

    expect([...earlyResponse, ...harness.messages()]).toEqual([
      {
        jsonrpc: '2.0',
        id: 'early',
        error: { code: -32000, message: 'Server not initialized' },
      },
      {
        jsonrpc: '2.0',
        id: 'duplicate',
        error: { code: -32600, message: 'initialize 已完成，不能重复调用' },
      },
    ]);
  });
});

describe('D036 ToolRegistry 适配', () => {
  const parameters: Tool['parameters'] = {
    type: 'object',
    properties: { message: { type: 'string', description: '要回显的文字' } },
    required: ['message'],
  };

  function registryWithEcho(
    execute?: Tool['execute'],
    registry = new ToolRegistry(),
  ): ToolRegistry {
    registry.register({
      name: 'workspace_echo',
      description: '回显工作区消息',
      parameters,
      execute: execute ?? (() => Promise.resolve({ content: 'echo' })),
    });
    return registry;
  }

  it('tools/list 保留 name、description，并把 parameters 暴露为 inputSchema', async () => {
    const harness = createHarness(registryWithEcho(), ['workspace_echo']);
    await ready(harness);

    harness.send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    await harness.flush();

    expect(harness.messages()).toEqual([
      {
        jsonrpc: '2.0',
        id: 2,
        result: {
          tools: [{ name: 'workspace_echo', description: '回显工作区消息', inputSchema: parameters }],
        },
      },
    ]);
  });

  it('tools/call 把对象序列化为 JSON 字符串并真实执行 Registry', async () => {
    class CapturingRegistry extends ToolRegistry {
      receivedCall?: ToolCall;

      override execute(toolCall: ToolCall, context: ToolContext): Promise<ToolResult> {
        this.receivedCall = toolCall;
        return super.execute(toolCall, context);
      }
    }

    let receivedWorkspace = '';
    const registry = new CapturingRegistry();
    registryWithEcho((_args, context) => {
      receivedWorkspace = context.workspaceRoot;
      return Promise.resolve({ content: '真实 Registry 结果' });
    }, registry);
    const harness = createHarness(registry, ['workspace_echo']);
    await ready(harness);

    harness.send({
      jsonrpc: '2.0',
      id: 'call-1',
      method: 'tools/call',
      params: { name: 'workspace_echo', arguments: { message: '你好', count: 2 } },
    });
    await harness.flush();

    expect(registry.receivedCall?.arguments).toBe('{"message":"你好","count":2}');
    expect(receivedWorkspace).toBe('/tmp/d036-test-workspace');
    expect(harness.messages()).toEqual([
      {
        jsonrpc: '2.0',
        id: 'call-1',
        result: {
          content: [{ type: 'text', text: '真实 Registry 结果' }],
          isError: false,
        },
      },
    ]);
  });

  it('Registry Schema 与业务失败映射为 isError，并保留结构化错误', async () => {
    const harness = createHarness(registryWithEcho(), ['workspace_echo']);
    await ready(harness);

    harness.send({
      jsonrpc: '2.0',
      id: 'schema-error',
      method: 'tools/call',
      params: { name: 'workspace_echo', arguments: { message: 42 } },
    });
    await harness.flush();

    const [response] = harness.messages();
    expect(response).toMatchObject({
      jsonrpc: '2.0',
      id: 'schema-error',
      result: {
        isError: true,
        structuredContent: { error: { code: 'INVALID_ARGUMENTS' } },
      },
    });
    expect(JSON.stringify(response)).toContain('message');
  });

  it('未知工具和外层非法参数是协议错误，未授权工具与未知工具同等不可见', async () => {
    const registry = registryWithEcho();
    registry.register({
      name: 'hidden',
      description: '隐藏',
      parameters,
      execute: () => Promise.resolve({ content: 'no' }),
    });
    const harness = createHarness(registry, ['workspace_echo']);
    await ready(harness);

    for (const [id, params] of [
      ['unknown', { name: 'missing', arguments: {} }],
      ['bad-arguments', { name: 'workspace_echo', arguments: 'not-an-object' }],
      ['hidden', { name: 'hidden', arguments: { message: 'secret' } }],
    ] as const) {
      harness.send({ jsonrpc: '2.0', id, method: 'tools/call', params });
    }
    await harness.flush();

    expect(harness.messages()).toEqual([
      {
        jsonrpc: '2.0',
        id: 'unknown',
        error: { code: -32602, message: 'Unknown tool: missing' },
      },
      {
        jsonrpc: '2.0',
        id: 'bad-arguments',
        error: { code: -32602, message: 'tools/call arguments 必须是 JSON object' },
      },
      {
        jsonrpc: '2.0',
        id: 'hidden',
        error: { code: -32602, message: 'Unknown tool: hidden' },
      },
    ]);
  });

  it('Registry 的敏感工具拒绝保留为工具错误而不是协议错误', async () => {
    const registry = new ToolRegistry();
    registry.register(
      { name: 'sensitive', description: '需授权', parameters, execute: () => Promise.resolve({ content: 'no' }) },
      { sensitive: true },
    );
    const harness = createHarness(registry, ['sensitive']);
    await ready(harness);

    harness.send({
      jsonrpc: '2.0',
      id: 'denied',
      method: 'tools/call',
      params: { name: 'sensitive', arguments: { message: 'x' } },
    });
    await harness.flush();

    expect(harness.messages()[0]).toMatchObject({
      id: 'denied',
      result: {
        isError: true,
        structuredContent: { error: { code: 'TOOL_CONFIRMATION_REQUIRED' } },
      },
    });
  });
});

describe('D036 JSON-RPC 边界', () => {
  it('未知方法返回 Method not found，通知即使未知也不回复', async () => {
    const harness = createHarness();
    await ready(harness);

    harness.send({ jsonrpc: '2.0', id: 'unknown', method: 'no/suchMethod' });
    harness.send({ jsonrpc: '2.0', method: 'no/suchNotification' });
    harness.send({ jsonrpc: '2.0', id: 'orphan', result: {} });
    await harness.flush();

    expect(harness.messages()).toEqual([
      {
        jsonrpc: '2.0',
        id: 'unknown',
        error: { code: -32601, message: 'Method not found: no/suchMethod' },
      },
    ]);
  });

  it('非法 initialize 参数返回 Invalid params，非法 JSON-RPC 信封返回 Invalid Request', async () => {
    const harness = createHarness();

    harness.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 25 } });
    harness.send({ jsonrpc: '1.0', id: 2, method: 'ping' });
    await harness.flush();

    expect(harness.messages()).toEqual([
      {
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32602, message: 'Invalid initialize params' },
      },
      {
        jsonrpc: '2.0',
        id: 2,
        error: { code: -32600, message: 'Invalid JSON-RPC request' },
      },
    ]);
  });

  it('畸形 JSON 返回 Parse error，跨 chunk 的后续 ndjson 仍能分帧处理', async () => {
    const harness = createHarness();

    harness.raw('{"jsonrpc":\n');
    harness.raw('{"jsonrpc":"2.0","id":"split","method":"pi');
    harness.raw('ng"}\n');
    await harness.flush();

    expect(harness.messages()).toEqual([
      { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } },
      { jsonrpc: '2.0', id: 'split', result: {} },
    ]);
  });

  it('tools/list 拒绝非法 params，未知取消 id 不产生响应', async () => {
    const harness = createHarness();
    await ready(harness);

    harness.send({ jsonrpc: '2.0', id: 'bad-list', method: 'tools/list', params: [] });
    harness.send({
      jsonrpc: '2.0',
      method: 'notifications/cancelled',
      params: { requestId: 'not-running', reason: 'client stopped' },
    });
    await harness.flush();

    expect(harness.messages()).toEqual([
      {
        jsonrpc: '2.0',
        id: 'bad-list',
        error: { code: -32602, message: 'Invalid tools/list params' },
      },
    ]);
  });
});

describe('D036 并发、取消与关闭', () => {
  function delayedRegistry(): ToolRegistry {
    const registry = new ToolRegistry();
    registry.register({
      name: 'delayed',
      description: '延迟回显',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string' },
          delayMs: { type: 'number' },
        },
        required: ['message', 'delayMs'],
      },
      execute: (rawArgs) => {
        const args = rawArgs as { message: string; delayMs: number };
        return new Promise((resolve) => {
          setTimeout(() => resolve({ content: args.message }), args.delayMs);
        });
      },
    });
    return registry;
  }

  it('多个 tools/call 并发执行，响应按完成顺序配对原 id', async () => {
    const harness = createHarness(delayedRegistry(), ['delayed']);
    await ready(harness);

    for (const [id, message, delayMs] of [
      ['slow', '慢结果', 40],
      ['fast', '快结果', 1],
    ] as const) {
      harness.send({
        jsonrpc: '2.0',
        id,
        method: 'tools/call',
        params: { name: 'delayed', arguments: { message, delayMs } },
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 70));

    expect(harness.messages().map((message) => message['id'])).toEqual(['fast', 'slow']);
    expect(harness.messages().map((message) => message['result'])).toEqual([
      { content: [{ type: 'text', text: '快结果' }], isError: false },
      { content: [{ type: 'text', text: '慢结果' }], isError: false },
    ]);
  });

  it('notifications/cancelled 传递真实 AbortSignal，取消请求不迟到回复也不阻塞 ping', async () => {
    let aborted = false;
    const registry = new ToolRegistry();
    registry.register({
      name: 'cancellable',
      description: '可取消任务',
      parameters: { type: 'object', properties: {} },
      execute: (_args, context) =>
        new Promise((resolve) => {
          context.signal?.addEventListener('abort', () => {
            aborted = true;
            resolve({ content: '已取消' });
          });
        }),
    });
    const harness = createHarness(registry, ['cancellable']);
    await ready(harness);

    harness.send({
      jsonrpc: '2.0',
      id: 'cancel-me',
      method: 'tools/call',
      params: { name: 'cancellable', arguments: {} },
    });
    harness.send({
      jsonrpc: '2.0',
      method: 'notifications/cancelled',
      params: { requestId: 'cancel-me', reason: '测试取消' },
    });
    harness.send({ jsonrpc: '2.0', id: 'still-alive', method: 'ping' });
    await harness.flush();

    expect(aborted).toBe(true);
    expect(harness.messages()).toEqual([
      { jsonrpc: '2.0', id: 'still-alive', result: {} },
    ]);
  });

  it('stdio 关闭会 abort 在途工具、清理任务且不再写响应', async () => {
    let aborted = false;
    const registry = new ToolRegistry();
    registry.register({
      name: 'closing',
      description: '关闭时清理',
      parameters: { type: 'object', properties: {} },
      execute: (_args, context) =>
        new Promise((resolve) => {
          context.signal?.addEventListener('abort', () => {
            aborted = true;
            resolve({ content: '关闭后不应发送' });
          });
        }),
    });
    const harness = createHarness(registry, ['closing']);
    await ready(harness);

    harness.send({
      jsonrpc: '2.0',
      id: 'closing-call',
      method: 'tools/call',
      params: { name: 'closing', arguments: {} },
    });
    await harness.flush();
    harness.input.end();
    await harness.running;
    await harness.flush();

    expect(aborted).toBe(true);
    expect(harness.messages()).toEqual([]);
  });
});
