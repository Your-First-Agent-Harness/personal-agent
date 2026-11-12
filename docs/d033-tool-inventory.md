# D033 工具清单资料包：星桥商城 40 API → 16 个 Agent 工具

> 配套讲义：[`docs/d033-public-course.md`](d033-public-course.md)
> 设计基线：D027–D032 的真实 Tool、ToolRegistry、Schema、权限、韧性与 AgentLoop；架构决策见 [`docs/adr/0001-failure-semantics.md`](adr/0001-failure-semantics.md)。
> **虚构声明**：星桥商城、下列路径、字段、业务规则和示例 ID 均为教学虚构，不是真实第三方 API，不可用于生产对接。
> **实现声明**：本资料是工具设计规格，不是已注册、已连接或已验证的 16 个业务工具；D033 不新增业务运行时代码。

## 1. 先给答案：不是 40，也不是 1，而是 16

切分单位是**一个可独立理解、授权、校验、失败和测试的任务意图**，不是 HTTP 端点数量。读操作可按同一上下文聚合，写操作按副作用与授权边界拆分；组合后若只能采用最保守策略，就要记录代价，必要时再拆。

| # | Agent 工具 | 覆盖 API | 性质 | 为什么这样切 |
| --- | --- | ---: | --- | --- |
| 1 | `get_customer_context` | A01–A04 | 租户只读 | 同一次“了解客户”上下文，用 `include` 选择所需部分 |
| 2 | `explore_catalog` | A05–A08 | 共享只读 | 同属商品发现链路，用四种明确 `mode` 区分，不接受任意动作 |
| 3 | `quote_checkout` | A09–A12 | 报价计算，无订单/扣款 | 同一 cart revision 的一次结算试算，统一过期时间 |
| 4 | `get_cart` | A13 | 租户只读 | 高频、独立的购物车快照，值得简单直接 |
| 5 | `update_cart` | A14–A17 | 普通写 | 同一购物车的四种变更，共享 revision 冲突语义；重试取最保守公约数 |
| 6 | `create_order` | A18 | 敏感写 | 从报价生成订单是独立承诺点，必须逐次确认 |
| 7 | `query_orders` | A19–A21 | 租户只读 | 列表、详情、时间线都是订单查询，返回结构保持可判别 |
| 8 | `cancel_order` | A22 | 敏感写 | 取消有独立权限、状态冲突和补偿边界，不埋进通用订单修改器 |
| 9 | `manage_payment` | A23–A24 | 敏感写 | 授权与扣款共享支付状态机；每次逻辑调用均需确认 |
| 10 | `get_payment_status` | A25–A26 | 租户只读 | 用于按支付或订单核对事实，尤其处理写操作超时后的未知状态 |
| 11 | `inspect_refund` | A27–A28 | 租户只读 | 两种退款查询视角，和退款申请副作用分开 |
| 12 | `request_refund` | A29 | 敏感写 | 资金退回必须独立确认，不能由查询或客服工具顺带执行 |
| 13 | `query_shipments` | A30–A32 | 租户只读 | 按运单、订单、轨迹查询同一履约事实 |
| 14 | `change_delivery` | A33–A34 | 敏感写 | 改地址与改派送均改变履约，共享发货前状态约束 |
| 15 | `query_support_cases` | A35–A36 | 租户只读 | 工单列表和详情聚合，避免查询工具膨胀 |
| 16 | `manage_support_cases` | A37–A40 | 敏感写 | 建单、回复、关闭、重开共享工单状态机；统一确认是本次有意的保守取舍 |

**数量守恒：4 + 4 + 4 + 1 + 4 + 1 + 3 + 1 + 2 + 2 + 2 + 1 + 3 + 2 + 2 + 4 = 40。**

## 2. 40 个虚构业务 API 的唯一映射

下表每个 API 恰好出现一次。`GET` 不自动等于可缓存，`POST` 也不自动等于危险；真正判断依据是业务副作用、可恢复性和授权边界。

| API | 虚构方法与路径 | 用途 | 唯一归属工具 |
| --- | --- | --- | --- |
| A01 | `GET /v1/customers/{customerId}/profile` | 基本资料 | `get_customer_context` |
| A02 | `GET /v1/customers/{customerId}/addresses` | 收货地址 | 同上 |
| A03 | `GET /v1/customers/{customerId}/membership` | 会员等级与权益 | 同上 |
| A04 | `GET /v1/customers/{customerId}/preferences` | 联系与购物偏好 | 同上 |
| A05 | `GET /v1/products?query=...` | 搜索商品 | `explore_catalog` |
| A06 | `GET /v1/products/{productId}` | 商品详情 | 同上 |
| A07 | `GET /v1/products/{productId}/skus` | 可售规格 | 同上 |
| A08 | `GET /v1/inventory?skuId=...&warehouseId=...` | 库存 | 同上 |
| A09 | `POST /v1/quotes/pricing` | 商品价格试算 | `quote_checkout` |
| A10 | `POST /v1/quotes/shipping` | 配送方案试算 | 同上 |
| A11 | `POST /v1/quotes/discounts` | 优惠试算 | 同上 |
| A12 | `POST /v1/quotes/tax` | 税费试算 | 同上 |
| A13 | `GET /v1/carts/{cartId}` | 购物车快照 | `get_cart` |
| A14 | `POST /v1/carts` | 创建购物车 | `update_cart` |
| A15 | `PUT /v1/carts/{cartId}/items/{skuId}` | 设置规格数量 | 同上 |
| A16 | `DELETE /v1/carts/{cartId}/items/{skuId}` | 删除规格 | 同上 |
| A17 | `POST /v1/carts/{cartId}/coupons` | 使用优惠码 | 同上 |
| A18 | `POST /v1/orders` | 从报价创建订单 | `create_order` |
| A19 | `GET /v1/orders/{orderId}` | 订单详情 | `query_orders` |
| A20 | `GET /v1/orders?customerId=...` | 订单列表 | 同上 |
| A21 | `GET /v1/orders/{orderId}/timeline` | 订单时间线 | 同上 |
| A22 | `POST /v1/orders/{orderId}/cancellation` | 取消订单 | `cancel_order` |
| A23 | `POST /v1/payments/authorize` | 支付授权 | `manage_payment` |
| A24 | `POST /v1/payments/{paymentId}/capture` | 支付扣款 | 同上 |
| A25 | `GET /v1/payments/{paymentId}` | 支付详情 | `get_payment_status` |
| A26 | `GET /v1/orders/{orderId}/payments` | 订单支付列表 | 同上 |
| A27 | `GET /v1/refunds/{refundId}` | 退款详情 | `inspect_refund` |
| A28 | `GET /v1/payments/{paymentId}/refunds` | 支付退款列表 | 同上 |
| A29 | `POST /v1/refunds` | 申请退款 | `request_refund` |
| A30 | `GET /v1/shipments/{shipmentId}` | 运单详情 | `query_shipments` |
| A31 | `GET /v1/orders/{orderId}/shipments` | 订单运单列表 | 同上 |
| A32 | `GET /v1/shipments/{shipmentId}/events` | 运单轨迹 | 同上 |
| A33 | `PUT /v1/shipments/{shipmentId}/address` | 修改收货地址 | `change_delivery` |
| A34 | `POST /v1/shipments/{shipmentId}/reroute` | 改派送站点 | 同上 |
| A35 | `GET /v1/support/cases/{caseId}` | 工单详情 | `query_support_cases` |
| A36 | `GET /v1/support/cases?customerId=...` | 工单列表 | 同上 |
| A37 | `POST /v1/support/cases` | 创建工单 | `manage_support_cases` |
| A38 | `POST /v1/support/cases/{caseId}/messages` | 追加工单消息 | 同上 |
| A39 | `POST /v1/support/cases/{caseId}/close` | 关闭工单 | 同上 |
| A40 | `POST /v1/support/cases/{caseId}/reopen` | 重开工单 | 同上 |

