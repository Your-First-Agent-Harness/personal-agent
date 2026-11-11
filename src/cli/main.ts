import { randomUUID } from 'node:crypto';

import { loadConfig } from '../adapters/config.ts';
import {
  createOpenAICompatibleProvider,
  ModelError,
} from '../adapters/model/openai-compatible.ts';
import type { Message } from '../core/message.ts';
import { createLoggerEventSink } from '../observability/event-sink.ts';
import { createLogger } from '../observability/logger.ts';
import { runAgentLoop } from '../runtime/loop.ts';
import { createBuiltinTools } from '../tools/fs.ts';
import { ToolRegistry } from '../tools/registry.ts';

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

  const registry = new ToolRegistry();
  for (const tool of createBuiltinTools()) {
    registry.register(tool);
  }

  const messages: Message[] = [
    {
      role: 'system',
      content: [
        '你是一个从零实现的 Agent Harness，回答尽量简洁。',
        '需要读文件或看目录时，优先调用工具，不要凭记忆编造文件内容。',
      ].join('\n'),
    },
    { role: 'user', content: prompt },
  ];

  const startedAt = Date.now();
  try {
    const result = await runAgentLoop({
      provider,
      registry,
      messages,
      maxTurns: config.agent.maxTurns,
      maxTokens: config.agent.maxTokensPerTurn,
      workspaceRoot: config.workspace.root,
      eventSink: createLoggerEventSink(logger),
    });

    process.stdout.write(
      result.stopReason === 'max_turns'
        ? `已达到最大轮次 ${config.agent.maxTurns}，任务未收敛。最后一条消息：\n${JSON.stringify(result.messages.at(-1))}\n`
        : `${result.text}\n`,
    );
    logger.info('运行结束', {
      stopReason: result.stopReason,
      turns: result.turns,
      latencyMs: Date.now() - startedAt,
      usage: result.usage,
    });
  } catch (error) {
    logger.error('运行失败', {
      message: error instanceof Error ? error.message : String(error),
      status: error instanceof ModelError ? (error.status ?? null) : null,
      latencyMs: Date.now() - startedAt,
    });
    process.exitCode = 1;
  }
}
