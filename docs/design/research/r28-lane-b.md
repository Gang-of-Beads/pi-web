# Round 28 — Lane B（行为与数据）：退役模型端到端 / interrupted-runs 诚实性 / prefetch 与缓存 key / 切换后的残留状态

配置：分支 `refactor/plugin-architecture`，HEAD `a5d3f390`（工作树含 round-28 启动提交 `161a44dd`，未触及本 lane 范围的代码）。本 lane 只读；所有发现给出 file:line、最小失败场景与 TRUE/FALSE 裁决。已核对 round-17～27 的 triage 与 research 页，凡已被记录、裁决或 owner 待决的项，只标注"沿用/新增实例"，不重复立案。

---

## 发现（按严重度排序）

### B-1（TRUE，Medium）读者发起的会话操作失败会"迟到重挂"：切换机器/工作区后，旧上下文的失败横幅被重新画到新上下文上

**证据（无 selection guard 的横幅写入，共 5 处）**

- `src/client/src/controllers/sessionController.ts:587`（`deliverPromptToSession` catch）— `this.setState(errorNoticePatch(error));`
- `src/client/src/controllers/sessionController.ts:639`（`deliverShellToSession` catch）
- `src/client/src/controllers/sessionController.ts:680`（`deliverCommandToSession` catch）
- `src/client/src/controllers/sessionController.ts:842`（`archiveSession` catch）
- `src/client/src/controllers/sessionController.ts:859`（`archiveSessionWithDescendants` catch）

同一 catch 块里的兄弟写入**有**守卫，横幅写入没有：

- `sessionController.ts:638` / `:679`：transcript 系统行写入带 `this.getState().selectedSession?.id === session.id` 守卫；紧随其后的 `:639` / `:680` 横幅写入无条件执行。
- `sessionController.ts:1954`：`markDelivery` 带 `current.selectedSession?.id !== sessionId → return` 守卫。
- 本仓库已修复的同类"迟到失败"模式都带 selection guard：`machineController.ts:157-167`（health，注释原话 "a late failure must not paint machine A's complaint onto machine B"）、`machineController.ts:178-183`（runtime）、terminals refresh（round-25 item 3）。

**被违反的设计句（仓库自己的话）**

- `src/client/src/components/PiWebApp.ts:3834-3837`："A machine or workspace switch clears the banner through the reset; holding the old context's banner across the switch would replay a complaint about a place the reader has left, over the place they just arrived at." —— 迟到的 `errorNoticePatch` 恰好就是这个被禁止的"replay"：切换时 reset 清掉了横幅，30s 截止/网关 502 到达后又把它重挂上来。
- `AGENTS.md`（How we work）"Data must carry the scope it belongs to … must not render … when that key does not match the current selection."

**最小失败场景**

1. 读者在机器 A 的会话里发出一条消息（`POST /sessions/:id/prompt`，JSON body → 30s 截止，`requestDeadline.ts:14`）；请求在途。
2. 第 5 秒读者切到机器 B（`machineController.selectMachine` → `resetWorkspaceScopedState()` 清空 error/selectedSession/messages；没有任何机制取消在途请求——`deadlineSignal` 的调用方未传自己的 signal）。
3. 第 30 秒 `RequestTimeoutError` 到达 → `:587` 无条件 `errorNoticePatch` → 横幅 "A request timed out. Polls retry on their own."（reply、作用域 A，来自 `notice.ts:108` 的 `machineIdFromUrl`）画在机器 B 的屏幕上。
4. 更糟的变体：网关回答 4xx（如 409 "Workspace is locked"）→ `noticeFromError` 判为 reader-retired（`notice.ts:101`）→ 作用域 "page"、**永不过期**，读者在机器 B 上必须手动关掉一条关于机器 A 操作的横幅。归档路径（`:842`/`:859`）同型。

**裁决：TRUE。** 注意反方向也成立、需要 owner 拍板：若加上守卫，失败对已离开的读者完全不可见——ledger 行只在它自己的 sessionKey 下渲染（`appState.ts:134-137`），transcript 行有守卫，横幅是唯一跨上下文信号。这是 round-22 遗留产品问题（"Scope switches clear reader-retired failures"）的姊妹面（那边是"切换时清"，这边是"切换后重挂"）。按仓库 "Product semantics belong to the owner" 规矩应摆给 owner；但"同 catch 块内 transcript 行有守卫、横幅没有"的不一致本身就是缺陷，五处站点与本仓库已修三次的迟到失败模式同型。

