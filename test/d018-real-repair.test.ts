import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));

interface DemoReport {
  readonly beforeExitCode: number | null;
  readonly beforeStdout: string;
  readonly beforeStderr: string;
  readonly afterExitCode: number | null;
  readonly afterStdout: string;
  readonly afterStderr: string;
  readonly finalLoopSource: string;
  readonly productionLoopUnchanged: boolean;
  readonly injectedDefect: boolean;
  readonly stopReason: string;
  readonly turns: number;
  readonly finalText: string;
  readonly providerRequests: number;
  readonly history: readonly string[];
  readonly toolOutcomes: readonly {
    readonly name: string;
    readonly isError: boolean;
    readonly code?: string;
  }[];
  readonly lastEvent: string;
  readonly tempRoot: string;
  readonly tempRemoved: boolean;
}

describe('D018 真实仓库回归修复回放', () => {
  it('缺陷副本先红，真实工具精确修复后变绿，并保留完整 Loop 证据', () => {
    const execution = spawnSync(
      process.execPath,
      [join(repositoryRoot, 'scripts/d018-real-repair.ts')],
      {
        cwd: repositoryRoot,
        encoding: 'utf8',
        env: { PATH: process.env.PATH ?? '' },
        timeout: 30_000,
      },
    );

    expect(execution.error).toBeUndefined();
    expect(execution.status, execution.stderr).toBe(0);
    const report = JSON.parse(execution.stdout) as DemoReport;
    const productionLoop = readFileSync(
      join(repositoryRoot, 'src/runtime/loop.ts'),
      'utf8',
    );

    expect(report.injectedDefect).toBe(true);
    expect(report.beforeExitCode).toBe(1);
    expect(report.beforeStdout).toContain('ℹ fail 1');
    expect(report.beforeStdout).toContain('tool_errors');
    expect(report.beforeStdout).toContain('cancelled');
    expect(report.afterExitCode).toBe(0);
    expect(report.afterStdout).toContain('ℹ pass 1');
    expect(report.afterStderr).toBe('');

    expect(report.finalLoopSource).toBe(productionLoop);
    expect(report.productionLoopUnchanged).toBe(true);
    expect(report.stopReason).toBe('completed');
    expect(report.turns).toBe(5);
    expect(report.finalText).toBe(
      '仓库回归修复完成：缺陷版测试失败，补回取消检查后测试通过。',
    );
    expect(report.providerRequests).toBe(5);
    expect(report.history).toEqual([
      'assistant:read-loop',
      'tool:read-loop:read_file',
      'assistant:test-before',
      'tool:test-before:run_command',
      'assistant:repair-loop',
      'tool:repair-loop:edit_file',
      'assistant:test-after',
      'tool:test-after:run_command',
      'assistant:final',
    ]);
    expect(report.toolOutcomes).toEqual([
      { name: 'read_file', isError: false },
      { name: 'run_command', isError: true, code: 'COMMAND_FAILED' },
      { name: 'edit_file', isError: false },
      { name: 'run_command', isError: false },
    ]);
    expect(report.lastEvent).toBe('run_completed:5:completed');
    expect(report.tempRemoved).toBe(true);
    expect(existsSync(report.tempRoot)).toBe(false);

    const packageJson = JSON.parse(
      readFileSync(join(repositoryRoot, 'package.json'), 'utf8'),
    ) as { readonly scripts: Readonly<Record<string, string>> };
    expect(packageJson.scripts['demo:d018']).toBe(
      'node scripts/d018-real-repair.ts',
    );
  }, 30_000);
});
