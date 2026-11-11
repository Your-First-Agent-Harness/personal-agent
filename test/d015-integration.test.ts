import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { ChatRequest, ChatResult, ModelProvider } from '../src/adapters/model/provider.ts';
import type { AgentEvent } from '../src/core/event.ts';
import type { ToolResult } from '../src/core/tool.ts';
import { Session } from '../src/memory/session.ts';
import { runAgentLoop } from '../src/runtime/loop.ts';
import { createBuiltinTools } from '../src/tools/builtin.ts';
import { ToolRegistry } from '../src/tools/registry.ts';

function scriptedProvider(results: readonly ChatResult[]): {
  provider: ModelProvider;
  requests: ChatRequest[];
} {
  const requests: ChatRequest[] = [];
  let index = 0;
  return {
    requests,
    provider: {
      name: 'scripted-d015',
      chat(request) {
        requests.push({ ...request, messages: request.messages.map((message) => ({
          ...message,
          ...(message.toolCalls === undefined
            ? {}
            : { toolCalls: message.toolCalls.map((call) => ({ ...call })) }),
        })) });
        const result = results[index];
        index += 1;
        return result === undefined
          ? Promise.reject(new Error('脚本里没有更多响应'))
          : Promise.resolve(result);
      },
    },
  };
}

describe('D015 工作区修复闭环', () => {
  it('失败测试回喂后精确编辑并复测成功，事件与 Session 保留完整历史', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pa-d015-integration-'));
    try {
      writeFileSync(join(root, 'math.js'), 'export function add(a, b) { return a - b; }\n');
      writeFileSync(join(root, 'math.test.js'), [
        "import assert from 'node:assert/strict';",
        "import { test } from 'node:test';",
        "import { add } from './math.js';",
        "test('add', () => { assert.equal(add(2, 2), 4); });",
        '',
      ].join('\n'));

      const command = `${JSON.stringify(process.execPath)} --test math.test.js`;
      const { provider, requests } = scriptedProvider([
        {
          text: '',
          model: 'scripted',
          toolCalls: [{ id: 'read-1', name: 'read_file', arguments: '{"path":"math.js"}' }],
        },
        {
          text: '',
          model: 'scripted',
          toolCalls: [{
            id: 'test-1',
            name: 'run_command',
            arguments: JSON.stringify({ command }),
          }],
        },
        {
          text: '',
          model: 'scripted',
          toolCalls: [{
            id: 'edit-1',
            name: 'edit_file',
            arguments: JSON.stringify({
              path: 'math.js',
              oldText: 'return a - b',
              newText: 'return a + b',
            }),
          }],
        },
        {
          text: '',
          model: 'scripted',
          toolCalls: [{
            id: 'test-2',
            name: 'run_command',
            arguments: JSON.stringify({ command }),
          }],
        },
        { text: '修复完成，测试已通过', model: 'scripted' },
      ]);
      const registry = new ToolRegistry();
      for (const tool of createBuiltinTools()) registry.register(tool);
      const toolResults: ToolResult[] = [];
      const execute = registry.execute.bind(registry);
      vi.spyOn(registry, 'execute').mockImplementation(async (call, context) => {
        const toolResult = await execute(call, context);
        toolResults.push(toolResult);
        return toolResult;
      });
      const events: AgentEvent[] = [];
      const session = new Session('d015-integration', [
        { role: 'system', content: '读取文件，运行测试，修复后必须复测。' },
        { role: 'user', content: '修复 math.js，让 math.test.js 通过。' },
      ]);
      const before = session.snapshot();

      const result = await runAgentLoop({
        provider,
        registry,
        messages: before,
        maxTurns: 8,
        maxTokens: 256,
        maxContextChars: 24_000,
        maxConsecutiveToolErrors: 3,
        workspaceRoot: root,
        eventSink: { emit: (event) => events.push(event) },
      });
      session.append(result.messages.slice(before.length));

      expect(result.stopReason).toBe('completed');
      expect(result.turns).toBe(5);
      expect(result.text).toBe('修复完成，测试已通过');
      expect(readFileSync(join(root, 'math.js'), 'utf8')).toBe(
        'export function add(a, b) { return a + b; }\n',
      );
      expect(requests).toHaveLength(5);
      expect(requests.map((request) => request.messages.length)).toEqual([2, 4, 6, 8, 10]);

      const failedRun = requests[2]?.messages.filter((message) => message.role === 'tool').at(-1);
      expect(failedRun).toMatchObject({ role: 'tool', toolCallId: 'test-1', name: 'run_command' });
      expect(failedRun?.content).toContain('"exitCode":1');
      expect(failedRun?.content).toContain('failing');

      const successfulRun = requests[4]?.messages
        .filter((message) => message.role === 'tool')
        .at(-1);
      expect(successfulRun).toMatchObject({ role: 'tool', toolCallId: 'test-2', name: 'run_command' });
      expect(successfulRun?.content).toContain('"exitCode":0');

      expect(toolResults).toHaveLength(4);
      expect(toolResults[1]).toMatchObject({
        isError: true,
        error: { code: 'COMMAND_FAILED', retryable: true },
      });
      expect(toolResults[3]?.isError).not.toBe(true);
      expect(toolResults[3]).not.toHaveProperty('error');

      expect(result.messages.map((message) => message.role)).toEqual([
        'system',
        'user',
        'assistant',
        'tool',
        'assistant',
        'tool',
        'assistant',
        'tool',
        'assistant',
        'tool',
        'assistant',
      ]);
      expect(result.messages.slice(2).map((message) => message.role === 'assistant'
        ? `assistant:${message.toolCalls?.[0]?.id ?? 'final'}`
        : `tool:${message.toolCallId ?? 'missing'}:${message.name ?? 'missing'}`))
        .toEqual([
          'assistant:read-1',
          'tool:read-1:read_file',
          'assistant:test-1',
          'tool:test-1:run_command',
          'assistant:edit-1',
          'tool:edit-1:edit_file',
          'assistant:test-2',
          'tool:test-2:run_command',
          'assistant:final',
        ]);

      expect(events.map((event) => event.type)).toEqual([
        'turn_started',
        'assistant_responded',
        'tool_call_started',
        'tool_call_finished',
        'turn_started',
        'assistant_responded',
        'tool_call_started',
        'tool_call_finished',
        'turn_started',
        'assistant_responded',
        'tool_call_started',
        'tool_call_finished',
        'turn_started',
        'assistant_responded',
        'tool_call_started',
        'tool_call_finished',
        'turn_started',
        'assistant_responded',
        'run_completed',
      ]);
      const finished = events.filter((event) => event.type === 'tool_call_finished');
      expect(finished.map((event) => ({
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        isError: event.isError,
      }))).toEqual([
        { toolCallId: 'read-1', toolName: 'read_file', isError: false },
        { toolCallId: 'test-1', toolName: 'run_command', isError: true },
        { toolCallId: 'edit-1', toolName: 'edit_file', isError: false },
        { toolCallId: 'test-2', toolName: 'run_command', isError: false },
      ]);
      expect(events.find((event) => event.type === 'tool_call_finished' && event.isError))
        .toMatchObject({ toolCallId: 'test-1', isError: true });
      expect(events.at(-1)).toEqual({ type: 'run_completed', turn: 5, stopReason: 'completed' });
      expect(session.snapshot()).toEqual(result.messages);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
    expect(existsSync(root)).toBe(false);
  });
});
