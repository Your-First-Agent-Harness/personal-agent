import type { ToolCall } from '../core/message.ts';
import type { Tool, ToolContext, ToolResult, ToolSchema } from '../core/tool.ts';
import { errorResult, normalizeError, toolError } from './errors.ts';
import { ResilientToolExecutor, type ToolResilienceOptions } from './resilience.ts';
import { validateArguments, validateToolSchema } from './schema.ts';

export type ToolMetadata = Readonly<Record<string, unknown>>;

export interface ToolRegistrationOptions {
  readonly version?: string;
  readonly metadata?: ToolMetadata;
  /** 未声明表示共享工具；声明后仅精确匹配的租户策略可见、可执行 */
  readonly tenantId?: string;
  /** 敏感工具每次执行前都必须通过本次调用的确认回调 */
  readonly sensitive?: boolean;
  /** 可选的执行韧性策略；省略时完整保留旧执行路径 */
  readonly resilience?: ToolResilienceOptions;
}

export interface ToolConfirmationRequest {
  readonly callId: string;
  readonly toolName: string;
  readonly args: unknown;
  readonly tenantId?: string;
}

export type SensitiveToolConfirmation = (
  request: ToolConfirmationRequest,
) => boolean | Promise<boolean>;

export interface ToolRegistryPolicy {
  /** undefined 保持 D028 的全量共享工具兼容；数组（包括空数组）表示显式白名单 */
  readonly allowedTools?: readonly string[];
  /** 一个 Registry 只代表一个租户主体，不用调用参数覆盖 */
  readonly tenantId?: string;
  readonly confirmSensitiveTool?: SensitiveToolConfirmation;
}

export interface ToolDescriptor extends ToolSchema {
  readonly version: string;
  readonly metadata: ToolMetadata;
}

export type ToolFactory = () => Tool | Promise<Tool>;

interface RegistryEntry {
  readonly schema: ToolSchema;
  tool?: Tool;
  readonly factory?: ToolFactory;
  loading?: Promise<Tool>;
  readonly version: string;
  readonly metadata: ToolMetadata;
  readonly tenantId?: string;
  readonly sensitive: boolean;
  readonly resilience?: ResilientToolExecutor;
}

function validateSchema(schema: ToolSchema): void {
  if (schema === null || typeof schema !== 'object') {
    throw new TypeError('非法工具注册：Schema 必须是对象');
  }
  if (typeof schema.name !== 'string' || schema.name.trim() === '') {
    throw new TypeError('非法工具注册：工具名称必须是非空字符串');
  }
  if (typeof schema.description !== 'string' || schema.description.trim() === '') {
    throw new TypeError('非法工具注册：工具描述必须是非空字符串');
  }
  if (schema.parameters === null || typeof schema.parameters !== 'object' || Array.isArray(schema.parameters)) {
    throw new TypeError('非法工具注册：parameters 必须是对象');
  }
  const schemaIssue = validateToolSchema(schema.parameters);
  if (schemaIssue !== undefined) {
    throw new TypeError(
      `非法工具注册：parameters ${schemaIssue.path}，${schemaIssue.message}（期望 ${schemaIssue.expected}）`,
    );
  }
}

function createEntry(tool: Tool, options: ToolRegistrationOptions): RegistryEntry {
  if (tool === null || typeof tool !== 'object') {
    throw new TypeError('非法工具注册：工具必须是对象');
  }
  validateSchema(tool);
  if (typeof tool.execute !== 'function') {
    throw new TypeError('非法工具注册：execute 必须是函数');
  }
  const version = options.version ?? 'unversioned';
  if (typeof version !== 'string' || version.trim() === '') {
    throw new TypeError('非法工具注册：version 必须是非空字符串');
  }
  const metadata = options.metadata ?? {};
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new TypeError('非法工具注册：metadata 必须是对象');
  }
  return {
    tool,
    schema: { name: tool.name, description: tool.description, parameters: tool.parameters },
    version,
    metadata,
    ...(options.tenantId === undefined ? {} : { tenantId: options.tenantId }),
    sensitive: options.sensitive === true,
    ...(options.resilience === undefined
      ? {}
      : { resilience: new ResilientToolExecutor(options.resilience) }),
  };
}

