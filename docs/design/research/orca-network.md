# Orca 的网络与操作模型 —— 给 PI WEB 的借鉴报告(lane:network / operation model)

来源:`git clone --depth 1 https://github.com/stablyai/orca /tmp/orca-study-d`(克隆成功,24792 个文件)。
所有 orca 引用均带克隆内 `文件:行号`;所有 PI WEB 引用均带本仓库 `文件:行号`。未验证之处明确标 NOT VERIFIED。

先说结论:**orca 在"一个客户端动作如何被端到端识别、丢失后如何补答"这一层,比 PI WEB 现有设计文档里的任何选项都走得远**,而且它证明了两件事:(1) `unknown` 作为一等显示状态是可行且必要的;(2) 幂等重放的完整闭环(id + 指纹 + 持久账本 + 重启降级为 unknown)在真实产品里养得起。但它**不是**把所有动作统一成一个大账本——它按"重复执行的代价"分了四层机制。这一点直接影响我们对 A/B/C 的选择(见末节)。

---

## 发现清单(按对 PI WEB 的价值排序)

### 1. 持久化操作账本:pending / succeeded / failed / unknown 四态,重放优先于重执行 ★最高价值

**Orca 做了什么**
- `src/shared/agent-session-operation-ledger.ts:26-27` 容量上限:每客户端 512 行、全局 4_096 行;
- `:29-39` 结局枚举 `pending | succeeded | failed | unknown`,其中 unknown 的注释是"The effect may or may not have happened; replay this answer instead of spawning again";
- `:58-60` 对一次带 id 的重复调用的三种裁决:`replay`(回放已记录结局)/ `admit`(真正执行)/ `refused`(invalid、conflict、expired、capacity 四种拒绝码);
- `:140-152` 关键语义:id 必须内嵌时间戳;未来时间被拒(防 tombstone 回收后 id 重新变"新");已存在但指纹不同 → conflict 而非 replay;超出" tombstone 可能已回收"窗口的重放 → `expired`,**宁可拒绝也不当成一次全新执行**;
- `:154-165` 容量拒绝而非淘汰:"tombstones cannot be evicted early without making an old replay capable of spawning again"——宁可拒绝新 id 也不让旧重放变成第二次 spawn;
- 持久性:`agent-session-operation-ledger.ts:1-8` 注明内存版规则已在用但"host restart turns 'replay this create' into 'spawn another agent'",所以把同一套规则写进与租约预留同一原子事务的持久行(`src/main/runtime/agent-session-reservation-admission.ts:86` 在 store 事务内调用 `evaluateAgentSessionOperation`)。

**PI WEB 现状**
- `src/server/daemon/sessions/acceptanceLedger.ts:14` 自认:"Process-scoped and bounded. A daemon restart forgets the ledger"。已有按 `clientMessageId` 去重(`:21-42`)和 `forget` 回滚(`:48-56`),但纯内存、无指纹、无过期语义、无容量拒绝策略(超限静默丢最旧,`accounting` at `:35-42`)。
- 命令(command)则连 id 都没有:`src/client/src/commandLedger.ts:20` 只有 `pending | ok | failed` 三态,id 是客户端自增 `cmd-N`(`:59`),`src/shared/apiTypes.ts` 中 grep `commandId|clientCommandId` 无结果——服务端从不回显。

**值不值得抄 / 成本 / 触及面**
值得,这是orca整条链的地基。对 PI WEB 的最小对应物:把 `AcceptanceLedger` 升级为持久行(SQLite 或 append-only 文件皆可,daemon 已有单进程所有权,落盘成本低),加 payload 指纹与四态结局。触及 `src/server/daemon/sessions/`(账本本体)、`src/shared/apiTypes.ts`(回显类型)、`messageDelivery.ts` 的对账入口。成本中;不需要动两进程分界。

### 2. 写前提交行 + 接受凭据:聊天消息的"我的 send 到底落地没有"有持久答案 ★最高价值

