import { LOG_LEVELS, type LogLevel } from '../adapters/config.ts';

const SEVERITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export type LogBindings = Record<string, unknown>;

export interface Logger {
  debug(message: string, bindings?: LogBindings): void;
  info(message: string, bindings?: LogBindings): void;
  warn(message: string, bindings?: LogBindings): void;
  error(message: string, bindings?: LogBindings): void;
  /** 派生一个携带固定字段的 logger，通常用于绑定 traceId / sessionId */
  child(bindings: LogBindings): Logger;
}

export interface LoggerOptions {
  readonly level?: LogLevel;
  readonly bindings?: LogBindings;
  readonly sink?: (line: string) => void;
  readonly now?: () => Date;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? 'info';
  const baseBindings = options.bindings ?? {};
  const sink = options.sink ?? ((line: string) => void process.stdout.write(`${line}\n`));
  const now = options.now ?? (() => new Date());

  const emit = (recordLevel: LogLevel, message: string, bindings?: LogBindings): void => {
    if (SEVERITY[recordLevel] < SEVERITY[level]) {
      return;
    }
    const record = {
      time: now().toISOString(),
      level: recordLevel,
      message,
      ...baseBindings,
      ...bindings,
    };
    sink(JSON.stringify(record));
  };

  return {
    debug: (message, bindings) => emit('debug', message, bindings),
    info: (message, bindings) => emit('info', message, bindings),
    warn: (message, bindings) => emit('warn', message, bindings),
    error: (message, bindings) => emit('error', message, bindings),
    child: (bindings) =>
      createLogger({ level, bindings: { ...baseBindings, ...bindings }, sink, now }),
  };
}

export { LOG_LEVELS };
