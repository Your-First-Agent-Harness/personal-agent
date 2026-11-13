# D046｜安全演示：工具沙箱攻击演示（未录屏）

本日在 D045 安全架构评审的基础上，真实回放 D043 `sandboxed_command` 与 D044 `secure_command` 的攻防差异：前者的临时 cwd、固定 env 和进程组管理**不是文件系统沙箱**；后者能把未允许的 executable/argv 在进程启动前拒绝，并对允许执行的命令施加输出字节预算、wall timeout 和双阶段审计。

**明确未录屏。** 当前环境没有录屏工具，本日没有生成或伪造视频、GIF、截图，也不声称完成录屏展示。交付证据是真实终端 [transcript](evidence/d046-transcript.txt)、真实 [JSONL 审计](evidence/d046-audit.jsonl)、可复跑 Demo 和行为测试。

## 1. 安全警告与授权范围

本 Demo 只用于本仓库内的防御验证。必须原样通过 `npm run demo:d046` 运行，不要把其中的路径、命令或 argv 改造成针对其他目录或主机的载荷。

- 所有攻击只发生在进程内 `mkdtemp` 创建的唯一一次性实验根中；Demo 不接受外部攻击目标路径。
- 只使用伪造宿主环境变量、专用 marker 和专用 victim；不使用真实凭证，不读取真实用户文件。
- 零外网、零真实 exfiltration、零端口监听。
- 唯一删除目标是实验根内预先创建的 `victims/delete.txt`；没有通配符删除或破坏性系统操作。
- 资源载荷只有 256 字节 pipe 输出和一个 `setInterval` 无害循环；未运行 fork bomb、OOM、无限写盘或其他危险载荷。
- `finally` 恢复伪造环境变量并递归删除唯一实验根；最终门禁要求 `hostRootRemoved=true`。
- “工具正确拒绝”是防御控制成立，不被描述为漏洞；D043 穿越初始 cwd 也只证明其名称中的 sandbox 不等于文件系统隔离。

## 2. 交付物与复跑入口

| 交付物 | 内容 |
| --- | --- |
| `src/demo/d046.ts` | 12 项真实攻防门禁、逐项 expected/observed/control/attackResult 和总门禁 |
| `scripts/d046-security.ts` | `npm run demo:d046` 入口；失败时输出 FAIL 并非零退出 |
| `test/d046-attack-chains.test.ts` | 5 个真实文件、真实 Tool 执行、真实 Node 子进程和 JSONL 行为测试 |
| `test/d046-demo.test.ts` | 完整 Demo 报告、12 项结果、16 条审计、spawn 计数、秘密与清理门禁 |
| `evidence/d046-transcript.txt` | 最终真实终端输出，不是手工编写的假想会话 |
| `evidence/d046-audit.jsonl` | Demo 通过真实 AuditSink 写出的 8 个 operation、16 条记录 |
| `evidence/d046-tdd-red.txt` | 新模块缺失和拒绝 completion 缺失时的真实 RED |
| `evidence/d046-tdd-green.txt` | 最小实现后，D044 回归与 D046 测试的真实 GREEN |
| 本 README | 安全边界、拓扑、命令、数据流、实测、TDD、风险和复跑方法 |

基线是 D045 提交 `f7fed82db2f916db36ae7415a9b4fb4a7e328115` 上的 `D046` 分支；没有从 main 重建或合并 main。本日没有新增运行时依赖。

## 3. 实验拓扑与信任边界