## 3. Schema 使用约定与真实 Harness 边界

### 3.1 本资料只使用当前支持的 Schema 子集

输入 Schema 可直接作为本项目的 `Tool.parameters` 设计稿，只使用源码实际执行的：`object/string/number/integer/boolean/array/null`、`properties/required/additionalProperties:false/items/minLength/minimum/maximum/enum`。不使用 `$ref`、`oneOf`、`allOf`、`pattern`、`format`、默认值或类型强转。

- 数组元素由 `items` 递归校验；数组唯一性、数组长度和字符串最大长度由业务层检查。**源码核对差异**：ADR-001 的文字列表写有 `maxLength/uniqueItems`，但 D032 基线的 `src/tools/schema.ts` 未执行这两个关键字；本资料因此不把它们放进 Schema，也不把它们当作安全约束。
- `mode/action + 可选字段` 的条件必填关系，例如 `mode="detail"` 必须有 `orderId`，**当前子集无法声明**，必须由工具业务层二次校验；Registry 只能先拒绝一般形状错误。
- `additionalProperties:false` 必须显式写出；未写时当前 Registry 默认允许额外字段。
- `tenantId` 故意不出现在任何模型输入 Schema 中。可信租户由 Registry 策略写入 `ToolContext`，工具还要检查资源是否属于该租户。
- 下列“输出 Schema”描述成功时放进 `ToolResult.content` 的 JSON 业务载荷设计。**当前 Registry 校验输入，不负责按这些输出 Schema 校验业务返回值**；生产适配器需自行测试。
- 失败统一走真实 `ToolResult` 的 `isError/error`，不把失败伪装成成功载荷中的 `success:false`。

### 3.2 公共字段

- ID 均是非空字符串；金额用整数最小货币单位 `amountMinor` 加 ISO 风格三位币种字符串 `currency`，避免浮点金额。
- 时间字段是 ISO 8601 字符串，但当前子集的 `format` 不可用，格式由业务层校验。
- `requestId` 是**业务适配器必须持久去重**的幂等键设计，不是 D030 Registry 自动提供的能力。未实现持久去重时，相关写工具必须保持 `maxRetries:0`。
- `expectedRevision` 是乐观锁版本；不匹配返回 `RESOURCE_CONFLICT`，不可自动重试。
- 下文超时均为**教学建议起点**，不是项目默认值、实测 SLO 或性能结论。真实语义是每次尝试超时；排队、退避和其他尝试不包含在同一个总 deadline 中。

### 3.3 公共错误语义

| code | retryable | 处理 | 来源/说明 |
| --- | --- | --- | --- |
| `INVALID_ARGUMENTS` | 否 | 按路径修正参数；条件必填失败也由业务层沿用此码并给 hint | Registry 或工具业务校验 |
| `TOOL_NOT_ALLOWED` | 否 | 不借重试绕过白名单/租户策略 | 真实 Registry |
| `TOOL_CONFIRMATION_REQUIRED` | 否 | 重新展示本次 callId、工具名和完整参数，取得本次批准 | 真实 Registry |
| `RESOURCE_NOT_FOUND` | 否 | 核对 ID；不得把“无权限”细化成资源枚举 oracle | 虚构业务错误 |
| `RESOURCE_CONFLICT` | 否 | 重新读取 revision/status，再让用户决定 | 虚构业务错误 |
| `QUOTE_EXPIRED` | 否 | 重新报价，不直接创建订单 | 虚构业务错误 |
| `PAYMENT_DECLINED` | 否 | 更换支付方式或停止，不自动重复授权 | 虚构业务错误 |
| `DEPENDENCY_UNAVAILABLE` | 是 | 只有工具幂等策略允许时才自动重试，否则稍后查询/人工决定 | 虚构业务错误 |
| `TOOL_TIMEOUT` | 按工具策略 | 写操作先查状态，不能假设“没执行” | 真实韧性层 |
| `TOOL_RATE_LIMITED` / `TOOL_CIRCUIT_OPEN` | 稍后新逻辑调用 | 当前执行器不立即自动重试 | 真实韧性层 |
| `INTERNAL_ERROR` | 否 | 脱敏上报，不向模型泄露原始异常或秘密 | 真实 Registry |

## 4. 十六个工具的完整契约

以下每节均给出：唯一 API 映射、输入与成功输出、切分理由、副作用/权限/确认、幂等/重试、建议超时及主要错误。所有输出示例字段都是虚构业务设计，而非现有商城实现。

### 4.1 `get_customer_context`（A01–A04）

**用途与切分**：一次取得同一客户的资料、地址、会员和偏好；`include` 缺省时业务层返回四部分，显式给出时只返回所选部分。不要把四个 GET 暴露成四次模型决策。

**输入 Schema**

```json
{
  "type": "object",
  "properties": {
    "customerId": { "type": "string", "minLength": 1 },
    "include": {
      "type": "array",
      "items": { "type": "string", "enum": ["profile", "addresses", "membership", "preferences"] }
    }
  },
  "required": ["customerId"],
  "additionalProperties": false
}
```

**成功输出 Schema**

```json
{
  "type": "object",
  "properties": {
    "customerId": { "type": "string" },
    "profile": {
      "type": "object",
      "properties": {
        "displayName": { "type": "string" },
        "locale": { "type": "string" }
      },
      "required": ["displayName", "locale"],
      "additionalProperties": false
    },
    "addresses": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "addressId": { "type": "string" },
          "recipient": { "type": "string" },
          "line1": { "type": "string" },
          "city": { "type": "string" },
          "postalCode": { "type": "string" }
        },
        "required": ["addressId", "recipient", "line1", "city", "postalCode"],
        "additionalProperties": false
      }
    },
    "membership": {
      "type": "object",
      "properties": {
        "level": { "type": "string", "enum": ["basic", "plus", "pro"] },
        "points": { "type": "integer", "minimum": 0 }
      },
      "required": ["level", "points"],
      "additionalProperties": false
    },
    "preferences": {
      "type": "object",
      "properties": {
        "contactChannel": { "type": "string", "enum": ["email", "sms", "none"] },
        "favoriteCategories": { "type": "array", "items": { "type": "string" } }
      },
      "required": ["contactChannel", "favoriteCategories"],
      "additionalProperties": false
    }
  },
  "required": ["customerId"],
  "additionalProperties": false
}
```