function createLazyEntry(
  schema: ToolSchema,
  factory: ToolFactory,
  options: ToolRegistrationOptions,
): RegistryEntry {
  validateSchema(schema);
  if (typeof factory !== 'function') {
    throw new TypeError('非法工具注册：factory 必须是函数');
  }
  const version = options.version ?? 'unversioned';
  if (typeof version !== 'string' || version.trim() === '') {
    throw new TypeError('非法工具注册：version 必须是非空字符串');
  }
  const metadata = options.metadata ?? {};
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new TypeError('非法工具注册：metadata 必须是对象');
  }
  return {
    schema: { ...schema },
    factory,
    version,
    metadata,
    ...(options.tenantId === undefined ? {} : { tenantId: options.tenantId }),
    sensitive: options.sensitive === true,
    ...(options.resilience === undefined
      ? {}
      : { resilience: new ResilientToolExecutor(options.resilience) }),
  };
}

function describeEntry(entry: RegistryEntry): ToolDescriptor {
  return {
    name: entry.schema.name,
    description: entry.schema.description,
    parameters: entry.schema.parameters,
    version: entry.version,
    metadata: entry.metadata,
  };
}

export class ToolRegistry {
  private readonly tools = new Map<string, RegistryEntry>();
  private readonly policy: ToolRegistryPolicy;

  constructor(policy: ToolRegistryPolicy = {}) {
    this.policy = policy;
  }

  private isVisible(entry: RegistryEntry): boolean {
    const inTenant = entry.tenantId === undefined || entry.tenantId === this.policy.tenantId;
    const inWhitelist = this.policy.allowedTools === undefined
      || this.policy.allowedTools.includes(entry.schema.name);
    return inTenant && inWhitelist;
  }

  private visibleEntries(): RegistryEntry[] {
    return [...this.tools.values()].filter((entry) => this.isVisible(entry));
  }

  register(tool: Tool, options: ToolRegistrationOptions = {}): void {
    const entry = createEntry(tool, options);
    if (this.tools.has(tool.name)) {
      throw new Error(`工具重复注册：${tool.name}`);
    }
    this.tools.set(tool.name, entry);
  }

  registerLazy(
    schema: ToolSchema,
    factory: ToolFactory,
    options: ToolRegistrationOptions = {},
  ): void {
    const entry = createLazyEntry(schema, factory, options);
    if (this.tools.has(schema.name)) {
      throw new Error(`工具重复注册：${schema.name}`);
    }
    this.tools.set(schema.name, entry);
  }

  replace(tool: Tool, options: ToolRegistrationOptions = {}): void {
    const entry = createEntry(tool, options);
    if (!this.tools.has(tool.name)) {
      throw new Error(`无法替换未注册工具：${tool.name}`);
    }
    this.tools.set(tool.name, entry);
  }

  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  /** 发给模型的 Schema 列表，仅包含当前策略可见工具，顺序稳定 */
  list(_query = ''): ToolSchema[] {
    return this.visibleEntries().map(({ schema }) => ({
      name: schema.name,
      description: schema.description,
      parameters: schema.parameters,
    }));
  }

  /** 给调用方看的完整注册信息，不混入模型请求的 Schema。 */
  discover(): ToolDescriptor[] {
    return this.visibleEntries().map(describeEntry);
  }

  describe(name: string): ToolDescriptor | undefined {
    const entry = this.tools.get(name);
    return entry === undefined || !this.isVisible(entry) ? undefined : describeEntry(entry);
  }

  get size(): number {
    return this.visibleEntries().length;
  }

