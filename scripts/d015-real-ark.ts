import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadConfig } from '../src/adapters/config.ts';
import { createOpenAICompatibleProvider } from '../src/adapters/model/openai-compatible.ts';
import { runAgentLoop } from '../src/runtime/loop.ts';
import { createBuiltinTools } from '../src/tools/builtin.ts';
import { ToolRegistry } from '../src/tools/registry.ts';

const testSource = [
  "import assert from 'node:assert/strict';",
  "import { test } from 'node:test';",
  "import { add } from './math.js';",
  "test('add', () => { assert.equal(add(2, 2), 4); });",
  '',
].join('\n');

const config = loadConfig();
if (config.model.provider !== 'openai-compatible' || config.model.apiKey === undefined) {
  throw new Error('请在 .env 配置 PA_MODEL_API_KEY、ARK base URL 和模型名');
}
const root = mkdtempSync(join(tmpdir(), 'pa-d015-ark-'));
try {
  writeFileSync(join(root, 'math.js'), 'export function add(a, b) { return a - b; }\n');
  writeFileSync(join(root, 'math.test.js'), testSource);
  const provider = createOpenAICompatibleProvider({
    baseUrl: config.model.baseUrl ?? 'https://ark.cn-beijing.volces.com/api/v3',
    apiKey: config.model.apiKey,
    model: config.model.name,
  });
  const registry = new ToolRegistry();
  for (const tool of createBuiltinTools()) registry.register(tool);
  const result = await runAgentLoop({
    provider,
    registry,
    messages: [
      { role: 'system', content: '你是修复助手。必须读取文件、运行测试、精确编辑并复测，不要编造结果。' },
      { role: 'user', content: '修复当前工作区的 math.js，使 node --test math.test.js 通过。' },
    ],
    maxTurns: config.agent.maxTurns,
    maxTokens: config.agent.maxTokensPerTurn,
    maxContextChars: config.agent.maxContextChars,
    maxConsecutiveToolErrors: config.agent.maxConsecutiveToolErrors,
    workspaceRoot: root,
    eventSink: { emit: (event) => process.stdout.write(`${JSON.stringify(event)}\n`) },
  });
  const verification = spawnSync(process.execPath, ['--test', 'math.test.js'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 10_000,
  });
  process.stdout.write(`${JSON.stringify({
    model: config.model.name,
    stopReason: result.stopReason,
    turns: result.turns,
    text: result.text,
    verificationExitCode: verification.status,
    verificationStdout: verification.stdout,
    verificationStderr: verification.stderr,
  })}\n`);
  if (result.stopReason !== 'completed' || verification.status !== 0) process.exitCode = 1;
} finally {
  rmSync(root, { recursive: true, force: true });
}
