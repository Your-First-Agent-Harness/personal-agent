import { loadConfig } from '../adapters/config.ts';
import type { AppConfig } from '../adapters/config.ts';

export function redactConfig(config: AppConfig): Omit<AppConfig, 'model'> & { model: Omit<AppConfig['model'], 'apiKey'> & { apiKey?: string } } {
  const { apiKey, ...model } = config.model;
  return { ...config, model: { ...model, ...(apiKey === undefined ? {} : { apiKey: '[REDACTED]' }) } };
}

export function runConfigCli(args: readonly string[], cwd = process.cwd(), env = process.env): string {
  if (args[0] !== 'show') throw new Error('用法：personal-agent config show [--json]');
  const config = redactConfig(loadConfig({ cwd, env }));
  return args.includes('--json') ? JSON.stringify(config, null, 2) : formatConfig(config);
}

function formatConfig(config: ReturnType<typeof redactConfig>): string {
  return [
    `model.provider=${config.model.provider}`,
    `model.name=${config.model.name}`,
    `model.apiKey=${config.model.apiKey ?? '<unset>'}`,
    `agent.maxTurns=${config.agent.maxTurns}`,
    `agent.maxTokensPerTurn=${config.agent.maxTokensPerTurn}`,
    `agent.maxContextChars=${config.agent.maxContextChars}`,
    `workspace.root=${config.workspace.root}`,
    `log.level=${config.log.level}`,
  ].join('\n');
}
