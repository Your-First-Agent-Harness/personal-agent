# D056 · 工具 Schema 分组与按需展开

D056 将大量工具 Schema 按确定性大小分组，调用方先看到分组边界，需要时只展开指定组，避免一次性把完整工具目录放入上下文。

## 产出

- `src/tools/schema-groups.ts`：Schema 分组和按组展开 API。
- `test/d056-schema-groups.test.ts`：分组、展开和非法参数测试。
- `scripts/d056-schema-groups.ts`：可复现验收脚本。

## 复现

```bash
npm run lint
npm run typecheck
npm test
npm run demo:d056
```

## 边界

当前分组是确定性数量分组，尚未把分组协议接入模型 Provider，也不替代 D049 的相关性检索；未展开的组不会自动执行工具。