```text
D046 父进程
  ├─ 设置 D046_HOST_SECRET=<仅伪造值>
  └─ hostRoot = realpath(mkdtemp(.../d046-security-lab-*))
       ├─ initial-cwd/
       │    └─ D043 每次调用再创建并清理自己的 .d043-sandbox-* cwd
       ├─ victims/
       │    ├─ absolute.txt          D043 绝对路径读写目标
       │    ├─ cd.txt                D043 shell cd 读写目标
       │    ├─ delete.txt            唯一允许删除的 victim
       │    └─ secure-victim.txt     D044 拒绝前后必须保持不变
       ├─ denial-marker             五类 D044 攻击均不得创建
       └─ d046-audit.jsonl           仅 D044 真实审计

D043 数据流：
  command 字符串 → /bin/sh -c（开放 shell）→ 独立 cwd / 固定 env / 进程组
                 → 绝对路径或 cd 可到初始 cwd 外，但本实验仍限制在 hostRoot 内

D044 数据流：
  executable + argv → realpath(executable) + 完整 argv 精确白名单
    ├─ 不匹配 → decision(denied) → completion(denied) → 不 spawn
    └─ 匹配   → decision(allowed) → spawn(shell:false, 固定 env, 独立 cwd/进程组)
               → 共享 stdout/stderr 字节预算与 wall timeout → completion
```

`initial-cwd 外`与`实验根外`是两个不同边界。本日只证明前者可以被 D043 穿越；所有 victim 都通过 `hostRoot` 前缀和测试路径约束确认仍在实验根内。Demo 结束后，临时审计文件随 `hostRoot` 清理，同时把相同 JSONL 内容保存到仓库 `evidence/d046-audit.jsonl`。

## 4. 攻击矩阵：命令、数据流、预期与实测

下表中的 `$hostRoot`、`$victims`、`$marker` 和 victim 路径都是 Demo 内部生成的临时路径，不是可替换为真实用户路径的操作说明。`node` 表示 `process.execPath` 的绝对路径。

### 4.1 D043：cwd 不是文件系统边界

| ID | 实际命令/输入 | 数据流与预期 | 实测 observed / control | attack result |
| --- | --- | --- | --- | --- |
| `D043_ABSOLUTE_PATH` | `node -e <读取 absoluteVictim，追加 \|ABSOLUTE_CHANGED，再读取>` | 开放 shell 启动 Node；绝对路径绕过每次调用的临时 cwd，预期能读写初始 cwd 外、hostRoot 内 victim | `ABSOLUTE_ORIGINAL` → `ABSOLUTE_ORIGINAL\|ABSOLUTE_CHANGED`；`cwdOutside=true`；victim 仍在 hostRoot | `cwd-crossed;hostRoot-contained` |
| `D043_SHELL_CD` | `cd "$victims" && printf '\|CD_CHANGED' >> cd.txt && /bin/cat cd.txt` | shell 自己改变 cwd；预期修改并读回 `cd.txt` | stdout 和父进程复读均为 `CD_ORIGINAL\|CD_CHANGED`；未访问真实用户目录 | `cwd-crossed;hostRoot-contained` |
| `D043_CONTROLLED_RM` | `/bin/rm "$deleteVictim"` | 绝对路径删除专用文件；预期文件消失而 victims 目录保留 | `victimExists=false;victimsDirectoryExists=true`；无通配符、无根外目标 | `controlled-victim-removed` |
| `D043_ENV_CONTROL` | `node -e <仅返回 hostSecretPresent 布尔值>` | 父进程存在伪造 SECRET；预期固定 env 不把它交给子进程，结果不含原值 | `parentSecretPresent=true;childSecretPresent=false;resultLeak=false`；子进程不打印秘密 | `not-disclosed` |

这三项成功的文件攻击不是 D043“防线被远程攻破”的证明，而是对其设计边界的实证：`shell:true`、绝对路径和 shell `cd` 均不受临时 cwd 限制。固定 env 是另一项独立控制，它的成立不会抵消文件系统边界缺失。

### 4.2 D044：精确准入、正向控制与资源终止

