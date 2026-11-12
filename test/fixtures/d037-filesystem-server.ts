import { createInterface } from 'node:readline';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';

const workspace = resolve(process.argv[2] ?? process.cwd());
const scenario = process.argv[3] ?? 'normal';
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });

function send(message: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function result(id: number | string, value: Record<string, unknown>): void {
  send({ jsonrpc: '2.0', id, result: value });
}

function target(path: unknown): string {
  if (typeof path !== 'string') throw new Error('path required');
  const resolved = resolve(path);
  if (resolved !== workspace && !resolved.startsWith(workspace + sep)) throw new Error('outside workspace');
  return resolved;
}

function callTool(id: number | string, params: Record<string, unknown>): void {
  const args = (params.arguments ?? {}) as Record<string, unknown>;
  if (params.name === 'read_file' && scenario === 'hang-read') return;
  if (params.name === 'read_file' && scenario === 'exit-read') process.exit(23);
  try {
    const path = target(args.path);
    const text = params.name === 'read_file'
      ? readFileSync(path, 'utf8')
      : params.name === 'list_directory'
        ? readdirSync(path, { withFileTypes: true }).map((entry) => (
            `${entry.isDirectory() ? '[DIR]' : '[FILE]'} ${entry.name}`
          )).join('\n')
        : undefined;
    if (text === undefined) throw new Error(`unknown tool: ${String(params.name)}`);
    result(id, { content: [{ type: 'text', text }] });
  } catch (error) {
    result(id, {
      content: [{ type: 'text', text: error instanceof Error ? error.message : 'fixture error' }],
      isError: true,
    });
  }
}

input.on('line', (line) => {
  const message = JSON.parse(line) as {
    id?: number | string;
    method?: string;
    params?: Record<string, unknown>;
  };
  if (message.method === 'notifications/initialized') return;
  const id = message.id;
  if (id === undefined) return;
  switch (message.method) {
    case 'initialize':
      result(id, {
        protocolVersion: '2025-11-25',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'd037-offline-filesystem-fixture', version: '1.0.0' },
      });
      return;
    case 'ping':
      result(id, {});
      return;
    case 'tools/list':
      result(id, {
        tools: [
          {
            name: 'read_file',
            description: 'fixture read',
            inputSchema: {
              type: 'object',
              properties: { path: { type: 'string' } },
              required: ['path'],
            },
          },
          {
            name: 'list_directory',
            description: 'fixture list',
            inputSchema: {
              type: 'object',
              properties: { path: { type: 'string' } },
              required: ['path'],
            },
          },
          {
            name: 'write_file',
            description: 'must not be exposed',
            inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
          },
        ],
      });
      return;
    case 'tools/call':
      callTool(id, message.params ?? {});
      return;
    default:
      send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'method not found' } });
  }
});
