import { appendFileSync, existsSync, readFileSync } from 'node:fs';

import type { ChatResult, ModelProvider } from '../src/adapters/model/provider.ts';
import { SqliteRunStore } from '../src/memory/run-store.ts';
import { SqliteSessionStore } from '../src/memory/session-store.ts';
import type {
  PersistentAgentRunResult,
  PersistentAgentRunOptions,
} from '../src/runtime/persistent-runner.ts';
import { PersistentAgentService } from '../src/runtime/persistent-runner.ts';
import { ToolRegistry } from '../src/tools/registry.ts';

const mode = process.argv[2];
const databasePath = process.argv[3]!;
const sessionId = process.argv[4]!;
const completedRunId = process.argv[5]!;
const crashedRunId = process.argv[6]!;
const toolLogPath = process.argv[7]!;
const sessionStore = new SqliteSessionStore(databasePath);
const runStore = new SqliteRunStore(databasePath);
const service = new PersistentAgentService({ sessionStore, runStore });

function toolLog(): string[] {
  if (!existsSync(toolLogPath)) {
    return [];
  }
  return readFileSync(toolLogPath, 'utf8').split('\n').filter((line) => line !== '');
}

function recordingRegistry(label: string, onExecute?: () => void): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register({
    name: 'record',
    description: '向本地日志追加一条真实副作用记录',
    parameters: { type: 'object', properties: {} },
    execute: () => {
      onExecute?.();
      appendFileSync(toolLogPath, `${label}\n`, 'utf8');
      return Promise.resolve({ content: label });
    },
  });
  return registry;
}

function runOptions(
  runId: string,
  userMessage: string,
  provider: ModelProvider,
  registry: ToolRegistry,
): PersistentAgentRunOptions {
  return {
    runId,
    sessionId,
    userMessage,
    provider,
    registry,
    maxTurns: 3,
    maxTokens: 128,
    workspaceRoot: process.cwd(),
  };
}

function execution(result: PersistentAgentRunResult) {
  return {
    messages: result.messages,
    text: result.text,
    turns: result.turns,
    stopReason: result.stopReason,
    usage: result.usage,
    run: result.run,
  };
}

function completedProvider(): ModelProvider {
  let calls = 0;
  return {
    name: 'completed-provider',
    chat: () => {
      calls += 1;
      if (calls === 1) {
        return Promise.resolve({
          text: '',
          model: 'm',
          toolCalls: [{ id: 'complete-call', name: 'record', arguments: '{}' }],
        });
      }
      return Promise.resolve({
        text: '完成结果',
        model: 'm',
        usage: { inputTokens: 7, outputTokens: 3 },
      });
    },
  };
}

function crashingProvider(): ModelProvider {
  let calls = 0;
  return {
    name: 'crashing-provider',
    chat: () => {
      calls += 1;
      if (calls === 1) {
        return Promise.resolve({
          text: '',
          model: 'm',
          toolCalls: [{ id: 'crash-call', name: 'record', arguments: '{}' }],
        });
      }
      // 保持事件循环存活；ready 在工具副作用之后发出，父进程只以 ready 决定 SIGKILL 时机。
      setInterval(() => undefined, 60_000);
      process.stdout.write(`${JSON.stringify({ type: 'ready', runId: crashedRunId })}\n`);
      return new Promise<ChatResult>(() => {});
    },
  };
}

try {
  if (mode === 'complete') {
    const result = await service.run(runOptions(
      completedRunId,
      '完成请求',
      completedProvider(),
      recordingRegistry('complete'),
    ));
    process.stdout.write(`${JSON.stringify({
      type: 'completed',
      execution: execution(result),
      sessionMessages: result.session.snapshot(),
      toolLog: toolLog(),
    })}\n`);
  } else if (mode === 'crash') {
    await service.run(runOptions(
      crashedRunId,
      '崩溃请求',
      crashingProvider(),
      recordingRegistry('crash'),
    ));
  } else if (mode === 'verify') {
    let providerCalls = 0;
    let unexpectedToolCalls = 0;
    const forbiddenProvider: ModelProvider = {
      name: 'forbidden-provider',
      chat: () => {
        providerCalls += 1;
        return Promise.resolve({ text: '不应执行', model: 'm' });
      },
    };
    const forbiddenRegistry = recordingRegistry('unexpected', () => {
      unexpectedToolCalls += 1;
    });
    const recovered = service.recover(sessionId);
    const recoveredAgain = service.recover(sessionId);
    const duplicate = await service.run(runOptions(
      completedRunId,
      '完成请求',
      forbiddenProvider,
      forbiddenRegistry,
    ));
    const interruptedError = await service.run(runOptions(
      crashedRunId,
      '崩溃请求',
      forbiddenProvider,
      forbiddenRegistry,
    )).then(
      () => '',
      (error: unknown) => error instanceof Error ? error.message : String(error),
    );
    process.stdout.write(`${JSON.stringify({
      type: 'verified',
      recovered: recovered && {
        sessionId: recovered.session.id,
        messages: recovered.session.snapshot(),
        interruptedRuns: recovered.interruptedRuns,
      },
      recoveredAgain: recoveredAgain && {
        sessionId: recoveredAgain.session.id,
        messages: recoveredAgain.session.snapshot(),
        interruptedRuns: recoveredAgain.interruptedRuns,
      },
      duplicate: execution(duplicate),
      runs: runStore.list(sessionId),
      toolLog: toolLog(),
      providerCalls,
      unexpectedToolCalls,
      interruptedError,
    })}\n`);
  } else {
    throw new Error(`未知模式：${String(mode)}`);
  }
} finally {
  runStore.close();
  sessionStore.close();
}
