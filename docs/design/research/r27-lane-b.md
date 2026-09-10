# Round 27 — Lane B（行为与数据）：退役模型端到端 / interrupted-runs 诚实性 / 预取与缓存键 / 切换后的状态

审查范围：`notice.ts` / `errorNotice.ts` / `errorBanner.ts` / `bannerHold.ts` / `transportHealth.ts` / `http.ts` 的新退役模型全链路；PiWebApp 的 banner 生命周期与 interrupted-runs；machineController/sessionController 错误点；quick switcher 与 unread 缓存键；round-17/18/19 三份 triage 与两个 changeset 的文档-代码一致性。HEAD 591b37e7（Start convergence round 27，含 round 26 修复 95ed8e54、00220101）。

本 lane 共 **6 项 TRUE 发现 + 1 项存疑（advisory）**，另附"已核查为干净"的清单。所有发现均给出 file:line 与最小失败场景。

---

## 发现 1（中）：realtime socket 的 onOpen 用"不构成反证的证据"退役机器级 claim —— 守护进程宕机期间 red-flash 复活

**证据链：**
- `src/client/src/components/PiWebApp.ts:1960-1963` — onOpen 回调：*"The socket being back is proof this machine's transport healed … this.clearTransientError(machineId)"*。
- `src/client/src/sessionSocket.ts:251-260` — `socket.onopen` 在**每次** WebSocket 升级完成时触发（`this.onOpen?.()`，第 259 行），并把 `reconnectDelay` 重置回 500ms（第 256 行）；没有任何"收到首帧/证明上游可达"的门。
- `src/server/web/sessionProxyRoutes.ts:43-46` — `/api/machines/local/events` 的处理是 `bridgeSockets(socket, daemon.connectWebSocket("/events"))`：**先接受升级、后异步连上游**。
- `src/server/shared/sessiondClient/sessionDaemonClient.ts:47-54` — `connectWebSocket` 用 `new WebSocket("ws+unix:…")`，**从不同步抛出**；守护进程不在时上游在异步路径上失败，`src/server/web/sessionProxyRoutes.ts:75` `upstream.on("error", () => { client.close(); })` 才关掉浏览器侧 socket。
- 远端机器同理：`src/server/web/machines/machineProxyRoutes.ts:178-195`，machine gateway 活着而该机 sessiond 死掉时，升级同样先被接受。

**最小失败场景（更新重启 daemon——模型文档自认的最常见场景）：**
1. sessiond 重启中，web 进程活着。用户发送 prompt → `POST api/machines/local/…/prompt` → 502 `"Session daemon unavailable: connect ECONNREFUSED …"` → banner（reply-retired、machineId "local"、6s 定时器）。
2. realtime socket 正处于重连循环：web 进程接受升级 → 浏览器 onopen 触发 → `clearTransientError("local")` → claim 被清（"disproved"）。
3. 桥接上游随即失败 → socket close → 500ms 后重连 → 再次 onopen → 再清。onOpen 自己触发的 refresh（unread/statuses/interrupted）502 失败又立刻重新举起同文案的 claim。
4. 结果：读者动作失败的解释在 ~0.5s 内被擦掉——正是 `banner-retirement-model.md` 声称已消灭的 "red flash with no explanation"；且整个宕机期间 claim 被反复用"web 进程接受了一次 WS 升级"这一不构成反证的事件退役，6 秒寿命与"机器的回答才算反证"的模型双双失效。

**裁定：TRUE。** onOpen 的注释（"socket being back is proof this machine's transport healed"）对 accept-then-bridge 的代理架构不成立：升级成功只证明 web 进程活着，不证明该机 daemon 回答过。

---

## 发现 2（低-中）：plugin-backend 包装层把 fetch 级失败"顶出"措辞表，同一链路故障得到两种寿命

**证据：**
- `src/client/src/api/pluginBackends.ts:70-73` — fetch/超时被包装为 `HttpError("Plugin backend request unavailable: <describeError>", 0, machineId)`。
- `src/client/src/components/errorBanner.ts:95` — fetch 家族规则**锚定整条消息**：`/^(failed to fetch|load failed|…)$/i`。带前缀的合成文本不匹配；`errorBanner.ts:64` 的 composed 规则要求 `; reconnecting`，也不匹配。
- `src/client/src/notice.ts:100-102` — HttpError 分支：`isTransientError(text)` 为假 → `noticeForReader(text)`。

**最小失败场景：** web 进程重启（更新）期间，某个插件面板发起 backend 请求 → fetch 被拒 → 文本 `"Plugin backend request unavailable: Failed to fetch"` → 不匹配任何措辞规则 → **reader-retired、role=alert、永不自愈**：web 进程恢复后 banner 仍挂着，只能手点关闭。而同一秒内由普通 `request()` 产生的同源故障 `"Failed to fetch"` 是 reply-retired、6s 自愈、可被任何成功反证。同一证据、两种寿命——违反 `notice.ts:88-92` 自己写下的原则（*"the same text must not get two lifetimes because two HTTP helpers raised it"*）。同包装层的超时文本（含 `did not answer within` 子串，errorBanner.ts:82-85）反而保持 reply 退役——**同一个 producer 内部都不一致**。