- **副作用/权限**：租户只读；`sensitive:false`，无人工确认；白名单与租户隔离生效，适配器检查 customer 归属。
- **幂等/重试**：读操作幂等；教学建议 `retry.idempotent:true、maxRetries:2`，仅重试可重试故障。
- **超时/错误**：每次尝试建议 1500ms；`RESOURCE_NOT_FOUND`、`DEPENDENCY_UNAVAILABLE`、`TOOL_TIMEOUT`。部分子查询失败不得静默假装完整，应返回明确错误或部分失败说明。
- **输出约束**：出现的部分由 `include` 决定，这一条件关系由业务层保证，Schema 不声称能做到条件校验。

### 4.2 `explore_catalog`（A05–A08）

**用途与切分**：只服务商品发现，四种封闭模式共享商品/SKU/库存词汇。它是领域工具而非万能工具：`mode` 没有“更新商品”“下订单”或任意 HTTP 方法。

**输入 Schema**

```json
{
  "type": "object",
  "properties": {
    "mode": { "type": "string", "enum": ["search", "product", "skus", "inventory"] },
    "query": { "type": "string", "minLength": 1 },
    "productId": { "type": "string", "minLength": 1 },
    "skuId": { "type": "string", "minLength": 1 },
    "warehouseId": { "type": "string", "minLength": 1 },
    "limit": { "type": "integer", "minimum": 1, "maximum": 20 }
  },
  "required": ["mode"],
  "additionalProperties": false
}
```

**成功输出 Schema**

```json
{
  "type": "object",
  "properties": {
    "mode": { "type": "string", "enum": ["search", "product", "skus", "inventory"] },
    "products": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "productId": { "type": "string" },
          "title": { "type": "string" },
          "description": { "type": "string" },
          "status": { "type": "string", "enum": ["active", "inactive"] }
        },
        "required": ["productId", "title", "description", "status"],
        "additionalProperties": false
      }
    },
    "product": {
      "type": "object",
      "properties": {
        "productId": { "type": "string" },
        "title": { "type": "string" },
        "description": { "type": "string" },
        "status": { "type": "string", "enum": ["active", "inactive"] }
      },
      "required": ["productId", "title", "description", "status"],
      "additionalProperties": false
    },
    "skus": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "skuId": { "type": "string" },
          "productId": { "type": "string" },
          "name": { "type": "string" },
          "priceMinor": { "type": "integer", "minimum": 0 },
          "currency": { "type": "string", "minLength": 3 }
        },
        "required": ["skuId", "productId", "name", "priceMinor", "currency"],
        "additionalProperties": false
      }
    },
    "inventory": {
      "type": "object",
      "properties": {
        "skuId": { "type": "string" },
        "warehouseId": { "type": "string" },
        "available": { "type": "integer", "minimum": 0 }
      },
      "required": ["skuId", "warehouseId", "available"],
      "additionalProperties": false
    }
  },
  "required": ["mode"],
  "additionalProperties": false
}
```

- **条件校验**：`search→query`，`product/skus→productId`，`inventory→skuId+warehouseId`；不适用字段必须为空，由业务层拒绝含混组合。`limit` 仅用于 `search`，缺省 10 是业务规则而非 Schema 自动默认值。
- **副作用/权限**：共享目录只读，`sensitive:false`；库存不返回其他租户预留量。
- **幂等/重试**：幂等；建议 `maxRetries:2`，库存只是瞬时事实，重试后仍须以报价/下单复核为准。
- **超时/错误**：每次尝试 2000ms；`RESOURCE_NOT_FOUND`、`DEPENDENCY_UNAVAILABLE`。
- **切分代价**：多模式输出较宽；若模型频繁混用参数，应优先拆出 `check_inventory`，不是继续加“智能猜测”。

### 4.3 `quote_checkout`（A09–A12）

**用途与切分**：对同一购物车 revision 一次性试算价格、配送、优惠和税费；四者必须共享过期时间，避免模型拼出来自不同报价的总额。可生成短期报价快照，但不创建订单、不占库存、不扣款。

**输入 Schema**

```json
{
  "type": "object",
  "properties": {
    "quoteRequestId": { "type": "string", "minLength": 8 },
    "cartId": { "type": "string", "minLength": 1 },
    "expectedRevision": { "type": "integer", "minimum": 1 },
    "addressId": { "type": "string", "minLength": 1 },
    "couponCodes": { "type": "array", "items": { "type": "string", "minLength": 1 } },
    "include": {
      "type": "array",
      "items": { "type": "string", "enum": ["pricing", "shipping", "discounts", "tax"] }
    }
  },
  "required": ["quoteRequestId", "cartId", "expectedRevision"],
  "additionalProperties": false
}
```

**成功输出 Schema**

```json
{
  "type": "object",
  "properties": {
    "quoteId": { "type": "string" },
    "cartId": { "type": "string" },
    "cartRevision": { "type": "integer", "minimum": 1 },
    "expiresAt": { "type": "string" },
    "subtotalMinor": { "type": "integer", "minimum": 0 },
    "discountMinor": { "type": "integer", "minimum": 0 },
    "shippingMinor": { "type": "integer", "minimum": 0 },
    "taxMinor": { "type": "integer", "minimum": 0 },
    "totalMinor": { "type": "integer", "minimum": 0 },
    "currency": { "type": "string", "minLength": 3 },
    "shippingOptions": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "optionId": { "type": "string" },
          "label": { "type": "string" },
          "amountMinor": { "type": "integer", "minimum": 0 },
          "estimatedDays": { "type": "integer", "minimum": 1 }
        },
        "required": ["optionId", "label", "amountMinor", "estimatedDays"],
        "additionalProperties": false
      }
    },
    "discountResults": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "code": { "type": "string" },
          "accepted": { "type": "boolean" },
          "reason": { "type": "string" }
        },
        "required": ["code", "accepted", "reason"],
        "additionalProperties": false
      }
    }
  },
  "required": ["quoteId", "cartId", "cartRevision", "expiresAt", "subtotalMinor", "discountMinor", "shippingMinor", "taxMinor", "totalMinor", "currency"],
  "additionalProperties": false
}
```

- **条件校验**：请求 shipping/tax 时必须有 `addressId`；`include` 缺省表示四项全算，是业务默认值。优惠不被接受可以是成功报价中的明确结果，系统性失败才是 ToolResult 错误。
- **副作用/权限**：租户报价计算，`sensitive:false`；不是金融扣款。适配器须校验 cart/address 租户归属。
- **幂等/重试**：只有 `quoteRequestId` 持久去重且同键返回同报价时，才建议 `retry.idempotent:true、maxRetries:2`；未做到则 `maxRetries:0`。Registry 不自动实现这个键。
- **超时/错误**：每次尝试 3000ms；`RESOURCE_CONFLICT`（revision 变了）、`RESOURCE_NOT_FOUND`、`DEPENDENCY_UNAVAILABLE`、`TOOL_TIMEOUT`。
- **切分理由**：报价是一个一致性边界；不要把税费结果和另一报价的配送结果拼接。

### 4.4 `get_cart`（A13）

**用途与切分**：读取单个购物车快照。调用高频、参数单一、结果稳定，没有必要和更新操作揉成 `cart_manager`。

