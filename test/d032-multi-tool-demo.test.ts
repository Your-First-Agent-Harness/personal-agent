import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createD032Tools } from '../src/demo/d032-tools.ts';
import { runD032Demo } from '../src/demo/d032.ts';
import { ToolRegistry } from '../src/tools/registry.ts';

interface D032Step {
  readonly id: string;
  readonly name: string;
  readonly arguments: string;
  readonly result: string;
  readonly resultSummary: string;
  readonly isError: boolean;
}

interface D032DemoReport {
  readonly registeredTools: readonly string[];
  readonly toolNames: readonly string[];
  readonly steps: readonly D032Step[];
  readonly finalText: string;
  readonly finalReport: string;
  readonly sha256: string;
  readonly verificationMatched: boolean;
  readonly reportWritten: boolean;
  readonly stopReason: string;
  readonly turns: number;
  readonly workspace: string;
  readonly workspaceRemoved: boolean;
}

const expectedRegisteredTools = [
  'read_file',
  'list_dir',
  'write_file',
  'edit_file',
  'run_command',
  'parse_tap_output',
  'evaluate_test_gate',
  'render_release_report',
  'sha256_text',
  'verify_file_sha256',
];

function createRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  for (const tool of createD032Tools()) registry.register(tool);
  return registry;
}

describe('D032 十工具多步骤离线 Demo', () => {
  it('恰好注册十个有独立用途的工具，并由 Registry 拒绝非法参数', async () => {
    const tools = createD032Tools();
    expect(tools.map((tool) => tool.name)).toEqual(expectedRegisteredTools);
    expect(new Set(tools.map((tool) => tool.name)).size).toBe(10);
    for (const tool of tools) {
      expect(tool.description.trim().length).toBeGreaterThan(8);
      expect(tool.parameters['type']).toBe('object');
    }

    const registry = createRegistry();
    expect(registry.list().map((tool) => tool.name)).toEqual(expectedRegisteredTools);
    const invalid = await registry.execute(
      { id: 'invalid-sha', name: 'sha256_text', arguments: '{"text":7}' },
      { workspaceRoot: process.cwd() },
    );
    expect(invalid.isError).toBe(true);
    expect(invalid.error?.code).toBe('INVALID_ARGUMENTS');
    expect(invalid.content).toContain('$.text');
  });

  it('通过真实 AgentLoop 将前序结果传给后续工具，完成九个不同工具的发布验收链', async () => {
    const lines: string[] = [];
    const report: D032DemoReport = await runD032Demo((line) => lines.push(line));
    const transcript = lines.join('\n');

    expect(report.registeredTools).toEqual(expectedRegisteredTools);
    expect(report.toolNames).toEqual([
      'list_dir',
      'read_file',
      'run_command',
      'parse_tap_output',
      'evaluate_test_gate',
      'render_release_report',
      'sha256_text',
      'write_file',
      'verify_file_sha256',
    ]);
    expect(new Set(report.toolNames).size).toBeGreaterThanOrEqual(4);
    expect(report.steps).toHaveLength(9);
    expect(report.stopReason).toBe('completed');
    expect(report.turns).toBe(10);
    expect(report.reportWritten).toBe(true);
    expect(report.verificationMatched).toBe(true);
    expect(report.workspaceRemoved).toBe(true);
    expect(existsSync(report.workspace)).toBe(false);

    const args = report.steps.map((step) => JSON.parse(step.arguments) as Record<string, unknown>);
    expect(args[3]?.['commandResultJson']).toBe(report.steps[2]?.result);
    expect(args[4]?.['configJson']).toBe(report.steps[1]?.result);
    expect(args[4]?.['summaryJson']).toBe(report.steps[3]?.result);
    expect(args[5]?.['gateResultJson']).toBe(report.steps[4]?.result);
    expect(args[6]?.['text']).toBe(report.steps[5]?.result);
    expect(args[7]?.['content']).toBe(report.steps[5]?.result);
    expect(args[8]?.['expectedSha256']).toBe(
      (JSON.parse(report.steps[6]?.result ?? '{}') as { sha256?: string }).sha256,
    );

    expect(report.finalReport).toContain('# D032 多工具协作验收');
    expect(report.finalReport).toContain('门禁结果：**通过**');
    expect(report.finalReport).toContain('通过：2');
    expect(report.finalReport).toContain('失败：0');
    expect(report.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(report.finalText).toContain('2/2 项测试通过');
    expect(report.finalText).toContain('release-report.md');
    expect(report.finalText).toContain(report.sha256);

    for (const [index, step] of report.steps.entries()) {
      expect(transcript).toContain(`[${String(index + 1).padStart(2, '0')}] ${step.name}`);
      expect(transcript).toContain('参数摘要：');
      expect(transcript).toContain('结果摘要：');
    }
    expect(transcript).toContain('注册工具（10）');
    expect(transcript).toContain('不请求网络、不需要 API Key');
    expect(transcript).toContain(`最终回答：${report.finalText}`);
    expect(transcript).toContain('D032 Demo PASS');
  }, 30_000);

  it('测试未通过时保留失败证据并停止，不渲染或写入发布报告', async () => {
    const lines: string[] = [];
    const report: D032DemoReport = await runD032Demo((line) => lines.push(line), { fixture: 'failing' });

    expect(report.toolNames).toEqual([
      'list_dir',
      'read_file',
      'run_command',
      'parse_tap_output',
      'evaluate_test_gate',
    ]);
    expect(report.steps[2]?.isError).toBe(true);
    expect(report.steps[2]?.result).toContain('"exitCode":1');
    expect(report.steps[4]?.result).toContain('"passed":false');
    expect(report.steps[4]?.result).toContain('失败测试数');
    expect(report.reportWritten).toBe(false);
    expect(report.finalReport).toBe('');
    expect(report.verificationMatched).toBe(false);
    expect(report.finalText).toContain('发布门禁未通过');
    expect(report.finalText).toContain('未生成报告');
    expect(report.stopReason).toBe('completed');
    expect(report.turns).toBe(6);
    expect(report.workspaceRemoved).toBe(true);
    expect(existsSync(report.workspace)).toBe(false);
    expect(lines.join('\n')).toContain('未写入报告');
    expect(lines.join('\n')).not.toContain('D032 Demo PASS');
  }, 30_000);

  it('SHA-256 工具使用标准摘要，文件摘要不匹配时明确失败', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'personal-agent-d032-tools-'));
    const registry = createRegistry();
    try {
      writeFileSync(join(workspace, 'sample.txt'), 'abc', 'utf8');
      const hashed = await registry.execute(
        { id: 'sha', name: 'sha256_text', arguments: '{"text":"abc"}' },
        { workspaceRoot: workspace },
      );
      expect(hashed.isError).toBeUndefined();
      expect(JSON.parse(hashed.content)).toEqual({
        algorithm: 'sha256',
        sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      });

      const mismatch = await registry.execute(
        {
          id: 'verify',
          name: 'verify_file_sha256',
          arguments: JSON.stringify({ path: 'sample.txt', expectedSha256: '0'.repeat(64) }),
        },
        { workspaceRoot: workspace },
      );
      expect(mismatch.isError).toBe(true);
      expect(mismatch.content).toContain('SHA-256 不匹配');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
