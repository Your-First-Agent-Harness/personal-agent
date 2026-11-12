# D021 · Session 存储：SQLite、JSON 序列化、快照

> 目标：在不改变现有内存 `Session`、Loop 和 CLI 契约的前提下，提供可关闭、重开并恢复完整消息历史的 SQLite 存储。
>
> 基线：D020 提交 `6bc5d1b`。本日验证环境：Node.js `v24.19.0`、原生 TypeScript、ESM、Vitest，零新增运行时依赖。

## 一、公开契约

实现位于 `src/memory/session-store.ts`：

```ts
export interface SessionStore {
  save(session: Session): void;
  load(id: string): Session | undefined;
  close(): void;
}
```

`SqliteSessionStore` 是同步实现，`SessionStoreError` 用于损坏消息数据和关闭后误用等明确的存储错误。现有 `src/memory/session.ts` 未修改：

- `Session.append()` 仍只修改内存历史；
- `snapshot()` 仍返回隔离副本；
- Loop、CLI 和 D020 流式路径不需要依赖存储层；
- 调用方决定何时 `save()`，以及何时用 `load(id)` 创建恢复后的内存 `Session`。

基本用法：

```ts
import { Session } from './src/memory/session.ts';
import { SqliteSessionStore } from './src/memory/session-store.ts';

const session = new Session('demo', [{ role: 'user', content: '你好\nSQLite' }]);
const store = new SqliteSessionStore('./sessions.sqlite');
store.save(session);
store.close();

const reopened = new SqliteSessionStore('./sessions.sqlite');
const restored = reopened.load('demo');
console.log(restored?.snapshot());
reopened.close();
```

数据库文件的父目录必须已经存在。`load()` 找不到 id 时返回 `undefined`。`close()` 可重复调用；关闭后再调用 `save()` 或 `load()` 会抛出 `SessionStoreError`。

## 二、SQLite schema

