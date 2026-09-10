# Round 21 · Lane B（行为与数据）审查报告

基线：refactor/plugin-architecture @ 1c2013f7。只读审查，未修改任何仓库文件。
焦点：退休模型端到端（machineId 作用域 / 过期 / bannerHold）、interrupted-runs 诚实性、预取与缓存键、跨切换的陈旧状态。

## 总览

8 项 TRUE，1 项 FALSE（判定非缺陷的观察），1 项标注为推测（未成立）。按影响排序：F4 > F1 > F5 > F3 > F2 > F6 > F7 > F8。文档与代码的主张冲突集中在 round-19/20 自己宣布"已闭合"的三条缝上。

---

## F1 · 判定 TRUE（中高）— bannerHold 的 1.5s 最小可见窗口在生产路径上是死代码，横幅可在数百毫秒内消失

证据：
- bannerHold.ts:8-24：hold 分支只在 next === "" 时返回；模块契约与测试（bannerHold.test.ts:5-16、22-26）写成"撤销要等横幅被读够 1.5s"。
- PiWebApp.ts:3795-3801：唯一调用点（PiWebApp.ts:3906 传入 state.error）在 error === "" 时**先**返回 null（注释：An empty next ... is decisive: the banner goes now）。于是进入 3803 时 next 恒非空，bannerHoldDecision 恒返回 show，3804-3808 的 hold 分支、bannerHoldTimer、heldErrorBanner 的 hold 返回全部不可达。
- 历史：1c2013f7（round 19）加入该早退分支，切断了 ed0cd40f 时代仍能工作的 hold；bannerHold.ts 契约、bannerHold.test.ts 的措辞、以及 dismiss 回调注释（PiWebApp.ts:3819-3820：the 1.5s minimum-visibility window exists for replacement churn）都仍按"窗口存在"书写。round-19 triage item 7 也仍宣称该窗口存在。

最小失败场景：机器作用域横幅 "RemoteA is unavailable; reconnecting…" 于 t0 出现（bannerShownAt=t0）；该机器 health 轮询于 t0+0.4s 成功 → clearTransientError → error="" → renderErrorBanner 首分支直接返回 null → 横幅仅存活 0.4s，布局抖动回归 —— 正是 bannerHold.test.ts:5-11 记录的原始病症（6 秒 21 次位移、累计 1.019px）。6s 过期与恢复清零路径同样绕过 hold。

判定：TRUE。修复方向二选一：把早退收窄为 bannerDismissedByReader（让空文本重新参与 hold 决策），或改写 bannerHold.ts 契约、测试与 dismiss 注释为"空即立撤"。二者现在互相矛盾，hold 是死代码。

（推测，未成立：reader dismissal 与新错误在同一批渲染前到达时，bannerDismissedByReader 可能吞掉新错误一个渲染周期；现有触发路径都跨宏任务，microtask 渲染会先复位标志 —— 标注为推测，未确立。）


---

## F2 · 判定 TRUE（中）— "page 级断言被任何响应驳倒"：注释、字段文档、round-20 主张与实现三方矛盾

证据：
- 实现（PiWebApp.ts:1046-1049）：disproved = machineId === undefined ? errorMachineId === "page" : errorMachineId === machineId。机器路由的成功只驳倒**该机器**的断言，不驳倒 page 断言。
- 紧贴其上的注释（PiWebApp.ts:1044-1045：A page-level claim is disproved by any response）、docstring（PiWebApp.ts:1039-1041：a page-level ("local") claim is disproved by any success at all —— 连 "local" 这个 round-19 旧 token 都还在）、appState.ts:130（"page" ... which any response disproves）—— 三处均与实现相反。
- round-20 提交信息与 triage item 1（docs/design/review-triage-uiux-round20.md：only page-level claims are retired by any response）同样与实现相反；同句的 web-owned URLs now vouch nothing 又与实现相反（web-owned 成功恰恰驳倒 page 断言）。

最小失败场景：手机休眠后唤醒，某个请求以 TypeError 失败 → page 级 "Lost connection to PI WEB. Reconnecting…"；唤醒后的第一次成功交换是机器路由轮询（api/machines/local/...）→ reportTransportReachable 上报 "local" → page 断言不被驳倒 → 横幅顶着正在流式输出的会话最多存活 6s（由过期兜底）。

判定：TRUE（矛盾客观成立；实现偏保守少清、注释偏激进多清，哪一侧是规范需 owner 裁决 —— 已标注为未决，而非断言实现错）。

---

## F3 · 判定 TRUE（中）— 健康运行时轮询的失败断言丢失机器作用域：同一文件两种写法自相矛盾，并让 round-20-C1 场景半复活

