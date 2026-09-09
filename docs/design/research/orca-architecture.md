# Orca 架构研究 — 供 PI WEB 借鉴（lane: 总体架构 / 管理面）

- 克隆：`/tmp/orca-study-e`（github.com/stablyai/orca，浅克隆成功，EXIT=0）。
- 范围：进程/服务拆分与状态归属；session/run 建模与控制；配置与多机；插件接缝；auth/权限边界；可观测性与"卡住的任务怎么看"；测试策略。
- PI WEB 对照依据：`AGENTS.md:8,10,22`（两进程拆分与 sessiond 所有权）、`docs/design/operation-model.md`（网络/消息模型诊断）、`src/server/daemon/` vs `src/server/web/`（AGENTS.md:22 规定 web/ 模块永不 import daemon/）、`src/server/shared/plugins/`（插件运行时）。
- 结论预告：orca 的"管理面"确实强（守护进程生命周期、执行边界词汇表、可观测性、编排持久化），其中约 5 条能直接服务于 operation-model.md 的 Operation 方案；它的聊天面在结构上弱于我们（终端快照 vs 结构化消息）。

---

## 1.（最高价值）三值结算类型：accepted / refused / unverifiable，且"歧义"携带对账事实

**Orca 做法**：`src/shared/pty-write-settlement.ts:30-40` 定义 `WriteSettlement` 为三臂判别联合：

```ts
export type WriteSettlement =
  | Readonly<{ outcome: 'accepted' }>
  | Readonly<{ outcome: 'refused'; reason: WriteRefusalReason }>
  | Readonly<{ outcome: 'unverifiable'
      reason: WriteAmbiguityReason
      bytesHandedToTransport: boolean }>
```

文件头注释（`pty-write-settlement.ts:1-6`）点明动机："Ambiguity is a value here: it is never a rejected promise, never a bare `false`, and never an absent optional flag. Flattening any of the three arms to a boolean is what let a lost SSH settlement clear a durable mailbox reservation and write the same pointer bytes twice."——**把三次失败压平成布尔值，曾导致同一指针字节被写两遍**。歧义臂的 `bytesHandedToTransport` 字段（`:39`）是持久化预约真正需要的对账事实（字节是否可能已在途）；且 `WriteAmbiguityReason` 刻意不设兜底成员（`:26` "There is no catch-all member by design"）。配套实现 `src/main/daemon/daemon-client-notify-settlement.ts:19`："Ambiguity is returned, not thrown: a stalled socket cannot prove the bytes never left."（歧义作为返回值，不抛异常）。

**PI WEB 现状**：`src/client/src/commandLedger.ts:20` 只有 `"pending" | "ok" | "failed"` 两态加一个 pending；请求超时走 `requestDeadline.ts:21` 的 30s AbortController + `:31` 的 `RequestTimeoutError`，被 `notice.ts` 展示成页面级故障（`docs/design/operation-model.md:9-12` 第 1 条）。operation-model.md:41-46 的诊断正是"Nothing represents 'unknown'"。

**是否值得借鉴**：**值得，排第一**。它就是 operation-model.md 里 `unknown` 状态的成熟实现形态，且带一个我们没有的关键字段：`bytesHandedToTransport`。重连对账（operation-model.md:78-82 "Reconnect reconciles"）要回答"resend 是否幂等安全"，答案恰好就是这类事实：字节已在途 → 服务器可能已收到 → 依赖服务端去重；字节没出门 → 直接重发。
- 成本：类型 + 纯分类器先行，客户端侧低；若把 settlement 升到 daemon 协议（服务端回执），中。
- 触及：`src/client/src/messageDelivery.ts`、`commandLedger.ts`（B 方案）；A 方案再加 `src/server/daemon/` 协议回执。
- 风格契合：这正是 AGENTS.md "Prefer state machines and enums over string comparison" 要求的形态——一个纯判别联合，调用方做哑执行器，测试枚举每个成员。

## 2. 执行边界词汇表：`live / unverifiable / exited` 是仓库级固定语言，不许同义词

**Orca 做法**：`docs/reference/ssh-execution-boundary.md:12` "Loss of contact is not evidence of `exited`. Report `unverifiable`, never `exited`."，`:14` "The vocabulary is fixed: **`live` / `unverifiable` / `exited`** … Do not introduce synonyms, and never collapse `unverifiable` into either neighbour."。类型收口在 `src/shared/pty-liveness-verdict.ts:8-14`（`exited` 要求 owning host 的缺席正证据；失去联系只能是 `unverifiable`），`:20-24` 还把每个 reason 收敛成**单一句子**（`SSH_PROVIDER_UNREGISTERED_REASON`、`NO_OBSERVING_PROVIDER_REASON` 等），`:36` 注释说明"the one sentence every surface uses to admit a stop was not confirmed"——所有 UI 用同一句话，杜绝五处不同措辞。

