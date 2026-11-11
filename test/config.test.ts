import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ConfigError, loadConfig } from '../src/adapters/config.ts';

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pa-config-'));
  dirs.push(dir);
  return dir;
}

function writeConfig(dir: string, content: unknown): void {
  writeFileSync(join(dir, 'agent.config.json'), JSON.stringify(content), 'utf8');
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('loadConfig', () => {
  it('没有配置文件时使用默认值', () => {
    const config = loadConfig({ cwd: tempDir(), env: {} });

    expect(config.log.level).toBe('info');
    expect(config.agent.maxTurns).toBe(20);
    expect(config.model.provider).toBe('openai-compatible');
  });

  it('配置文件覆盖默认值', () => {
    const dir = tempDir();
    writeConfig(dir, { log: { level: 'warn' }, agent: { maxTurns: 8 } });

    const config = loadConfig({ cwd: dir, env: {} });

    expect(config.log.level).toBe('warn');
    expect(config.agent.maxTurns).toBe(8);
    expect(config.agent.maxTokensPerTurn).toBe(4096);
  });

  it('环境变量覆盖配置文件', () => {
    const dir = tempDir();
    writeConfig(dir, { log: { level: 'warn' }, model: { name: 'file-model' } });

    const config = loadConfig({
      cwd: dir,
      env: { PA_LOG_LEVEL: 'debug', PA_MODEL_NAME: 'env-model', PA_MAX_TURNS: '3' },
    });

    expect(config.log.level).toBe('debug');
    expect(config.model.name).toBe('env-model');
    expect(config.agent.maxTurns).toBe(3);
  });

  it('非法日志级别直接报错，而不是静默降级', () => {
    expect(() => loadConfig({ cwd: tempDir(), env: { PA_LOG_LEVEL: 'verbose' } })).toThrow(
      ConfigError,
    );
  });

  it('非正整数轮次报错', () => {
    expect(() => loadConfig({ cwd: tempDir(), env: { PA_MAX_TURNS: '0' } })).toThrow(ConfigError);
    expect(() => loadConfig({ cwd: tempDir(), env: { PA_MAX_TURNS: 'abc' } })).toThrow(ConfigError);
  });

  it('配置文件不是合法 JSON 时报错', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'agent.config.json'), '{ not json', 'utf8');

    expect(() => loadConfig({ cwd: dir, env: {} })).toThrow(ConfigError);
  });
});
