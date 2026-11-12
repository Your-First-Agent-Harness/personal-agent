import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { runG1Demo } from '../src/demo/g1.ts';
import * as publicApi from '../src/index.ts';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));

interface G1DemoReport {
  readonly provider: string;
  readonly toolNames: readonly string[];
  readonly beforeExitCode: number | null;
  readonly afterExitCode: number | null;
  readonly readContent: string;
  readonly editDiff: string;
  readonly finalSource: string;
  readonly stopReason: string;
  readonly turns: number;
  readonly workspace: string;
  readonly workspaceRemoved: boolean;
}

describe('D025 G1 确定性离线 Demo', () => {
  it('无 API Key 时通过真实 read/edit/run_command 修复样例并证明测试先红后绿', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'personal-agent-d025-cli-test-'));
    try {
      const execution = spawnSync(
        process.execPath,
        [join(repositoryRoot, 'src/cli/main.ts'), 'demo', '--json'],
        {
          cwd,
          encoding: 'utf8',
          env: { PATH: process.env.PATH ?? '' },
          timeout: 30_000,
        },
      );

      expect(execution.error).toBeUndefined();
      expect(execution.status, execution.stderr).toBe(0);
      expect(execution.stderr).toBe('');
      const report = JSON.parse(execution.stdout) as G1DemoReport;
      expect(report.provider).toBe('deterministic-offline-script');
      expect(report.toolNames).toEqual([
        'read_file',
        'run_command',
        'edit_file',
        'run_command',
      ]);
      expect(report.beforeExitCode).toBe(1);
      expect(report.afterExitCode).toBe(0);
      expect(report.readContent).toContain('return left - right;');
      expect(report.editDiff).toContain('-  return left - right;');
      expect(report.editDiff).toContain('+  return left + right;');
      expect(report.finalSource).toContain('return left + right;');
      expect(report.finalSource).not.toContain('return left - right;');
      expect(report.stopReason).toBe('completed');
      expect(report.turns).toBe(5);
      expect(report.workspaceRemoved).toBe(true);
      expect(existsSync(report.workspace)).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 30_000);

  it('返回可复核证据并输出离线声明、四个步骤和最终断言', async () => {
    const lines: string[] = [];
    const report = await runG1Demo((line) => lines.push(line));
    const transcript = lines.join('\n');

    expect(publicApi.VERSION).toBe('0.1.0');
    expect(publicApi.runG1Demo).toBe(runG1Demo);
    expect(publicApi.runAgentLoop).toBeTypeOf('function');
    expect(publicApi.createBuiltinTools).toBeTypeOf('function');
    expect(publicApi.ToolRegistry).toBeTypeOf('function');
    expect(report.beforeExitCode).toBe(1);
    expect(report.beforeStdout).toContain('✖ add returns the sum');
    expect(report.beforeStdout).toContain('ℹ fail 1');
    expect(report.afterExitCode).toBe(0);
    expect(report.afterStdout).toContain('✔ add returns the sum');
    expect(report.afterStdout).toContain('ℹ pass 1');
    expect(report.finalSource).toContain('return left + right;');
    expect(report.workspaceRemoved).toBe(true);
    expect(existsSync(report.workspace)).toBe(false);
    expect(transcript).toContain('确定性离线 Demo');
    expect(transcript).toContain('不请求网络、不需要 API Key');
    expect(transcript).toContain('[1/4] read_file');
    expect(transcript).toContain('[2/4] run_command');
    expect(transcript).toContain('[3/4] edit_file');
    expect(transcript).toContain('[4/4] run_command');
    expect(transcript).toContain('G1 Demo PASS');
  }, 30_000);

  it('真实命令结果不符合先红后绿证据时拒绝成功并执行清理', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(process, 'execPath');
    expect(descriptor).toBeDefined();
    Object.defineProperty(process, 'execPath', {
      ...descriptor,
      value: '/tmp/personal-agent-d025-missing-node',
    });
    try {
      await expect(runG1Demo(() => undefined)).rejects.toThrow(
        'G1 Demo 未满足真实读取、先红、编辑、后绿与最终文件断言',
      );
    } finally {
      Object.defineProperty(process, 'execPath', descriptor as PropertyDescriptor);
    }
  }, 30_000);
});
