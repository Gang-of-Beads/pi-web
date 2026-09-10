# 收敛第 26 轮 — B 道（行为与数据：退役模型端到端 / interrupted-runs 诚实性 / 预取与缓存键 / 切换后的状态）

分支 `refactor/plugin-architecture`，审阅起点 `3ec25d8d`（工作区另见 `e9d055fd`，仅 AGENTS.md/package.json 变动，与本道无关）。只读审阅，未改任何仓库文件。

---

## 发现 1（P1）：interrupted-runs「status unknown」横幅的撤回在第 25 轮修复后仍然断裂——early return 绕过撤回，flag 是只写变量

**证据**

- `src/client/src/components/PiWebApp.ts:778-810`（`refreshInterruptedRuns`）：
  - `:793` `this.interruptedRunsUnknown = false;`（第 25 轮提交 3ec25d8d 把它移到 emptiness 判断之前）
  - `:794` `if (ids?.size === 0 && !adoptEmpty) return;` ← **early return**
  - `:795-801` 失败分支：置 flag、`if (this.state.error === "")` 才挂横幅
  - `:802-808` 采纳分支：仅在此处 `if (this.state.error === INTERRUPTED_RUNS_UNKNOWN_MESSAGE) this.setState(clearErrorPatch())` 撤回横幅
- `interruptedRunsUnknown` 全仓库只有三处出现：`:302`（声明）、`:793`（写 false）、`:798`（写 true）——**没有任何读取点**。grep 全 `src/client` 及测试文件确认。
- 第 25 轮提交（3ec25d8d）的注释与提交信息声称「the retraction is gated on the flag (cleared above)」「Any successful read now clears the unknown state, before the emptiness decision」——但撤回 `setState(clearErrorPatch())` 仍在 `:808`、仍在 early return **之后**；flag 被提前清零却不被任何人读取。修复实际做的是把一个死存储（dead store）挪早了三行，读者可见的横幅撤回一步都没动。
- `.changeset/round-twentyfive-recovery-delivers.md`：「Any successful read now clears the unknown state.」与代码不符。
- `docs/design/review-triage-uiux-round19.md:34`：「the unknown banner's retraction tracks a flag, not a wording match」——现在既不 track flag（只写），撤回本身就是 `:808` 的文本同一性比较。

**最小失败场景**

1. 页面加载，`connectRealtime`（PiWebApp.ts:1956）发起 boot read；HTTP 读失败（超时/502/隧道抖动）→ `loadInterruptedRuns` 返回 `undefined`（sessionController.ts:1007-1015），挂上 reader-retired 横幅「Interrupted-run status is unknown: the read failed. Reconnect to read it again.」；`interruptedRunsBootReadDone` 仍为 false。
2. daemon 恢复、socket 连上。注意两条读会同时发生：`:1956` 的显式 boot 读，**以及** `RealtimeSocket.onopen` 在**首次** open 也会触发的回调（`src/client/src/sessionSocket.ts:252-266` 无 first-open 门；回调内 `:1973` 以 `adoptEmpty: false` 再读一次）。daemon 端是 read-and-clear：失败的那次读往往已被 daemon 消费记录，后到的成功读返回**空记录**。
3. 成功读 + 空记录 + `adoptEmpty:false` → `:794` early return → `:808` 不可达 → 横幅留下，而它承诺的「Reconnect to read it again」刚刚兑现完毕。reader-retired 不会被 `clearTransientError`（只撤 reply-retired）触碰，只能手动关掉或被别处 `clearErrorPatch` 顶掉。

**次级缺口（同根）**：`:798-799`「只在安静屏幕上宣布 unknown」设置 flag 后若横幅位被别的错误占用，flag 从未被读，屏幕安静下来后永远不会再宣布——「状态未知」被无声丢弃。

**裁定：TRUE**（高置信）。第 25 轮声称修复的正是这条路径，修复没有到达读者可见行为；两个 changeset/文档的声明与代码相悖。

---

## 发现 2（P2）：本地机的 plugin-backend 请求永远拿不到 machine scope——`target.machineId` 在手却被丢弃

**证据**

