import { createInterface } from 'node:readline/promises';

export interface ReplOptions {
  readonly input: NodeJS.ReadableStream;
  readonly output: NodeJS.WritableStream;
  readonly runTurn: (prompt: string) => Promise<string>;
}

export async function runRepl(options: ReplOptions): Promise<void> {
  const rl = createInterface({ input: options.input, output: options.output });
  try {
    for await (const line of rl) {
      const prompt = line.trim();
      if (prompt === '/exit') break;
      if (prompt === '') continue;
      options.output.write(`${await options.runTurn(prompt)}\n`);
    }
  } finally {
    rl.close();
  }
}
