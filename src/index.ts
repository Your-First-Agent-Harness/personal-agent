export const VERSION = '0.1.0';

export type { ChatRequest, ChatResult, ModelProvider } from './adapters/model/provider.ts';
export type { Tool, ToolContext } from './core/tool.ts';
export { runG1Demo } from './demo/g1.ts';
export type { G1DemoReport } from './demo/g1.ts';
export { runAgentLoop } from './runtime/loop.ts';
export type { AgentLoopOptions, AgentLoopResult } from './runtime/loop.ts';
export { createBuiltinTools } from './tools/builtin.ts';
export { ToolRegistry } from './tools/registry.ts';
export type {
  SensitiveToolConfirmation,
  ToolConfirmationRequest,
  ToolDescriptor,
  ToolMetadata,
  ToolRegistrationOptions,
  ToolRegistryPolicy,
} from './tools/registry.ts';