- `src/client/src/api/pluginBackends.ts:36-39`：`const prefix = target.machineId === "local" ? "api" : \`api/machines/${encodeURIComponent(target.machineId)}\``——本地机 URL 是 `api/plugin-backends/...`，**不含 `/machines/` 段**（与服务器一致：`src/server/web/plugins/pluginBackendProxyRoutes.ts:20` prefix `/api/plugin-backends`；无 `/api/machines/local/plugin-backends` 别名）。
- `:72` 与 `:77`：`throw new HttpError(..., machineIdFromUrl(pluginBackendRequestUrl(target, operation)))`——对本地 URL `machineIdFromUrl`（`src/client/src/api/transportHealth.ts:22-31`）返回 `undefined`，尽管 `target.machineId` 就在同一函数作用域里。这与 `notice.ts:92-100` 注释里描述过的那类事故同形（「the scope stamp the producer chose was being dropped」），且与第 25 轮提交信息「the plugin-backend failures keep their machine scope」相悖——该声明只对 remote 成立。
- 后果链：本地 daemon 重启时，本地代理 502 的 body error 是「Session daemon unavailable: connect ECONNREFUSED」（`pluginBackendProxyRoutes.ts:32-33`），`noticeFromError`（notice.ts:100-107）会把它判为 transport → `noticeFromTransport(text, undefined)` → **page 级** reply 声明。而 `transportHealth.ts:20-24` 的既定模型明说：web-owned 成功「proves the web process answered and nothing about any machine's link - **not even the local one**」。page 声明会被任何 web-owned 成功（`clearTransientError` 的 `disproved = errorMachineId === "page"` 分支，PiWebApp.ts:1057-1069）抹掉——daemon 明明还挂着。

**影响范围（如实标注）**：目前是**潜伏**缺陷——我核查了插件面板对 backend 失败的处理：`pi-web-plugins/workspace-tasks/tasksPanelElement.ts:176-181`、`pi-web-plugins/relays/relayDiscovery.ts:93-131`、`pi-web-plugins/goals/pi-web-plugin.ts:47` 都是面板内自渲染/吞掉，未走页面横幅；`registerExternalPlugins` 的失败只 console.warn（PiWebApp.ts:3226-3252）。所以今天没有直接的读者可见错误横幅；但 seam 已坏，任何未来把该错误接入 `errorNoticePatch`（既定唯一上报通道）的调用点都会立刻复活「本地 daemon 掉线被 web 轮询成功抹掉」的旧缺陷。修复也平凡：`:72`/`:77` 用 `target.machineId` 而不是从 URL 反推。

**裁定：TRUE**（机制层面确定；读者可见影响当前为潜伏，已如实标注）。

---

## 发现 3（P2/P3）：bannerHold 的 1.5s 保持窗把上一个机器/工作区的横幅带进新上下文

**证据**

- `src/client/src/components/bannerHold.ts:9-17`：决策输入只有 `{shownAt, now, next}`——**看不到作用域变化**。
- `src/client/src/components/PiWebApp.ts:3841-3845`：`next === ""` 且 `elapsed < 1500` 时返回 `this.heldErrorBanner`（上一次渲染的横幅 TemplateResult）。
- 机器切换会清 error：`machineController.ts:44-66`（selectMachine 展开 `resetWorkspaceScopedState()`，其中 `clearErrorPatch()` 见 `appState.ts:143-156`）；工作区切换同理（`workspaceController.ts:42/55/76`）。

**最小失败场景**：t0 读者选了机器 A，健康读失败，`selectInitialMachine` 挂上「A is unavailable; reconnecting…」（machineController.ts:181，composed、无过期）；t0.4 读者看到 A 挂了，切到机器 B（`selectMachine(B)` 清空 error）。切换后的第一次渲染：`next === ""`、`shownAt=t0`、elapsed 400ms → **hold** → 在机器 B 的界面上继续渲染 A 的重连横幅，最长再挂 1.1s（`BANNER_MIN_VISIBLE_MS` 兜底）。横幅文字虽带 A 的名字，但它描述的上下文已经不在屏上——正是本项目「数据必须带着它的 key、key 不匹配就不得渲染」规则的反例，而且是读者最容易踩中的时刻（机器挂了才切机器）。

