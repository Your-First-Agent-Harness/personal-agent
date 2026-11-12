import { existsSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { runD041Demo } from '../src/demo/d041.ts';

interface DemoStep {
  readonly id: string;
  readonly name: string;
  readonly arguments: string;
  readonly result: string;
  readonly isError: boolean;
}

interface DemoSource {
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

describe('D041 真实 AgentLoop 知识库 Demo', () => {
  it('模型从真实 search 工具消息取路径和行号，再 read 并生成有来源的回答', async () => {
    const output: string[] = [];
    const report = await runD041Demo((line) => output.push(line));
    const transcript = output.join('\n');

    expect(report.provider).toBe('deterministic-d041-script');
    expect(report.registeredTools).toEqual(['knowledge_search', 'knowledge_read']);
    expect(report.toolNames).toEqual(['knowledge_search', 'knowledge_read']);
    expect(report.stopReason).toBe('completed');
    expect(report.turns).toBe(3);
    expect(report.steps).toHaveLength(2);
    expect(report.steps.every((step: DemoStep) => !step.isError)).toBe(true);

    const search = JSON.parse(report.steps[0]!.result) as {
      results: Array<{ path: string; line: number }>;
    };
    const readArguments = JSON.parse(report.steps[1]!.arguments) as Record<string, unknown>;
    expect(readArguments).toEqual({
      path: search.results[0]!.path,
      startLine: search.results[0]!.line,
      endLine: search.results[0]!.line,
    });
    expect(readArguments['path']).toBe('operations/release.md');
    expect(readArguments['startLine']).toBe(3);

    expect(report.sources).toEqual([
      {
        path: 'operations/release.md',
        line: 3,
        text: '发布窗口为每周二 14:00，发布前必须完成全量测试。',
      },
    ] satisfies DemoSource[]);
    expect(report.finalText).toContain('每周二 14:00');
    expect(report.finalText).toContain('operations/release.md:3');
    expect(report.finalText).toContain(report.sources[0]!.text);
    expect(report.workspaceRemoved).toBe(true);
    expect(existsSync(report.workspace)).toBe(false);

    expect(transcript).toContain('不请求网络、不需要 API Key');
    expect(transcript).toContain('knowledge_search');
    expect(transcript).toContain('knowledge_read');
    expect(transcript).toContain('来源：operations/release.md:3');
    expect(transcript).toContain('stopReason=completed');
    expect(transcript).toContain('workspaceRemoved=true');
    expect(transcript).toContain('D041 Demo PASS');
  });
});