**Orca 做了什么**
- `src/main/native-chat/agent-session-journal/journal-store.ts:225-228` `appendSubmission`:"It is durable before the caller dispatches anything, and it doubles as the optimistic user bubble so an accepted echo reconciles into an existing slot instead of appending a second copy"——乐观气泡本身就是服务端持久行,回声到达时合并而不是追加第二条;
- `:241` `resolveDispatch`:"Advance a submission to exactly one of accepted / rejected / unknown",且接受必须携带 provider 身份(`:242-245`:"Accepting REQUIRES the provider identity rather than a free-form id…a mismatched string here would silently give the user a second copy of their own message");
- `:175-176` `receiptFor(clientMessageId)`:"The durable answer to 'did my send land?' — a reconnecting client asking again gets this instead of re-sending";
- `src/shared/agent-session-journal-types.ts:189-204` 投递态 `pending | accepted | rejected | unknown`,注释明确 "`unknown` is a displayed state: the turn reads as delivery unconfirmed, never as sent and never as failed";`:209-214` `AgentJournalAcceptanceReceipt` "outlives the journal tail"。

**PI WEB 现状**
- 消息有五态 `sending | received | queued | delivered | failed`(`src/client/src/components/shared.ts:95`),**没有 unknown**;`markDelivery` 一旦 failed 不可逆(`src/client/src/messageDelivery.ts:163-167`)。
- 队列记录"forget an id the moment the prompt is consumed"(acceptanceLedger.ts:7-9 自己写明),即"accepted 后凭据消失",重连客户端无从询问。

**值不值得抄**
值得,且这是选项 B 里最便宜也最有效的一块:给 accepted 的消息保留一个可查询的凭据(id → providerItemId/已投递标记),重连时用一次查询闭合 unknown。触及 `sessionService` 的 prompt 路径与 `apiTypes`。

### 3. `unknown` + 有界自动探测:不阻塞用户,也永不放弃 ★高价值

**Orca 做了什么**
- `src/renderer/src/components/native-chat/use-structured-agent-session-outbox.ts:24-29`:`UNCONFIRMED_PROBE_BASE_DELAY_MS = 1_000`、`UNCONFIRMED_PROBE_MAX_DELAY_MS = 16_000`,注释:"No attempt ceiling: a transport outage outlives any fixed budget, and giving up restores the wedge this fixes";
- `:240-260` 对处于 `unconfirmed` 的队头做指数退避自动重发探测(1s→2s→…→16s 封顶),重发**同一 id、不带 retryUnknown**,注释:"Re-issuing the same envelope without `retryUnknown` is idempotent: the operation ledger replays a recorded outcome, or the host performs a genuine first delivery";
- 服务端确认的 unknown 则停在校验点等用户手动 Retry(`:236-239`:"A host-confirmed unknown stays parked — forcing past that redispatches, which is the user's call")。
- 客户端把失败分为 `delivery-unknown | failed`(`src/shared/structured-agent-session-outbox.ts:167-174`),unknown 进 `unconfirmed` 状态、failed 回 `queued` 并阻塞队头等待人工处理(`use-…outbox.ts:184-199`)。

**PI WEB 现状**
- `RequestTimeoutError` 直接上页面级横幅(`docs/design/operation-model.md` 引 `notice.ts:70`),命令行无 unknown、无探测、无 per-row 补救;消息 failed 后只有手动 `restartDelivery`(`src/client/src/messageDelivery.ts:179`)。

**值不值得抄**
值得。自动幂等探测 + 人工两档,正是"flaky link 上用户永不被阻塞也永不被骗"的具体形态。成本:客户端逻辑 + 服务端幂等(发现 1/2 的依赖)。

### 4. 指纹防"同 id 不同载荷":重试不是改写 ★高价值

**Orca 做了什么**
- `src/shared/agent-session-mutation-envelope.ts:24-44`:对 method/sessionId/fields 做排序键 canonical JSON 再 sha256,两端独立计算;
- `:46-60` `agentSessionFingerprintConflict`:同 id 不同指纹在**查账本之前**拒绝,"Checked BEFORE the ledger is consulted, so a refused call never leaves an admitted row that a later honest retry would replay as already-done";
- 消息侧同款:`structured-agent-session-turns.ts:79-83`(`performSend` 先比对 `payloadFingerprint`,不符直接 invalid)。