**输入 Schema**

```json
{
  "type": "object",
  "properties": {
    "cartId": { "type": "string", "minLength": 1 }
  },
  "required": ["cartId"],
  "additionalProperties": false
}
```

**成功输出 Schema**

```json
{
  "type": "object",
  "properties": {
    "cartId": { "type": "string" },
    "customerId": { "type": "string" },
    "revision": { "type": "integer", "minimum": 1 },
    "items": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "skuId": { "type": "string" },
          "quantity": { "type": "integer", "minimum": 1 },
          "unitPriceMinor": { "type": "integer", "minimum": 0 },
          "currency": { "type": "string", "minLength": 3 }
        },
        "required": ["skuId", "quantity", "unitPriceMinor", "currency"],
        "additionalProperties": false
      }
    },
    "couponCodes": { "type": "array", "items": { "type": "string" } }
  },
  "required": ["cartId", "customerId", "revision", "items", "couponCodes"],
  "additionalProperties": false
}
```

- **副作用/权限**：租户只读，`sensitive:false`，检查 cart 归属。
- **幂等/重试**：幂等；建议 `maxRetries:2`。结果是快照，后续写操作仍用 revision 防旧数据覆盖。
- **超时/错误**：每次尝试 1000ms；`RESOURCE_NOT_FOUND`、`DEPENDENCY_UNAVAILABLE`、`TOOL_TIMEOUT`。

### 4.5 `update_cart`（A14–A17）

**用途与切分**：创建购物车、设置绝对数量、删除规格、应用优惠码都改变同一购物车并共享 revision。设置数量是“设为 N”而非“增加 N”，降低重复调用造成的数量放大。

**输入 Schema**

```json
{
  "type": "object",
  "properties": {
    "action": { "type": "string", "enum": ["create", "set_item", "remove_item", "apply_coupon"] },
    "requestId": { "type": "string", "minLength": 8 },
    "customerId": { "type": "string", "minLength": 1 },
    "cartId": { "type": "string", "minLength": 1 },
    "expectedRevision": { "type": "integer", "minimum": 1 },
    "skuId": { "type": "string", "minLength": 1 },
    "quantity": { "type": "integer", "minimum": 1, "maximum": 99 },
    "couponCode": { "type": "string", "minLength": 1 }
  },
  "required": ["action", "requestId"],
  "additionalProperties": false
}
```

**成功输出 Schema**

```json
{
  "type": "object",
  "properties": {
    "action": { "type": "string", "enum": ["create", "set_item", "remove_item", "apply_coupon"] },
    "cartId": { "type": "string" },
    "customerId": { "type": "string" },
    "revision": { "type": "integer", "minimum": 1 },
    "items": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "skuId": { "type": "string" },
          "quantity": { "type": "integer", "minimum": 1 },
          "unitPriceMinor": { "type": "integer", "minimum": 0 },
          "currency": { "type": "string", "minLength": 3 }
        },
        "required": ["skuId", "quantity", "unitPriceMinor", "currency"],
        "additionalProperties": false
      }
    },
    "couponCodes": { "type": "array", "items": { "type": "string" } }
  },
  "required": ["action", "cartId", "customerId", "revision", "items", "couponCodes"],
  "additionalProperties": false
}
```

- **条件校验**：`create→customerId`，其余→`cartId+expectedRevision`；`set_item→skuId+quantity`，`remove_item→skuId`，`apply_coupon→couponCode`。无关字段须省略，由业务层拒绝歧义。
- **副作用/权限**：租户普通写，`sensitive:false`；低风险不等于无权限，仍受白名单和资源归属约束。
- **幂等/重试**：后三种动作可设计成同 revision 幂等，`create` 依赖 requestId 持久去重；因单条 Registry 策略无法按 action 切换，本工具统一 `maxRetries:0`。若确需自动重试，应拆出 `create_cart`。
- **超时/错误**：每次尝试 2500ms；`RESOURCE_CONFLICT`、`RESOURCE_NOT_FOUND`、`INVALID_ARGUMENTS`、`TOOL_TIMEOUT`。超时后先 `get_cart`，不能盲目重发。
- **确认边界**：工具本身不二次确认，但宿主产品仍可在自己的 UX 中确认；不要把宿主提示伪称为 Registry 自动能力。

### 4.6 `create_order`（A18）

**用途与切分**：把一份未过期报价转成订单，是独立业务承诺。它不能藏在 `quote_checkout` 或 `update_cart` 中，否则“试算”会悄悄获得下单权限。

**输入 Schema**

```json
{
  "type": "object",
  "properties": {
    "requestId": { "type": "string", "minLength": 8 },
    "quoteId": { "type": "string", "minLength": 1 },
    "shippingOptionId": { "type": "string", "minLength": 1 },
    "acceptedTotalMinor": { "type": "integer", "minimum": 0 },
    "currency": { "type": "string", "minLength": 3 }
  },
  "required": ["requestId", "quoteId", "shippingOptionId", "acceptedTotalMinor", "currency"],
  "additionalProperties": false
}
```

**成功输出 Schema**

```json
{
  "type": "object",
  "properties": {
    "orderId": { "type": "string" },
    "quoteId": { "type": "string" },
    "status": { "type": "string", "enum": ["pending_payment", "confirmed"] },
    "totalMinor": { "type": "integer", "minimum": 0 },
    "currency": { "type": "string", "minLength": 3 },
    "createdAt": { "type": "string" }
  },
  "required": ["orderId", "quoteId", "status", "totalMinor", "currency", "createdAt"],
  "additionalProperties": false
}
```

- **副作用/权限**：租户敏感写，`sensitive:true`；每次逻辑调用确认 quoteId、配送选项、acceptedTotalMinor/currency 和 requestId。
- **幂等/重试**：业务必须用 requestId 持久去重；本课安全基线仍为 `maxRetries:0`。只有证明同键跨进程去重后才可另行评审开启，不能直接设 `allowNonIdempotent:true`。
- **超时/错误**：每次尝试 4000ms；`QUOTE_EXPIRED`、`RESOURCE_CONFLICT`（总额或报价已变）、`DEPENDENCY_UNAVAILABLE`、`TOOL_TIMEOUT`。超时后先按订单/报价事实查询，不立即再建一单。
- **输出边界**：创建订单不等于支付成功；输出不得暗示已扣款。

### 4.7 `query_orders`（A19–A21）

**用途与切分**：同一订单事实的列表、详情、时间线三种只读视角。`mode` 是封闭枚举，输出带 mode，避免模型误解空列表与详情。

**输入 Schema**

```json
{
  "type": "object",
  "properties": {
    "mode": { "type": "string", "enum": ["list", "detail", "timeline"] },
    "customerId": { "type": "string", "minLength": 1 },
    "orderId": { "type": "string", "minLength": 1 },
    "status": { "type": "string", "enum": ["pending_payment", "confirmed", "cancelled", "completed"] },
    "limit": { "type": "integer", "minimum": 1, "maximum": 20 }
  },
  "required": ["mode"],
  "additionalProperties": false
}
```

**成功输出 Schema**

