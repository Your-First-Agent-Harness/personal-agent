import type { ToolSchema } from '../core/tool.ts';
import {
  DEFAULT_TOOL_SEARCH_LIMIT,
  searchToolMatches,
  validateToolSearchLimit,
} from './retrieval.ts';
import { ToolRegistry, type ToolRegistryPolicy } from './registry.ts';
import type { ToolSearchable, ToolSearchMatch } from './retrieval.ts';

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
  catalog(): ToolSearchable[] {
    return super.discover().map(({ name, description, parameters, metadata }) => ({
      name,
      description,
      parameters,
      metadata,
    }));
  }

  /** 返回命中工具及其确定性相关性分数，供运行时审计和调试使用。 */
  search(query = ''): ReadonlyArray<ToolSearchMatch> {
    return searchToolMatches(this.catalog(), query, this.limit);
  }

  /** 只把本次查询选中的少量 Schema 暴露给模型。 */
  override list(query = ''): ToolSchema[] {
    return this.search(query).map(({ tool: { name, description, parameters } }) => ({
      name,
      description,
      parameters,
    }));
  }
}
