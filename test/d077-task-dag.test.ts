import { describe, expect, it } from 'vitest';

import { readyDagNodes, validateDag } from '../src/runtime/task-dag.ts';

describe('D077 任务依赖图', () => {
  const nodes = [
    { id: 'a', dependsOn: [] },
    { id: 'b', dependsOn: ['a'] },
    { id: 'c', dependsOn: ['a'] },
  ];

  it('验证 DAG 并返回依赖已完成的 ready 节点', () => {
    expect(() => validateDag(nodes)).not.toThrow();
    expect(readyDagNodes(nodes, new Set(['a'])).map(({ id }) => id)).toEqual(['b', 'c']);
  });

  it('拒绝未知依赖和循环依赖', () => {
    expect(() => validateDag([{ id: 'a', dependsOn: ['missing'] }])).toThrow('未知依赖');
    expect(() => validateDag([{ id: 'a', dependsOn: ['b'] }, { id: 'b', dependsOn: ['a'] }])).toThrow('循环');
  });
});