  /**
   * 执行一次工具调用。
   * 任何失败都转成 isError 的 ToolResult 回喂模型——模型看到错误才有机会自我修正，
   * 直接抛异常等于替模型放弃了这一轮。
   */
  async execute(call: ToolCall, context: ToolContext): Promise<ToolResult> {
    const entry = this.tools.get(call.name);
    if (entry === undefined) {
      const available = this.visibleEntries().map(({ schema }) => schema.name).join(', ');
      return toolError('UNKNOWN_TOOL', `未知工具：${call.name}`, true, `请改用已注册工具：${available}`);
    }
    if (!this.isVisible(entry)) {
      return toolError(
        'TOOL_NOT_ALLOWED',
        '当前策略不允许调用该工具',
        false,
        '请改用当前策略可见且允许的工具',
      );
    }
    let args: unknown;
    try {
      args = call.arguments.trim() === '' ? {} : JSON.parse(call.arguments);
    } catch {
      return toolError(
        'INVALID_JSON',
        '工具参数不是合法 JSON',
        true,
        '请把 arguments 修正为合法 JSON 对象',
      );
    }

    const issue = validateArguments(entry.schema.parameters, args);
    if (issue !== undefined) {
      return toolError(
        'INVALID_ARGUMENTS',
        `参数校验失败：${issue.path}，${issue.message}（期望 ${issue.expected}）`,
        true,
        `请修正 ${issue.path}：期望 ${issue.expected}；${issue.message}`,
      );
    }

    if (entry.sensitive) {
      const confirm = this.policy.confirmSensitiveTool;
      if (confirm === undefined) {
        return toolError(
          'TOOL_CONFIRMATION_REQUIRED',
          '敏感工具调用未获得本次明确确认',
          false,
          '请由调用方针对本次 toolCallId 确认后重新发起调用',
        );
      }
      let approved: boolean;
      try {
        approved = await confirm({
          callId: call.id,
          toolName: call.name,
          args,
          ...(this.policy.tenantId === undefined ? {} : { tenantId: this.policy.tenantId }),
        });
      } catch {
        return toolError(
          'TOOL_CONFIRMATION_FAILED',
          '敏感工具确认失败，本次调用已安全拒绝',
          false,
          '请检查调用方确认回调后重新发起调用',
        );
      }
      if (approved !== true) {
        return toolError(
          'TOOL_CONFIRMATION_REQUIRED',
          '敏感工具调用未获得本次明确确认',
          false,
          '请由调用方针对本次 toolCallId 确认后重新发起调用',
        );
      }
    }

    const executionContext: ToolContext = {
      workspaceRoot: context.workspaceRoot,
      ...(context.signal === undefined ? {} : { signal: context.signal }),
      ...(this.policy.tenantId === undefined ? {} : { tenantId: this.policy.tenantId }),
    };
    try {
      // eager/已缓存工具保持 D047 的同步进入 execute 时序；仅首次 lazy 加载需要等待。
      const tool = entry.tool ?? await this.resolveTool(entry);
      return entry.resilience === undefined
        ? await tool.execute(args, executionContext)
        : await entry.resilience.execute(tool, args, executionContext);
    } catch (error) {
      return errorResult(normalizeError(error));
    }
  }

  private async resolveTool(entry: RegistryEntry): Promise<Tool> {
    if (entry.tool !== undefined) return entry.tool;
    const factory = entry.factory;
    if (factory === undefined) throw new TypeError(`工具 ${entry.schema.name} 不可执行`);

    if (entry.loading === undefined) {
      entry.loading = (async () => {
        const tool = await factory();
        if (tool === null || typeof tool !== 'object') {
          throw new TypeError('非法懒加载工具：factory 必须返回工具对象');
        }
        validateSchema(tool);
        if (typeof tool.execute !== 'function') {
          throw new TypeError('非法懒加载工具：execute 必须是函数');
        }
        if (tool.name !== entry.schema.name) {
          throw new TypeError('非法懒加载工具：工具名称必须与注册 Schema 一致');
        }
        entry.tool = tool;
        return tool;
      })();
    }

    try {
      return await entry.loading;
    } catch (error) {
      entry.loading = undefined;
      throw error;
    }
  }
}
