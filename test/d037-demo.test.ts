import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { StdioMcpClient } from '../src/adapters/mcp-stdio-client.ts';
import { runD037Demo } from '../src/demo/d037.ts';

const fixture = fileURLToPath(new URL('./fixtures/d037-filesystem-server.ts', import.meta.url));

describe('D037 可复现 local/MCP 对比 Demo', () => {
  it('通过真实 AgentLoop 对同一工作区运行同一任务，并报告实际远端名称和参数', async () => {
    const output: string[] = [];
    const report = await runD037Demo((line) => output.push(line), {
      createMcpClient: (workspace) => new StdioMcpClient({
        command: process.execPath,
        args: [fixture, workspace],
        requestTimeoutMs: 1_000,
      }),
    });

    const local = report.backends[0]!;
    const mcp = report.backends[1]!;
    expect(local.steps.map((step) => step.exposedName)).toEqual(['list_dir', 'read_file']);
    expect(mcp.steps.map((step) => step.exposedName)).toEqual(['list_dir', 'read_file']);
    expect(mcp.steps.map((step) => step.remoteName)).toEqual(['list_directory', 'read_file']);
    expect(mcp.steps[0]!.remoteArguments).toEqual({ path: report.workspace });
    expect(mcp.steps[1]!.remoteArguments).toEqual({
      path: join(report.workspace, 'note.txt'),
    });
    expect(local.steps[1]!.content).toBe('D037 shared workspace\n');
    expect(mcp.steps[1]!.content).toBe('D037 shared workspace\n');
    expect(local.steps[0]!.content).toContain('nested/');
    expect(mcp.steps[0]!.content).toContain('[DIR] nested');
    expect(report.backends.every((backend) => backend.stopReason === 'completed')).toBe(true);
    expect(report.backends.every((backend) => backend.turns === 3)).toBe(true);
    expect(report.backends.every((backend) => backend.closed)).toBe(true);
    expect(report.workspaceRemoved).toBe(true);
    expect(output.join('\n')).toContain('backend=mcp');
    expect(output.join('\n')).toContain('remote=list_directory');
  });

  it('MCP 子进程失败时仍关闭后端并清理临时工作区', async () => {
    const root = mkdtempSync(join(tmpdir(), 'personal-agent-d037-demo-failure-'));
    const missingFixture = join(root, 'missing-server.ts');
    try {
      await expect(runD037Demo(() => undefined, {
        createMcpClient: (workspace) => new StdioMcpClient({
          command: process.execPath,
          args: [missingFixture, workspace],
          requestTimeoutMs: 100,
          closeTimeoutMs: 100,
        }),
      })).rejects.toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