**PI WEB 现状**
- acceptanceLedger 只认 id 不认内容;浏览器重试时若文本已变(比如重试按钮改过草稿)会被静默吞掉或错配。NOT VERIFIED:PI WEB 重试路径是否允许改文本后复用 id(未找到证据,标记存疑)。

**值不值得抄**
值得,实现是纯函数 + 两个调用点,几乎零基础设施成本;防止的是"重试变成第二条消息"这类最难看的重复。

### 5. 重启语义:pending 一律降级为 unknown,"Orca 从不替用户重发" ★高价值

**Orca 做了什么**
- `journal-store.ts:248-250` `markPendingSubmissionsUnknown`;`src/main/native-chat/agent-session-journal/journal-pending-submission-recovery.ts:9-22`:对每个 pending 提交写回 `{state:'unknown', reason:'host_restarted_before_acknowledgement', recovered:true}`,注释:"Orca never re-sends on the user's behalf";
- 与发现 3 的自动探测对照,真相是:**自动重发存在,但只以幂等形态发生**(同 id,结局要么已记录要么从未执行)。重启后凭据仍在,所以重连客户端问一次就得到确定的 unknown→accepted/rejected 答案。

**PI WEB 现状**
- daemon 重启后 acceptanceLedger 清空、事件环清空(`src/server/daemon/realtime/sessionEventHub.ts:29-37`),重连客户端的 pending 消息永远停在 sending(或靠 `replayDecision` 落到 resync 全量刷新);命令行 pending 行只能等下一个事件或永远悬置。

**值不值得抄**
值得,且必须与发现 1/2 一起抄——单独抄"重启降级 unknown"而没有凭据可查,unknown 就无法闭合。

### 6. 准入的固定顺序:指纹 → 账本 → 租约 → fence;journal first ★中高价值

**Orca 做了什么**
- `agent-session-mutation-envelope.ts:79-83`:"Fixed order: fingerprint agreement, then the ledger (so a retry replays before anything else can refuse it), then the lease, then the fence. Putting the ledger ahead of the fence is deliberate — a retry that crossed an owner change must still return its recorded answer";
- 效果先写日志后执行:`structured-agent-session-turns.ts:1-5`:"Journal first is deliberate: a crash between the two leaves a row the next attach settles as `unknown`, whereas the reverse would lose a turn the provider already accepted";`:37-46` 适配器抛错按 unknown 结算("A thrown adapter error is indistinguishable from a lost reply")。

**PI WEB 现状**
- 无统一准入;`sessionService.prompt` 的接受/回滚顺序分散在 acceptanceLedger 的 `record`/`forget` 手工配对中(`src/server/daemon/sessions/acceptanceLedger.ts:35-56`)。orca 的教训是:这种顺序应当被命名为一个纯函数并用测试枚举,而不是散在调用点。

**值不值得抄**
值得,即使选 B/C 也可以先把"接受 → 记账 → 执行 → 结算"的顺序固化成一个命名的准入分类器——与项目既有风格(`revisionVerdict`、`replayDecision`)完全一致。

### 7. 断线即 fail-fast 所有 in-flight 请求 ★中价值

**Orca 做了什么**
- `src/renderer/src/web/web-runtime-connection-transport.ts:93-94,137`:socket close/中断时 `requestRegistry.rejectAll('Remote Orca runtime connection interrupted.')`,在途 RPC 立刻收到"连接中断"而非干等 30s 超时(`web-runtime-request-registry.ts:4` 默认 `REQUEST_TIMEOUT_MS = 30_000`);
- 桌面共享控制通道还有 `retired-request-ids` 注册表(`src/shared/remote-runtime-shared-control-retired-request-ids.ts:1-5`,2048 个 id、60s TTL),跨 socket 代际去重迟到/重复的请求 id。

