# D092 · 稳定 SDK 与编程式任务 API

D092 增加面向调用方的 `PersonalAgentClient`：通过 SDK 提交任务，获得稳定的任务 handle，并查询任务状态；核心类型从包根入口导出。

## 示例

```ts
import { PersonalAgentClient } from 'personal-agent';

const client = new PersonalAgentClient<{ prompt: string }>();
const task = client.submit({ payload: { prompt: 'hello' } });
console.log(task.id, task.get());
```

## 复现

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run demo:d092
```

## 边界

当前 SDK 绑定进程内 TaskQueue，不自动执行任务、不跨进程持久化，自动生成的 id 仅用于当前运行实例；稳定 HTTP API 留待后续部署阶段。
