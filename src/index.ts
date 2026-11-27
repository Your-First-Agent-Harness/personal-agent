export const VERSION = '0.3.0';

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
export { createTaskSummary, formatTaskSummary } from './context/task-summary.ts';
export type { TaskStepStatus, TaskStepSummary, TaskSummary } from './context/task-summary.ts';
export type { AgentLoopOptions, AgentLoopResult } from './runtime/loop.ts';
export { TaskStateMachine } from './runtime/task-state.ts';
export type { TaskRunStatus, TaskStateMachineOptions, TaskTurnState } from './runtime/task-state.ts';
export { decideRecovery } from './runtime/recovery.ts';
export type { RecoveryAction, RecoveryDecision } from './runtime/recovery.ts';
export { createTaskPlan, updatePlanStep } from './runtime/task-plan.ts';
export type { PlanStep, PlanStepStatus, TaskPlan } from './runtime/task-plan.ts';
export { calculateCost } from './runtime/cost.ts';
export type { CostEvent, CostReport } from './runtime/cost.ts';
export { decideCostAction } from './runtime/cost-budget.ts';
export type { CostAction, CostDecision } from './runtime/cost-budget.ts';
export { summarizeBenchmark } from './runtime/benchmark.ts';
export type { BenchmarkResult, BenchmarkSummary } from './runtime/benchmark.ts';
export { TaskQueue } from './runtime/task-queue.ts';
export type { QueueTask, QueueTaskStatus } from './runtime/task-queue.ts';
export { createBackgroundRunner } from './runtime/background-runner.ts';
export type { BackgroundRunner } from './runtime/background-runner.ts';
export { TaskController } from './runtime/task-control.ts';
export type { ControlledTask, ControlledTaskStatus } from './runtime/task-control.ts';
export { canUseSubAgentTool, createSubAgentSpec } from './runtime/sub-agent.ts';
export type { SubAgentSpec } from './runtime/sub-agent.ts';
export { aggregateParallelResults, runParallelAgents } from './runtime/parallel-agents.ts';
export type { ParallelAgentResult } from './runtime/parallel-agents.ts';
export { validateSubAgentPolicy } from './runtime/sub-agent-policy.ts';
export type { SubAgentPolicy } from './runtime/sub-agent-policy.ts';
export { readyDagNodes, validateDag } from './runtime/task-dag.ts';
export type { DagNode } from './runtime/task-dag.ts';
export { RunStore } from './runtime/run-store.ts';
export type { RunRecord } from './runtime/run-store.ts';
export { IdempotencyStore } from './runtime/idempotency.ts';
export type { IdempotencyRecord } from './runtime/idempotency.ts';
export { TraceRecorder } from './observability/trace.ts';
export type { TraceSpan } from './observability/trace.ts';
export { TraceStore, createReplayInput } from './observability/trace-store.ts';
export type { TraceSnapshot } from './observability/trace-store.ts';
export { replayTrace } from './observability/replay.ts';
export type { ReplayResult, ReplayStep } from './observability/replay.ts';
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
export { expandToolSchemaGroup, groupToolSchemas } from './tools/schema-groups.ts';
export type { ToolSchemaGroup } from './tools/schema-groups.ts';
export { runContextPressureCases } from './context/pressure.ts';
export type { ContextPressureCase, ContextPressureResult } from './context/pressure.ts';
export { acceptsLongTermMemory, classifyMemory } from './memory/layers.ts';
export type { MemoryEntry, MemoryLayer } from './memory/layers.ts';
export { MemoryWriter } from './memory/writer.ts';
export type { MemoryCandidate, MemoryWriteResult } from './memory/writer.ts';
export { searchMemory } from './memory/retriever.ts';
export type { MemoryMatch } from './memory/retriever.ts';
export { resolveMemoryVersions } from './memory/conflicts.ts';
export type { MemoryConflict, MemoryVersion } from './memory/conflicts.ts';
export { runD050G2Demo } from './demo/d050.ts';
export type { D050G2Report } from './demo/d050.ts';