**裁定：TRUE**（有界：≤1.5s；机制确定。hold 的防抖动目的只覆盖「同上下文抖动」，未区分「上下文已切换」）。

---

## 发现 4（P3）：round-24「schedule 带机器」的修复对两条连续的 page 级同文声明仍然失效

**证据**

- 重挂门 `PiWebApp.ts:3850`：`if (error !== this.lastScheduledError || this.state.errorMachineId !== this.lastScheduledMachineId)`；定时器守卫 `:1108`：`this.state.error === error && this.state.errorMachineId === machineId`。两个比较对 page 声明都是 `"page" === "page"`——第二次声明继承第一次的 6s 定时器。
- `.changeset/round-twentyfour-claim-identity.md`：「Two machines down in a row produce identical banner text; the expiry timer that was armed for the first machine's claim deleted the second machine's banner that never answered once」——修复覆盖了 M1/M2（机器 id 不同能区分），没覆盖 page/page。

**最小失败场景**：远端恢复阶梯中，`refreshMachineHealth` 失败（文本「Remote machine unavailable (connect ECONNREFUSED)」，page 或 M-scope 均可，此处取两条 fetch-family "Failed to fetch" 亦同）：t0 失败一（挂横幅、武装 t6 定时器）；t0.1 失败二（同文同 scope → 不重挂）；t6 定时器守卫全部相等 → 清掉——第二条声明只可见了 ~1s。影响小（自愈类声明、下次失败会重挂），但正是 round-24 声称关掉的那类删除。

**裁定：TRUE**（残余缝隙，P3）。

---

## 发现 5（P3，竞态）：`loadQuickSwitcherData` 无序号令牌，A→B→A 折返可让旧应答后到并重置新鲜度时钟

**证据**

- `src/client/src/components/PiWebApp.ts:2547-2596`：唯一的时代防护是 `:2585` `if (this.quickSwitcherBrowseMachineId !== machineId) return;`——折回原机器后，**两次**对 A 的在途加载都通过该防护；先启动的那次若后完成，会覆盖 `quickSwitcherSessions/Workspaces` 并把 `quickSwitcherFetchedAt` 重置为它自己的完成时刻（`:2587`）。
- 新鲜度门 `:2553-2558`：`Date.now() - quickSwitcherFetchedAt < QUICK_SWITCHER_REFRESH_MS`（30s，`:217`）——被旧应答重置后，30s 内重开 switcher 不再刷新。

**最小失败场景**：打开 switcher（A，加载 L1 在途）→ 切到 B 页签（L1 每阶段完成时被防护丢弃）→ 立刻切回 A（启动 L2）→ L1 的 sessions 批量请求比 L2 慢、在 L2 之后完成 → 列表被 L1（早几分钟的数据）覆盖、`fetchedAt` 重置 → 30s 内重开 switcher 直接命中新鲜度门，展示陈旧数据。对照：machineController 为同类问题给每个机器发了序号（`healthRefreshSeqByMachine`，machineController.ts:10/124），这里没有。

**裁定：TRUE**（竞态窗口真实；影响有界：30s 窗口后或 force 刷新即自愈；标注为 P3）。

---

## 发现 6（P3，文档 vs 代码漂移，两处）

1. `docs/design/review-triage-uiux-round17.md:62-63`：「Six-second expiry - decided by the retirement model, **not by matching the wording**: only reply-retired claims expire on the timer.」——第 22 轮刻意推翻了后半句：`scheduleTransientErrorDismissal`（PiWebApp.ts:1083-1112）在 reply-retired 之外还要求 `normalizeTransientError(error) !== undefined`（`:1096`），composed「X is unavailable; reconnecting…」与阶梯终句「X is still unavailable.」因此**永不过期**（`.changeset/round-twentytwo-scope-and-expiry.md` 明文记录这是决策）。round-17 文档未随之更新；两份文档互相矛盾，代码遵循较新的决策。
2. `docs/design/operation-model.md:22-26`（「What the branch actually does today」）：「a timeout … the notice layer raises a **page-level banner**」——round-19 修复 #5 之后，deadline miss 已按 `machineIdFromUrl(error.url)` 带机器作用域（notice.ts:106-107）。文档同页的 Update 段（`:146-151`）描述的是新事实，历史段未标注已被推翻，读者按前段理解会得到错误的现行为。

