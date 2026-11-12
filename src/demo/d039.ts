import { fileURLToPath } from 'node:url';

import { createMcpTool } from '../adapters/mcp-tool.ts';
import {
  McpClientError,
  StdioMcpClient,
  type McpCallToolResult,
  type McpInitializeResult,
  type McpRequestOptions,
  type McpServerInfo,
  type McpTool,
} from '../adapters/mcp-stdio-client.ts';
import { ToolRegistry } from '../tools/registry.ts';

export interface D039McpClient {
  connect(): Promise<McpInitializeResult>;
  listAllTools(options?: McpRequestOptions): Promise<readonly McpTool[]>;
  callTool(
    name: string,
    arguments_: Readonly<Record<string, unknown>>,
    options?: McpRequestOptions,
  ): Promise<McpCallToolResult>;
  close(): Promise<void>;
}

export interface D039DemoOptions {
  readonly createClient?: () => D039McpClient;
}

export interface D039DemoReport {
  readonly protocolVersion: string;
  readonly serverInfo: McpServerInfo;
  readonly toolNames: readonly string[];
  readonly firstServerPid: number;
  readonly recoveredServerPid: number;
  readonly failureCode: 'TRANSPORT_ERROR';
  readonly clientsCreated: number;
  readonly clientsClosed: number;
}

interface ConnectedSession {
  readonly client: D039McpClient;
  readonly initialization: McpInitializeResult;
  readonly registry: ToolRegistry;
  readonly tools: readonly McpTool[];
}

function defaultClient(): D039McpClient {
  return new StdioMcpClient({
    command: process.execPath,
    args: [fileURLToPath(new URL('./d039-mcp-server.ts', import.meta.url))],
    env: { NO_COLOR: '1' },
    requestTimeoutMs: 2_000,
    closeTimeoutMs: 200,
  });
}

async function openSession(
  connection: number,
  createClient: () => D039McpClient,
  clients: D039McpClient[],
  output: (line: string) => void,
): Promise<ConnectedSession> {
  const client = createClient();
  clients.push(client);
  output(`connection=${connection} clientFactory=created initialize=request`);
  const initialization = await client.connect();
  output(
    `connection=${connection} initialize=ok protocol=${initialization.protocolVersion} server=${initialization.serverInfo.name}@${initialization.serverInfo.version}`,
  );
  output(`connection=${connection} notifications/initialized=sent`);
  const tools = await client.listAllTools();
  output(`connection=${connection} tools/list=ok names=${tools.map((tool) => tool.name).join(',')}`);
  const registry = new ToolRegistry();
  for (const tool of tools) registry.register(createMcpTool(tool, client));
  return { client, initialization, registry, tools };
}

async function callEcho(
  session: ConnectedSession,
  callId: string,
  message: string,
  output: (line: string) => void,
): Promise<{ content: string; serverPid: number }> {
  const arguments_ = { message };
  output(`tools/call id=${callId} name=echo arguments=${JSON.stringify(arguments_)}`);
  const result = await session.registry.execute(
    { id: callId, name: 'echo', arguments: JSON.stringify(arguments_) },
    { workspaceRoot: process.cwd() },
  );
  if (result.isError === true) throw new Error(`echo 调用失败：${result.content}`);
  const serverPid = Number(result.content.match(/serverPid=(\d+)/)?.[1]);
  if (!Number.isSafeInteger(serverPid) || serverPid <= 0) {
    throw new Error(`echo 响应缺少真实 Server PID：${result.content}`);
  }
  output(`tools/call id=${callId} result=ok serverPid=${serverPid} content=${JSON.stringify(result.content)}`);
  return { content: result.content, serverPid };
}

export async function runD039Demo(
  output: (line: string) => void,
  options: D039DemoOptions = {},
): Promise<D039DemoReport> {
  const createClient = options.createClient ?? defaultClient;
  const clients: D039McpClient[] = [];
  let report: Omit<D039DemoReport, 'clientsCreated' | 'clientsClosed'>;
  output(`D039 deterministic cross-process MCP demo; clientPid=${process.pid}`);
  try {
    const first = await openSession(1, createClient, clients, output);
    const firstCall = await callEcho(first, 'd039-first-echo', 'before-disconnect', output);

    output('tools/call id=d039-disconnect name=disconnect arguments={}');
    try {
      const unexpected = await first.client.callTool('disconnect', {});
      throw new Error(
        `disconnect 必须产生 TRANSPORT_ERROR，实际返回 ${JSON.stringify(unexpected)}`,
      );
    } catch (error) {
      if (!(error instanceof McpClientError) || error.code !== 'TRANSPORT_ERROR') {
        throw error;
      }
      output(`failureCode=${error.code} message=${JSON.stringify(error.message)}`);
    }

    await first.client.close();
    output('connection=1 oldClientClosed=true failedCallReplayed=false');

    const recovered = await openSession(2, createClient, clients, output);
    const recoveredCall = await callEcho(
      recovered,
      'd039-recovered-echo',
      'after-reconnect-independent-call',
      output,
    );
    if (recoveredCall.serverPid === firstCall.serverPid) {
      throw new Error('重连后仍使用原 Server PID，未形成新 OS 进程');
    }
    output(
      `recovery=ok oldServerPid=${firstCall.serverPid} newServerPid=${recoveredCall.serverPid} failedCallReplayed=false`,
    );
    report = {
      protocolVersion: recovered.initialization.protocolVersion,
      serverInfo: recovered.initialization.serverInfo,
      toolNames: recovered.tools.map((tool) => tool.name),
      firstServerPid: firstCall.serverPid,
      recoveredServerPid: recoveredCall.serverPid,
      failureCode: 'TRANSPORT_ERROR',
    };
  } finally {
    await Promise.all(clients.map(async (client) => client.close()));
    output(`cleanup clients=${clients.length} closed=true`);
  }
  output(
    `D039 PASS clients=2 firstServerPid=${report.firstServerPid} recoveredServerPid=${report.recoveredServerPid} failedCallReplayed=false`,
  );
  return { ...report, clientsCreated: clients.length, clientsClosed: clients.length };
}