**裁定：TRUE**（注：无测试覆盖此包装文本，说明该缝未被有意裁决过；判定"是否有意"属于 owner 决策，此处只断言行为不一致这一事实）。

---

## 发现 3（低）：controller 侧 `clearErrorPatch` 在 1.5s hold 窗口内不清 schedule 标记对，"同文案重举必须重新武装自己的到期"存在可达的破口

**证据：**
- 不变量声明：`src/client/src/components/PiWebApp.ts:1062-1066`（*"a re-raised identical text - for the same machine or for the page - must re-arm its own expiry rather than be silently gated by the previous schedule"*）；round-19 triage 第 7 条 *"a cleared-then-returned banner re-arms its own expiry"*。
- `PiWebApp.ts:3855-3859` — `decision.kind === "hold"` 分支**提前 return**，不重置 `lastScheduledError`/`lastScheduledMachineId`，也不清 `transientErrorTimer`。
- controller 侧的清屏（machineController.ts:70、82；sessionController.ts:544、1623、1664、1789 等）只 `setState(clearErrorPatch())`，不碰 PiWebApp 的私有 schedule 标记——它们也无法碰。

**最小失败场景：** t0 轮询失败，banner "Reconnecting to the session daemon…"（reply, page）举起，6s 定时器武装于 t0。t0+0.9s 用户保存机器改名（`updateMachine` 入口 `clearErrorPatch`）→ 渲染落入 hold 分支（elapsed 0.9 < 1.5），标记对未重置、旧定时器未清。t0+1.1s 下一次轮询以**完全相同**的文案失败 → 标记对匹配 → 跳过 re-arm：新 claim 继承 t0 的到期基点（实际只活 ~4.9s），且其自身的 1.5s hold 窗口死亡（`bannerShownAt` 停留在 t0，t0+2.2s 的恢复瞬间隐藏、无最短可见期）。

**裁定：TRUE**（窗口窄：清除必须落在举起后 1.5s 内且重举发生在 hold 残余时间内；但被违反的正是代码注释与 round-19 明文写下的不变量）。附带一提：定时器回调（`PiWebApp.ts:1104`）只重置 `lastScheduledError` 不重置 `lastScheduledMachineId`，使标记对短暂失配——目前因成对比较逻辑而无害，记录为 nit。

---

## 发现 4（低，文档-代码漂移）：owner 决策 #5 与 changeset 宣称"到期只看退役标记、不看措辞"，代码实际双重门控

**证据：**
- `docs/design/review-triage-uiux-round17.md:62-63` — *"Six-second expiry - decided by the retirement model, not by matching the wording: only reply-retired claims expire on the timer."*
- `.changeset/banner-retirement-model.md:13` — *"The six-second expiry checks the retirement mark instead of guessing from the wording"*。
- 代码：`PiWebApp.ts:1095-1097` — `if (this.state.errorRetiredBy !== RetiredBy.reply) return; if (normalizeTransientError(error) === undefined) return;` — reply-retired 但措辞表不认的 claim（machineController.ts:181 与 PiWebApp.ts:1576 的合成消息 "X is unavailable; reconnecting…"）**永不**到期。round-22 的提交标题（*"Round 22: scope follows the producer's evidence, expiry follows the words"*）更是直接与决策 #5 相抵触。

**裁定：TRUE（行为本身有代码内注释辩护——合成消息按永久样式渲染，到期会自相矛盾——但两份持久文档记录的决策与实现相矛盾且从未修订，属于文档-代码漂移）。**

---

## 发现 5（低）：round 26 删字段留下孤儿 docstring，且 round-19 triage 描述的机制已被删除

**证据：**
- `src/client/src/components/PiWebApp.ts:302-303`：
  ```
  /** Whether the last interrupted-runs read failed; a flag, not a wording match. */
  @state() private unreadSessionIds: ReadonlySet<string> = …
  ```
  该注释描述的 `interruptedRunsUnknown` 字段已被 00220101 删除（diff 可证：`-  private interruptedRunsUnknown = false;`），注释却留在原地，现在**错误地**描述 `unreadSessionIds`。
- `docs/design/review-triage-uiux-round19.md:33-35` — *"the unknown banner's retraction tracks a flag, not a wording match"*：现行代码（`PiWebApp.ts:806`）的收回恰是**按精确文案匹配** `INTERRUPTED_RUNS_UNKNOWN_MESSAGE`（00220101 提交信息自认 flag 是 write-only storage 并移除）。审阅者按 round-19 文档核对代码会得到矛盾。

**裁定：TRUE**（行为未坏——按常量文案匹配在单生产者前提下是安全的；坏的是注释与两份记录在说一个不存在的机制）。

---

## 发现 6（低）：`Notice.machineId` 的 docstring 写错取值域

