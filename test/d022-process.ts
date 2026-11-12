import type { ChatResult, ModelProvider } from '../src/adapters/model/provider.ts';
import { SqliteRunStore } from '../src/memory/run-store.ts';
import { SqliteSessionStore } from '../src/memory/session-store.ts';
import { PersistentAgentService } from '../src/runtime/persistent-runner.ts';
import { ToolRegistry } from '../src/tools/registry.ts';

const mode = process.argv[2];
const databasePath = process.argv[3]!;
const sessionId = process.argv[4]!;
const runId = process.argv[5]!;
const sessionStore = new SqliteSessionStore(databasePath);
const runStore = new SqliteRunStore(databasePath);
const service = new PersistentAgentService({ sessionStore, runStore });

try {
  if (mode === 'crash') {
    const provider: ModelProvider = {
      name: 'blocking-provider',
      chat: () => {
        process.stdout.write(`${JSON.stringify({ type: 'ready', runId, sessionId })}\n`);
        return new Promise<ChatResult>(() => {});
      },
    };
    await service.run({
      runId,
      sessionId,
      userMessage: '崩溃前必须落盘',
      provider,
      registry: new ToolRegistry(),
      maxTurns: 2,
      maxTokens: 128,
      workspaceRoot: process.cwd(),
    });
  } else if (mode === 'recover') {
    const recovered = service.recover(sessionId);
    const run = recovered?.interruptedRuns.find((candidate) => candidate.id === runId);
    process.stdout.write(
      `${JSON.stringify({
        type: 'recovered',
        sessionId: recovered?.session.id,
        messages: recovered?.session.snapshot(),
        run,
      })}\n`,
    );
  } else {
    throw new Error(`未知模式：${String(mode)}`);
  }
} finally {
  runStore.close();
  sessionStore.close();
}
