import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import type { SpawnSyncOptions } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { G1DemoReport } from '../src/demo/g1.ts';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function execute(command: string, args: readonly string[], cwd: string): string {
  const options: SpawnSyncOptions = {
    cwd,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
    timeout: 60_000,
  };
  const result = spawnSync(command, args, options);
  assert.equal(result.error, undefined);
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(' ')} 失败：\n${String(result.stdout)}\n${String(result.stderr)}`,
  );
  return String(result.stdout);
}

const tempRoot = mkdtempSync(join(tmpdir(), 'personal-agent-g1-install-'));
try {
  const manifest = JSON.parse(
    readFileSync(join(repositoryRoot, 'package.json'), 'utf8'),
  ) as { readonly version: string };
  execute(npm, ['pack', '--pack-destination', tempRoot], repositoryRoot);
  const tarball = join(tempRoot, `personal-agent-${manifest.version}.tgz`);
  const tarballBytes = statSync(tarball).size;
  const installRoot = join(tempRoot, 'install');
  execute(npm, ['install', '--offline', '--ignore-scripts', '--prefix', installRoot, tarball], tempRoot);

  const packageRoot = join(installRoot, 'node_modules', 'personal-agent');
  const installedManifest = JSON.parse(
    readFileSync(join(packageRoot, 'package.json'), 'utf8'),
  ) as {
    readonly version: string;
    readonly dependencies?: Readonly<Record<string, string>>;
  };
  assert.equal(installedManifest.version, '0.1.0');
  assert.equal(installedManifest.dependencies, undefined);
  for (const excluded of ['src', 'test', 'scripts', 'coverage', '.env', '.env.example']) {
    assert.equal(existsSync(join(packageRoot, excluded)), false, `${excluded} 不应进入 tarball`);
  }
  assert.equal(existsSync(join(packageRoot, 'dist/cli/main.js')), true);

  const importCheck = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      "import { createBuiltinTools, ToolRegistry, VERSION } from 'personal-agent'; const registry = new ToolRegistry(); for (const tool of createBuiltinTools()) registry.register(tool); if (registry.size !== 5 || VERSION !== '0.1.0') throw new Error('public export smoke failed'); process.stdout.write('PACKAGE_IMPORT_PASS tools=5 version=0.1.0\\n');",
    ],
    {
      cwd: installRoot,
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '' },
      timeout: 10_000,
    },
  );
  assert.equal(importCheck.status, 0, importCheck.stderr);
  assert.equal(importCheck.stdout, 'PACKAGE_IMPORT_PASS tools=5 version=0.1.0\n');

  const executable = join(installRoot, 'node_modules', '.bin', 'personal-agent');
  const demo = spawnSync(executable, ['demo', '--json'], {
    cwd: installRoot,
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '' },
    maxBuffer: 10 * 1024 * 1024,
    timeout: 30_000,
  });
  assert.equal(demo.error, undefined);
  assert.equal(demo.status, 0, demo.stderr);
  assert.equal(demo.stderr, '');
  const report = JSON.parse(demo.stdout) as G1DemoReport;
  assert.equal(report.provider, 'deterministic-offline-script');
  assert.deepEqual(report.toolNames, ['read_file', 'run_command', 'edit_file', 'run_command']);
  assert.equal(report.beforeExitCode, 1);
  assert.equal(report.afterExitCode, 0);
  assert.equal(report.finalSource.includes('return left + right;'), true);
  assert.equal(report.finalSource.includes('return left - right;'), false);
  assert.equal(report.workspaceRemoved, true);
  assert.equal(existsSync(report.workspace), false);

  process.stdout.write(`G1_INSTALL_ACCEPTANCE_PASS\n${JSON.stringify({
    ...report,
    tarball: `personal-agent-${manifest.version}.tgz`,
    tarballBytes,
    publicImport: importCheck.stdout.trim(),
  }, null, 2)}\n`);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