```json
{
  "type": "object",
  "properties": {
    "mode": { "type": "string", "enum": ["list", "detail", "timeline"] },
    "orders": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "orderId": { "type": "string" },
          "customerId": { "type": "string" },
          "status": { "type": "string", "enum": ["pending_payment", "confirmed", "cancelled", "completed"] },
          "totalMinor": { "type": "integer", "minimum": 0 },
          "currency": { "type": "string", "minLength": 3 },
          "createdAt": { "type": "string" }
        },
        "required": ["orderId", "customerId", "status", "totalMinor", "currency", "createdAt"],
        "additionalProperties": false
      }
    },
    "order": {
      "type": "object",
      "properties": {
        "orderId": { "type": "string" },
        "customerId": { "type": "string" },
        "status": { "type": "string", "enum": ["pending_payment", "confirmed", "cancelled", "completed"] },
        "totalMinor": { "type": "integer", "minimum": 0 },
        "currency": { "type": "string", "minLength": 3 },
        "createdAt": { "type": "string" }
      },
      "required": ["orderId", "customerId", "status", "totalMinor", "currency", "createdAt"],
      "additionalProperties": false
    },
    "timeline": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "event": { "type": "string" },
          "occurredAt": { "type": "string" }
        },
        "required": ["event", "occurredAt"],
        "additionalProperties": false
      }
    }
  },
  "required": ["mode"],
  "additionalProperties": false
}
```

- **条件校验**：`list→customerId`，`detail/timeline→orderId`；status/limit 仅用于 list，缺省 limit=10 是业务规则。
- **副作用/权限**：租户只读，`sensitive:false`，资源归属检查不可省。
- **幂等/重试**：幂等，建议 `maxRetries:2`；状态仍可能在返回后变化。
- **超时/错误**：每次尝试 2000ms；`RESOURCE_NOT_FOUND`、`DEPENDENCY_UNAVAILABLE`。空订单列表是成功，不是 NOT_FOUND。

### 4.8 `cancel_order`（A22）

**用途与切分**：只负责取消，不成为 `update_order` 的入口。取消是否可行取决于订单和履约状态，查询与写入明确分离。

**输入 Schema**

```json
{
  "type": "object",
  "properties": {
    "requestId": { "type": "string", "minLength": 8 },
    "orderId": { "type": "string", "minLength": 1 },
    "expectedRevision": { "type": "integer", "minimum": 1 },
    "reason": { "type": "string", "enum": ["customer_request", "duplicate_order", "other"] }
  },
  "required": ["requestId", "orderId", "expectedRevision", "reason"],
  "additionalProperties": false
}
```

**成功输出 Schema**

```json
{
  "type": "object",
  "properties": {
    "orderId": { "type": "string" },
    "status": { "type": "string", "enum": ["cancelled"] },
    "revision": { "type": "integer", "minimum": 1 },
    "cancelledAt": { "type": "string" }
  },
  "required": ["orderId", "status", "revision", "cancelledAt"],
  "additionalProperties": false
}
```

- **副作用/权限**：租户敏感写，`sensitive:true`；逐次确认 orderId、revision 和原因，不提供“本会话永远允许”。
- **幂等/重试**：requestId 持久去重；已取消且同请求可返回原结果，不同请求是否允许需业务规则。基线 `maxRetries:0`，超时先 `query_orders`。
- **超时/错误**：每次尝试 3000ms；`RESOURCE_CONFLICT`（已发货/版本变化）、`RESOURCE_NOT_FOUND`、`DEPENDENCY_UNAVAILABLE`。
- **补偿边界**：取消订单不自动等于退款；已扣款时需独立 `request_refund` 和另一次确认。

### 4.9 `manage_payment`（A23–A24）

**用途与切分**：授权与扣款共享支付状态机，但用两个封闭 action 明确区分；不接受卡号、CVV 或任意支付网关参数，只接受已保管的 paymentMethodId。

**输入 Schema**

```json
{
  "type": "object",
  "properties": {
    "action": { "type": "string", "enum": ["authorize", "capture"] },
    "requestId": { "type": "string", "minLength": 8 },
    "orderId": { "type": "string", "minLength": 1 },
    "paymentId": { "type": "string", "minLength": 1 },
    "paymentMethodId": { "type": "string", "minLength": 1 },
    "amountMinor": { "type": "integer", "minimum": 1 },
    "currency": { "type": "string", "minLength": 3 }
  },
  "required": ["action", "requestId", "amountMinor", "currency"],
  "additionalProperties": false
}
```

**成功输出 Schema**

```json
{
  "type": "object",
  "properties": {
    "paymentId": { "type": "string" },
    "orderId": { "type": "string" },
    "status": { "type": "string", "enum": ["authorized", "captured"] },
    "amountMinor": { "type": "integer", "minimum": 1 },
    "currency": { "type": "string", "minLength": 3 },
    "updatedAt": { "type": "string" }
  },
  "required": ["paymentId", "orderId", "status", "amountMinor", "currency", "updatedAt"],
  "additionalProperties": false
}
```

- **条件校验**：`authorize→orderId+paymentMethodId`，`capture→paymentId`；金额与币种必须和授权/订单规则一致，由业务层检查。
- **副作用/权限**：租户敏感写，`sensitive:true`；每次逻辑调用都确认动作、金额、币种、订单/支付 ID。确认回调和日志不得记录卡资料。
- **幂等/重试**：requestId 必须由支付适配器与提供方持久去重；基线 `maxRetries:0`，绝不因 retryable 提示就直接允许非幂等重试。
- **超时/错误**：每次尝试 5000ms；`PAYMENT_DECLINED`、`RESOURCE_CONFLICT`、`DEPENDENCY_UNAVAILABLE`、`TOOL_TIMEOUT`。超时代表结果未知，先 `get_payment_status`，不是“支付失败可重扣”。
- **切分代价**：authorize/capture 权限若在未来分给不同角色，应拆成两个 Registry 条目；当前统一敏感确认是有意选择。

### 4.10 `get_payment_status`（A25–A26）

**用途与切分**：按 paymentId 查单笔，或按 orderId 查全部支付尝试；它是支付写操作后的对账工具，不承担退款或再次扣款。

**输入 Schema**

```json
{
  "type": "object",
  "properties": {
    "mode": { "type": "string", "enum": ["by_payment", "by_order"] },
    "paymentId": { "type": "string", "minLength": 1 },
    "orderId": { "type": "string", "minLength": 1 }
  },
  "required": ["mode"],
  "additionalProperties": false
}
```

**成功输出 Schema**

```json
{
  "type": "object",
  "properties": {
    "mode": { "type": "string", "enum": ["by_payment", "by_order"] },
    "payment": {
      "type": "object",
      "properties": {
        "paymentId": { "type": "string" },
        "orderId": { "type": "string" },
        "status": { "type": "string", "enum": ["authorized", "captured", "declined", "partially_refunded", "refunded"] },
        "amountMinor": { "type": "integer", "minimum": 1 },
        "currency": { "type": "string", "minLength": 3 },
        "updatedAt": { "type": "string" }
      },
      "required": ["paymentId", "orderId", "status", "amountMinor", "currency", "updatedAt"],
      "additionalProperties": false
    },
    "payments": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "paymentId": { "type": "string" },
          "orderId": { "type": "string" },
          "status": { "type": "string", "enum": ["authorized", "captured", "declined", "partially_refunded", "refunded"] },
          "amountMinor": { "type": "integer", "minimum": 1 },
          "currency": { "type": "string", "minLength": 3 },
          "updatedAt": { "type": "string" }
        },
        "required": ["paymentId", "orderId", "status", "amountMinor", "currency", "updatedAt"],
        "additionalProperties": false
      }
    }
  },
  "required": ["mode"],
  "additionalProperties": false
}
```