| ID | 实际 executable / argv | 数据流与预期 | 实测 observed / control | attack result |
| --- | --- | --- | --- | --- |
| `D044_EXECUTABLE` | `/bin/sh`, `['-c', '/bin/printf COMPROMISED > "$marker"']` | executable 不在白名单；预期 spawn 前拒绝，marker/victim 不变 | `COMMAND_NOT_ALLOWED;spawnDelta=0;audit=decision+completion;markerAbsent=true;victimUnchanged=true` | `blocked-before-spawn` |
| `D044_ARGV` | `node`, `['-e', <把 secureVictim 改为 COMPROMISED>]` | executable 相同但 argv 未精确允许；预期不能修改 victim | 同上；父进程复读 victim 仍为 `SECURE_ORIGINAL` | `blocked-before-spawn` |
| `D044_SHELL_META` | 已允许 env argv 后追加 `[';', '/bin/sh', '-c', <写 marker>]` | 完整 argv 不相等；预期拒绝，而不是把后缀当 shell 命令 | 同上；共享 marker 未创建 | `blocked-before-spawn` |
| `D044_COMMAND_SUBSTITUTION` | 已允许 env argv 后追加 `$(/bin/sh -c <写 marker>)` | 命令替换只是未允许 argv；预期启动前拒绝 | 同上；没有 shell 解释该参数 | `blocked-before-spawn` |
| `D044_REDIRECTION` | 已允许 env argv 后追加 `['>', '$marker']` | 重定向后缀使完整 argv 不匹配；预期 marker 不变 | 同上；`shell:false` 且精确 argv 双重约束 | `blocked-before-spawn` |
| `D044_ENV_CONTROL` | 白名单精确允许 `node -e <env 布尔检查>` | 正向控制必须真实执行一次；预期子进程无伪造 SECRET，结果和审计无原值 | `childSecretPresent=false;spawnCount=1;audit=decision+completion;resultLeak=false` | `allowed-control;not-disclosed` |
| `D044_OUTPUT_BUDGET` | 白名单允许 `node -e "process.stdout.write('x'.repeat(256));setTimeout(()=>{},5000)"` | 256 字节 pipe 输出进入 stdout/stderr 共享 64 字节预算；预期终止而非无限保留 | `COMMAND_OUTPUT_LIMIT;stdoutBytes=64;stderrBytes=0;outputLimitExceeded=true;cleanedUp=true`；双阶段审计 | `terminated-by-output-budget` |
| `D044_WALL_TIMEOUT` | 白名单允许 `node -e 'setInterval(()=>{},1000)'`, `timeoutMs=30` | 无害循环不主动退出；预期 30ms wall timeout 终止并清理 | `COMMAND_TIMEOUT;timedOut=true;cleanedUp=true`；双阶段审计 | `terminated-by-wall-timeout` |

五类拒绝都使用同一组共享 marker/victim 对照，并且每一项都同时检查错误码、真实 spawn 增量、文件结果和 `decision+completion`。正向 env 控制先证明包装后的真实 spawn 计数从 0 变为 1，因此后面的 `spawnDelta=0` 不是“计数器从未工作”的假阴性。

## 5. D043 与 D044 的关键差异

| 维度 | D043 `sandboxed_command` | D044 `secure_command` |
| --- | --- | --- |
| 命令模型 | 单个 command 字符串，`/bin/sh -c` | 结构化 executable + argv，`shell:false` |
| 准入 | 没有精确 executable/argv 白名单 | `realpath(executable)` 与完整 argv 精确相等 |
| cwd | 每次调用独立临时 cwd，但绝对路径/`cd` 可离开 | 每次允许调用独立临时 cwd；仍不是 OS 文件系统沙箱 |
| env | 固定基础 env，并校验调用方额外 env | 固定 env，不继承宿主秘密 |
| 输出/时间 | 有超时、进程组清理和字符截断 | stdout/stderr 共享字节预算，超限终止；wall timeout |
| 审计 | 没有 D044 这类双阶段命令审计 | 允许和拒绝均有 decision + completion |
| 本日实证 | 能穿越初始 cwd，能读写/删除专用 victim | 五类未允许调用在 spawn 前拒绝；允许命令受资源预算约束 |

