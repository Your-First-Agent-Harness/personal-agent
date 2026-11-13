import type { ToolSchema } from '../core/tool.ts';
import {
  DEFAULT_TOOL_SEARCH_LIMIT,
  searchToolSchemas,
  validateToolSearchLimit,
} from './retrieval.ts';
import { ToolRegistry, type ToolRegistryPolicy } from './registry.ts';

export interface DynamicToolRegistryOptions extends ToolRegistryPolicy {
  readonly limit?: number;
}

export class DynamicToolRegistry extends ToolRegistry {
  private readonly limit: number;

  constructor(options: DynamicToolRegistryOptions = {}) {
    const { limit = DEFAULT_TOOL_SEARCH_LIMIT, ...policy } = options;
    validateToolSearchLimit(limit);
    super(policy);
    this.limit = limit;
  }

  /** 当前策略可见的完整目录；不会实例化 lazy tool。 */
  catalog(): ToolSchema[] {
    return super.list();
  }

  /** 只把本次查询选中的少量 Schema 暴露给模型。 */
  override list(query = ''): ToolSchema[] {
    return searchToolSchemas(this.catalog(), query, this.limit);
  }
}