- **条件校验**：`by_payment→paymentId`，`by_order→orderId`；由业务层执行。
- **副作用/权限**：租户只读，`sensitive:false`；不返回完整卡号、认证秘密或网关原始报文。
- **幂等/重试**：幂等，建议 `maxRetries:2`；“查不到”在写操作刚超时后可能是延迟，不能立刻断言未扣款，应结合时间线和提供方对账。
- **超时/错误**：每次尝试 2000ms；`RESOURCE_NOT_FOUND`、`DEPENDENCY_UNAVAILABLE`。

### 4.11 `inspect_refund`（A27–A28）

**用途与切分**：按退款 ID 或支付 ID 查询退款事实，与申请退款严格分离，模型可以安全调查而不获得资金写入能力。

**输入 Schema**

```json
{
  "type": "object",
  "properties": {
    "mode": { "type": "string", "enum": ["by_refund", "by_payment"] },
    "refundId": { "type": "string", "minLength": 1 },
    "paymentId": { "type": "string", "minLength": 1 }
  },
  "required": ["mode"],
  "additionalProperties": false
}
```

**成功输出 Schema**

```json
{
  "type": "object",
  "properties": {
    "mode": { "type": "string", "enum": ["by_refund", "by_payment"] },
    "refund": {
      "type": "object",
      "properties": {
        "refundId": { "type": "string" },
        "paymentId": { "type": "string" },
        "status": { "type": "string", "enum": ["requested", "processing", "succeeded", "failed"] },
        "amountMinor": { "type": "integer", "minimum": 1 },
        "currency": { "type": "string", "minLength": 3 },
        "requestedAt": { "type": "string" }
      },
      "required": ["refundId", "paymentId", "status", "amountMinor", "currency", "requestedAt"],
      "additionalProperties": false
    },
    "refunds": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "refundId": { "type": "string" },
          "paymentId": { "type": "string" },
          "status": { "type": "string", "enum": ["requested", "processing", "succeeded", "failed"] },
          "amountMinor": { "type": "integer", "minimum": 1 },
          "currency": { "type": "string", "minLength": 3 },
          "requestedAt": { "type": "string" }
        },
        "required": ["refundId", "paymentId", "status", "amountMinor", "currency", "requestedAt"],
        "additionalProperties": false
      }
    }
  },
  "required": ["mode"],
  "additionalProperties": false
}
```

- **条件校验**：`by_refund→refundId`，`by_payment→paymentId`。
- **副作用/权限**：租户只读，`sensitive:false`，检查支付和退款归属。
- **幂等/重试**：幂等，建议 `maxRetries:2`；processing 是正常状态，不应被转成内部异常。
- **超时/错误**：每次尝试 2000ms；`RESOURCE_NOT_FOUND`、`DEPENDENCY_UNAVAILABLE`；按 payment 查询无退款时返回空数组。

### 4.12 `request_refund`（A29）

**用途与切分**：单独的资金副作用工具，不由 `cancel_order` 或客服建单隐式调用。成功仅表示退款请求被接受，不谎称资金已到账。

**输入 Schema**

```json
{
  "type": "object",
  "properties": {
    "requestId": { "type": "string", "minLength": 8 },
    "paymentId": { "type": "string", "minLength": 1 },
    "amountMinor": { "type": "integer", "minimum": 1 },
    "currency": { "type": "string", "minLength": 3 },
    "reason": { "type": "string", "enum": ["customer_request", "order_cancelled", "return_accepted", "other"] }
  },
  "required": ["requestId", "paymentId", "amountMinor", "currency", "reason"],
  "additionalProperties": false
}
```

**成功输出 Schema**

```json
{
  "type": "object",
  "properties": {
    "refundId": { "type": "string" },
    "paymentId": { "type": "string" },
    "status": { "type": "string", "enum": ["requested", "processing"] },
    "amountMinor": { "type": "integer", "minimum": 1 },
    "currency": { "type": "string", "minLength": 3 },
    "requestedAt": { "type": "string" }
  },
  "required": ["refundId", "paymentId", "status", "amountMinor", "currency", "requestedAt"],
  "additionalProperties": false
}
```

- **副作用/权限**：租户敏感写，`sensitive:true`；确认 paymentId、金额、币种和原因，每次逻辑调用独立批准。
- **幂等/重试**：requestId 持久去重且累计退款不得超过可退余额；基线 `maxRetries:0`，超时先 `inspect_refund` 与 `get_payment_status`。
- **超时/错误**：每次尝试 5000ms；`RESOURCE_CONFLICT`（超额/状态不允许）、`RESOURCE_NOT_FOUND`、`DEPENDENCY_UNAVAILABLE`、`TOOL_TIMEOUT`。
- **错误边界**：退款后续失败通过查询返回 failed；本次请求被接受与最终到账是两个事实，不能合并成一句“已退款”。

### 4.13 `query_shipments`（A30–A32）

**用途与切分**：按运单查详情、按订单查运单、按运单查轨迹，全部只读并共享履约词汇。

**输入 Schema**

```json
{
  "type": "object",
  "properties": {
    "mode": { "type": "string", "enum": ["detail", "by_order", "events"] },
    "shipmentId": { "type": "string", "minLength": 1 },
    "orderId": { "type": "string", "minLength": 1 }
  },
  "required": ["mode"],
  "additionalProperties": false
}
```

**成功输出 Schema**

```json
{
  "type": "object",
  "properties": {
    "mode": { "type": "string", "enum": ["detail", "by_order", "events"] },
    "shipment": {
      "type": "object",
      "properties": {
        "shipmentId": { "type": "string" },
        "orderId": { "type": "string" },
        "status": { "type": "string", "enum": ["preparing", "in_transit", "delivered", "exception"] },
        "carrier": { "type": "string" },
        "trackingNumber": { "type": "string" }
      },
      "required": ["shipmentId", "orderId", "status", "carrier", "trackingNumber"],
      "additionalProperties": false
    },
    "shipments": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "shipmentId": { "type": "string" },
          "orderId": { "type": "string" },
          "status": { "type": "string", "enum": ["preparing", "in_transit", "delivered", "exception"] },
          "carrier": { "type": "string" },
          "trackingNumber": { "type": "string" }
        },
        "required": ["shipmentId", "orderId", "status", "carrier", "trackingNumber"],
        "additionalProperties": false
      }
    },
    "events": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "status": { "type": "string" },
          "location": { "type": "string" },
          "occurredAt": { "type": "string" }
        },
        "required": ["status", "location", "occurredAt"],
        "additionalProperties": false
      }
    }
  },
  "required": ["mode"],
  "additionalProperties": false
}
```