D044 的正向控制不是“所有命令都拒绝”的演示：env 检查、输出 flood 和短循环三条精确白名单规则均真实启动，合计 `secureSpawnCount=3`；五类拒绝的增量合计为 `secureDeniedSpawnDelta=0`。

## 6. 审计与失败门禁

最终 Demo 的 D044 部分包含 8 个 operation：

- 1 个 env 正向控制、5 个拒绝、1 个输出预算、1 个 wall timeout；
- 每个 operation 恰有 `decision` 和 `completion`，共 16 条 JSONL；
- 五类拒绝产生 10 条 denied 记录；允许执行的三条链各有双阶段记录；
- 所有攻击结果均由真实文件、真实返回值、真实 spawn 包装计数和真实审计计算，不是从 transcript 反推。

D046 起，D044 拒绝路径也写 denied completion。denied decision 写失败或 denied completion 写失败都会显式失败，且命令仍未启动；这与允许命令 completion 写失败不同，后者的副作用可能已经发生且不能回滚。相关语义同步更新在 `docs/d044-security-course.md`。

`runD046Demo` 只有在以下条件全部成立时才打印 PASS：

1. 12 个项目全部满足自身门禁；
2. `secureSpawnCount === 3` 且 `secureDeniedSpawnDelta === 0`；
3. 16 条审计属于 8 个 operation，每个都有双阶段记录；
4. 报告与审计不含伪造秘密原值；
5. 唯一 `hostRoot` 已删除。

任一条件不成立都会抛出 `D046 Demo FAIL`；脚本设置非零退出码，不打印 PASS。测试还直接执行真实攻击链，避免只检查 transcript 中是否出现某些字符串。

## 7. TDD：真实 RED 到 GREEN

本日先写新测试，再添加 production module 和安全语义修正。

### RED

[原始 RED](evidence/d046-tdd-red.txt) 保留了模块缺失和行为失败：

- `test/d046-demo.test.ts` 因 `src/demo/d046.ts` 不存在而无法收集；
- 真实攻击测试共 5 项，3 项通过、2 项失败；
- 正向控制的 spawn 计数期望 1、实测 0，因为当时还没有可信 spawn 包装入口；
- 五类拒绝每次只有 `decision`，相关记录总数为 7 而非 12；
- 真实 JSONL sink 只有 `['decision']`，不是要求的 `['decision','completion']`。

D043 穿越 cwd、env 不泄露、输出预算和 timeout 在 RED 阶段已经真实通过；没有把测试接入错误或伪造结果当作安全缺陷。

### 最小实现与旧期望变更

- 新增 `src/demo/d046.ts`，复用 D043/D044 Tool 和现有 JSONL AuditSink。
- `createSecureCommandTool` 新增受信任工厂配置 `spawnImplementation?: typeof spawn`；默认仍为 Node `spawn`。Demo/测试只包装真实 spawn 并计数，不伪造子进程结果，该选项不能由工具调用输入设置。
- 拒绝分支在 denied decision 后追加 denied completion；不改变允许命令的默认执行方式。
- 新测试先复现 completion 缺失后，才更新 D044 旧测试的审计数量：单次拒绝从 1 条改为 2 条，D044 Demo 总记录从 8 条改为 10 条，并新增 completion 字段断言。不是为通过测试而静默改旧期望。

### GREEN

[原始 GREEN](evidence/d046-tdd-green.txt) 来自 D044 回归与 D046 新测试共同运行：**5 个测试文件、44 项测试全部通过**。随后完整 `npm run check` 和覆盖率门禁也通过，最终记录见第 9 节。

## 8. 运行方法与真实 transcript

要求 Node.js 24+，无需 API Key、真实凭证或外网。

```bash
npm ci
npm run check
npm run test:coverage
npm run demo:d046
git diff --check
```

只复跑本日及受影响回归：