---

### B-2（TRUE，Medium-Low）健康探测的 200+`ok:false` 既"证明机器可达"又什么都不声明：三条无重挂路径让"机器不可达"声明被报告不可达的那个响应清掉

round-24 已把"health 路由 200+ok:false 自证可达"记录为 owner 待决（`review-triage-uiux-round24.md` "The local namespace is mixed…"，round-27 仍列为 pending）。本 lane 确认其在 HEAD 仍然成立，并补三个**记录里没有的新实例**：

**服务端事实（本地与远程同型）**

- `pi-web-plugins/machines/server/machineService.ts:118-126`（`remoteHealth`）：catch 把连接失败包装成 `{ ok:false, status:"offline" }` 以 **HTTP 200** 返回；`:99-111`（`localHealth`）同型。健康/运行时路由从不在 HTTP 层失败。
- 客户端 `src/client/src/api/http.ts:50`：`reportTransportReachable(url)` 在 `!response.ok` 判定**之前**触发 → `transportHealth.ts:49-58` 以 URL 作用域为该机器 vouch → `PiWebApp.ts:1055-1074` `clearTransientError(machineId)` 清掉该机器的 reply 声明。

**新实例 1 —— 三条"清了且无人重挂"的路径**

`machineController.refreshMachineHealth` 的成功路径（`machineController.ts:137-145`）只写 `machineStatuses`，对 `ok:false` **不产生任何声明**（只有 catch 产生，`:157-167`）。于是：

- roster 清扫 `refreshMachineHealthFor`（`:218-222`，`Promise.allSettled` 吞掉一切拒绝，r21-lane-c T2 记过"raises nothing at all"）;
- `selectMachine` 的 `void this.refreshMachineHealth(machine.id)`（`machineController.ts:87-88`）;
- 机器行菜单的 "Check again"（`pi-web-plugins/machines/browser/MachineList.ts` `onRefresh` → `PiWebApp.ts:2977` / `:3318`）。

场景：机器 B 掉线，某 poll 502 挂出 "Reconnecting to the machine…"（机器作用域 B）；随后任意一次上述健康探测返回 200+`ok:false` → **报告不可达的响应把"不可达"声明清掉**，且无重挂——读者手里只剩行内 offline 红点，横幅模型"only a success from that machine disproves it"（round-17 决策 1）被一个从未触到 B 的响应违反。

**新实例 2 —— boot composed 声明的"出现→被清→由 ladder 重挂"抖动**

1. 深链指向远程 B 且 B 掉线：`selectInitialMachine` → `safeRemoteHealth` 失败 → `machineController.ts:195` 挂出 composed "B is unavailable; reconnecting…"（reply、机器作用域、composed 不进 6s 过期表）。
2. 紧随其后的 `refreshMachineHealthFor`（`machineController.ts:52-53`）对 B 再发健康探测 → 网关 200+`ok:false` → report 触发 → **刚挂的 composed 声明被清**；allSettled 吞掉无重挂。
3. 只有 defer ladder 的 `setRemoteRouteRestoreMessage`（`PiWebApp.ts:1568-1577`）随后重挂；ladder 每一跳 `refreshMachineHealth`（`PiWebApp.ts:1528`）又以同样的 200+`ok:false` 清一次再重挂一次——**raise→clear→raise 的抖动**，恰是横幅模型要消灭的 churn 形状（r24-lane-c:319 只把它记为"self-correcting within one request"的语义瑕疵；这里的 swallow 版本使自校正依赖"别的调用方恰好会重挂"这一偶然）。

**裁决：TRUE**（作为 round-24 待决项的"仍然开着 + 新实例"立案，不推翻其 owner-待决定性；修复方向仍是 round-24 写下的词汇表决策，但应把"report 只应在响应真正触到该机器时 vouch"纳入同一决策）。

---

### B-3（TRUE，Low）`interruptedRunsReadPlan.resolveUnknown` 没有任何生产读者；撤回判定退回 wording 比较——round-26"决策住在单一已测模块"只兑现了三分之二

**证据**

- `src/client/src/interruptedRunsRead.ts:16,20-21`：plan 的第三个字段 `resolveUnknown`（"A successful read answers the unknown-state banner, empty or not"）被计算并测试（`interruptedRunsRead.test.ts:6,11,22,27`），但唯一调用方从未读它。
- `src/client/src/components/PiWebApp.ts:788-806`：调用方只消费 `plan.failed` 与 `plan.adoptMarkers`；撤回写的是 `if (this.state.error === INTERRUPTED_RUNS_UNKNOWN_MESSAGE) this.setState(clearErrorPatch());`（`:806`）——按**文本比较**重新推导 plan 已经给出的答案。