**PI WEB 现状**
- HTTP 请求与 socket 互不相通(设计文档第 1 节),socket 死了 in-flight fetch 仍要等满 30s;`reportTransportReachable`(`src/client/src/api/http.ts:59`)只在成功时被叫,失败方向无对称动作。

**值不值得抄**
值得(选项 B 的"liveness-aware deadline"其实可以更简单:socket 断开事件主动 abort 在途 fetch,让它们变成 per-row unknown,而不是让 30s 定时器先到)。成本低。

### 8. 客户端出站背压队列:有序、软帽、溢出→干净重连 ★中价值

**Orca 做了什么**
- `src/shared/ws-outbound-backpressure-queue.ts:1-11`:软帽 8MiB 停止向 wire 排水,硬帽 64MiB / 4096 帧才宣告"链路楔死",此时 `onOverflow` 让调用方"tear the connection down so a fresh subscription can replay an authoritative snapshot";
- 保序、可取消(`enqueueCancelable`, `:231-269`)、drain 分帧限速。

**PI WEB 现状**
- 客户端发送无背压处理;服务端方向用"超 1MiB 直接 terminate socket"(`sessionEventHub.ts:28, 237-243`)——更粗暴:慢客户端被踢线后必须走全量 resync,而 orca 是先在客户端排队、真不行才重连+重放。

**值不值得抄**
半值得。PI WEB 的 UI 事件量级小,64MiB 级队列未必必要;但"缓冲上限→主动断开→重连重放"的三段语义值得在 `socketLiveness`/`sessionSocket` 里补上(client 侧 bufferedAmount 监控),成本小。

### 9. RPC 调用队列:前台/后台分道 + 过载拒绝 + 字节记账 ★中价值

**Orca 做了什么**
- `src/shared/runtime-rpc-call-queue.ts:5-9`:每选择器并发 8(前台)/2(后台),总排队上限 2048、单选择器 256;
- `:15-27` 后台方法白名单(git.status、prForBranch 等装饰性刷新),`:139-141` 注释:"decorative calls must not stampede it"(跑流与卡片刷新共享容量);
- `:64-90` 过载按 `selector | global | memory` 三种 scope 抛结构化错误码 `runtime_rpc_queue_overloaded`,而非无限排队。

