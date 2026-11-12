import type { ToolCall } from '../core/message.ts';
import type { Tool, ToolContext, ToolResult, ToolSchema } from '../core/tool.ts';
import { errorResult, normalizeError, toolError } from './errors.ts';
import { validateArguments } from './schema.ts';

export type ToolMetadata = Readonly<Record<string, unknown>>;

export interface ToolRegistrationOptions {
  readonly version?: string;
  readonly metadata?: ToolMetadata;
}

export interface ToolDescriptor extends ToolSchema {
  readonly version: string;
  readonly metadata: ToolMetadata;
}

interface RegistryEntry {
  readonly tool: Tool;
  readonly version: string;
  readonly metadata: ToolMetadata;
}

function createEntry(tool: Tool, options: ToolRegistrationOptions): RegistryEntry {
  if (tool === null || typeof tool !== 'object') {
    throw new TypeError('非法工具注册：工具必须是对象');
  }
  if (typeof tool.name !== 'string' || tool.name.trim() === '') {
    throw new TypeError('非法工具注册：工具名称必须是非空字符串');
  }
  if (typeof tool.description !== 'string' || tool.description.trim() === '') {
    throw new TypeError('非法工具注册：工具描述必须是非空字符串');
  }
  if (tool.parameters === null || typeof tool.parameters !== 'object' || Array.isArray(tool.parameters)) {
    throw new TypeError('非法工具注册：parameters 必须是对象');
  }
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
  return { tool, version, metadata };
}

function describeEntry(entry: RegistryEntry): ToolDescriptor {
  return {
    name: entry.tool.name,
    description: entry.tool.description,
    parameters: entry.tool.parameters,
    version: entry.version,
    metadata: entry.metadata,
  };
}

export class ToolRegistry {
  private readonly tools = new Map<string, RegistryEntry>();

  register(tool: Tool, options: ToolRegistrationOptions = {}): void {
    const entry = createEntry(tool, options);
    if (this.tools.has(tool.name)) {
      throw new Error(`工具重复注册：${tool.name}`);
    }
    this.tools.set(tool.name, entry);
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

  /** 发给模型的 Schema 列表，顺序稳定，方便对比两次请求的 diff */
  list(): ToolSchema[] {
    return [...this.tools.values()].map(({ tool }) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }));
  }

  /** 给调用方看的完整注册信息，不混入模型请求的 Schema。 */
  discover(): ToolDescriptor[] {
    return [...this.tools.values()].map(describeEntry);
  }

  describe(name: string): ToolDescriptor | undefined {
    const entry = this.tools.get(name);
    return entry === undefined ? undefined : describeEntry(entry);
  }

  get size(): number {
    return this.tools.size;
  }

  /**
   * 执行一次工具调用。
   * 任何失败都转成 isError 的 ToolResult 回喂模型——模型看到错误才有机会自我修正，
   * 直接抛异常等于替模型放弃了这一轮。
   */
  async execute(call: ToolCall, context: ToolContext): Promise<ToolResult> {
    const entry = this.tools.get(call.name);
    if (entry === undefined) {
      const available = [...this.tools.keys()].join(', ');
      return toolError('UNKNOWN_TOOL', `未知工具：${call.name}`, true, `请改用已注册工具：${available}`);
    }
    const { tool } = entry;

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

    const issue = validateArguments(tool.parameters, args);
    if (issue !== undefined) {
      return toolError(
        'INVALID_ARGUMENTS',
        `参数校验失败：${issue.path}，${issue.message}（期望 ${issue.expected}）`,
        true,
        `请修正 ${issue.path}：期望 ${issue.expected}；${issue.message}`,
      );
    }

    try {
      return await tool.execute(args, context);
    } catch (error) {
      return errorResult(normalizeError(error));
    }
  }
}