构造存储时启用外键，并幂等创建以下两张表：

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS session_messages (
  session_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  message_json TEXT NOT NULL,
  PRIMARY KEY (session_id, position),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
```

- `sessions.id` 是 Session 的稳定身份；
- `session_messages.position` 是消息在快照中的数组下标，恢复时使用 `ORDER BY position ASC`；
- `(session_id, position)` 主键防止同一 Session 的同一位置出现两行；
- 外键保证消息必须属于一个 Session，删除父记录时可级联清理；
- 所有 id、序号和 JSON 文本都通过 `?` 参数绑定，不把外部值拼入 SQL。

## 三、JSON 序列化边界

一次 `save(session)` 首先取得 `session.snapshot()`，再把每条消息分别用 `JSON.stringify()` 写入 `message_json`。序列化的是消息快照，不是 `Session` 实例，也不保存任何运行时 Provider、工具注册表或流式回调。

保留的 `Message` 字段为：

- `role`、`content`；
- 可选 `toolCalls`，其中每次调用的 `id`、`name`、`arguments` 都按字符串保存；
- 可选 `toolCallId`、`name`。

`toolCalls.arguments` 不在存储层解析成对象再重建，因此其原始 JSON 字符串保持不变。`content` 和工具结果中的换行、Unicode、空字符串由 JSON 和 SQLite TEXT 完整保留。

`load(id)` 读取有序行后，将 JSON 解析结果先当作 `unknown` 处理，再逐字段验证并构造新的 `Message`：

- role 必须是 `system`、`user`、`assistant` 或 `tool`；
- content 必须是字符串；
- toolCalls 及其 id/name/arguments 必须符合现有领域契约；
- 可选字段出现时必须是字符串；
- 非法 JSON、非字符串持久化内容或不符合契约的结构都会抛出带 Session id 和消息位置的 `SessionStoreError`，不会把任意 JSON 直接断言成 `Message`。

验证后通过 `new Session(id, messages)` 恢复，因此原 Session 与恢复 Session 的 id、snapshot 一致，并继续具备原有快照隔离。修改恢复对象的快照或只修改其内存历史，不会反向改变数据库；再次 `load()` 仍读取最后一次成功保存的快照。

## 四、事务与重复保存

每次保存使用一个显式事务：

```text
BEGIN IMMEDIATE
  插入 sessions 父记录（id 已存在则保持不变）
  删除该 id 的旧 session_messages
  按 position 插入本次完整消息快照
COMMIT
```

任一步骤失败会执行 `ROLLBACK` 并重新抛出错误。这样，其他数据库连接不会看到一次保存中“旧消息已删、新消息尚未写全”的中间状态。

重复保存相同 id 的语义是**替换为最新完整快照**，不是增量追加：消息新增后保存不会留下旧副本，使用同 id 的较短快照保存也不会残留更长历史。

本日的事务保证针对一次数据库快照写入；它不意味着进程中断识别、Run 续跑或工具副作用恢复已经实现。

## 五、测试策略与 RED → GREEN 证据

`test/d021-session-store.test.ts` 使用系统临时目录中的真实 SQLite 文件，没有 mock `node:sqlite`。9 项测试覆盖：

1. 关闭并重开数据库后恢复三轮有序 user/assistant 历史，以及换行、Unicode、空字符串；
2. 工具调用与工具结果恢复，保留调用 id/name/arguments；
3. 同 id 重复保存替换完整快照，不重复追加；
4. 两个 Session 的历史隔离；
5. 不存在的 id 返回 `undefined`；
6. 外部修改恢复快照或内存 Session 后，再次读取不受污染；
7. 非法 JSON 抛出明确 `SessionStoreError`；
8. JSON 结构不符合 Message 契约时抛出明确 `SessionStoreError`；
9. close 幂等，以及关闭后的 save/load 错误行为。

严格按照测试先行执行：

```text
RED：npm test -- test/d021-session-store.test.ts
     1 个文件、9 项测试全部失败
     原因：src/memory/session-store.ts 尚不存在

GREEN：完成最小实现后再次执行同一命令
       1 个文件、9 项测试全部通过
```

随后联合运行旧 Session 与 D020 流式测试，共 5 个文件、26 项测试全部通过，确认既有快照边界和流式能力未受影响。

## 六、运行与实测结果

只跑本日测试：

```bash
npm test -- test/d021-session-store.test.ts
```

运行本日及相关回归：

```bash
npm test -- \
  test/session.test.ts \
  test/d021-session-store.test.ts \
  test/d020-streaming.test.ts \
  test/d020-loop-streaming.test.ts \
  test/d020-cli.test.ts
```

完整验证：

```bash
npm run check
npm run test:coverage
```

在 Node.js `v24.19.0` 下的最终实测：

| 项目 | 结果 |
| --- | --- |
| ESLint | 通过 |
| TypeScript `tsc --noEmit` | 通过 |
| 全量 Vitest | **23 个测试文件、197 项测试全部通过** |
| 覆盖率运行 | **23 / 23 文件、197 / 197 测试通过** |
| Statements | **94.52%** |
| Branches | **89.49%** |
| Functions | **98.47%** |
| Lines | **95.36%** |

覆盖率阈值仍为 statements/lines/functions 80、branches 75，结果全部高于阈值。本次未增加 `better-sqlite3`、`sqlite3` 或任何其他运行时依赖，直接使用 Node 内置 `node:sqlite` 的 `DatabaseSync`。

本机上述测试、完整检查和覆盖率输出中均**未出现 `node:sqlite` ExperimentalWarning**。命令行仍会显示环境已有的 npm `Unknown user config "home"` 提示，该提示与 SQLite 和本日功能无关。

## 七、明确限制与后续边界

本日只交付显式的 Session 保存与恢复能力，没有向 CLI 添加半套自动恢复逻辑：

- **D022**：Run journal、进程中断识别、崩溃扫描和自动续跑不在本日范围内；SQLite 中仍存在某个 Session 不等于系统知道它中断前执行到哪一步。
- **D023**：工具幂等 key、副作用去重和 exactly-once 语义不在本日范围内；恢复消息历史不会自动判断某个工具是否已经产生外部副作用。
- 当前没有 schema 版本迁移机制，也未宣称完成多进程并发写入或跨进程崩溃恢复验证。
- `save()` 只持久化调用时的快照；之后新增到内存 Session 的消息需要再次显式保存。
- D020 的 Provider 流式读取、Loop delta 事件和 CLI 输出路径未改动；本日测试不包含真实模型服务调用。