**PI WEB 现状**：方向已对但未成词汇表。`docs/design/operation-model.md:72-75` 提出"A lost answer becomes `unknown` **on that operation's row**"；`src/client/src/socketLiveness.ts:3,19,23` 的分类器只覆盖链路级两态（`leave-alone | drop-and-reconnect`）。没有跨操作共享的 reason 单句表。

**是否值得借鉴**：**值得，几乎零成本**。两条具体动作：(a) 在 `src/shared/` 建一个 operation/liveness 判别联合，reason 成员带单句文案，所有展示面引用它（直接消灭 AGENTS.md "The same symptom reported twice" 那类五连修）；(b) 把"失去联系 ≠ 死亡"写进 `docs/`——我们已有 "Absence is not negation"（AGENTS.md 运营规则节），orca 证明它值得升级为带 file:line 的 reference 文档。触及：共享类型 + notice/row 文案；文档一页。

## 3. 调用方 deadline 只限定"等待"，不取消持久工作

**Orca 做法**：`src/main/daemon/daemon-request-deadline.ts:4-20`，函数名即语义：`awaitDaemonWorkWithinCallerDeadline(work, deadlineMs)`，注释一行："**The caller's wait is bounded without cancelling durable work, which keeps running and committing.**" 实现：`Promise.race` 等待 vs 定时器，超时返回 `false`（= 调用方先走），工作照常跑完并提交。

**PI WEB 现状**：`src/client/src/api/requestDeadline.ts:21`（30s）/`:27`（上传 180s）到点 `controller.abort()`。daemon 侧命令继续跑（operation-model.md:9-12 已确认），但系统里没有任何记录把"这次等待放弃"与"工作仍在进行"绑在一起，于是屏幕上出现"server did not answer"与 transcript 仍在输出的矛盾（operation-model.md:5-8 的真实事故）。

**是否值得借鉴**：**值得**。orca 的形状比我们的更诚实：等待与工作是两个生命周期。最小落地 = operation-model.md 选项 B 的"deadline 是等待的事实，超时落 `unverifiable`/`unknown` 行内状态，而不是 failed"。
- 成本：中（客户端语义为主）。
- 触及：`requestDeadline.ts` 调用方语义、`commandLedger.ts`/`messageDelivery.ts` 状态机、notice 层降级为链路状态（operation-model.md:70-73 的规则本就要求）。

## 4. daemon 端点按"语义协议版本"命名，持有活会话的 daemon 跨版本保留

**Orca 做法**：`src/main/daemon/daemon-spawner.ts:135` 端点是 `daemon-v${protocolVersion}.sock`（`:139` token、`:143` pid 同名族）；`src/main/daemon/daemon-protocol-version.ts:3` `PROTOCOL_VERSION = 36`，且 `:4-7` 每个特性有自己的协议底线常量（如 `ASYNC_CWD_VALIDATION_DAEMON_PROTOCOL_VERSION = 35`）——**升级历史被编码成常量表**。配套 `daemon-replacement-preflight.ts:247` `shouldPreserveDaemonWithLiveSessions`：持有活会话的 daemon 在版本变化时被保留而不是替换。文档对照（`docs/reference/ssh-execution-boundary.md:49`）还给出反面教材：relay 侧用构建内容哈希做安装目录，结果"app 更新后旧 relay 永久不可达，其所有 PTY 变成 running-but-unreachable（#13852）"。

**PI WEB 现状**：`src/server/shared/sessiondClient/config.ts:5` 固定单一 `sessiond.sock`（无版本命名空间）；`sessionDaemonClient.ts` 中 grep 不到任何 handshake/版本协商；`AGENTS.md:10` 要求"影响 daemon 协议时需人工重启 sessiond"，所有权与二次实例要求在 `docs/install.html`。我们是"单一通道 + 人工重启"，orca 是"版本化通道 + 旧版本仍可 attach + 活会话保留"。

