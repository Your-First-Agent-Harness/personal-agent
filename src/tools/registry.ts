import type { ToolCall } from '../core/message.ts';
import type { Tool, ToolContext, ToolResult, ToolSchema } from '../core/tool.ts';

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`工具重复注册：${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  /** 发给模型的 Schema 列表，顺序稳定，方便对比两次请求的 diff */
  list(): ToolSchema[] {
    return [...this.tools.values()].map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }));
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
    const tool = this.tools.get(call.name);
    if (tool === undefined) {
      return {
        content: `未知工具：${call.name}。可用工具：${[...this.tools.keys()].join(', ')}`,
        isError: true,
      };
    }

    let args: unknown;
    try {
      args = call.arguments.trim() === '' ? {} : JSON.parse(call.arguments);
    } catch {
      return { content: `工具参数不是合法 JSON：${call.arguments}`, isError: true };
    }

    try {
      return await tool.execute(args, context);
    } catch (error) {
      return {
        content: `工具执行失败：${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      };
    }
  }
}
