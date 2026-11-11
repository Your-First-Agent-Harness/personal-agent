import { describe, expect, it } from 'vitest';

import { createLogger } from '../src/observability/logger.ts';

interface Capture {
  lines: string[];
  sink: (line: string) => void;
}

function capture(): Capture {
  const lines: string[] = [];
  return { lines, sink: (line) => lines.push(line) };
}

/** JSON.parse 的结果是 any，这里显式收窄成可断言的记录类型 */
function record(line: string | undefined): Record<string, unknown> {
  return JSON.parse(line ?? '{}') as Record<string, unknown>;
}

const fixedNow = (): Date => new Date('2026-11-13T11:00:00.000Z');

describe('createLogger', () => {
  it('输出单行 JSON，包含时间、级别与消息', () => {
    const { lines, sink } = capture();
    const logger = createLogger({ sink, now: fixedNow });

    logger.info('启动');

    expect(lines).toHaveLength(1);
    expect(record(lines[0])).toEqual({
      time: '2026-11-13T11:00:00.000Z',
      level: 'info',
      message: '启动',
    });
  });

  it('低于当前级别的日志被丢弃', () => {
    const { lines, sink } = capture();
    const logger = createLogger({ level: 'warn', sink, now: fixedNow });

    logger.debug('忽略');
    logger.info('忽略');
    logger.warn('保留');

    expect(lines).toHaveLength(1);
    expect(record(lines[0]).level).toBe('warn');
  });

  it('error 日志不受默认 info 阈值过滤', () => {
    const { lines, sink } = capture();
    const logger = createLogger({ sink, now: fixedNow });

    logger.error('失败', { code: 'E_TEST' });

    expect(lines).toHaveLength(1);
    expect(record(lines[0])).toMatchObject({ level: 'error', message: '失败', code: 'E_TEST' });
  });

  it('child 派生的字段与调用时字段合并，调用时优先', () => {
    const { lines, sink } = capture();
    const logger = createLogger({ sink, now: fixedNow }).child({ traceId: 'trace-1' });

    logger.info('带上下文', { turn: 2, traceId: 'trace-2' });

    const entry = record(lines[0]);
    expect(entry.traceId).toBe('trace-2');
    expect(entry.turn).toBe(2);
  });

  it('child 不影响父 logger 的绑定', () => {
    const { lines, sink } = capture();
    const parent = createLogger({ sink, now: fixedNow });
    parent.child({ traceId: 'trace-1' }).info('子');
    parent.info('父');

    expect(record(lines[0]).traceId).toBe('trace-1');
    expect(record(lines[1]).traceId).toBeUndefined();
  });
});