证据：
- machineController.ts:118-127、129-142：refreshMachineHealth / refreshMachineRuntime 的 catch 直接 errorNoticePatch(error)。machineId 就在参数里，但 seam 只能从 RequestTimeoutError.url 取机器（notice.ts:96-98）；TypeError 与代理 502 的正文断言一律落 "page"（errorNotice.ts:16、22）。
- 同文件 machineController.ts:149-155（selectInitialMachine）对**同一种失败**（远程机器不可达）明确决策：Reply-retired and machine-scoped: ... only a success from that machine disproves it。
- 下游：page 级断言会被 web-owned 成功驳倒，而这类成功在当前树里常见：PiWebApp.ts:641-648 每次 visibilitychange→visible 都跑 checkClientFreshness → clients.ts:113 api/pi-web/version；clients.ts:92-94 本机 piWebStatus 走 api/pi-web/status；boot 后的 deferred status refresh（PiWebApp.ts:1206、1288、1365）。

最小失败场景：本地 daemon 重启（例如更新流程）→ 机器路由轮询 502，正文 "session daemon unavailable: connect ECONNREFUSED ...sessiond.sock" → isTransientError 命中 → reply 退休但 **page 作用域**的 "Reconnecting to the session daemon…" → 读者切走再切回标签页 → api/pi-web/version 200 → 横幅被清，daemon 依旧不可用，页面看似健康，直到下一次机器路由失败重新举起。这正是 round-20 lane C 的 C1 场景（docs/design/research/r20-lane-c.md:17-44）；修复只对携带机器 id 的断言生效。round-20 提交信息宣称 the daemon-down banner survives theme switches，其引用的 cycleTheme→getPiWebVersion 路径在当前树已不存在（grep 无 cycleTheme）。

附带：refreshActiveTerminals 的 catch（PiWebApp.ts:2019-2021）没有选择守卫（成功路径有，PiWebApp.ts:2013），失败横幅可落在读者已离开的 workspace/机器上；对照 refreshInterruptedRuns 的显式守卫（PiWebApp.ts:779-781：A stale machine failed read must not announce onto the machine the reader is now looking at）与 sessionController 各错误点的 isCurrentSessionSelection 守卫，machineController 的两个 catch 是残余的无守卫生产者。

判定：TRUE。修法：给 seam 增加携带调用方已知 machineId 的入口（两个 catch 都知道机器），或把这两类断言正式定为 page 级并改写 selectInitialMachine 的注释 —— 现状两头不一致。


---

## F4 · 判定 TRUE（高）— 本地深链 + projects 列表失败：延迟恢复循环在第一次重试就自取消，且横幅说谎

证据链：
- PiWebApp.ts:1166-1176：projectsLoad === "failed" 且路由带 projectId → deferRemoteRouteRestore —— 对本地路由同样触发（对比 1152-1157 的 machines 失败分支显式排除 local）。注释（1166-1171）承诺：re-lists the projects and re-restores the same route once the listing recovers。
- PiWebApp.ts:1465-1471：deferRemoteRouteRestore 无条件 setRemoteRouteRestoreMessage。
- PiWebApp.ts:1536-1547：对 route.machineId ?? "local" 生成 "<本机名> is unavailable; reconnecting…" —— 而此刻本机在线（machines 列表成功，仅 projects 读失败；machineStatuses["local"] 多半 ok:true）→ 假话。
- PiWebApp.ts:1549-1555：pendingRemoteRouteRestoreStillCurrent 的第一个合取是 machineId !== "local" → 本地路由永假。
- PiWebApp.ts:1486-1492：retryPendingRemoteRouteRestore 第一步 stillCurrent 不满足 → clearPendingRemoteRouteRestore → return。承诺的恢复循环对本地路由**从未运行**（首个重试 tick 约 1s：REMOTE_ROUTE_RESTORE_RETRY_DELAYS_MS[0]=1000，PiWebApp.ts:336）。
- 测试只覆盖一半：PiWebApp.bootRestore.test.ts:22-56 用本地深链（?project=…&workspace=…）断言 pending 已设置，但从不驱动重试梯子 —— 自取消行为无测试。

最小失败场景：Pi WEB 更新/daemon 重启期间刷新页面，URL 带 ?project=p1&workspace=w1（本地机器）：machines 列表成功、projects 读 502 → 横幅 "Local Pi Web is unavailable; reconnecting…"（假）→ 1s 后重试 tick 清掉 pending → 恢复循环不再运行 → 读者停在 "Select or start a session"，深链丢失。唯一间接恢复是浏览器 resume（PiWebApp.ts:1271-1281 refreshAfterBrowserResume → loadProjects），且不重放路由；桌面常驻标签页不触发 resume —— 恰是 e58b6619 注释声称要防的结局。

