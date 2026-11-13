import { describe, expect, it } from 'vitest';

import { runD043Demo } from '../src/demo/d043.ts';

describe('D043 沙箱命令 Demo', () => {
  it('真实证明 cwd/env 隔离、可写清理和 cwd 越权拒绝，且不访问网络', async () => {
    const transcript: string[] = [];
    const report = await runD043Demo((line) => transcript.push(line));
    const text = transcript.join('\n');

    expect(report).toMatchObject({
      hostSecretLeaked: false,
      isolatedCwd: true,
      workingDirectoryWritable: true,
      allowedEnvVisible: true,
      sandboxCleanedUp: true,
      dangerousArtifactRemoved: true,
      escapeBlocked: true,
      escapeErrorCode: 'PATH_OUTSIDE_WORKSPACE',
      hostRootRemoved: true,
    });
    expect(text).toContain('hostSecret=null');
    expect(text).toContain('allowedEnv=explicit-public-value');
    expect(text).toContain('controlledDanger=removed-inside-sandbox');
    expect(text).toContain('cwdEscape=PATH_OUTSIDE_WORKSPACE');
    expect(text).toContain('D043 Demo PASS');
    expect(text).not.toContain('FAKE_D043_DEMO_HOST_SECRET_VALUE');
  }, 10_000);
});
