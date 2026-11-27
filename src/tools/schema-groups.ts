import type { ToolSchema } from '../core/tool.ts';

export interface ToolSchemaGroup {
  readonly name: string;
  readonly tools: readonly ToolSchema[];
}

export function groupToolSchemas(tools: readonly ToolSchema[], groupSize = 5): ToolSchemaGroup[] {
  if (!Number.isSafeInteger(groupSize) || groupSize <= 0) throw new Error('groupSize 必须是正整数');
  const groups: ToolSchemaGroup[] = [];
  for (let index = 0; index < tools.length; index += groupSize) {
    groups.push({ name: `group-${groups.length + 1}`, tools: tools.slice(index, index + groupSize) });
  }
  return groups;
}

export function expandToolSchemaGroup(
  groups: readonly ToolSchemaGroup[],
  groupName: string,
): ToolSchema[] {
  return groups.find((group) => group.name === groupName)?.tools.slice() ?? [];
}
