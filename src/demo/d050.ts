import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { StdioMcpClient } from '../adapters/mcp-stdio-client.ts';
import { runD037Demo } from './d037.ts';
import { runD042Demo } from './d042.ts';
import { runD049Demo } from './d049.ts';

const fixture = fileURLToPath(new URL('../../test/fixtures/d037-filesystem-server.ts', import.meta.url));

export interface D050G2Report {
  readonly dynamicRetrieval: { readonly passed: true; readonly matchedTools: readonly string[] };
  readonly externalSystem: { readonly passed: true; readonly source: 'open-meteo'; readonly fetchCalls: number };
  readonly mcp: { readonly passed: true; readonly backends: readonly string[]; readonly remoteTools: readonly string[] };
  readonly checks: readonly string[];
}

function offlineWeatherFetch(): { readonly fetchImpl: typeof fetch; readonly getCalls: () => number } {
  let calls = 0;
  const fetchImpl: typeof fetch = () => {
    calls += 1;
    return Promise.resolve(new Response(JSON.stringify({
      latitude: 31.25,
      longitude: 121.5,
      timezone: 'Asia/Shanghai',
      current_units: { time: 'iso8601', temperature_2m: '°C', wind_speed_10m: 'km/h', weather_code: 'wmo code' },
      current: { time: '2026-12-30T20:00', temperature_2m: 8.5, wind_speed_10m: 4.2, weather_code: 1 },
    }), { headers: { 'content-type': 'application/json' } }));
  };
  return { fetchImpl, getCalls: () => calls };
}

export async function runD050G2Demo(output: (line: string) => void): Promise<D050G2Report> {
  const checks: string[] = [];
  const retrieval = await runD049Demo((line) => output(`[dynamic] ${line}`));
  checks.push('dynamic tool retrieval and lazy loading');

  const weatherTransport = offlineWeatherFetch();
  const weather = await runD042Demo((line) => output(`[external] ${line}`), {
    mode: 'offline',
    fetchImpl: weatherTransport.fetchImpl,
  });
  if (weather.weather.source !== 'open-meteo' || weatherTransport.getCalls() !== 1) {
    throw new Error('G2 外部系统验收失败：weather_current 没有完成结构化响应闭环');
  }
  checks.push('external API tool and structured upstream errors');

  const workspace = mkdtempSync(join(tmpdir(), 'personal-agent-d050-'));
  writeFileSync(join(workspace, 'note.txt'), 'D050 MCP acceptance\n', 'utf8');
  try {
    const mcp = await runD037Demo((line) => output(`[mcp] ${line}`), {
      createMcpClient: (root) => new StdioMcpClient({
        command: process.execPath,
        args: [fixture, root],
        requestTimeoutMs: 1_000,
        closeTimeoutMs: 200,
      }),
    });
    const mcpBackend = mcp.backends.find((backend) => backend.backend === 'mcp');
    if (mcpBackend === undefined || !mcpBackend.closed || mcp.workspaceRemoved !== true) {
      throw new Error('G2 MCP 验收失败：远端后端没有完成关闭和工作区清理');
    }
    const remoteTools = mcpBackend.steps.map((step) => step.remoteName);
    checks.push('MCP client/server bidirectional tool projection');
    output(`G2 MCP remote tools=${remoteTools.join(',')}`);

    const report: D050G2Report = {
      dynamicRetrieval: { passed: true, matchedTools: retrieval.matches.map(({ name }) => name) },
      externalSystem: { passed: true, source: weather.weather.source, fetchCalls: weatherTransport.getCalls() },
      mcp: { passed: true, backends: mcp.backends.map(({ backend }) => backend), remoteTools },
      checks,
    };
    output(`G2 checks=${checks.length}`);
    output('D050 G2 ACCEPTANCE PASS');
    return report;
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}
