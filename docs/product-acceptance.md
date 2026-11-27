# Product Acceptance（D096）

D096 把已发布的 CLI 产品入口串成一条本地验收链路：

1. `task create` 创建任务。
2. `task status` 查询任务。
3. `config show --json` 验证配置输出不泄露 API key。
4. `tools list --json` 验证能力清单包含 5 个内置工具。

```bash
npm run build
npm run demo:d096
```

成功输出：

```text
D096 PRODUCT ACCEPTANCE PASS
```

这是本地构建产物的综合验收，不证明真实模型调用、跨机器部署、持久化队列或生产身份系统。
