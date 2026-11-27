export interface DagNode { readonly id: string; readonly dependsOn: readonly string[]; }

export function validateDag(nodes: readonly DagNode[]): void {
  const ids = new Set(nodes.map(({ id }) => id));
  for (const node of nodes) for (const dependency of node.dependsOn) {
    if (!ids.has(dependency)) throw new Error(`未知依赖：${dependency}`);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error('任务依赖存在循环');
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id)?.dependsOn ?? []) visit(dependency);
    visiting.delete(id); visited.add(id);
  };
  for (const node of nodes) visit(node.id);
}

export function readyDagNodes(nodes: readonly DagNode[], completed: ReadonlySet<string>): DagNode[] {
  validateDag(nodes);
  return nodes.filter(({ id, dependsOn }) => !completed.has(id) && dependsOn.every((dependency) => completed.has(dependency)));
}