```bash
npx vitest run \
  test/d046-attack-chains.test.ts test/d046-demo.test.ts \
  test/d044-secure-command.test.ts test/d044-audit-sink.test.ts \
  test/d044-demo.test.ts
```

重新生成真实 transcript 和审计：

```bash
set -o pipefail
npm run demo:d046 2>&1 | tee evidence/d046-transcript.txt
```

Demo 脚本同时覆写 `evidence/d046-audit.jsonl`。最终 transcript 的真实末尾为：

```text
summary auditRecords=16 operations=8 secureSpawnCount=3 secureDeniedSpawnDelta=0 hostRootRemoved=true recording=none
D046 Demo PASS: 12 项门禁成立；攻击未离开实验根；明确未录屏。
auditEvidence=evidence/d046-audit.jsonl
```

完整的 12 行 `expected / observed / control / attackResult` 请直接查看 [evidence/d046-transcript.txt](evidence/d046-transcript.txt)。首行可能出现本机 npm 对未知 `home` 配置的警告，它不是 Demo 攻击结果，也没有被隐藏或改写。

## 9. 最终验收记录

2026-11-12 在本分支实际运行完整检查；数值来自真实 Vitest/V8 输出，不代表攻击面覆盖率或外部安全认证。

| 命令 | 实测结果 |
| --- | --- |
| `npm run check` | ESLint、TypeScript 通过；**56 个测试文件 / 511 项测试全部通过** |
| `npm run test:coverage` | **56 / 56** 测试文件、**511 / 511** 测试通过，覆盖率门禁通过 |
| `npm run demo:d046` | **12 / 12** 项门禁通过；8 个 operation、16 条审计；3 次允许 spawn，拒绝增量 0；实验根已清理 |
| `git diff --check` | 通过，无 whitespace error |

`All files` 四项覆盖率：

| Statements | Branches | Functions | Lines |
| ---: | ---: | ---: | ---: |
| **91.61%** | **86.67%** | **96.75%** | **93.86%** |

`src/demo/d046.ts` 覆盖率为 Statements 95.57%、Branches 90.47%、Functions 82.35%、Lines 97.14%。这些数字只说明代码回归覆盖，不表示已经验证所有攻击路径。

## 10. 明确未执行的载荷与剩余风险

本日没有执行：fork bomb、OOM、真实数据外传、端口监听、真实凭证读取、真实用户目录遍历、无限写盘、通配符或系统目录删除、提权、持久化、容器逃逸、seccomp/chroot 绕过。不得把本实验扩展成这些载荷后再声称仍属于 D046 授权范围。

即使 D044 的五类拒绝全部成立，也不能宣称它是完整 OS 沙箱：

1. **解释器能力**：允许 `node -e <固定源码>` 就是允许该源码拥有的当前用户能力；白名单不会把解释器变成安全业务工具。
2. **TOCTOU**：`realpath` 检查与 `spawn` 之间仍可能发生文件系统替换；需要 dirfd/no-follow、可信只读规则路径或 OS 级机制。
3. **无网络隔离**：被允许进程仍可尝试网络访问；本 Demo 零外网是实验选择，不是 D044 提供了网络命名空间或出口防火墙。
4. **无完整文件系统隔离**：独立 cwd 不阻止被允许程序使用绝对路径；生产场景需要容器、独立低权限用户、挂载/文件系统策略等。
5. **资源维度不完整**：输出字节和 wall timeout 不等于 CPU、RSS、虚拟内存、文件描述符、磁盘总量、进程数 rlimit/cgroup。
6. **审计不是防篡改系统**：本地 JSONL 不提供 WORM、签名、集中传输、跨进程事务或宿主篡改防护。
7. **env 控制不是万能防泄漏**：固定 env 能避免继承伪造宿主 SECRET，但不能替代参数、stdout/stderr、文件、网络和错误通道的数据分类与脱敏。

因此，本日结论是“用无害实证校准了 D043/D044 的真实边界”，不是“工具已经安全到可承载任意不可信代码”。
