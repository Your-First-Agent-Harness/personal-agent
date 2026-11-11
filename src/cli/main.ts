import { randomUUID } from 'node:crypto';

import { loadConfig } from '../adapters/config.ts';
import { createOpenAICompatibleProvider, ModelError } from '../adapters/model/openai-compatible.ts';
import type { Message } from '../core/message.ts';
import { createLogger } from '../observability/logger.ts';

const config = loadConfig();
const logger = createLogger({ level: config.log.level }).child({ traceId: randomUUID() });
const prompt = process.argv.slice(2).join(' ').trim();

logger.info('personal-agent 启动', {
  provider: config.model.provider,
  model: config.model.name,
  workspace: config.workspace.root,
  maxTurns: config.agent.maxTurns,
});

if (prompt === '') {
  logger.error('缺少输入，用法：npm run dev -- "你的问题"');
  process.exitCode = 1;
} else if (config.model.provider !== 'openai-compatible') {
  logger.error('暂不支持该 Provider', { provider: config.model.provider });
  process.exitCode = 1;
} else if (config.model.apiKey === undefined) {
  logger.error('缺少模型密钥：请设置 PA_MODEL_API_KEY（密钥只从环境变量读取）');
  process.exitCode = 1;
} else {
  const provider = createOpenAICompatibleProvider({
    baseUrl: config.model.baseUrl ?? 'https://api.openai.com/v1',
    apiKey: config.model.apiKey,
    model: config.model.name,
  });

  const messages: Message[] = [
    { role: 'system', content: '你是一个从零实现的 Agent Harness，回答尽量简洁。' },
    { role: 'user', content: prompt },
  ];

  const startedAt = Date.now();
  try {
    const result = await provider.chat({ messages, maxTokens: config.agent.maxTokensPerTurn });
    process.stdout.write(`${result.text}\n`);
    logger.info('模型回复完成', {
      model: result.model,
      latencyMs: Date.now() - startedAt,
      usage: result.usage ?? null,
    });
  } catch (error) {
    logger.error('模型调用失败', {
      message: error instanceof Error ? error.message : String(error),
      status: error instanceof ModelError ? (error.status ?? null) : null,
      latencyMs: Date.now() - startedAt,
    });
    process.exitCode = 1;
  }
}