**矛盾链**

- round-19 item 8 曾宣称 "the unknown banner's retraction tracks a flag, not a wording match"；
- round-26 item 1 宣称 "the decision now lives in one tested module, not in a callback body"——但**撤回这一半**（何时清 unknown 横幅）仍住在回调体里、以 wording 比较实现，被测模块的对应字段成了死代码。

**最小失败场景**：未来任何人把 `:806` 的比较改成"以 plan 为准"之外的形态（例如先改 `INTERRUPTED_RUNS_UNKNOWN_MESSAGE` 文案再漏改某处），唯一防线是两处恰用同一常量；而 plan 模块为防这个问题专门算出的 `resolveUnknown` 恰恰无人读——round-26 那条"决策进模块"的修复只对 `failed`/`adoptMarkers` 两半生效。今天行为等价（TRUE 但 Low：死字段 + 契约漂移，非用户可见缺陷）。

**裁决：TRUE（Low，死代码/契约漂移）。**

---

### B-4（TRUE，Low，沿用未闭）XHR 上传成功从不 report reachability——r22-B6 的后半至今未闭

**证据**

- `src/client/src/api/workspaceUploads.ts` 全文无 `transportHealth` 导入；`uploadWorkspaceFile` 的 `xhr.onload`（2xx 分支）成功时不作任何 vouch。
- 消费端 `src/client/src/plugins/workspaceFiles.ts:52-60`（`uploadFiles` 绑定）也不补。
- round-23 item 9 只补了四个 fetch 腿（tree/fork、terminal-command-run、plugin-manifest、plugin-backend）；round-25 lane-b 已注明"XHR 半边仍未闭"。round-26/27 的修复清单均未触及此腿。

**最小失败场景**：机器 X 的 daemon 重启期间挂出 composed "X is unavailable; reconnecting…"（无 6s 过期，`errorBanner.ts:64-65` 的 composed 守卫）；daemon 恢复后读者恰好在 X 的工作区上传一个附件——XHR 上传**成功**（这条成功恰恰证明了 X 的代理链路已通），却不能退役该声明；若此后没有其它对 X 的机器作用域 HTTP 读，横幅留到读者手关。实际影响有限（unread/statuses 轮询通常会更先成功上报），但这是模型覆盖面上最后一个已记录未闭的洞。

**附带观察**（同文件，不单独立案）：`xhr.onerror` 固定产出 `new Error("Workspace upload failed")`（`workspaceUploads.ts:159`）——链路失败的证据被固定文案替换，最终以 reader-retired 姿态出现在面板行内；同一失败走 `request()` 会是 reply+机器作用域。归属显示层契约，建议与 B-4 一并定夺。

**裁决：TRUE（Low，沿用 r22-B6，确认 round-28 HEAD 仍开着）。**

---

### B-5（TRUE，Low）`operation-model.md` 三处与 round-27 之后的代码矛盾（docs-vs-code 漂移）

**证据**

1. `docs/design/operation-model.md:24`："the notice layer (`noticeFromError` in `notice.ts`) raises a **page-level** banner"——自 round-19 起截止超时按 `machineIdFromUrl(error.url)` 带机器作用域（`notice.ts:107-108`）。
2. `docs/design/operation-model.md:29-31`："The suppression branch **exists** in `notice.ts` - `RequestTimeoutError` with a live link returns `NO_NOTICE` - but no production caller passes the verdict yet: `errorNoticePatch` defaults its `link` to `{ live: false }`"——round-27 已把 link 参数、分支与 `NO_NOTICE` **整体删除**（round-27 triage item 5）；`notice.ts:76-78` 现在明说 "no such branch ships here"；`errorNotice.ts:23-29` 的 `errorNoticePatch(error)` 没有 `link` 参数。文档描述的是不存在的代码。
3. `docs/design/operation-model.md:151`："Wiring `errorNoticePatch`'s `link` argument to the socket's keepalive facts **remains the open piece** of consequence 2."——该参数已不存在；round-18 遗留的 seam 决议以"删除"而非"接线"收场，"Still open"清单仍按旧形态描述。