**是否值得借鉴**：**值得，但要挑时机**。pi-web 仍是单用户本地栈，全套借鉴过重；最有价值的一小块是：**socket 路径携带协议版本**（如 `sessiond-v2.sock`），让"新 web 进程 + 旧 daemon"能被显式诊断成版本错配而不是神秘连接失败，并为未来多 daemon 并存留出语义空间。`PROTOCOL_VERSION` 常量表 + 每特性底线常量的写法，则直接可抄——我们当前协议演进（goal、operation 等都在动 daemon 协议）正好用得上。
- 成本：低-中（命名 + 常量表 + `docs/install.html` 联动）。
- 触及：`src/server/shared/sessiondClient/config.ts`、`src/server/sessiond.ts` 启动所有权声明、`docs/install.html`。
- 保留判断：**不**照搬"跨版本保留旧 daemon"——那需要 attach-only 替换协议，当前单实例场景收益小。

## 5. 缺席回答必须带证据标记；"无标记 = 歧义"（旧端兼容性写进协议）

**Orca 做法**：`src/shared/pty-attach-absence-evidence.ts:1-10`。`pty.attach` 的 `PTY "<id>" not found` 有两种完全不同的成因（probe 过确认已退出 vs 会话表里从来没有——后者覆盖 relay 重启后所有旧 id）。只有前者携带 `PTY_ATTACH_PROVEN_EXITED_MARKER`（`:10`），客户端收到的是 `SshPtyProvenExitedOnRelayError`；无标记则只允许清理本地路由。注释点破关键："The marker is additive on purpose: an answer without it means 'ambiguous', **which is also what an older relay's unmarked answer means**, so a client may never read a missing marker as evidence of anything."

**PI WEB 现状**：`AGENTS.md` 运营规则 "Absence is not negation" 是口头纪律，没有进入任何协议字段；消息侧有 `AcceptanceLedger`（`src/server/daemon/sessions/acceptanceLedger.ts:1-10`，重发同 `clientMessageId` 幂等去重，`:2657/2689` 在 `piSessionService.ts` 落地）但那是"已接受"方向的记录，命令侧仍无服务端回执（operation-model.md:33-38 第 3 条）。

**是否值得借鉴**：**值得，顺手**。当我们给命令加服务端回执（选项 B）时，把回执设计成两档：`proven`（亲眼所见）与 `ambiguous`（不知道），且缺省歧义——旧客户端/旧服务端天然兼容。这直接满足 AGENTS.md "A refused request that answers with a snapshot must still say it refused / 每个可未知状态都需要显式 unknown"。成本：设计时多想 10 分钟；实现为协议可选项。

## 6. 可观测性三件套：本地 span tracer + 主线程 hang watchdog + 带限额的诊断包上传

**Orca 做法**：
- `src/main/observability/tracer.ts:1-18`：纯 TS span 记录器，`AsyncLocalStorage` 维护 span 树（子 span 在 `await` 链里自动继承父），输出 NDJSON 到本地文件 sink；`:16-18` 注释：redactor 在**三处幂等运行**（sink 写入时、bundle 收集时、服务器端），日志默认可安全外发。
- `src/main/hang-watchdog/`：独立 worker 以 `HANG_WATCHDOG_HEARTBEAT_INTERVAL_MS = 2_000` / `TIMEOUT_MS = 45_000` 心跳监控主线程卡死（`hang-watchdog-worker-protocol.ts:1-3`），主线程挂起写 marker 文件供下个实例消费（`hang-detection-marker.ts:15-23`）。
- 诊断包：`src/main/observability/diagnostic-bundle-limits.ts` + `diagnostic-upload-http.ts`——限额 + 上传端点，"用户自查卡住任务"有正式出口。

**PI WEB 现状**：`src/server/shared/diagnostics/` 只有 `nodePtyNativeModule` / `nodePtySpawnHelper`（原生模块诊断），无 span、无 hang 检测、无诊断包出口。AGENTS.md 验证流程要求"读 daemon 日志取证"，说明取证目前靠手工。

**是否值得借鉴**：**部分值得**。优先级排序：(a) **daemon 侧请求级 span/事件日志（NDJSON 本地文件）**——operation-model.md 方案 A 需要"daemon 保留近期操作日志用于重连对账"，orca 的 tracer 就是现成蓝本，成本低、直接服务方案 A；(b) hang watchdog 与诊断包——我们单机自用，价值低，**暂不借鉴**。触及：`src/server/daemon/` 新增小模块（符合目录规则），`sessionEventHub` 旁路写。

## 7. 编排 Runs/Tasks/Dispatches/Mailbox：持久化 SQLite + 有界送达 + 拒绝码