**证据：** `src/client/src/notice.ts:29-30` — `/** The machine a transport claim is about; "page" when the claim is global. */`。但 Notice 层的全局 claim 携带的是 `undefined`（`notice.ts:32-35`；三处 `noticeFromTransport` 调用无一传 "page"）；"page" 只在 `errorNotice.ts:28/33` 的 `?? "page"` 处进入 AppState。reader-retired 的 HttpError 即便手持 machineId（如 `pluginBackends.ts:72`）也会在 `notice.ts:101` 被丢弃为 "page"。

**裁定：TRUE**（纯注释错误，但恰好落在"scope 语义"这个本 round 的核心概念上，误导下一个读者）。

---

## 存疑（advisory，未裁定为缺陷，需 owner 表态）

**A. self-update 成功后旧的 "Update failed: …" reader banner 无退役路径。** `PiWebApp.ts:883-900`：重试成功（`result.started`）不清屏；banner 保持到下一次 transport claim（daemon 重启的轮询失败）把它**替换**掉为止——期间页面同屏显示"Update failed"与"正在更新…"的矛盾状态数秒。这是 reader-retired 模型（"只有读者退役它"）的**文档化代价**，不是新缝；但"同一操作后来的成功"这一反证种类在模型中不存在，值得 owner 知晓。裁定：行为属实（TRUE），是否算缺陷 = FALSE（设计代价）——挂起待 owner。

**B. interrupted 标记的"已恢复且已结束"残影。** 标记只被 adoption 替换（`PiWebApp.ts:796-799`），仲裁只排除 "working"（`pi-web-plugins/.../QuickSwitcher.ts:198` 附近：`interrupted … && rawStateKind !== "working"`）。开机被切断的 run 若被用户手动 resume 并正常结束，会以 idle 状态**永远**带 interrupted 徽标（直到刷新页面）。round-17 决策 4 与 round-25/26 注释把"是否继续"交给活动状态仲裁，但"继续过且已结束"无仲裁种类。裁定：行为属实；是否缺陷属于产品语义，标注为推测性边缘案例，交 owner。

---

## 已核查为干净（明确声明，供收敛裁决使用）

1. **seam 覆盖**：全客户端搜索 `setState({ error:` / 裸 `error:` 写入——页面级错误全部经 `errorNoticePatch`/`noticePatch`/`clearErrorPatch`（authDialog、settings、sessionCleanupDialog 等是各自的局部字段，非页面 banner）。round-18 第 8 条、round-19 第 3 条的声明与代码相符。
2. **clearErrorPatch 三元组原子性**（errorNotice.ts:37-38）与 `appState.ts:195`（resetWorkspaceScopedState 含 clearErrorPatch）——机器/工作区切换时 scope 随文本一起走。
3. **machineIdFromUrl**（transportHealth.ts:27-38）：对 `api/machines/{id}/…`、URL 结尾于机器段、百分号编码 id（decodeURIComponent + 畸形转义回退不抛）均正确；`api/machines`（花名册）与 web 自有 URL 正确落 "page"。
4. **deleteMachine 的 claim 退役**（machineController.ts:107）：只清属于被删机器的 claim——正确。
5. **loadInterruptedRuns 返回 undefined**（sessionController.ts:1007-1017）与 `interruptedRunsReadPlan`（interruptedRunsRead.ts）：boot 失败不置位 flag → 后续空读不误收回 prior markers；`adoptEmpty` 语义自洽；机器切换守卫（`PiWebApp.ts:786`）与渲染端机器 scoping（`PiWebApp.ts:3997` + `interruptedSessionIdsMachine`）成立。
6. **round-26 的两项声明**：contextKey 重置不再经 hold 回放旧 context 的 banner（`PiWebApp.ts:3834-3841`）；连续两次 page-level claim 的 re-arm（clearTransientError 补齐 `lastScheduledMachineId`）成立——发现 3 只是其 hold 分支残余。
7. **缓存/预取键**：`sessionUnread` 全程 machine 键控 + generation 守卫（sessionUnread.ts:96-106、371-373）；`cachedNewSessions` 条目带 machineId（cachedNewSessions.ts:12、44）；quick switcher 数据按 browseMachineId 键控并有迟到答案守卫（`PiWebApp.ts:2579`）；`workspaceSessionsCache` 按 machine+path；`chatHistoryCache` 按 sessionId（id 全局唯一，判定干净）；`machineNavigationMemory` 按 machine 键控；hydrateSessionStatuses 有 selection 守卫（sessionController.ts:1043）。
8. **round-18 第 6 条**：self-update 失败经 `noticePatch(noticeForReader(...))`（`PiWebApp.ts:890-891、898`），无残留到期调用。
9. **round-19 第 6 条**：`http.ts:47-49` 在判状态码**之前**上报可达（500 同样反证"链路断了"）。
10. **`link.live` 未接线**与 operation-model.md:147-152 的"still open"记录一致——deferred 项没有谎报为已修。

## 复核说明

- 发现 1 的服务端行为链（accept-then-bridge、connectWebSocket 不同步抛）全部来自源码证据，未做浏览器实测；如需实测可在 8505 栈上 `pkill sessiond` 观察 banner 的 raise/clear 循环。
- 文件只写入本路径；仓库未做任何修改（只读约束遵守）。
