# D059 · 长任务故障恢复

D059 明确长任务中的恢复决策：可恢复错误有限重试，中断任务从检查点恢复，不重复盲目执行副作用；不可恢复错误或达到尝试上限时停止并保留原因。

## 产出

- `src/runtime/recovery.ts`：恢复决策函数。
- `test/d059-recovery.test.ts`：retry、resume、stop 三类路径测试。
- `scripts/d059-recovery.ts`：可复现验收脚本。

## 复现

```bash
npm run lint
npm run typecheck
npm test
npm run demo:d059
```

## 边界

本日提供确定性决策组件，尚未把恢复动作接入持久化 Run Store；真实副作用重放仍需后续幂等和检查点机制保护。