- **条件校验**：`detail/events→shipmentId`，`by_order→orderId`。
- **副作用/权限**：租户只读，`sensitive:false`；对外展示轨迹前检查订单归属。
- **幂等/重试**：幂等，建议 `maxRetries:2`；轨迹可能延迟，工具不得把最新一条事件称为绝对实时位置。
- **超时/错误**：每次尝试 2000ms；`RESOURCE_NOT_FOUND`、`DEPENDENCY_UNAVAILABLE`；无运单的订单返回空 shipments。

### 4.14 `change_delivery`（A33–A34）

**用途与切分**：修改收货地址与改派站点都是发货前/运输中的履约变更，共享 revision 与状态冲突；不能借客服消息工具静默执行。

**输入 Schema**

```json
{
  "type": "object",
  "properties": {
    "action": { "type": "string", "enum": ["update_address", "reroute"] },
    "requestId": { "type": "string", "minLength": 8 },
    "shipmentId": { "type": "string", "minLength": 1 },
    "expectedRevision": { "type": "integer", "minimum": 1 },
    "addressId": { "type": "string", "minLength": 1 },
    "destinationCode": { "type": "string", "minLength": 1 }
  },
  "required": ["action", "requestId", "shipmentId", "expectedRevision"],
  "additionalProperties": false
}
```

**成功输出 Schema**

```json
{
  "type": "object",
  "properties": {
    "shipmentId": { "type": "string" },
    "revision": { "type": "integer", "minimum": 1 },
    "status": { "type": "string", "enum": ["preparing", "in_transit", "exception"] },
    "addressId": { "type": "string" },
    "destinationCode": { "type": "string" },
    "updatedAt": { "type": "string" }
  },
  "required": ["shipmentId", "revision", "status", "updatedAt"],
  "additionalProperties": false
}
```

- **条件校验**：`update_address→addressId`，`reroute→destinationCode`；已 delivered 或不允许的 in_transit 状态返回冲突，不能假装成功。
- **副作用/权限**：租户敏感写，`sensitive:true`；逐次确认运单、动作及目标地址/站点，address 也须属于当前客户。
- **幂等/重试**：requestId 持久去重；统一 `maxRetries:0`，超时先查运单，避免重复改派。
- **超时/错误**：每次尝试 4000ms；`RESOURCE_CONFLICT`、`RESOURCE_NOT_FOUND`、`DEPENDENCY_UNAVAILABLE`。
- **输出边界**：接受改派请求不代表新地址已实际生效于承运商；适配器需根据真实状态准确返回。

### 4.15 `query_support_cases`（A35–A36）

**用途与切分**：客服工单列表与详情只读聚合，和创建、回复、关闭等对外可见副作用分开授权。

**输入 Schema**

```json
{
  "type": "object",
  "properties": {
    "mode": { "type": "string", "enum": ["list", "detail"] },
    "customerId": { "type": "string", "minLength": 1 },
    "caseId": { "type": "string", "minLength": 1 },
    "status": { "type": "string", "enum": ["open", "closed"] },
    "limit": { "type": "integer", "minimum": 1, "maximum": 20 }
  },
  "required": ["mode"],
  "additionalProperties": false
}
```

**成功输出 Schema**

```json
{
  "type": "object",
  "properties": {
    "mode": { "type": "string", "enum": ["list", "detail"] },
    "cases": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "caseId": { "type": "string" },
          "customerId": { "type": "string" },
          "subject": { "type": "string" },
          "status": { "type": "string", "enum": ["open", "closed"] },
          "revision": { "type": "integer", "minimum": 1 },
          "updatedAt": { "type": "string" }
        },
        "required": ["caseId", "customerId", "subject", "status", "revision", "updatedAt"],
        "additionalProperties": false
      }
    },
    "case": {
      "type": "object",
      "properties": {
        "caseId": { "type": "string" },
        "customerId": { "type": "string" },
        "subject": { "type": "string" },
        "status": { "type": "string", "enum": ["open", "closed"] },
        "revision": { "type": "integer", "minimum": 1 },
        "updatedAt": { "type": "string" }
      },
      "required": ["caseId", "customerId", "subject", "status", "revision", "updatedAt"],
      "additionalProperties": false
    }
  },
  "required": ["mode"],
  "additionalProperties": false
}
```

- **条件校验**：`list→customerId`，`detail→caseId`；status/limit 仅用于 list，缺省 limit=10 是业务规则。
- **副作用/权限**：租户只读，`sensitive:false`；消息正文可能含个人信息，只返回完成任务所需字段并遵守宿主日志策略。
- **幂等/重试**：幂等，建议 `maxRetries:2`。
- **超时/错误**：每次尝试 1500ms；`RESOURCE_NOT_FOUND`、`DEPENDENCY_UNAVAILABLE`；无工单返回空数组。

### 4.16 `manage_support_cases`（A37–A40）

**用途与切分**：创建、回复、关闭、重开共享工单 revision 和状态机。它们不是四个“端点工具”，但统一敏感确认会让建单也更繁琐，这是明确记录的拆分候选。

**输入 Schema**

```json
{
  "type": "object",
  "properties": {
    "action": { "type": "string", "enum": ["create", "reply", "close", "reopen"] },
    "requestId": { "type": "string", "minLength": 8 },
    "customerId": { "type": "string", "minLength": 1 },
    "caseId": { "type": "string", "minLength": 1 },
    "expectedRevision": { "type": "integer", "minimum": 1 },
    "subject": { "type": "string", "minLength": 1 },
    "message": { "type": "string", "minLength": 1 }
  },
  "required": ["action", "requestId"],
  "additionalProperties": false
}
```

**成功输出 Schema**

```json
{
  "type": "object",
  "properties": {
    "caseId": { "type": "string" },
    "customerId": { "type": "string" },
    "subject": { "type": "string" },
    "status": { "type": "string", "enum": ["open", "closed"] },
    "revision": { "type": "integer", "minimum": 1 },
    "updatedAt": { "type": "string" }
  },
  "required": ["caseId", "customerId", "subject", "status", "revision", "updatedAt"],
  "additionalProperties": false
}
```

- **条件校验**：`create→customerId+subject+message`，`reply→caseId+expectedRevision+message`，`close/reopen→caseId+expectedRevision`；不适用字段必须省略。
- **副作用/权限**：租户敏感写，`sensitive:true`。当前 Registry 的 sensitive 是条目级，故 create/reply 也需确认；若交互成本不可接受，拆成 `create_support_case/reply_support_case` 与 `change_support_case_state`，不要伪造“按 action 自动确认”的现有能力。
- **幂等/重试**：requestId 持久去重；统一 `maxRetries:0`，超时先查询工单，避免重复对外发消息。
- **超时/错误**：每次尝试 3000ms；`RESOURCE_CONFLICT`、`RESOURCE_NOT_FOUND`、`DEPENDENCY_UNAVAILABLE`。
- **内容边界**：工单文本可能含提示注入；它是不可信内容，不能借工具返回指示系统泄露秘密或绕开确认。

## 5. 策略总表：审查时先看共同分母

