import { createInterface, type Interface as ReadlineInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';

import { MCP_PROTOCOL_VERSION, type McpServerInfo } from './mcp-stdio-client.ts';
import type { ToolResult } from '../core/tool.ts';
import type { ToolRegistry } from '../tools/registry.ts';

type JsonObject = Record<string, unknown>;
type RequestId = string | number;

export interface McpStdioServerOptions {
  readonly registry: ToolRegistry;
  readonly toolNames: readonly string[];
  readonly workspaceRoot: string;
  readonly input: Readable;
  readonly output: Writable;
  readonly errorOutput: Writable;
  readonly serverInfo: McpServerInfo;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRequestId(value: unknown): value is RequestId {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
}

function requestKey(id: RequestId): string {
  return `${typeof id}:${String(id)}`;
}

interface ActiveCall {
  readonly controller: AbortController;
  cancelled: boolean;
}

export class McpStdioServer {
  private readonly options: McpStdioServerOptions;
  private readonly closedPromise: Promise<void>;
  private resolveClosed!: () => void;
  private lines?: ReadlineInterface;
  private started = false;
  private closed = false;
  private initializeReceived = false;
  private initialized = false;
  private readonly activeCalls = new Map<string, ActiveCall>();

  constructor(options: McpStdioServerOptions) {
    this.options = options;
    this.closedPromise = new Promise<void>((resolve) => {
      this.resolveClosed = resolve;
    });
  }

  start(): Promise<void> {
    if (this.started) throw new Error('MCP Server 已启动');
    this.started = true;
    this.lines = createInterface({ input: this.options.input, crlfDelay: Infinity });
    this.lines.on('line', this.onLine);
    this.lines.once('close', this.close);
    return this.closedPromise;
  }

  private readonly onLine = (line: string): void => {
    if (this.closed) return;
    let message: unknown;
    try {
      message = JSON.parse(line) as unknown;
    } catch {
      this.options.errorOutput.write('MCP JSON parse error\n');
      this.sendError(null, -32700, 'Parse error');
      return;
    }
    if (!isObject(message) || message['jsonrpc'] !== '2.0') {
      const id = isObject(message) && isRequestId(message['id']) ? message['id'] : null;
      this.sendError(id, -32600, 'Invalid JSON-RPC request');
      return;
    }

    const id = message['id'];
    const method = message['method'];
    if (method === undefined && (message['result'] !== undefined || message['error'] !== undefined)) {
      return;
    }
    if (typeof method !== 'string' || (id !== undefined && !isRequestId(id))) {
      this.sendError(isRequestId(id) ? id : null, -32600, 'Invalid JSON-RPC request');
      return;
    }

    const notification = id === undefined;
    if (method === 'notifications/initialized') {
      if (this.initializeReceived) this.initialized = true;
      return;
    }
    if (method === 'notifications/cancelled') {
      const params = message['params'];
      const requestId = isObject(params) ? params['requestId'] : undefined;
      if (isRequestId(requestId)) {
        const active = this.activeCalls.get(requestKey(requestId));
        if (active !== undefined) {
          active.cancelled = true;
          active.controller.abort();
        }
      }
      return;
    }
    if (method.startsWith('notifications/')) return;
    if (notification) return;

    if (method === 'initialize') {
      this.initialize(id, message['params']);
      return;
    }
    if (method === 'ping') {
      this.sendResult(id, {});
      return;
    }
    if (method === 'tools/list') {
      if (!this.requireInitialized(id)) return;
      if (message['params'] !== undefined && !isObject(message['params'])) {
        this.sendError(id, -32602, 'Invalid tools/list params');
        return;
      }
      this.listTools(id);
      return;
    }
    if (method === 'tools/call') {
      if (!this.requireInitialized(id)) return;
      this.callTool(id, message['params']);
      return;
    }
    this.sendError(id, -32601, `Method not found: ${method}`);
  };

  private initialize(id: RequestId, params: unknown): void {
    if (this.initializeReceived) {
      this.sendError(id, -32600, 'initialize 已完成，不能重复调用');
      return;
    }
    if (!this.validInitializeParams(params)) {
      this.sendError(id, -32602, 'Invalid initialize params');
      return;
    }
    this.initializeReceived = true;
    this.sendResult(id, {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: this.options.serverInfo,
    });
  }

  private validInitializeParams(params: unknown): boolean {
    if (!isObject(params) || typeof params['protocolVersion'] !== 'string') return false;
    if (!isObject(params['capabilities']) || !isObject(params['clientInfo'])) return false;
    const clientInfo = params['clientInfo'];
    return typeof clientInfo['name'] === 'string' && typeof clientInfo['version'] === 'string';
  }

  private requireInitialized(id: RequestId): boolean {
    if (this.initialized) return true;
    this.sendError(id, -32000, 'Server not initialized');
    return false;
  }

  private listTools(id: RequestId): void {
    this.sendResult(id, {
      tools: this.options.toolNames.flatMap((name) => {
        const tool = this.options.registry.describe(name);
        return tool === undefined
          ? []
          : [{ name: tool.name, description: tool.description, inputSchema: tool.parameters }];
      }),
    });
  }

  private callTool(id: RequestId, params: unknown): void {
    if (!isObject(params) || typeof params['name'] !== 'string') {
      this.sendError(id, -32602, 'Invalid tools/call params');
      return;
    }
    const name = params['name'];
    const args = params['arguments'] ?? {};
    if (!isObject(args)) {
      this.sendError(id, -32602, 'tools/call arguments 必须是 JSON object');
      return;
    }
    if (!this.options.toolNames.includes(name) || this.options.registry.describe(name) === undefined) {
      this.sendError(id, -32602, `Unknown tool: ${name}`);
      return;
    }

    const key = requestKey(id);
    const active: ActiveCall = { controller: new AbortController(), cancelled: false };
    this.activeCalls.set(key, active);
    void this.options.registry
      .execute({ id: `mcp:${requestKey(id)}`, name, arguments: JSON.stringify(args) }, {
        workspaceRoot: this.options.workspaceRoot,
        signal: active.controller.signal,
      })
      .then((result) => {
        if (this.activeCalls.get(key) === active && !active.cancelled) {
          this.sendResult(id, this.toolResult(result));
        }
      })
      .catch(() => {
        if (this.activeCalls.get(key) === active && !active.cancelled) {
          this.sendError(id, -32603, 'Internal error');
        }
      })
      .finally(() => {
        if (this.activeCalls.get(key) === active) this.activeCalls.delete(key);
      });
  }

  private toolResult(result: ToolResult): JsonObject {
    return {
      content: [{ type: 'text', text: result.content }],
      isError: result.isError === true,
      ...(result.error === undefined ? {} : { structuredContent: { error: result.error } }),
    };
  }

  private sendResult(id: RequestId, result: JsonObject): void {
    if (!this.closed) this.options.output.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
  }

  private sendError(id: RequestId | null, code: number, message: string): void {
    if (!this.closed) {
      this.options.output.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })}\n`);
    }
  }

  readonly close = (): void => {
    if (this.closed) return;
    this.closed = true;
    this.lines?.off('line', this.onLine);
    for (const active of this.activeCalls.values()) {
      active.cancelled = true;
      active.controller.abort();
    }
    this.activeCalls.clear();
    this.resolveClosed();
  };
}
