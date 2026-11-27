import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { runConfigCli } from '../src/cli/config-cli.ts';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe('D087 配置 CLI', () => {
  it('读取配置文件并让环境变量覆盖，同时脱敏 API key', () => {
    const directory = mkdtempSync(join(tmpdir(), 'pa-d087-'));
    directories.push(directory);
    writeFileSync(join(directory, 'agent.config.json'), JSON.stringify({ agent: { maxTurns: 7 }, model: { apiKey: 'file-secret' } }));
    const output = JSON.parse(runConfigCli(['show', '--json'], directory, { PA_MAX_TURNS: '9' })) as {
      agent: { maxTurns: number };
      model: { apiKey: string };
    };
    expect(output.agent.maxTurns).toBe(9);
    expect(output.model.apiKey).toBe('[REDACTED]');
  });

  it('非法配置返回 ConfigError 文本', () => {
    expect(() => runConfigCli(['bad'], process.cwd(), {})).toThrow('用法');
    expect(() => runConfigCli(['show'], process.cwd(), { PA_LOG_LEVEL: 'verbose' })).toThrow('配置项');
  });
});