**Orca 做法**：`src/main/runtime/orchestration/`。要点：
- 状态机全部收口在 `types.ts`：`TaskStatus = 'pending'|'ready'|'dispatched'|'completed'|'failed'|'blocked'`（`:16`）、`DispatchStatus = …'circuit_broken'`（`:22`）、`GateStatus`（`:36`）。职责分离清晰：任务、派发、决策门、协调器是四类状态。
- **持久送达**：`DeliveryRow`（`types.ts:44-53`）带 `DeliveryStatus = 'outstanding' | 'acknowledged' | 'fenced'` 与 `acknowledged_at`——投递不是"发了就算"，有数据库行背书；`db/orchestration-db.ts:27` 开 WAL。
- **幂等结算带拒绝码**：`WorkerReportSettlement`（`types.ts:27-34`）`rejected` 分支给出 `unknown_task | unknown_dispatch | task_dispatch_mismatch | inactive_dispatch | stale_dispatch` 五个原因码——重复上报不是静默吞掉，而是可判定的拒绝。
- 生命周期重建：`lifecycle-reconciliation.ts`、`orchestration-mailbox-crash-recovery.test.ts`（崩溃恢复是常态测试项）。

**PI WEB 现状**：会话在 daemon 有 `backgroundTasks.ts`、`backgroundRunCount.ts`（`src/server/daemon/sessions/`，进程内存态）；goal 插件的 continuation 遵循"子代理运行期间不注入、有界兜底"（AGENTS.md goal 节）；无跨会话的持久投递行。

**是否值得借鉴**：**选择性借鉴**。整搬（多代理 DAG、federation sync `federation-sync.ts`）对单用户 PI WEB 明显过重；值得借的是两个概念：
1. `DeliveryStatus` 的 `outstanding/acknowledged/fenced` —— 如果做方案 A 的服务端操作日志，这就是表结构的直接参照（含 `acknowledged_at`）。
2. 结算拒绝码枚举——服务端对重复/过期请求的五种拒绝原因，正是我们 `commandLedger` 升级时需要的枚举粒度（比 `ok|failed` 有信息量得多）。
- 成本：按行数看是全套重写；借概念则低。
- 触及：方案 A 的 daemon 端操作日志（新表），不动现有 sessions 结构。

## 8. automation：写库即广播 + owner fencing（变更必须"通知跟着写走"）

**Orca 做法**：`src/main/automations/automation-run-writer.ts:8-10` 注释："Clients with the Automations page closed — or none attached at all — have no other way to learn that a run progressed, **so the event must follow the write, not a render.**" —— 状态变更事件由持久层提交点发出，而不是由某个恰好打开的 UI 渲染触发。另有 `automation-owner-fencing.test.ts:152`：并发管理者捕获的 owner 失配时抛 `AUTOMATION_OWNER_CONFLICT_CODES.ownerChanged`——写者必须携带自己看到的 owner，失配即拒（fence）。

**PI WEB 现状**：goal 面板依赖 `sessionEventHub.ts`（`src/server/daemon/realtime/`）推送；事件源头与写路径的绑定靠约定（NOT VERIFIED：未逐条核对每个写点是否都伴随事件）。

**是否值得借鉴**：**值得记一条纪律**：任何新增持久化写入（尤其 goal 状态、operation 日志）必须"提交点发事件"。fencing 在我们多客户端连同一 session 的场景（多个浏览器标签）有真实价值——goal 的 focus/pause 就可能被两个标签同时改，owner 失配拒绝比"后写覆盖"诚实。成本：低-中；触及 goal 插件写路径与 `sessionEventHub`。

## 9. 插件接缝：每插件独立 fork 进程 + capability 白名单 + 生命周期预算

**Orca 做法**：`src/main/plugins/plugin-host-process.ts:1`（`fork`），每个插件一个子进程，启动参数带 `grantedCapabilities: readonly PluginCapabilityKind[]`（`:57-64` 附近）；预算齐备：`PLUGIN_WORKER_SHUTDOWN_GRACE_MS = 2_000`（disable/quit 不卡 UI）、`PLUGIN_WORKER_EVENT_TIMEOUT_MS = 5 * 60_000`、`PLUGIN_WORKER_MAX_PENDING_EVENTS = 64`（`:20-23`），worker 发起的 host API 调用走 `hostResult` 回程消息（`:25`）。配套：`plugin-discovery.ts`、`plugin-enablement.ts`、`plugin-audit-log.ts`、`plugin-install-trust.ts`。

