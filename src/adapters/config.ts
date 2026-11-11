import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface AppConfig {
  readonly log: { readonly level: LogLevel };
  readonly model: {
    readonly provider: string;
    readonly name: string;
    readonly apiKey?: string;
    readonly baseUrl?: string;
  };
  readonly agent: {
    readonly maxTurns: number;
    readonly maxTokensPerTurn: number;
  };
  readonly workspace: { readonly root: string };
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const DEFAULTS: AppConfig = {
  log: { level: 'info' },
  model: { provider: 'openai-compatible', name: 'default' },
  agent: { maxTurns: 20, maxTokensPerTurn: 4096 },
  workspace: { root: '.' },
};

export interface LoadConfigOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly fileName?: string;
}

export function loadConfig(options: LoadConfigOptions = {}): AppConfig {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const fileName = options.fileName ?? 'agent.config.json';

  const fromFile = readConfigFile(join(cwd, fileName));
  const fromEnv = readEnv(env);

  return {
    log: { level: fromEnv.log.level ?? fromFile.log.level ?? DEFAULTS.log.level },
    model: {
      provider: fromEnv.model.provider ?? fromFile.model.provider ?? DEFAULTS.model.provider,
      name: fromEnv.model.name ?? fromFile.model.name ?? DEFAULTS.model.name,
      apiKey: fromEnv.model.apiKey ?? fromFile.model.apiKey,
      baseUrl: fromEnv.model.baseUrl ?? fromFile.model.baseUrl,
    },
    agent: {
      maxTurns: fromEnv.agent.maxTurns ?? fromFile.agent.maxTurns ?? DEFAULTS.agent.maxTurns,
      maxTokensPerTurn:
        fromEnv.agent.maxTokensPerTurn ??
        fromFile.agent.maxTokensPerTurn ??
        DEFAULTS.agent.maxTokensPerTurn,
    },
    workspace: { root: fromEnv.workspace.root ?? fromFile.workspace.root ?? DEFAULTS.workspace.root },
  };
}

interface PartialConfig {
  log: { level?: LogLevel };
  model: { provider?: string; name?: string; apiKey?: string; baseUrl?: string };
  agent: { maxTurns?: number; maxTokensPerTurn?: number };
  workspace: { root?: string };
}

const EMPTY: PartialConfig = {
  log: {},
  model: {},
  agent: {},
  workspace: {},
};

function readConfigFile(path: string): PartialConfig {
  if (!existsSync(path)) {
    return EMPTY;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new ConfigError(`配置文件不是合法 JSON：${path}（${String(error)}）`);
  }

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ConfigError(`配置文件必须是对象：${path}`);
  }

  const source = raw as Record<string, unknown>;
  return {
    log: { level: parseLevel(pick(source, 'log', 'level'), `log.level`) },
    model: {
      provider: parseString(pick(source, 'model', 'provider'), 'model.provider'),
      name: parseString(pick(source, 'model', 'name'), 'model.name'),
      apiKey: parseString(pick(source, 'model', 'apiKey'), 'model.apiKey'),
      baseUrl: parseString(pick(source, 'model', 'baseUrl'), 'model.baseUrl'),
    },
    agent: {
      maxTurns: parsePositiveInt(pick(source, 'agent', 'maxTurns'), 'agent.maxTurns'),
      maxTokensPerTurn: parsePositiveInt(
        pick(source, 'agent', 'maxTokensPerTurn'),
        'agent.maxTokensPerTurn',
      ),
    },
    workspace: { root: parseString(pick(source, 'workspace', 'root'), 'workspace.root') },
  };
}

function readEnv(env: NodeJS.ProcessEnv): PartialConfig {
  return {
    log: { level: parseLevel(env['PA_LOG_LEVEL'], 'PA_LOG_LEVEL') },
    model: {
      provider: parseString(env['PA_MODEL_PROVIDER'], 'PA_MODEL_PROVIDER'),
      name: parseString(env['PA_MODEL_NAME'], 'PA_MODEL_NAME'),
      apiKey: parseString(env['PA_MODEL_API_KEY'], 'PA_MODEL_API_KEY'),
      baseUrl: parseString(env['PA_MODEL_BASE_URL'], 'PA_MODEL_BASE_URL'),
    },
    agent: {
      maxTurns: parsePositiveInt(env['PA_MAX_TURNS'], 'PA_MAX_TURNS'),
      maxTokensPerTurn: parsePositiveInt(env['PA_MAX_TOKENS'], 'PA_MAX_TOKENS'),
    },
    workspace: { root: parseString(env['PA_WORKSPACE'], 'PA_WORKSPACE') },
  };
}

function pick(source: Record<string, unknown>, group: string, key: string): unknown {
  const section = source[group];
  if (section === undefined || section === null) {
    return undefined;
  }
  if (typeof section !== 'object' || Array.isArray(section)) {
    throw new ConfigError(`配置项 ${group} 必须是对象`);
  }
  return (section as Record<string, unknown>)[key];
}

function parseString(value: unknown, path: string): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new ConfigError(`配置项 ${path} 必须是字符串`);
  }
  return value;
}

function parsePositiveInt(value: unknown, path: string): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ConfigError(`配置项 ${path} 必须是正整数，实际为 ${describeValue(value)}`);
  }
  return parsed;
}

/** 把任意配置来源的值转成可读文本，避免对象被打印成 [object Object] */
function describeValue(value: unknown): string {
  return typeof value === 'string' ? value : (JSON.stringify(value) ?? 'unknown');
}

function parseLevel(value: unknown, path: string): LogLevel | undefined {
  const text = parseString(value, path);
  if (text === undefined) {
    return undefined;
  }
  if (!LOG_LEVELS.some((candidate) => candidate === text)) {
    throw new ConfigError(`配置项 ${path} 必须是 ${LOG_LEVELS.join(' / ')} 之一，实际为 ${text}`);
  }
  return text as LogLevel;
}
