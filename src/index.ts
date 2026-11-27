export const VERSION = '0.2.0';

export type { ChatRequest, ChatResult, ModelProvider } from './adapters/model/provider.ts';
export type { Tool, ToolContext, ToolSchema } from './core/tool.ts';
export { runG1Demo } from './demo/g1.ts';
export type { G1DemoReport } from './demo/g1.ts';
export { runD032Demo } from './demo/d032.ts';
export type { D032DemoOptions, D032DemoReport, D032DemoStep } from './demo/d032.ts';
export { createD032Tools } from './demo/d032-tools.ts';
export { runD041Demo } from './demo/d041.ts';
export type { D041DemoReport, D041DemoStep, D041Source } from './demo/d041.ts';
export { runAgentLoop } from './runtime/loop.ts';
export { measureContextBudget, messageBudget, toolSchemaChars } from './context/budget.ts';
export type { ContextBudgetInput, ContextBudgetReport } from './context/budget.ts';
export { buildPrioritizedContext } from './context/priority.ts';
export type { ContextDecision, ContextPriority, PrioritizedContext } from './context/priority.ts';
export { truncateAssistantText, truncateToolResult } from './context/truncate.ts';
export type { TruncationReport } from './context/truncate.ts';
export { DeterministicContextCompactor } from './context/compactor.ts';
export type { ContextCompactionResult, ContextCompactor } from './context/compactor.ts';
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
export { DynamicToolRegistry } from './tools/dynamic-registry.ts';
export type { DynamicToolRegistryOptions } from './tools/dynamic-registry.ts';
export {
  DEFAULT_TOOL_SEARCH_LIMIT,
  searchToolMatches,
  searchToolSchemas,
} from './tools/retrieval.ts';
export type { ToolSearchMatch, ToolSearchable } from './tools/retrieval.ts';
export type {
  SensitiveToolConfirmation,
  ToolFactory,
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
export { createSecureCommandTool } from './tools/secure-command.ts';
export type {
  CommandAllowRule,
  SecureCommandResources,
  SecureCommandResult,
  SecureCommandToolOptions,
} from './tools/secure-command.ts';
export { createJsonlAuditSink } from './observability/audit-sink.ts';
export type {
  AuditResourceUsage,
  AuditSink,
  CommandAuditRecord,
  JsonlAuditSinkOptions,
} from './observability/audit-sink.ts';
export { runD044Demo } from './demo/d044.ts';
export type { D044DemoReport } from './demo/d044.ts';
export { runD046Demo } from './demo/d046.ts';
export type { D046DemoItem, D046DemoReport } from './demo/d046.ts';
export { runD048Demo } from './demo/d048.ts';
export type { D048DemoReport, D048RequestReport } from './demo/d048.ts';
export { runD049Demo } from './demo/d049.ts';
export type { D049RetrievalReport } from './demo/d049.ts';
export { runD050G2Demo } from './demo/d050.ts';
export type { D050G2Report } from './demo/d050.ts';