**PI WEB 现状**：`src/server/shared/plugins/serverPluginRuntime.ts:1-10` 用 `pathToFileURL` + importer **进程内动态 import** 插件 server 模块，安全靠**操作契约**（`pluginOperations.ts` 的 `requirePluginOperation` / `UnknownPluginOperationError`）+ 插件级 scoped storage（`pluginScopedStorage.ts`）；`serverPluginExec.ts:1` 执行外部文件时才 `spawn`。子进程隔离不存在（NOT VERIFIED：未确认 web 进程组装 runtime 时是否有额外子进程边界）。

**是否值得借鉴**：**暂不**。两种威胁模型：orca 面向第三方插件市场（隔离 + 审计 + 信任链完整）；pi-web 面向自控插件（契约门控已够）。记录在案即可：若未来开放第三方插件，orca 的"fork + capability 白名单 + 生命周期预算"是完整参照系。**orca 并无明显弱于我们的地方**在此项——只是重量不同。

## 10. 测试策略：7367 个就地测试 + 363 个 e2e + "repro-<issue>" 命名 + 前台安全规则

**Orca 做法**：
- 规模：`find src -name '*.test.ts' | wc -l` = **7367**，全部与被测代码同目录；`tests/e2e/*.spec.ts` 共 **363** 个 Playwright 规格。
- Ratchet（棘轮）测试把架构纪律变成 CI 失败：`src/main/ports/port-scan-command-import-boundary.test.ts:8-21` 逐字读源码断言主线程模块不得 import `child_process`（注释引 #11161：libuv 在调用线程内联建进程）。daemon 侧同理有 `daemon-init-*.test.ts` 系列专测启动/替换/复活路径（`daemon-init-restart-sequence`、`daemon-init-live-session-preservation` 等）。
- 事故复现测试直接以 issue 命名：`src/main/daemon/repro-12101-mouse-tracking-survives-agent-death.test.ts`、`repro-13767-shell-ready-marker-lost-to-exec.test.ts`、`repro-7329-remote-snapshot-corruption.test.ts`——回归防止与事故编号绑定。
- fuzz/bench 就地：`headless-emulator-fidelity.fuzz.test.ts`、`session-ingest-throughput.bench.test.ts`。
- 前台安全：`tests/AGENTS.md`（"Keep Automated Runs Out of the Foreground"）——测试与 agent 启动的 app 可用机器但**绝不抢前台**，由 `ORCA_BACKGROUND_LAUNCH=1` 强制，headless 用 CDP 截图。

**PI WEB 现状**：架构棘轮已有等价物且更直接——`src/server/processOwnership.test.ts:1-5` 逐字断言 web/ 与 daemon/ 互不 import、shared/ 不 import 任何一侧、类型导入也算耦合；e2e 用 `scripts/probe-*.mjs` + 8505 栈（AGENTS.md 验证流程节）；`repro-<issue>` 命名没有制度化（回归测试靠 commit message 带事故，AGENTS.md git 规则节）。

**是否值得借鉴**：**小而值得**：(a) 把"回归测试以事故编号命名"写进 `.agents/skills/testing-guide/SKILL.md`，让我们的事故驱动文化在测试名上可检索；(b) fuzz/bench 就地命名（`.fuzz.test.ts`/`.bench.test.ts`）便于按需筛选，成本为零。其余（前台安全）与我们的桌面环境不对应。触及：仅测试规范文档 + 未来回归测试命名。

## 11. 文档文化：reference 文档自带 file:line 证据 + 事故工作笔记

**Orca 做法**：`docs/reference/ssh-execution-boundary.md` 全篇引用具体 `file:line`（如 `:22-24` 列出规则 1 的四处实现点，还警告"Grep those names for the current call sites rather than trusting a count"——文档自己承认会漂移，给读者验证手段）；`docs/reference/remote-wire-compatibility.md` 用 PR 号当案例（PR #12641）。云端事故有持续更新的工作笔记 `cloud/docs/relay-reconnect-2026-09-findings.md`：状态板逐行记录"PR / 验证 run / 谁拍板"（如 "Owner decision 2026-09-04 ~05:10Z | Option B approved"）。

**PI WEB 现状**：`docs/design/operation-model.md` 已是同一风格（事故开头 + 选项给 owner 拍板 + "No code has been changed for it"），AGENTS.md 还要求 commit 带事故引用。差距只在：我们的 docs 目前只有 design/ 一篇，没有"reference 类"的机制文档层（协议兼容、执行边界这类**长期契约**文档）。