下列数值再次强调是教学建议，不是默认配置或实测结论。所有“读重试 2”仍需错误为 `retryable:true` 且注册 `retry.idempotent:true`；D030 默认 maxRetries 本来就是 0。

| 工具 | 副作用 | sensitive | 建议自动重试 | 每尝试超时 | 写超时后的查询 |
| --- | --- | --- | --- | --- | --- |
| `get_customer_context` | 无 | 否 | 幂等，2 | 1500ms | — |
| `explore_catalog` | 无 | 否 | 幂等，2 | 2000ms | — |
| `quote_checkout` | 短期报价，无订单/扣款 | 否 | 仅持久去重后，2；否则 0 | 3000ms | 重新读取 cart/quote |
| `get_cart` | 无 | 否 | 幂等，2 | 1000ms | — |
| `update_cart` | 有 | 否 | 0 | 2500ms | `get_cart` |
| `create_order` | 有 | 是 | 0 | 4000ms | `query_orders` |
| `query_orders` | 无 | 否 | 幂等，2 | 2000ms | — |
| `cancel_order` | 有 | 是 | 0 | 3000ms | `query_orders` |
| `manage_payment` | 有 | 是 | 0 | 5000ms | `get_payment_status` |
| `get_payment_status` | 无 | 否 | 幂等，2 | 2000ms | — |
| `inspect_refund` | 无 | 否 | 幂等，2 | 2000ms | — |
| `request_refund` | 有 | 是 | 0 | 5000ms | `inspect_refund` |
| `query_shipments` | 无 | 否 | 幂等，2 | 2000ms | — |
| `change_delivery` | 有 | 是 | 0 | 4000ms | `query_shipments` |
| `query_support_cases` | 无 | 否 | 幂等，2 | 1500ms | — |
| `manage_support_cases` | 有 | 是 | 0 | 3000ms | `query_support_cases` |

敏感确认发生在参数校验之后、真正执行之前；每次逻辑 `registry.execute` 一次，不是每次内部重试一次。工具失败作为 ToolResult 回喂，Loop 默认连续 3 次工具错误停止；不能靠无限自救绕过权限或业务冲突。

## 6. 反例：这些设计为什么不能只凭“能用”通过

### 反例 A：40 API = 40 工具

把 `get_customer_profile/get_customer_addresses/get_membership/get_preferences` 全塞给模型，会让简单任务先做四次低价值选择，放大工具描述 token、相似工具误选和测试矩阵。**修正**：同客户、同权限、同只读语义聚合为 `get_customer_context(include)`。

### 反例 B：一个万能 `commerce_api`

```json
{ "method": "任意字符串", "path": "任意字符串", "headers": {}, "body": {} }
```

它看似兼容 40 API，实际把选择、权限、Schema、错误和审计全部推回模型；还可能变成任意请求代理。**修正**：封闭工具名与 action 枚举，逐工具 Schema，敏感写独立确认。

### 反例 C：一个 `manage_commerce` 管所有读写

报价和退款共享 action 并不代表应共享权限。条目级 sensitive、重试、超时只能取共同配置，最终不是人人确认，就是资金操作被放开。**修正**：按副作用和授权边界拆分。

### 反例 D：把条件 Schema 当成现有能力

写 `oneOf` 或 `$ref` 看似精确，当前 Registry 并不支持；只声明 action 又假设“模型自然会填对”也不够。**修正**：使用当前子集做第一层校验，业务层明确检查模式所需字段与无关字段，并返回可修复的参数路径。

### 反例 E：所有错误都重试

参数错误、权限拒绝、支付 decline、状态冲突重试不会改变结果；支付超时重试还可能重复扣款。**修正**：确定性错误立即回喂；幂等读有限重试；写超时先查事实。限流和熔断不在同一逻辑调用中立即自动重试。

### 反例 F：让模型传 tenantId 并信任它

Schema 中的 tenantId 是调用方可伪造数据，不是身份。**修正**：Registry 策略覆盖 ToolContext.tenantId，业务层再验证资源归属。

### 反例 G：返回值只包一层字符串或大原始报文

`"{\"ok\":true}"` 让模型无法稳定引用字段，原始网关响应又可能过大或泄密。**修正**：小而稳定的业务输出，失败走结构化 ToolResult，必要时提供摘要与分页。

## 7. 可复用的工具粒度决策清单

按顺序回答；任何一个“否”都可能意味着需要重新切分，而不是把 16 当普遍标准。

1. **一句话意图**：能否不用“和/或/等等”说清工具替用户完成什么？
2. **业务内聚**：聚合的 API 是否共享同一对象、一致性快照或状态机，而不只是同属一个后台？
3. **调用频率**：是否把几乎每个任务都要用的简单查询独立出来，减少 action 分支？
4. **读写分离**：只读调用者能否在完全没有写权限时发现并调用它？
5. **权限一致**：工具内所有 action 是否适合同一白名单、租户和 sensitive 策略？若不是，拆分。
6. **副作用可解释**：用户确认界面能否完整展示将发生的动作、对象、金额与影响？
7. **输入可判别**：action/mode 是否封闭枚举？条件字段是否少且业务校验有明确错误路径？
8. **输出有界**：是否限制 limit、字段和正文大小？空集合、部分失败、处理中状态是否区分？
9. **幂等可证明**：重复请求是返回原结果，还是重复产生副作用？requestId 去重究竟由谁持久实现？
10. **重试取共同分母**：条目内有没有一个 action 迫使全部动作 maxRetries=0？代价是否值得，是否应拆？
11. **失败可恢复**：每种错误是否标明 retryable、hint 和下一步？写超时是否有对应状态查询工具？
12. **超时预算可解释**：数值是否按每次尝试理解，并另算排队/退避，而不是谎称总 deadline？
13. **独立可测**：能否不调用其他工具就测试正常、非法参数、权限、冲突、超时与迟到结果？
14. **模型可发现**：名称和描述是否使用用户任务语言，而不是内部控制器或 HTTP 路径语言？
15. **演化信号**：误选率、条件参数错误、过宽权限、输出 token、确认疲劳是否持续升高？用证据拆并，不凭审美。
16. **映射守恒**：每个 API 是否恰好归属一个工具？每个工具是否都有存在理由，还是为凑数量？

### 何时合并

同一任务上下文、同一只读/授权策略、输出可保持可判别，并且合并能明显减少模型低价值选择时合并。

### 何时拆分

权限或副作用不同、重试共同分母长期浪费、条件字段组合频繁出错、输出膨胀、工具需要独立替换/限流/熔断，或一个工具已无法用一句话解释时拆分。

## 8. 资料包自检

- [x] A01–A40 每个恰好出现一次，16 个工具数量守恒。
- [x] 每个工具都有输入 Schema、成功输出 Schema、切分理由、副作用、权限/确认、幂等/重试、建议超时与错误语义。
- [x] 条件必填明确交给业务层，没有冒充当前 Registry 支持 oneOf/$ref。
- [x] requestId、输出 Schema 和业务权限是适配器设计，没有冒充 Harness 内建能力。
- [x] 40=40 与万能工具等反例给出原因和修正，不以“16”作为跨领域固定答案。
