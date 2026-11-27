export interface SubAgentSpec {
  readonly id: string;
  readonly parentId: string;
  readonly task: string;
  readonly allowedTools: readonly string[];
  readonly budget: number;
  readonly depth: number;
}

export function createSubAgentSpec(input: Omit<SubAgentSpec, 'depth'> & { depth?: number }): SubAgentSpec {
  const depth = input.depth ?? 0;
  if (input.id === input.parentId) throw new Error('子 Agent 不能把自己作为父任务');
  if (!Number.isSafeInteger(input.budget) || input.budget <= 0) throw new Error('子 Agent budget 必须是正整数');
  if (!Number.isSafeInteger(depth) || depth < 0) throw new Error('子 Agent depth 必须是非负整数');
  return { ...input, depth };
}

export function canUseSubAgentTool(spec: SubAgentSpec, toolName: string): boolean {
  return spec.allowedTools.includes(toolName);
}
