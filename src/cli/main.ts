import { randomUUID } from 'node:crypto';

import { loadConfig } from '../adapters/config.ts';
import { createLogger } from '../observability/logger.ts';

const config = loadConfig();
const logger = createLogger({ level: config.log.level }).child({ traceId: randomUUID() });

logger.info('personal-agent 启动', {
  model: config.model.name,
  provider: config.model.provider,
  workspace: config.workspace.root,
  maxTurns: config.agent.maxTurns,
});

logger.debug('调试日志只在 PA_LOG_LEVEL=debug 时出现');
