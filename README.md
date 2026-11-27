# D094 · API 兼容性检查

D094 增加 API manifest 比较器：新增根导出视为兼容，移除已有导出明确标记为不兼容，为 v1 API 冻结和弃用策略提供可执行检查基础。

## 产出

- `src/api/compatibility.ts`：API manifest 比较。
- `test/d094-compatibility.test.ts`：新增和移除导出测试。
- `scripts/d094-compatibility.ts`：可复现验收脚本。

## 复现

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run demo:d094
```

## 边界

当前检查的是导出名称集合，不分析 TypeScript 类型签名、运行时行为或语义兼容性；正式 API 冻结还需要人工审阅和版本策略。
