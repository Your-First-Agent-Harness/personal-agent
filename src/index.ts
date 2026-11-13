export const VERSION = '0.1.0';

export type { ChatRequest, ChatResult, ModelProvider } from './adapters/model/provider.ts';
export type { Tool, ToolContext } from './core/tool.ts';
export { runG1Demo } from './demo/g1.ts';
export type { G1DemoReport } from './demo/g1.ts';
export { runD032Demo } from './demo/d032.ts';
export type { D032DemoOptions, D032DemoReport, D032DemoStep } from './demo/d032.ts';
export { createD032Tools } from './demo/d032-tools.ts';
export { runD041Demo } from './demo/d041.ts';
export type { D041DemoReport, D041DemoStep, D041Source } from './demo/d041.ts';
export { runAgentLoop } from './runtime/loop.ts';
export type { AgentLoopOptions, AgentLoopResult } from './runtime/loop.ts';
export { createBuiltinTools } from './tools/builtin.ts';
export { createKnowledgeTools } from './tools/knowledge.ts';
export type {
  ToolCircuitBreakerOptions,
  ToolRateLimitOptions,
  ToolResilienceOptions,
  ToolRetryOptions,
} from './tools/resilience.ts';
export { ToolRegistry } from './tools/registry.ts';
export type {
  SensitiveToolConfirmation,
  ToolConfirmationRequest,
  ToolDescriptor,
  ToolMetadata,
  ToolRegistrationOptions,
  ToolRegistryPolicy,
} from './tools/registry.ts';
export { createWeatherCurrentTool } from './tools/weather.ts';
export type {
  WeatherCurrentInput,
  WeatherCurrentResult,
  WeatherCurrentToolOptions,
} from './tools/weather.ts';
export { runD042Demo } from './demo/d042.ts';
export type {
  D042DemoMode,
  D042DemoOptions,
  D042DemoReport,
} from './demo/d042.ts';
export { sandboxedCommandTool } from './tools/sandboxed-command.ts';
export type { SandboxedCommandResult } from './tools/sandboxed-command.ts';
export { runD043Demo } from './demo/d043.ts';
export type { D043DemoReport } from './demo/d043.ts';