**裁定：TRUE**（纯文档漂移，P3；不涉行为）。

---

## 核查过且干净的点（防「空巷」声明的对照清单）

- **clearTransientError 的作用域判定本身正确**（PiWebApp.ts:1057-1069）：page 声明被任何成功驳回、机器声明只被该机器的 URL 成功驳回（`transportHealth.ts` + `clients.ts:76` 全客户端一致使用 `api/machines/<id>/…` 前缀）；清场时同时重置 `lastScheduledError` 与定时器，同批同文重挂会重新武装（round-24 修复在位，仅剩发现 4 的 page/page 残余）。
- **服务器错误体与客户端提取一致**：网关 502/504 带 `{error, machineId, detail}`（`machineProxyRoutes.ts:365-374`、`machinePluginProxyRoutes.ts:234-244`）；body 无 machineId 时 `http.ts:56-60` 回退到 URL 提取——本地代理 502（无 machineId 字段）正确落为 "local"。
- **deleteMachine 连带撤回**：`machineController.ts:104-107` 按 `errorMachineId === machine.id` 清场，正确。（机器被**别的浏览器**删除、本机 roster 刷新后无人清扫 `errorMachineId`——模型边缘，声明只能由读者撤；记录为观察，不立案。）
- **interrupted-runs 的机器归属**：`:802-803` 记录 `interruptedSessionIdsMachine`，`:3986` 渲染前比对当前机器；迟到的失败读不会把 A 的未知刷到 B（`:785`）。
- **prefetch/缓存键**：`prefetchSession` 用 `machineId:session.id` 防重、失败即忘（sessionController.ts:1919-1928）；`workspaceSessionsCache` 键为 machine+workspacePath；`cachedNewSessions` 所有调用点都显式传 machineId（workspaceController.ts:78、sessionController.ts:1647/1785/1787/1088）；transcript 存储全部经 `machineSessionKey`（`:297/436/734/791/1127/1504/1926`）。`loadEarlierMessages` 落盘键在 settle 时刻取当前机器（`:436`）理论上可错位，但机器切换必然清空 `selectedSession`（machineController.ts:52），`selectedSession?.id` 守卫使其不可达——不立案。
- **切换后的派生状态**：`subagents/subagentRuns/backgroundTasks` 在 chat 身份变化时清空（PiWebApp.ts:687-693）；`sessionStatuses/sessionActivities` 随机器切换清空（machineController.ts:52-53）；`machineStatuses/machineRuntimes/machineStatusSnapshots` 按机器键保留并在 deleteMachine 时摘除（machineController.ts:111-114）。
- **unread 投影**：`sessionUnread` 按机器保留/丢弃（retainMachines，sessionUnread.ts:80-91），后台失败只 console.warn（PiWebApp.ts:293-295），不污染横幅。
- **状态轮询失败不挂横幅**（piWebStatusController onRefreshError → console.warn，PiWebApp.ts:360），不会在 daemon 重启期间制造 page 级噪声。
- **Timer 清理**：`bannerHoldTimer` 与 `transientErrorTimer` 均在 disconnect 清理（`:1124-1126` 及 hold 分支外层；round-25 补的清理在位）。
- **MachineSwitcher 删除无残留**：全仓库无引用。

## 一句话结论

本轮 B 道的头条是发现 1：第 25 轮对 interrupted-runs 撤回的修复清的是一个没有任何读者的 flag，early return 依旧绕过撤回，横幅对自己许下的「Reconnect to read it again」在最常见的「空记录」应答下无法兑现——提交信息、代码注释与 changeset 三处都在描述一个不存在的机制。发现 2 是同类「缝合处少一针」（machine 在手却从 URL 反推且反推不出），当前潜伏。
