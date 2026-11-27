# D095 · 产品化发布清单

D095 固化发布前产品化结构检查：包元数据、根入口、CLI bin、构建产物和部署文档必须同时存在，为后续 RC 验收减少遗漏。

## 产出

- `src/release/productization.ts`：产品化清单检查器。
- `test/d095-productization.test.ts`：当前仓库清单回归测试。
- `scripts/d095-productization.ts`：可复现验收脚本。
- `docs/productization.md`：清单和真实能力边界。

## 复现

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run demo:d095
```

## 边界

清单只验证仓库结构和本地构建产物，不替代真实 npm 安装、跨平台运行、认证、持久化或线上演练。
