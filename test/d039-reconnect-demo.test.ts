import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import {
  McpRpcError,
  StdioMcpClient,
  type McpCallToolResult,
  type McpInitializeResult,
  type McpTool,
} from '../src/adapters/mcp-stdio-client.ts';

const execFileAsync = promisify(execFile);
const serverPath = resolve('src/demo/d039-mcp-server.ts');
const initialization: McpInitializeResult = {
  protocolVersion: '2025-11-25',
  capabilities: { tools: { listChanged: false } },
  serverInfo: { name: 'd039-deterministic-test-server', version: '1.0.0' },
};
const remoteTools: readonly McpTool[] = [
  {
    name: 'echo',
    description: '返回消息和当前 Server PID',
    inputSchema: {
      type: 'object',
      properties: { message: { type: 'string' } },
      required: ['message'],
      additionalProperties: false,
    },
  },
  {
    name: 'disconnect',
    description: '仅用于演示的确定性传输故障',
    inputSchema: { type: 'object', additionalProperties: false },
  },
];

interface FakeClient {
  readonly client: {
    connect(): Promise<McpInitializeResult>;
    listAllTools(): Promise<readonly McpTool[]>;
    callTool(
      name: string,
      arguments_: Readonly<Record<string, unknown>>,
    ): Promise<McpCallToolResult>;
    close(): Promise<void>;
  };
  readonly calls: Array<{ name: string; arguments: Readonly<Record<string, unknown>> }>;
  isClosed(): boolean;
}

function fakeClient(disconnect: () => Promise<McpCallToolResult>): FakeClient {
  const calls: FakeClient['calls'] = [];
  let closed = false;
  return {
    calls,
    isClosed: () => closed,
    client: {
      connect: () => Promise.resolve(initialization),
      listAllTools: () => Promise.resolve(remoteTools),
      callTool: (name, arguments_) => {
        calls.push({ name, arguments: arguments_ });
        if (name === 'disconnect') return disconnect();
        return Promise.resolve({
          content: [{
            type: 'text',
            text: `D039 echo message=${JSON.stringify(arguments_['message'])} serverPid=100`,
          }],
          isError: false,
        });
      },
      close: () => {
        closed = true;
        return Promise.resolve();
      },
    },
  };
}

describe('D039 跨进程 MCP 故障与新 Client 恢复 Demo', () => {
  it('可运行入口使用默认 Client factory，并只在完整清理后报告 PASS', async () => {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [resolve('scripts/d039-reconnect.ts')],
      { env: { NO_COLOR: '1' }, timeout: 10_000 },
    );

    expect(stdout).toContain('notifications/initialized');
    expect(stdout).toContain('failureCode=TRANSPORT_ERROR');
    expect(stdout).toContain('failedCallReplayed=false');
    expect(stdout).toContain('cleanup clients=2 closed=true');
    expect(stdout).toContain('D039 PASS');
    expect(stderr).toBe('');
  }, 15_000);

  it('真实 stdio 握手和调用后，传输断开只发一次；关闭旧 Client 再以新进程完成独立调用', async () => {
    const { runD039Demo } = await import('../src/demo/d039.ts');
    const output: string[] = [];
    const calls: Array<{ client: number; name: string }> = [];
    let factoryCalls = 0;
    let firstClientClosed = false;

    const report = await runD039Demo((line) => output.push(line), {
      createClient: () => {
        factoryCalls += 1;
        const clientNumber = factoryCalls;
        if (clientNumber === 2) expect(firstClientClosed).toBe(true);
        const client = new StdioMcpClient({
          command: process.execPath,
          args: [serverPath],
          env: { NO_COLOR: '1' },
          requestTimeoutMs: 1_000,
          closeTimeoutMs: 100,
        });
        return {
          connect: () => client.connect(),
          listAllTools: () => client.listAllTools(),
          callTool: (name, arguments_, options) => {
            calls.push({ client: clientNumber, name });
            return client.callTool(name, arguments_, options);
          },
          close: async () => {
            await client.close();
            if (clientNumber === 1) firstClientClosed = true;
          },
        };
      },
    });

    expect(factoryCalls).toBe(2);
    expect(calls).toEqual([
      { client: 1, name: 'echo' },
      { client: 1, name: 'disconnect' },
      { client: 2, name: 'echo' },
    ]);
    expect(report.firstServerPid).not.toBe(process.pid);
    expect(report.recoveredServerPid).not.toBe(process.pid);
    expect(report.recoveredServerPid).not.toBe(report.firstServerPid);
    expect(report.failureCode).toBe('TRANSPORT_ERROR');
    expect(report.clientsClosed).toBe(2);
    expect(output.join('\n')).toContain('notifications/initialized');
    expect(output.join('\n')).toContain('failedCallReplayed=false');
    expect(output.join('\n')).toContain('D039 PASS');
  }, 10_000);

  it('MCP ToolResult isError 是业务结果，不创建新 Client，也不重放该调用', async () => {
    const { runD039Demo } = await import('../src/demo/d039.ts');
    const fake = fakeClient(() => Promise.resolve({
      content: [{ type: 'text', text: 'business failure' }],
      isError: true,
    }));
    let factoryCalls = 0;

    await expect(runD039Demo(() => undefined, {
      createClient: () => {
        factoryCalls += 1;
        return fake.client;
      },
    })).rejects.toThrow('disconnect 必须产生 TRANSPORT_ERROR');

    expect(factoryCalls).toBe(1);
    expect(fake.calls.map((call) => call.name)).toEqual(['echo', 'disconnect']);
    expect(fake.isClosed()).toBe(true);
  });

  it('JSON-RPC error 不被当成传输断开，不创建新 Client，也不重放该调用', async () => {
    const { runD039Demo } = await import('../src/demo/d039.ts');
    const fake = fakeClient(() => Promise.reject(
      new McpRpcError(-32602, 'invalid disconnect arguments', { field: 'reason' }),
    ));
    let factoryCalls = 0;

    await expect(runD039Demo(() => undefined, {
      createClient: () => {
        factoryCalls += 1;
        return fake.client;
      },
    })).rejects.toMatchObject({ code: 'RPC_ERROR', rpcCode: -32602 });

    expect(factoryCalls).toBe(1);
    expect(fake.calls.map((call) => call.name)).toEqual(['echo', 'disconnect']);
    expect(fake.isClosed()).toBe(true);
  });
});