**是否值得借鉴**：**值得，几乎零成本**。本次 operation-model 落地时，顺手把"daemon 协议变更契约"写成 `docs/reference/` 一页（谁 bump 什么、缺字段意味着歧义），它就是发现 4/5 的落地载体。触及：`docs/` 新增一页 + AGENTS.md 文档边界节补一句（README 保持精简的既有规则不变）。

---

## Orca 弱于我们的地方（不要照抄）

1. **聊天面结构性偏弱**（印证 owner 的判断）：orca 的"聊天"本质是终端仿真器快照 + 有界重放。远端会话重连时，`REPLAY_BUFFER_MAX = 100 * 1024` 字符的尾部缓冲（`src/relay/pty-handler.ts:340`），文档自认："Output beyond that while you were away is lost to the client even though the process was never interrupted: **the transcript is truncated; the work stays `live`**"（`docs/reference/ssh-execution-boundary.md:41`）。离开期间超出 100KB 的输出**永久丢失**。PI WEB 的消息是结构化 pi 消息，daemon 持有 transcript、客户端按页缓存（`src/client/src/chatHistoryCache.ts:1-2`，`v2` 前缀 + 30 分钟 TTL），消息级有 `messageDelivery.ts` 状态机与 `AcceptanceLedger` 幂等（`piSessionService.ts:2657,2689`）。**远端长会话回归时，我们的 transcript 语义严格更强。**
2. **控制面绑定客户端在线**：SSH 主机上 `orca` 命令是回连客户端运行时的 shim，"When the client disconnects, every `orca …` command run on the SSH host fails with `No owning Orca client is connected to the relay`"（`ssh-execution-boundary.md` Control plane 节）；文档自己承认编排状态（Runs/Tasks/Dispatches/mailboxes）client-resident。PI WEB 的 sessiond 独立于浏览器存活（AGENTS.md:8 "Browser disconnects and UI/API restarts should not stop active Pi sessions"）——我们的归属模型在这一点上就是对的，保持不动。
3. **自相矛盾处**：`src/main/ssh/ssh-relay-session.ts:1` 顶部是 `/* oxlint-disable max-lines */`，而其 AGENTS.md 明文 "NEVER add a `max-lines` disable"——单一权威文件（注释自称 "single authority for all relay lifecycle state"）膨胀到需要禁令，说明"一个模块管全部"在大文件上的边界维护同样会失守。我们 AGENTS.md "小而内聚的模块" 立场无需动摇。
4. **重量与形态不可整体移植**：orca 是 Electron 桌面 + 云 relay + 手机伴侣 + 多租户（`cloud/apps/relay`、`relay-fence-broker`、云运维手册与 canary 流程，`cloud/docs/`）。它的很多强度（多租户 fence broker、`PROTOCOL_VERSION=36` 的演进密度）是产品形态逼出来的；PI WEB 单机两进程，抄完整套是把别人家庭的承重墙搬进自己的公寓。结论按条采纳（本报告 1/2/3/5/11 是重点），不做框架级引入。

---

## 优先级汇总（按对本仓库价值排序）

| # | 采纳物 | 成本 | 主触及 |
|---|---|---|---|
| 1 | `WriteSettlement` 三值判别联合（含 `bytesHandedToTransport`） | 低→中 | messageDelivery/commandLedger（→ daemon 协议） |
| 2 | `live/unverifiable/exited` 仓库级词汇 + reason 单句表 | 低 | `src/shared/` + 各展示面 + docs |
| 3 | deadline=等待、工作不取消 | 中 | requestDeadline 调用方语义 + 状态机 |
| 5 | 回执证据标记：缺省 = 歧义 | 低（设计时） | 命令回执协议 |
| 11 | `docs/reference/` 契约文档层 | 低 | docs |
| 4 | socket 路径带协议版本 + PROTOCOL_VERSION 常量表 | 低-中 | sessiondClient/sessiond + install.html |
| 7 | DeliveryRow（outstanding/acknowledged/fenced）+ 结算拒绝码 | 中（仅概念） | 方案 A 的操作日志表 |
| 8 | 写库即广播 + owner fencing | 低-中 | goal 插件写路径 |
| 10 | repro-<issue> 测试命名 + fuzz/bench 后缀 | 低 | testing-guide |

NOT VERIFIED 项已逐条标注（第 6 条 pi-web diagnostics 覆盖面、第 8 条写点全覆盖、第 9 条 web 进程子进程边界）。所有 orca 引用均来自 `/tmp/orca-study-e` 本地克隆；所有 pi-web 引用均来自本仓库当前工作区。本报告未修改本仓库任何文件。