判定：TRUE。修法二选一：1172 的 defer 像 1152 一样限定非本地并给本地一个 projects 重试路径；或让 stillCurrent 对本地路由放行、梯子重放 restoreBootRoute 的 projects 段。

---

## F5 · 判定 TRUE（中）— interrupted 标记被"已消费的空记录"撤回：重读把"记录花掉了"当成"运行已继续"

证据：
- 守护端：GET /sessions/interrupted 是 read-and-clear（src/server/daemon/sessions/sessionRoutes.ts:95-103）；记录只被再一次重启重新填充（interruptedRunStore.ts:52-79、155-157）。
- 客户端：refreshInterruptedRuns 把成功结果原样采纳（PiWebApp.ts:786-787）；openQuickSwitcher **每次打开**都重读（PiWebApp.ts:2469-2474），而 clients.ts:262-263 与 sessionController.ts:992-996 都写明该记录 fetched once per connection rather than polled。
- openQuickSwitcher 注释（PiWebApp.ts:2469-2470）称重读 retracts markers whose runs have since continued —— 但首次读取已把记录清空，重读无法区分"已继续"与"记录已花掉"：任何重读都返回空并被 verbatim 采纳。

最小失败场景：daemon 重启掐断 run S1 → 连接时读取 {S1}（守护端清空）→ 打开 quick switcher，S1 行显示 interrupted → 约一个 RTT 后重读的空记录落地 → interruptedSessionIds=[] → 标记在读者眼前消失；之后每次打开都不再显示，尽管 S1 从未恢复。首次打开表现为闪现后消失（先渲染再异步重读），后续打开表现为从未有过。

判定：TRUE。诚实形状：连接后首次读取才采纳空记录，或重读仅在 socket 重连/新重启后进行；重读的空结果不应比照"守护端撤回"。

（次生小缝，同判定 TRUE（低）：interruptedRunsUnknown 是单个布尔、不随机器切换或无关 clearErrorPatch（如 machineController.ts:14、69 的 load/update 入口 clear）复位 —— 横幅被无关清除后，读者会短暂同时看不到标记与 unknown 横幅；下一次失败读会重新举起、成功读会复位，危害有界。）


---

## F6 · 判定 TRUE（低）— 四处裸 error:"" 清除绕过 clearErrorPatch，与 round-19/20 的"每次清除都重置 mark+scope"主张冲突

证据：
- sessionController.ts:544（enqueuePendingSessionSend 成功入队路径）、1623（pending-start 选中路径）、1664（resolvePendingSessionStart）、appState.ts:191（resetWorkspaceScopedState）—— 都只写 error，不写 errorRetiredBy / errorMachineId；errorNotice.ts:36-39 明言清除必须 carries no stranger mark or scope。
- 主张：docs/design/review-triage-uiux-round19.md item 3（every clear now goes through clearErrorPatch, which resets mark and scope together）；.changeset/round-nineteen-seams.md（every clear resets the retirement mark and machine scope together）；6c32b436 提交信息（the last bare error writes ... go through the seam）。6c32b436 实际只转换了 sessionController.ts:532 的守卫、1789 的 replacement clear 与两个 load clear（projectController.ts:35、machineController.ts:14）—— 544 与 532 同函数却仍裸写。
- 现状危害潜伏：现有读取方都在 error !== "" 时才读 scope；但任何未来读者都会继承陌生作用域，且上述文档主张当前即为假。

判定：TRUE（主张与代码漂移 + 潜伏路径）。

---

## F7 · 判定 TRUE（低）— notice.ts 的 Notice.machineId 文档仍是 round-19 的 "local=全局断言" 词汇表，round-20 改名后语义被倒置

证据：notice.ts:27：The machine a transport claim is about; "local" when the claim is global。6c32b436 之后："local" 是**本机这台机器**的 id（如 PiWebApp.ts:1546 路由恢复横幅对本地路由传 "local"，须等本机成功才被驳倒）；未指名机器的全局断言携带 undefined，在 state 缝上成为 "page"（errorNotice.ts:16、22）。照该文档读会把 errorMachineId === "local" 误解为全局断言（任何成功可清），而现行模型把它当作本机链路断言（仅本机成功可清）。

判定：TRUE（文档漂移，语义倒置级）。

---

