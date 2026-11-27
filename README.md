# D057 · 上下文预算压力测试

D057 建立可重复的上下文压力用例，覆盖短历史、大工具目录和超长工具结果，确认统一预算模型能够报告适配与超预算，而不是静默放大上限。

## 产出

- `src/context/pressure.ts`：压力用例执行器。
- `test/d057-pressure.test.ts`：三类压力回归测试。
- `scripts/d057-pressure.ts`：可复现验收脚本。

## 复现

```bash
npm run lint
npm run typecheck
npm test
npm run demo:d057
```

## 边界

当前压力测试测量字符预算，不是 tokenizer token 或真实延迟基准；超预算报告不会自动决定压缩策略。