**最小失败场景**：读者按 consequence-2 理解现行为（存在可达性抑制分支、errorNoticePatch 接受 link）→ 去 `notice.ts`/`errorNotice.ts` 找不到对应物 → 对"截止超时是 page 级还是机器级"得出与 round-19/27 相反的结论。round-26 item 10 只修了 "Status: what landed" 清单里的旧 claim，未同步 consequence 段。

**裁决：TRUE（Low，文档漂移；三处同源，一次编辑可闭）。**

---

## 验证为干净的部分（带 trace，非空泛背书）

1. **bannerHold × 6s 过期 × hold 窗口全部交错**（本轮重点 hunts）：
   - 到期回调先重置 schedule 标记对再比较（`PiWebApp.ts:1101-1112`，round-27 补的 `lastScheduledMachineId=undefined` 在位）；hold 分支同样重置标记对并清 `transientErrorTimer`（`PiWebApp.ts:3857-3871`）；`clearTransientError` 清场时同步重置标记与定时器（`:1061-1074`）。
   - 追踪过的路径：到期时 state 已被替换（重排程先清旧 timer，无双删）；到期时正处于 hold（hold 分支已清 timer）；切机器在 hold 窗口内（contextKey 分支 + reset 双清）；到期后 `bannerShownAt` 未重置 → 下一帧 "hide" 落入标记分支被 `"page" !== undefined` 重置为无害稳态。均无可见缺陷。
   - `disconnectedCallback` 现在同时清 hold timer（round-27，`:1118`）。
2. **machineIdFromUrl**：机器 id 含保留字符时全构造点先 `encodeURIComponent`（`clients.ts:20`、`urls.ts:14-33` 等），`transportHealth.ts:30-40` 的 decode 在 try 内、失败回退原段；`fetchWithDeadline` 腿的 `RequestTimeoutError.url` 已是 `resolveAppUrl` 后的绝对路径，正则同样命中。干净。
3. **清场作用域卫生**：`clearErrorPatch` 三字段一体（`errorNotice.ts:36-38`）；`deleteMachine` 按 `errorMachineId === machine.id` 连带撤回（`machineController.ts:107`）；到期守卫三条件（text+machineId+reply）在位（`PiWebApp.ts:1109`）。
4. **缓存/prefetch key**：`workspaceSessionsCache` 键为 `machineId\0workspacePath`（`workspaceSessionsCache.ts:15-17`）；`cachedNewSessions` 每条携带 machineId 且 merge 按 machine+cwd 过滤（`cachedNewSessions.ts:45-52`）；quick switcher 每机器独立加载、迟到应答有 browse-guard（`PiWebApp.ts:2588`），已知 fetch race 仍按 round-26 记录 deferred（不重复立案）；draft/transcript 键经 `machineSessionKey`。干净。
5. **切换后的残留状态**：`selectMachine` 清 `sessionStatuses/sessionActivities/workspacesByProjectId/workspaceDeletionRuns` 并带 `resetWorkspaceScopedState()`（`machineController.ts:39-66`）；interrupted 标记按 `interruptedSessionIdsMachine` 在渲染门处隔离（`PiWebApp.ts:4011`）；late 健康读三重守卫（seq+selection，`machineController.ts:157-167`）。干净。
6. **rail/dot 优先级**（交接核对，非本 lane 主责）：`:has()` 规则全 (0,1,0) 按源序、`archived/selected` (0,2,0) 压制、machine-status danger 排在 unread 后且注释言明（`shared.ts:439-456`）；session 行由 `sessionRowIndicator` 单点仲裁（`sessionRowIndicator.ts:23-45`），dot 类互斥，未发现组合态下 rail/dot 分裂的新实例。

## 已有 erratum/裁决、不再重复立案

- round-17 决策 5 的"expiry 不看 wording"已被 round-22 gate（`PiWebApp.ts:1095-1096` 同时要求 reply + `normalizeTransientError`）取代，erratum 在 `review-triage-uiux-round23.md`（页尾）——round-17 文档按惯例未改，round-23 页已背书。
- round-18 item 9 "leaving the screen resets the schedule" 的过时记录已有 round-25 erratum。
- 深链 boot interrupted-runs 竞态（round-23 deferred）、quick switcher fetch race（round-26 deferred）、restore ladder 把共享横幅当自身信号（round-23 deferred）——均确认仍在原 deferred 状态，未复检出新形状（B-2 实例 2 是其近亲但机制不同：清/挂抖动，不是误判）。
- round-24"混合 local 命名空间"owner 待决——B-2 为其补充远程机器实例与无重挂路径，决策仍待 owner。
