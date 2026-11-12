import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  StdioMcpClient,
  type McpRequestOptions,
  type McpServerInfo,
} from '../adapters/mcp-stdio-client.ts';
import type { ChatResult, ModelProvider } from '../adapters/model/provider.ts';
import type { Message } from '../core/message.ts';
import { runAgentLoop } from '../runtime/loop.ts';
import {
  createFilesystemBackend,
  type McpFilesystemClient,
} from '../tools/filesystem-backend.ts';

export const D037_FILESYSTEM_PACKAGE = '@modelcontextprotocol/server-filesystem@2025.11.25';

export interface D037DemoStep {
  readonly exposedName: string;
  readonly exposedArguments: string;
  readonly remoteName: string;
  readonly remoteArguments: Readonly<Record<string, unknown>>;
  readonly content: string;
  readonly isError: boolean;
}

export interface D037BackendReport {
  readonly backend: 'local' | 'mcp';
  readonly protocolVersion?: string;
  readonly serverInfo?: McpServerInfo;
  readonly steps: readonly D037DemoStep[];
  readonly finalText: string;
  readonly stopReason: string;
  readonly turns: number;
  readonly closed: boolean;
}

export interface D037DemoReport {
  readonly package: string;
  readonly workspace: string;
  readonly workspaceRemoved: boolean;
  readonly backends: readonly D037BackendReport[];
}

export interface D037DemoOptions {
  readonly createMcpClient?: (workspace: string) => McpFilesystemClient;
}

interface RemoteCall {
  readonly name: string;
  readonly arguments: Readonly<Record<string, unknown>>;
}

function officialClient(workspace: string): McpFilesystemClient {
  return new StdioMcpClient({
    command: 'npx',
    args: ['--yes', D037_FILESYSTEM_PACKAGE, workspace],
    env: {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? tmpdir(),
      NO_COLOR: '1',
      npm_config_update_notifier: 'false',
    },
    requestTimeoutMs: 30_000,
    closeTimeoutMs: 2_000,
  });
}

function tracingClient(client: McpFilesystemClient, calls: RemoteCall[]): McpFilesystemClient {
  return {
    connect: (options?: McpRequestOptions) => client.connect(options),
    listAllTools: (options?: McpRequestOptions) => client.listAllTools(options),
    callTool: (name, arguments_, options) => {
      calls.push({ name, arguments: arguments_ });
      return client.callTool(name, arguments_, options);
    },
    close: () => client.close(),
  };
}

function createProvider(): ModelProvider {
  let turn = 0;
  const toolResponse = (id: string, name: string, args: Record<string, unknown>): ChatResult => ({
    text: '',
    model: 'deterministic-d037-script',
    toolCalls: [{ id, name, arguments: JSON.stringify(args) }],
  });
  return {
    name: 'deterministic-d037-script',
    chat: () => {
      turn += 1;
      if (turn === 1) return Promise.resolve(toolResponse('d037-list', 'list_dir', {}));
      if (turn === 2) return Promise.resolve(toolResponse('d037-read', 'read_file', { path: 'note.txt' }));
      if (turn === 3) {
        return Promise.resolve({
          text: '同一任务完成：已列目录并读取 note.txt。',
          model: 'deterministic-d037-script',
        });
      }
      return Promise.reject(new Error('D037 脚本没有更多响应'));
    },
  };
}

function summarize(content: string): string {
  const compact = content.replace(/\s+/g, ' ').trim();
  return compact.length <= 180 ? compact : `${compact.slice(0, 177)}...`;
}

function toolContent(messages: readonly Message[], callId: string): string {
  const message = messages.find(
    (candidate) => candidate.role === 'tool' && candidate.toolCallId === callId,
  );
  if (message === undefined) throw new Error(`AgentLoop 缺少工具结果：${callId}`);
  return message.content;
}

async function runBackend(
  backendType: 'local' | 'mcp',
  workspace: string,
  options: D037DemoOptions,
  output: (line: string) => void,
): Promise<D037BackendReport> {
  const remoteCalls: RemoteCall[] = [];
  const backend = backendType === 'local'
    ? await createFilesystemBackend({ backend: 'local' })
    : await createFilesystemBackend({
        backend: 'mcp',
        client: tracingClient((options.createMcpClient ?? officialClient)(workspace), remoteCalls),
      });
  const initialization = backend.initialization;
  let pending: Omit<D037BackendReport, 'closed'>;
  try {
    output(`backend=${backendType} tools=${backend.registry.list().map((tool) => tool.name).join(',')}`);
    if (initialization !== undefined) {
      output(
        `backend=mcp negotiated=${initialization.protocolVersion} server=${initialization.serverInfo.name}@${initialization.serverInfo.version}`,
      );
    }
    const errors = new Map<string, boolean>();
    const result = await runAgentLoop({
      provider: createProvider(),
      registry: backend.registry,
      messages: [
        { role: 'system', content: '只能使用 read_file 和 list_dir；不要写入或读取工作区之外的内容。' },
        { role: 'user', content: '列出当前目录，然后读取 note.txt。' },
      ],
      maxTurns: 3,
      maxTokens: 256,
      workspaceRoot: workspace,
      eventSink: {
        emit(event) {
          if (event.type === 'tool_call_finished') errors.set(event.toolCallId, event.isError);
        },
      },
    });
    const steps: D037DemoStep[] = [];
    for (const message of result.messages) {
      if (message.role !== 'assistant') continue;
      for (const call of message.toolCalls ?? []) {
        const index = steps.length;
        const remote = backendType === 'mcp'
          ? remoteCalls[index]
          : { name: call.name, arguments: JSON.parse(call.arguments) as Record<string, unknown> };
        if (remote === undefined) throw new Error(`缺少第 ${index + 1} 次 MCP 实际调用记录`);
        const content = toolContent(result.messages, call.id);
        const step = {
          exposedName: call.name,
          exposedArguments: call.arguments,
          remoteName: remote.name,
          remoteArguments: remote.arguments,
          content,
          isError: errors.get(call.id) === true,
        };
        steps.push(step);
        output(
          `backend=${backendType} exposed=${step.exposedName} args=${step.exposedArguments} remote=${step.remoteName} remoteArgs=${JSON.stringify(step.remoteArguments)} summary=${JSON.stringify(summarize(content))} isError=${step.isError}`,
        );
      }
    }
    pending = {
      backend: backendType,
      ...(initialization === undefined ? {} : {
        protocolVersion: initialization.protocolVersion,
        serverInfo: initialization.serverInfo,
      }),
      steps,
      finalText: result.text,
      stopReason: result.stopReason,
      turns: result.turns,
    };
  } finally {
    await backend.close();
    output(`backend=${backendType} closed=true`);
  }
  return { ...pending, closed: true };
}

export async function runD037Demo(
  output: (line: string) => void,
  options: D037DemoOptions = {},
): Promise<D037DemoReport> {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'personal-agent-d037-demo-')));
  let backends: readonly D037BackendReport[];
  try {
    mkdirSync(join(workspace, 'nested'));
    writeFileSync(join(workspace, 'note.txt'), 'D037 shared workspace\n', 'utf8');
    output(`D037 package=${D037_FILESYSTEM_PACKAGE}`);
    output(`workspace=${workspace} allowedDirectory=${workspace}`);
    backends = [
      await runBackend('local', workspace, options, output),
      await runBackend('mcp', workspace, options, output),
    ];
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
  output(`workspaceRemoved=${!existsSync(workspace)}`);
  return {
    package: D037_FILESYSTEM_PACKAGE,
    workspace,
    workspaceRemoved: !existsSync(workspace),
    backends,
  };
}