## F8 · 判定 TRUE（低）— notice.ts 的 RequestTimeoutError 兜底分支不可达，而 round-20 主张"重复的 timeout 分支已删除"

证据：requestDeadline.ts:29-33 保证每个 RequestTimeoutError 的文本都含 "did not answer within"；notice.ts:96-98 首分支（isTransientError → errorBanner.ts 的 /did not answer within/i 规则）必然先命中并已带 machineIdFromUrl(error.url)；因此 notice.ts:101-104 永不执行。其注释仍以现在时叙述 30.007s 的实测案例，仿佛该分支在承保超时的退休语义。round-20 triage item 3 声称 the duplicate timeout branch is gone —— TypeError 分支确实删了，这个 RequestTimeoutError 分支还在且是死的。

判定：TRUE（死代码 + 主张不符）。若它是有意的安全网（防止措辞表改动翻转退休语义），注释应明说。

---

## O1 · 判定 FALSE（非缺陷）— 两条保守方向的观察

1. fetchWithDeadline 路径（clients.ts:378、399；pluginBackends.ts:63；plugins/external.ts:81）从不 reportTransportReachable —— 成功不断言（保守方向，无假驳倒）；其失败包装文本（如 Plugin backend request unavailable: Failed to fetch）经 notice.ts:96 未锚定的 fetch 族正则判为 reply 退休 —— 与"退休跟随消息证据"的决策一致，且 errorBanner 的锚定正则不改写复合消息（round-20 修复保住前缀/机器名）。方向一致，无错。
2. chatHistoryCache 的键只有 sessionId（chatHistoryCache.ts:184-186），无 machineId —— 名义上违反"数据携带作用域"纪律；但会话 id 由各 daemon 以 UUID 铸造，跨机器同 id 需要真实迁移路径，而同一 daemon 的多个 machine 条目本就该共享同一份内容。判定：非缺陷（实践成立）；若未来出现会话跨机器迁移，此处是第一个要补机器键的地方。

---

## 已验证且干净的部分（同样是一条主张）

- 缓存键纪律：workspaceSessionsCache（machineId+NUL+path）；cachedNewSessions（记录内 machineId、按机器过滤）；sessionUnread（每机 MachineUnreadState + retainMachines）；machineStatusSnapshots（按机器 + epoch/revision 仲裁，machineStatusController.ts:37-49）；quick switcher 的 browse/shown 双守卫与 30s 窗口（PiWebApp.ts:2511-2560、2569-2573、2577-2584）；机器切换清空 sessionStatuses/sessionActivities（machineController.selectMachine）。
- interrupted 标记的机器守卫：采纳处（PiWebApp.ts:780-781）与渲染处（PiWebApp.ts:3941，interruptedSessionIdsMachine 不匹配即 EMPTY_ID_SET）；QuickSwitcher.ts:198 的 interrupted+working 抑制。
- 决策 5 落地：6s 过期只看 errorRetiredBy（PiWebApp.ts:1073-1074），不再匹配措辞。
- 决策 1/4 落地：HttpError reader 退休（notice.ts:97-98）；selectInitialMachine 的重连横幅 reply+机器作用域（machineController.ts:149-155）。
- http.ts:50 在判定状态**前**上报可达性 —— 500 也驳倒"链路断了"（transportHealth.test.ts 有断言）。
- self-update 横幅 coarse 地板顺序正确（PiWebApp.ts appStyles：.self-update-banner button 基础规则在 @media (pointer: coarse) 之前）。
- reportedError.ts（只清自己报的）与 projectController.loadProjects（catch 带机器守卫，注释甚至预见了"横幅已被无关成功退休"）是模范写法。
- round-17 修复 3（路由恢复横幅不再自我粘贴）属实：setRemoteRouteRestoreMessage 的 detail 读 machineStatuses 的 health.error，不读 state.error。
- 轨道（rail）与点色一致性依赖 sessionRowIndicator.ts 的仲裁器"每行一个标记"保证 + 环（ring）复合的豁免注释（shared.ts 轨道规则块），抽验未见双规则同时命中一行的现存组合。

## 交给 owner 的两个裁决点

1. page 断言的驳倒规则：按注释（任何响应）还是按实现（仅 web-owned）？（F2）
2. 空横幅是立撤（现实现），还是恢复 1.5s hold（模块契约）？（F1）

（行号勘误：REMOTE_ROUTE_RESTORE_RETRY_DELAYS_MS 定义于 PiWebApp.ts:257（正文误写 336）；machines 失败分支的非本地守卫在 PiWebApp.ts:1148（正文引作 1152-1157 区段，守卫行以 1148 为准）。其余引用均已逐一核对。）
