import { evaluateReplay } from '../observability/eval.ts';
import { replayTrace } from '../observability/replay.ts';
import { TraceRecorder } from '../observability/trace.ts';
import { createReplayInput, TraceStore } from '../observability/trace-store.ts';

export async function runD085G4Acceptance(): Promise<string> {
  const recorder = new TraceRecorder('d085-g4');
  const root = recorder.start('task');
  const tool = recorder.start('tool', root.id, { tool: 'read_file' });
  recorder.end(tool.id, { output: 'ok' });
  recorder.end(root.id, { output: 'ok' });
  const snapshot = new TraceStore().save('d085-g4', recorder.list());
  const replay = await replayTrace(createReplayInput(snapshot), (step) => Promise.resolve(`${step.name}:ok`));
  const evaluation = evaluateReplay({ id: 'd085-g4', expected: ['task:ok', 'tool:ok'] }, replay.steps);
  if (!evaluation.passed) throw new Error(`D085 G4 验收失败：${evaluation.mismatches.join('; ')}`);
  return 'D085 G4 ACCEPTANCE PASS';
}
