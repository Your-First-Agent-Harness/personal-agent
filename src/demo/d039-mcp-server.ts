import { McpStdioServer } from '../adapters/mcp-stdio-server.ts';
import type { Tool } from '../core/tool.ts';
import { ToolRegistry } from '../tools/registry.ts';

// 仓库内专用的确定性测试 Server；不是官方或外部 MCP Server。
const echoTool: Tool = {
  name: 'echo',
  description: '返回消息和当前 Server PID，证明响应来自独立 OS 进程',
  parameters: {
    type: 'object',
    properties: { message: { type: 'string' } },
    required: ['message'],
    additionalProperties: false,
  },
  execute: (args) => {
    const message = (args as { message: string }).message;
    return Promise.resolve({
      content: `D039 echo message=${JSON.stringify(message)} serverPid=${process.pid}`,
    });
  },
};

const disconnectTool: Tool = {
  name: 'disconnect',
  description: '仅供 D039：在响应 tools/call 前让当前测试 Server 退出',
  parameters: { type: 'object', additionalProperties: false },
  execute: async () => {
    process.stderr.write(`D039 deterministic disconnect; serverPid=${process.pid}; exitCode=42\n`);
    await new Promise<void>((resolve) => setImmediate(resolve));
    process.exit(42);
  },
};

const registry = new ToolRegistry();
registry.register(echoTool);
registry.register(disconnectTool);

const server = new McpStdioServer({
  registry,
  toolNames: ['echo', 'disconnect'],
  workspaceRoot: process.cwd(),
  input: process.stdin,
  output: process.stdout,
  errorOutput: process.stderr,
  serverInfo: { name: 'd039-deterministic-test-server', version: '1.0.0' },
});

process.stderr.write(`D039 test Server ready; serverPid=${process.pid}\n`);
await server.start();
process.stderr.write(`D039 test Server stopped; serverPid=${process.pid}\n`);