**PI WEB 现状**
- 无客户端发送队列概念;`sessionSocket.ts` 的 outbox 是消息队列但无并发/过载语义;HTTP 各自为战。NOT VERIFIED:daemon 侧是否已有等效限流(未逐一核查 sessions/* 的并发控制)。

**值不值得抄**
低优先。orca 这层主要保护远程 SSH/隧道链路;PI WEB 的 HTTP+WS 双通道压力面更小。列为"知道即可"。

### 10. 重连梯子:active/idle 两档 + 单侧 jitter + 连接/握手各自超时 ★中价值

**Orca 做了什么**
- `src/renderer/src/web/web-runtime-connection-transport.ts:23-25`:`CONNECT_TIMEOUT_MS = 12_000`、`HANDSHAKE_TIMEOUT_MS = 10_000`、`RECONNECT_DELAYS_MS = [500,1000,2000,4000,8000,15_000]`;
- `src/shared/reconnect-jitter.ts:1-6`:单侧 jitter(`delay + delay*20%*random`,只加不减),注释点名雷区是"同一路径上的所有 socket 同毫秒重拨";
- `src/shared/remote-runtime-shared-control-reconnect.ts:3-4`:active 梯子最高 30s、idle 梯子到 300s——长中断时不鞭尸。
- PI WEB 侧对照:`sessionSocket.ts:38-44` 已有 jitter(好),`:154` 1.6× 封顶 5s——**封顶太低**:daemon 停机 10 分钟期间每 5s 一次无效重拨,而 orca 证明可以温和得多。

**值不值得抄**
值得,一行改动(封顶上调 + 更长梯子),顺带把"连接中/握手中"两个超时分开(PI WEB 用 `socketLiveness.ts:16-24` 的 `handshakeBudgetMs` 已经部分做到,基础在)。

### 11. 订阅重放标记:重连后第一帧必须能穿透新鲜度门 ★中高价值

**Orca 做了什么**
- `src/shared/runtime-subscription-replay.ts:1-16`:重连后服务端重发的快照带 `_replayedAfterReconnect` 标记(客户端在解析后加),否则"monotonic freshness gates would silently drop it and leave mirrors frozen (#7718)"。场景:客户端已应用过同版本快照,单调门会把重连后的**权威**快照当成旧数据丢掉——镜像冻结。

**PI WEB 现状**
- `chatHistoryCache.ts:1-5` 用 TTL 30min 的 sessionStorage 缓存 + 页码,无版本/epoch 概念;`sessionEventHub.replaySince`(`:165-177`)的重放帧不带"这是重放"标记。PI WEB 目前没有单调新鲜度门所以没有这个 bug,但一旦按"数据必须携带 scope"的方向给 transcript 加 last-write-wins 门,这个坑就在前面。

**值不值得抄**
记录在案,实施缓存/门控时一并做(标记成本≈0)。

### 12. 迟到结算:超时的 waiter 退休保留,事后凭 provider 回放"翻案" ★中高价值

**Orca 做了什么**
- `src/main/claude/claude-structured-dispatch.ts:9-15`:`ClaudeLateDispatchSettlement` —— "A dispatch whose ack window expired, proven delivered by this replay";`MAX_RETIRED_DISPATCH_WAITERS = 64`;
- `:47-51` 相关性只用权威 uuid,"never fall back to queue order or content, since identical prompts may be in flight across a timeout boundary";`:79-99` 内容匹配仅当**唯一候选**时允许,任何歧义(有活动+退休候选并存)一律留 unknown;
- `:196-216` 发送抛错时若 waiter 已被回放结算,仍按 accepted 处理——**先查"其实已经成了",再谈失败**。

**PI WEB 现状**
- `messageDelivery.ts:126-128` 明文规则:"a late event still cannot resurrect a failed message"——是防僵尸,但也意味着"超时判 failed 后才到的 delivery 证据"无处安放。orca 的答案是中间态:超时不判 failed,判 unknown 并保留证据通道。

**值不值得抄**
值得作为设计原则吸收:超时后保留"可翻案"通道,而翻案条件严格(唯一候选、权威 id)。

### 13. "查一查"只读 oracle + 诚实的 absent 语义 ★中价值(直接对应选项 B)

**Orca 做了什么**
- `src/shared/orchestration-mutation-request.ts:1-14`:`request-show` 三态 `completed | pending | absent`,注释:"the read-only answer to 'did my mutation take effect?' when the response was lost in transit";
- `:27-45` 每种状态的解释文案**随行携带**、不许调用方自行"软化":absent 的解释是"Absent is not proof that nothing happened"——恰好是 PI WEB 项目规则"Absence is not negation"的成品实现;
- `src/shared/orchestration-retry-request-id.ts:1-5`:CLI 用 `--retry-request <uuid>` 重放原请求而非新发。

**PI WEB 现状**
- 无任何"按 id 查询结局"的端点;`dismissCommand` 只藏收据(`src/client/src/commandLedger.ts:96-99`),unknown 无处安放也无法查询。

**值不值得抄**
值得,这是选项 B 的核心件:一个 `GET /operation/:id` 式的只读端点,三态 + 解释文案进 `apiTypes`。成本小(daemon 已持有全部状态,只差暴露)。

### 14. 历史分页:三方向、字节预算、clamp 不拒绝、cursor 失效原因枚举 ★中价值( owner 关心的"丝滑"在这里有一半)

**Orca 做了什么**
- `src/main/native-chat/agent-session-wire/agent-session-history-page.ts:1-13`:为什么 `after` 方向必须读行而不是读 item 窗口("an item created early and revised late orders by its creation sequence, so an item-window read would silently skip that revision")——三方向语义各写明理由;
- `:48-52` `resolveHistoryLimit`:"Clamped, never rejected: a client asking for more than the host will serve should get a smaller page and keep paging, not an error mid-scroll";
- 字节预算 `:44-46`(`boundHistoryItemsByBytes`,按整 sequence 组切,防半条);
- cursor 失效原因枚举 `agent-session-journal-types.ts:224-231`(`epoch_changed | cursor_ahead | cursor_compacted | journal_gap | schema_unreadable`),"Every value forces a clean snapshot reload"。

**PI WEB 现状**
- `chatHistoryCache.ts` 的 RawMessagePage 有 start/total 页模型(好),但无字节预算、无 epoch;重连后一律靠 resync 或缓存 TTL 过期。NOT VERIFIED:会话历史 HTTP 分页端点是否已有字节上限(未找到对应 daemon 端 clamp 逻辑)。

**值不值得抄**
分页 clamp 和失效原因枚举直接可抄;字节预算在移动端(393px)长会话里值得。

### 15. 流事件客户端合并:48ms 窗口、按 itemId 幂等合并 ★低价值

**Orca 做了什么**
- `src/shared/structured-agent-session-coalescer.ts:3` `STRUCTURED_AGENT_SESSION_CLIENT_COALESCE_MS = 48`;`:6-11` 助手消息批才合并、其余事件直通;`:13-51` 按 `itemId`/`clientMessageId` 做键合并(重复到达即覆盖,天然幂等)。

**PI WEB 现状**
- transcript 流式渲染未见合并层。NOT VERIFIED(未逐行核对 chat 渲染节流)。

**值不值得抄**
先不抄;orca 需要它是因为 journal batch 直发 UI。PI WEB 若引入 journal 式批事件,这个模式一起来。

### 16. 取消的可见窗口由 provider 生命周期决定 ★中价值

**Orca 做了什么**
- `src/shared/agent-session-journal-types.ts:154-156`:`turnLifecycle: { turnId, state: 'running' | 'completed' }` —— "Durable root-turn lifecycle used by clients to expose cancellation only while the provider can still accept it";
- `agentSession.cancel` 是一等变更操作,带自己的 envelope/fence,且在中转命令未决时仍可达(`structured-agent-session-host-mutations.ts:83-110`)。

**PI WEB 现状**
- 命令无取消:`dismissCommand` 拒绝 pending 行(`commandLedger.ts:96-99`),"discard is only ever a receipt-hiding action"(设计文档第 3 条)。design doc 的 open question 2(discard 在 live 命令上的含义)orca 用"turnLifecycle 决定取消按钮是否出现"回答了:取消能力是 provider 的事实,不是 UI 的意愿。

**值不值得抄**
值得。设计文档选项 B 已含"add cancel where the daemon already supports abort";orca 补充的是**判据**——用 daemon 已知的工作状态(是否仍在接受 abort)驱动取消按钮的可用性,而非一刀切。

---

## orca 比 PI WEB 差的地方(同样是发现)

17. **渲染端用正则分类"delivery-unknown"**:`use-structured-agent-session-outbox.ts:31-33` `isDesktopDeliveryUnknown` 对错误文本做 `/timeout|disconnect|connection|closed|unavailable|cutover/i` 匹配——正是本项目 owner 明令禁止的 string comparison(AGENTS.md "Prefer state machines and enums over string comparison")。host 侧明明有结构化 refusal code 体系(`agent-session-refusal-retry.ts:16-45` 是纯查表),客户端却没接上。PI WEB 的 typed error(`RequestTimeoutError`、`HttpError`)在这点上更好。
18. **web 传输的重连重放只覆盖 `files.watch`**:`web-runtime-subscription-registry.ts:4`(`REPLAYABLE_SUBSCRIPTION_METHODS`)、`:28-48`:其余订阅断线即 close,靠消费者自己重订。PI WEB 的 seq 环 + `replayDecision` 纯分类器(`sessionEventHub.ts:165-177, 288-301`)在聊天事件重放这件事上**设计更干净**——五态显式、测试可枚举,不必改。
19. **deadline 不感知 liveness**:orca 的 web RPC 是固定 30s(`web-runtime-request-registry.ts:4`),桌面端按方法定长(`structured-agent-session-client.ts:28-30`,会话命令 195s、编排 ask 600s+5s grace,`orchestration-ask-timeout.ts:1-4`),没有任何一处把 socket 心跳新鲜度折进 deadline。即:**我们设计文档里"被活 socket 反证的 deadline 不算失败"这条规则,orca 没有先例**;orca 的等效解法是让超时非终结(→unknown,发现 3)+断线 fail-fast(发现 7)。这提示我们:unknown 状态是承重墙,liveness-aware deadline 至多是锦上添花。
20. **乐观气泡的时钟接续规则分散**:`native-chat-turn-status.ts:97-112` 处理"同一 turn 换 id(乐观回声被转录替换)"时要接续计时——orca 需要这段补丁恰恰因为它的乐观回声与 journal 行是两个 id 空间;PI WEB 的 `splitTranscriptAndPending`(`messageDelivery.ts:48-103`)用同一 clientMessageId 贯穿,无此问题。

---

## 对三个选项的证据裁决

- **Orca 的证据支持 A 的终态、B 的路径、C 的被淘汰**,但要对 A 做一处重要修正:**orca 没有"一个大账本统一一切"**。它按重复执行的代价分四层:
  1. 会话级持久操作账本(reserve/create 级,代价=多 spawn 一个 agent)——SQLite 行、重放结局、容量拒绝(`agent-session-operation-ledger.ts`);
  2. 每会话 journal 投递行+凭据(消息级,代价=重复消息)——写前行 + receipt + 重启降级 unknown(`journal-store.ts:225-256`);
  3. 共享控制 RPC 的 id 去重注册表(帧级,代价=重复副作用小)——内存 Map + TTL(`remote-runtime-shared-control-retired-request-ids.ts`);
  4. 编排 CLI 的只读 oracle(事后查询)——`orchestration-mutation-request.ts`。
  统一的只有**协议不变量**:每个变更调用携带客户端铸的 id + 载荷指纹,host 幂等作答。存储分层则与 PI WEB 现实的成本结构吻合:daemon 已有 acceptanceLedger(层 2 的雏形)和事件环,离层 1/2 比"全新统一账本"近得多。
- **B 的每个零件都有 orca 成品背书**:id 回显(发现 1/2)、unknown 显示态(发现 3)、per-row 查询(发现 13)、断线 fail-fast(发现 7)、cancel 判据(发现 16)。B 不是临时方案,是 A 的子集——orca 自己也是这么长出来的(账本文件头注明它是对已有内存规则的持久化,`agent-session-operation-ledger.ts:4-8`)。
- **C 的两个动作(banner 收窄、禁 discard)orca 都做了,但都建立在前置的 id/状态机器上**;没有 id 的 C 会留下orca已用 #7718 这类事故证明过的坑(重放快照被新鲜度门丢弃、半开连接永不判定)。

## NOT VERIFIED 清单
- PI WEB 消息重试路径是否允许改文本后复用 id(发现 4 的对照面)。
- PI WEB daemon 侧是否已有 RPC 并发限流(发现 9 的对照面)。
- PI WEB 历史分页端点是否有字节上限(发现 14 的对照面)。
- orca mobile 端(独立 `mobile/` 目录)如何消费同一套 journal/outbox 协议——未读,若 owner 关心手机端丝滑度可补一轮。

## 建议的最小采纳序列(供 owner 裁决,非自作主张)
1. 命令/控制动作获得服务端回显 id + `unknown` 态 + 按行查询端点(发现 1、3、13 的 B 集合);
2. acceptanceLedger 持久化 + 指纹 + 容量拒绝语义(发现 1、4);
3. 断线 fail-fast 在途请求(发现 7)与重连封顶上调(发现 10);
4. 其余(层 1 全量账本、journal 化消息、客户端背压队列)在 1-3 落地后再按需求加。
