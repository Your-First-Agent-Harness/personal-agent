import { Readable, Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { runRepl } from '../src/cli/repl.ts';

function captureOutput(): { output: Writable; text: () => string } {
  let text = '';
  const output = new Writable({
    write(chunk, _encoding, callback) {
      text += String(chunk);
      callback();
    },
  });
  return { output, text: () => text };
}

describe('runRepl', () => {
  it('忽略空行，逐轮输出答案，并在 /exit 后停止处理输入', async () => {
    const prompts: string[] = [];
    const { output, text } = captureOutput();

    await runRepl({
      input: Readable.from(['  第一轮  \n\n第二轮\n/exit\n第三轮\n']),
      output,
      runTurn(prompt) {
        prompts.push(prompt);
        return Promise.resolve(`回答 ${prompts.length}`);
      },
    });

    expect(prompts).toEqual(['第一轮', '第二轮']);
    expect(text()).toBe('回答 1\n回答 2\n');
  });

  it('单轮输入执行一次 runTurn 并输出答案', async () => {
    const prompts: string[] = [];
    const { output, text } = captureOutput();

    await runRepl({
      input: Readable.from(['唯一问题\n']),
      output,
      runTurn(prompt) {
        prompts.push(prompt);
        return Promise.resolve('固定答案');
      },
    });

    expect(prompts).toEqual(['唯一问题']);
    expect(text()).toBe('固定答案\n');
  });

  it('首行 /exit 时不调用 runTurn', async () => {
    const prompts: string[] = [];
    const { output, text } = captureOutput();

    await runRepl({
      input: Readable.from(['/exit\n不应执行\n']),
      output,
      runTurn(prompt) {
        prompts.push(prompt);
        return Promise.resolve('不应输出');
      },
    });

    expect(prompts).toEqual([]);
    expect(text()).toBe('');
  });
});
