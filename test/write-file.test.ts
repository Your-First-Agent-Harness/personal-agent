import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { ChatRequest, ChatResult, ModelProvider } from '../src/adapters/model/provider.ts';
import { runAgentLoop } from '../src/runtime/loop.ts';
import { createBuiltinTools } from '../src/tools/builtin.ts';
import { ToolRegistry } from '../src/tools/registry.ts';
import { writeFileTool } from '../src/tools/write-file.ts';

const dirs: string[] = [];

function workspace(): string {
  const base = mkdtempSync(join(tmpdir(), 'pa-write-'));
  dirs.push(base);
  const root = join(base, 'workspace', 'root');
  mkdirSync(root, { recursive: true });
  return root;
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('write_file', () => {
  it('Schema 声明三个参数、两个必填项且不接受额外字段', () => {
    expect(writeFileTool.parameters).toMatchObject({
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
        overwrite: { type: 'boolean' },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    });
  });

  it('新建文件并返回路径和 JS 字符数', async () => {
    const root = workspace();

    const result = await writeFileTool.execute(
      { path: 'note.txt', content: '你好', overwrite: false },
      { workspaceRoot: root },
    );

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain('note.txt');
    expect(result.content).toContain('2');
    expect(readFileSync(join(root, 'note.txt'), 'utf8')).toBe('你好');
  });

  it('默认拒绝覆盖且原内容不变', async () => {
    const root = workspace();
    writeFileSync(join(root, 'a.txt'), 'old');

    const result = await writeFileTool.execute(
      { path: 'a.txt', content: 'new' },
      { workspaceRoot: root },
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain('默认不覆盖');
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('old');
  });

  it('overwrite: true 显式覆盖已有文件', async () => {
    const root = workspace();
    writeFileSync(join(root, 'a.txt'), 'old');

    const result = await writeFileTool.execute(
      { path: 'a.txt', content: 'new', overwrite: true },
      { workspaceRoot: root },
    );

    expect(result.isError).toBeUndefined();
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('new');
  });

  it('拒绝非字符串 content', async () => {
    const root = workspace();

    const result = await writeFileTool.execute(
      { path: 'bad.txt', content: 42 },
      { workspaceRoot: root },
    );

    expect(result.content).toContain('content 必须是字符串');
    expect(result.error?.code).toBe('INVALID_ARGUMENTS');
    expect(existsSync(join(root, 'bad.txt'))).toBe(false);
  });

  it('拒绝非布尔 overwrite', async () => {
    const root = workspace();

    const result = await writeFileTool.execute(
      { path: 'bad.txt', content: 'text', overwrite: 'yes' },
      { workspaceRoot: root },
    );

    expect(result.content).toContain('overwrite 必须是布尔值');
    expect(result.error?.code).toBe('INVALID_ARGUMENTS');
    expect(existsSync(join(root, 'bad.txt'))).toBe(false);
  });

  it('父目录不存在时返回错误且不创建目录', async () => {
    const root = workspace();

    const result = await writeFileTool.execute(
      { path: 'missing/a.txt', content: 'text' },
      { workspaceRoot: root },
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain('父目录不存在');
    expect(existsSync(join(root, 'missing'))).toBe(false);
  });

  it('父路径不是目录时返回错误', async () => {
    const root = workspace();
    writeFileSync(join(root, 'parent.txt'), 'file');

    const result = await writeFileTool.execute(
      { path: 'parent.txt/a.txt', content: 'text' },
      { workspaceRoot: root },
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain('不是目录');
    expect(readFileSync(join(root, 'parent.txt'), 'utf8')).toBe('file');
  });

  it('拒绝路径越狱且不写外部文件', async () => {
    const root = workspace();
    const outside = resolve(root, '../../outside.txt');

    await expect(
      writeFileTool.execute(
        { path: '../../outside.txt', content: '不应写入' },
        { workspaceRoot: root },
      ),
    ).rejects.toThrow('越出工作区');
    expect(existsSync(outside)).toBe(false);
  });
});

describe('write_file Loop 集成', () => {
  it('依次写入、读取并回答，后续请求能看到工具结果', async () => {
    const root = workspace();
    const requests: ChatRequest[] = [];
    const results: ChatResult[] = [
      {
        text: '',
        model: 'scripted',
        toolCalls: [
          {
            id: 'w1',
            name: 'write_file',
            arguments: JSON.stringify({ path: 'note.txt', content: '来自工具' }),
          },
        ],
      },
      {
        text: '',
        model: 'scripted',
        toolCalls: [{ id: 'r1', name: 'read_file', arguments: '{"path":"note.txt"}' }],
      },
      { text: '文件已创建并读取', model: 'scripted' },
    ];
    let index = 0;
    const provider: ModelProvider = {
      name: 'scripted',
      chat(request) {
        requests.push({ ...request, messages: [...request.messages] });
        const result = results[index];
        index += 1;
        if (result === undefined) throw new Error('脚本里没有更多响应');
        return Promise.resolve(result);
      },
    };
    const registry = new ToolRegistry();
    for (const tool of createBuiltinTools()) {
      registry.register(tool);
    }

    expect(registry.list().map((tool) => tool.name)).toEqual([
      'read_file',
      'list_dir',
      'write_file',
      'edit_file',
      'run_command',
    ]);

    const result = await runAgentLoop({
      provider,
      registry,
      messages: [{ role: 'user', content: '创建并读取 note.txt' }],
      maxTurns: 4,
      maxTokens: 128,
      workspaceRoot: root,
    });

    expect(result.stopReason).toBe('completed');
    expect(result.turns).toBe(3);
    expect(result.text).toBe('文件已创建并读取');
    expect(readFileSync(join(root, 'note.txt'), 'utf8')).toBe('来自工具');
    expect(requests).toHaveLength(3);

    const secondRequestTools = requests[1]?.messages.filter((message) => message.role === 'tool');
    expect(secondRequestTools).toHaveLength(1);
    expect(secondRequestTools?.[0]).toMatchObject({ toolCallId: 'w1', name: 'write_file' });
    expect(secondRequestTools?.[0]?.content).toContain('note.txt');

    const thirdRequestTools = requests[2]?.messages.filter((message) => message.role === 'tool');
    expect(thirdRequestTools).toHaveLength(2);
    expect(thirdRequestTools?.[0]).toMatchObject({ toolCallId: 'w1', name: 'write_file' });
    expect(thirdRequestTools?.[1]).toMatchObject({
      toolCallId: 'r1',
      name: 'read_file',
      content: '来自工具',
    });
  });
});
