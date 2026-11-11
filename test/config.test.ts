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
    expect(config.agent.maxContextChars).toBe(24_000);
    expect(config.agent.maxConsecutiveToolErrors).toBe(3);
    expect(config.model.provider).toBe('openai-compatible');
  });

  it('配置文件覆盖默认值', () => {
    const dir = tempDir();
    writeConfig(dir, {
      log: { level: 'warn' },
      agent: { maxTurns: 8, maxContextChars: 12_000, maxConsecutiveToolErrors: 5 },
    });

    const config = loadConfig({ cwd: dir, env: {} });

    expect(config.log.level).toBe('warn');
    expect(config.agent.maxTurns).toBe(8);
    expect(config.agent.maxTokensPerTurn).toBe(4096);
    expect(config.agent.maxContextChars).toBe(12_000);
    expect(config.agent.maxConsecutiveToolErrors).toBe(5);
  });

  it('环境变量覆盖配置文件', () => {
    const dir = tempDir();
    writeConfig(dir, {
      log: { level: 'warn' },
      model: { name: 'file-model' },
      agent: { maxContextChars: 12_000, maxConsecutiveToolErrors: 5 },
    });

    const config = loadConfig({
      cwd: dir,
      env: {
        PA_LOG_LEVEL: 'debug',
        PA_MODEL_NAME: 'env-model',
        PA_MAX_TURNS: '3',
        PA_MAX_CONTEXT_CHARS: '8000',
        PA_MAX_CONSECUTIVE_TOOL_ERRORS: '4',
      },
    });

    expect(config.log.level).toBe('debug');
    expect(config.model.name).toBe('env-model');
    expect(config.agent.maxTurns).toBe(3);
    expect(config.agent.maxContextChars).toBe(8000);
    expect(config.agent.maxConsecutiveToolErrors).toBe(4);
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

  it('PA_MAX_CONTEXT_CHARS 为零或非法值时复用 ConfigError', () => {
    for (const value of ['0', '-1', '1.5', 'abc']) {
      expect(() =>
        loadConfig({ cwd: tempDir(), env: { PA_MAX_CONTEXT_CHARS: value } }),
      ).toThrow(ConfigError);
    }
  });

  it('连续工具错误上限为零或非法值时复用 ConfigError', () => {
    for (const value of ['0', '-1', '1.5', 'abc']) {
      expect(() =>
        loadConfig({ cwd: tempDir(), env: { PA_MAX_CONSECUTIVE_TOOL_ERRORS: value } }),
      ).toThrow(ConfigError);
    }
  });

  it('配置文件不是合法 JSON 时报错', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'agent.config.json'), '{ not json', 'utf8');

    expect(() => loadConfig({ cwd: dir, env: {} })).toThrow(ConfigError);
  });

  it.each([
    { name: '根节点不是对象', content: [], message: '配置文件必须是对象' },
    { name: '配置分组不是对象', content: { agent: [] }, message: '配置项 agent 必须是对象' },
    {
      name: '字符串字段类型错误',
      content: { model: { name: 42 } },
      message: '配置项 model.name 必须是字符串',
    },
  ])('$name 时直接报错', ({ content, message }) => {
    const dir = tempDir();
    writeConfig(dir, content);

    expect(() => loadConfig({ cwd: dir, env: {} })).toThrow(message);
  });
});
