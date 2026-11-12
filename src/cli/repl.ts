import { createInterface } from 'node:readline/promises';

import type { EventSink } from '../core/event.ts';

export interface TurnOutput {
  readonly text: string;
  readonly streamed: boolean;
  readonly status?: boolean;
}

export function createTerminalTurn(write: (chunk: string) => void): {
  readonly eventSink: EventSink;
  readonly complete: (text: string, options?: { readonly status?: boolean }) => TurnOutput;
} {
  let streamed = false;
  return {
    eventSink: {
      emit(event) {
        if (event.type === 'assistant_delta') {
          streamed = true;
          write(event.delta);
        }
      },
    },
    complete(text, options) {
      return { text, streamed, ...(options?.status === true ? { status: true } : {}) };
    },
  };
}

export function writeTurnOutput(write: (chunk: string) => void, output: TurnOutput): void {
  if (output.streamed && output.status === true) {
    write(`\n${output.text}\n`);
  } else {
    write(output.streamed ? '\n' : `${output.text}\n`);
  }
}

export interface ReplOptions {
  readonly input: NodeJS.ReadableStream;
  readonly output: NodeJS.WritableStream;
  readonly runTurn: (prompt: string) => Promise<string | TurnOutput>;
}

export async function runRepl(options: ReplOptions): Promise<void> {
  const rl = createInterface({ input: options.input, output: options.output });
  try {
    for await (const line of rl) {
      const prompt = line.trim();
      if (prompt === '/exit') break;
      if (prompt === '') continue;
      const answer = await options.runTurn(prompt);
      if (typeof answer === 'string') {
        options.output.write(`${answer}\n`);
      } else {
        writeTurnOutput((chunk) => options.output.write(chunk), answer);
      }
    }
  } finally {
    rl.close();
  }
}
