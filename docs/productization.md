# Productization Checklist（D095）

D095 固化发布前产品化清单：包名和版本、根入口、CLI bin、构建产物、部署文档都必须存在，脚本输出逐项检查结果。

```bash
npm run build
npm run demo:d095
```

成功输出：

```text
D095 PRODUCTIZATION PASS
```

这份清单只验证仓库内可见的发布结构，不替代真实 npm 安装、跨平台运行、身份认证、持久化和线上运维演练。
