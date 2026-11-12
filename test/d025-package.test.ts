import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));

describe('D025 tarball 干净安装验收', () => {
  it('构建并安装 tarball 后，从安装目录执行 bin 的完整 G1 Demo', () => {
    const execution = spawnSync(
      process.execPath,
      [join(repositoryRoot, 'scripts/verify-g1-install.ts')],
      {
        cwd: repositoryRoot,
        encoding: 'utf8',
        env: process.env,
        timeout: 60_000,
      },
    );

    expect(execution.error).toBeUndefined();
    expect(execution.status, execution.stderr).toBe(0);
    expect(execution.stdout).toContain('G1_INSTALL_ACCEPTANCE_PASS');
    expect(execution.stdout).toContain('"beforeExitCode": 1');
    expect(execution.stdout).toContain('"afterExitCode": 0');
    expect(execution.stdout).toContain('"workspaceRemoved": true');
  }, 60_000);
});
