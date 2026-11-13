import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface AuditResourceUsage {
  timeoutMs: number;
  maxOutputBytes: number;
  stdoutBytes: number;
  stderrBytes: number;
  outputTruncated: boolean;
  queueWaitMs: number;
  cleanedUp: boolean;
}

export interface CommandAuditRecord {
  schemaVersion: 1;
  timestamp: string;
  operationId: string;
  phase: 'decision' | 'completion';
  tool: 'secure_command';
  ruleId: string | null;
  decision: 'allowed' | 'denied';
  status: 'pending' | 'succeeded' | 'denied' | 'failed';
  resultCode: string;
  executable: string;
  argv: string[];
  argvSha256: string;
  durationMs: number;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  resource: AuditResourceUsage;
}

export interface AuditSink {
  append(record: CommandAuditRecord): Promise<void>;
}

export interface JsonlAuditSinkOptions {
  filePath: string;
}

export function createJsonlAuditSink(options: JsonlAuditSinkOptions): AuditSink {
  if (typeof options.filePath !== 'string' || options.filePath.length === 0 || options.filePath.includes('\0')) {
    throw new TypeError('AuditSink filePath 必须是非空、无 NUL 的字符串');
  }

  let chain = Promise.resolve();
  return {
    append(record) {
      const operation = chain.then(async () => {
        const line = `${JSON.stringify(record)}\n`;
        await mkdir(dirname(options.filePath), { recursive: true });
        await appendFile(options.filePath, line, { encoding: 'utf8', flag: 'a' });
      });
      chain = operation.catch(() => undefined);
      return operation;
    },
  };
}
