import { describe, expect, it } from 'vitest';

import { discoverTools, runToolsCli } from '../src/cli/tools-cli.ts';

describe('D088 工具清单 CLI', () => {
  it('列出内置工具及其 Schema 元数据', () => {
    const tools = discoverTools();
    expect(tools).toHaveLength(5);
    expect(tools.map(({ name }) => name)).toContain('read_file');
    expect(JSON.parse(runToolsCli(['list', '--json']))).toHaveLength(5);
  });

  it('支持人类可读输出并拒绝未知命令', () => {
    expect(runToolsCli(['list'])).toContain('read_file@');
    expect(() => runToolsCli(['install'])).toThrow('用法');
  });
});
