import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { McpStdioServer } from '../adapters/mcp-stdio-server.ts';
import { listDirTool, readFileTool } from '../tools/fs.ts';
import { ToolRegistry } from '../tools/registry.ts';

const workspaceRoot = mkdtempSync(join(tmpdir(), 'personal-agent-d036-'));
writeFileSync(
  join(workspaceRoot, 'README.txt'),
  'D036 safe MCP workspace\nOnly read_file and list_dir are exposed.\n',
  'utf8',
);
writeFileSync(join(workspaceRoot, 'hello.txt'), 'Hello from the Personal Agent Registry.\n', 'utf8');

const registry = new ToolRegistry();
registry.register(readFileTool);
registry.register(listDirTool);

const server = new McpStdioServer({
  registry,
  toolNames: ['read_file', 'list_dir'],
  workspaceRoot,
  input: process.stdin,
  output: process.stdout,
  errorOutput: process.stderr,
  serverInfo: { name: 'personal-agent-safe-demo', version: '0.1.0' },
});

process.stderr.write(`D036 MCP Server ready; workspace=${workspaceRoot}; tools=read_file,list_dir\n`);
try {
  await server.start();
} finally {
  rmSync(workspaceRoot, { recursive: true, force: true });
  process.stderr.write('D036 MCP Server stopped; temporary workspace removed\n');
}
