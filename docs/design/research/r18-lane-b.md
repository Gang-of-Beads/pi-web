# Round 18 · Lane B(行为与数据):退役模型端到端、interrupted-runs 诚实性、缓存键、跨切换状态

审查对象:branch `refactor/plugin-architecture`,HEAD `b0bce2a0`。本 lane 聚焦**行为与数据**:退役模型(machineId 作用域、expiry、bannerHold)、interrupted-runs 诚实性、prefetch/缓存键、跨切换状态、docs-vs-code 漂移。只读审查,未改动任何仓库文件;除 grep/read 外仅运行了一次单文件 vitest(`pointerQueryOrder.test.ts`,253ms)与两段 /tmp 内 node 仿真(不改仓库)。

结论:**不是干净的一轮**。共 11 项发现(B1–B11),其中 2 项 P1。最重的一条不是代码,而是 round-17 triage 页声称已修的两个缺陷(F1 死地板、F2 守卫盲区)在 HEAD 上**均未落地**——我实跑了守卫测试并仿真复现了盲区。

---

## B1(P1,docs-vs-code 漂移 + 缺陷仍在):round-17 triage 声称"已修"的两项在 HEAD 上都不存在

**triage 的声明**(`docs/design/review-triage-uiux-round17.md:14-22`,"Fixed in this wave" 第 1、2 条):

> 1. **Self-update banner's coarse floor was dead** (lane A, medium) - the base rule sat after the media block. **Fixed** by ordering, and the guard that should have caught it is fixed too (next item).
> 2. **pointerQueryOrder never checked the first rule of a media block** … **Fixed** in the guard, and F1 is its first catch.

**代码证据(HEAD b0bce2a0)**:

- 自更新横幅的 coarse 地板**仍然是死规则**:`src/client/src/components/PiWebApp.ts:205`
  `@media (pointer: coarse) { .self-update-banner button { min-height: var(--pi-control-height-touch); } … }`
  紧随其后 `:206` 同选择器基础规则 `.self-update-banner button { box-sizing: border-box; min-height: var(--pi-control-height); … }`。两选择器同为 (0,1,1),author 层按源序取胜 → 206 的 32px 在所有指针下获胜。`--pi-control-height: 32px`、`--pi-control-height-touch: 44px`(`src/client/index.html:103`;`designTokens.test.ts:86` 断言 touch=44px)。这与仓库自己写下的规则相悖(`shared.ts:468-469`:"a media query carries no extra specificity, so a coarse floor written earlier loses to a later base declaration")。
- 守卫**仍然看不见每条 media 块的第一条规则**:`src/client/src/components/pointerQueryOrder.test.ts:24` 的锚仍是 `/(?:^|\})\s*(?<selector>…)/`(要求选择器前是串首或 `}`),而 `:40` `inside = source.slice(open, end)` 以 media 块自己的 `{` 开头,块首选择器永远无法满足 `(?:^|\})` 锚。`git log --all -- pointerQueryOrder.test.ts` 显示该文件自 d167533d(round nine)后从未被改过;646a0d5a 的文件清单(`--stat`)里也没有它。
- **实测**:`npx vitest run src/client/src/components/pointerQueryOrder.test.ts` 在 HEAD 上**通过**(1 passed),而上述违规真实存在——正是 r17-lane-a.md 自己描述的"二者同时成立即为本发现的证明"的形态。用修正锚(`slice(open+1, end)`)的同构扫描跑遍 `src/client/src` 与 `pi-web-plugins`,全仓恰好只有这一处 offence:`PiWebApp.ts` mediaLine 194(剥离注释后坐标,对应原文件 205/206)`.self-update-banner button` 的 `min-height`。
- 646a0d5a 的提交信息也声称 "the pointer-query guard never checked the first rule of a media block" 已修——同样与树不符。

**最小失败场景**:手机(coarse pointer)打开自更新横幅 → "Update now"/"Skip" 按钮渲染 32px 而非 44px;且本应抓住它的结构守卫在 CI 里绿灯通过。

**裁决:TRUE**(CSS 源序 + 令牌值 + 实跑守卫通过 + 修正锚仿真仅此一处 offence,四重证据)。

---

## B2(P1,退役模型本身的作用域缝隙):`errorNoticePatch` 不携带 `errorMachineId`,通用路径产生的 transport 声明继承上一条通知的机器作用域

**证据**:
- `src/client/src/errorNotice.ts:23-29`:`errorNoticePatch` 返回 `Pick<AppState, "error" | "errorRetiredBy">`——**没有** `errorMachineId`;对比同文件 `:32-33` 的 `noticePatch` 明确写 `errorMachineId: notice.machineId ?? "local"`。
- `setState` 是浅合并(`src/client/src/components/PiWebApp.ts:1095-1099`),未指定的字段保留旧值。
- 约 35 个调用点走这条路径:`sessionController.ts:413,439,587,639,680,703,726,752,756,778,811,842,859,1118-1301…`、`machineController.ts:30,54,76,92,109,124`、`workspaceController.ts:64,89`、`projectController.ts:47`。其中 TypeError/RequestTimeoutError 会成为 reply 退役、**却带陈旧作用域**的 transport 声明(`notice.ts:87-94`)。
- 退役守卫:`PiWebApp.ts:1024-1032`;恢复上报:`api/http.ts:54` → `api/transportHealth.ts:31-40`(按 URL 的 `/machines/{id}` 段归机器,无段归 "local")。

**失败场景 A(欠清除,作用域卡死)**:
1. 启动时远端机器 A 健康检查失败 → `machineController.ts:214-217` → `errorMachineId="A"`;
2. socket 重连成功 → `clearTransientError("A")` 只清 `error` 文本(`PiWebApp.ts:1031`),`errorMachineId` 仍为 "A";
3. 用户切到机器 B,B 的一次 poll 抛 TypeError → `errorNoticePatch` → `error="Failed to fetch"`、reply,但 `errorMachineId` **仍是 "A"**;
4. B 恢复 → `reportTransportReachable("api/machines/B/…")` → `clearTransientError("B")` → 守卫(`PiWebApp.ts:1026`)"A"≠"B" → **不退**。声称 B 链路断开的横幅无法被 B 自己的恢复退役,只能等 6s 定时器或 A 的成功。这与 `transportHealth.ts:34-36` 的语义("The report vouches for the machine the URL addressed")直接矛盾——vouch 被陈旧作用域废掉了。

**失败场景 B(过清除,owner 明令禁止的行为从这条路径复活)**:新页面 `errorMachineId` 初始 "local"(`appState.ts:271`)→ 机器 B 的 poll 抛 TypeError → 声明作用域为 "local" → 本地机器下一次成功请求(`reportTransportReachable("api/health")` → "local")把它清掉——**A 的成功抹掉了 B 的申诉**,正是 owner 决策("a success from machine A no longer erases machine B's complaint")点名要消灭的行为,只是从 `errorNoticePatch` 这条路原样存活。

另注:`notice.ts:90-94` 关于 timeout 的注释承诺 "later answers disprove it the same way"——该承诺只在作用域匹配时成立,而 timeout 恰恰走 `errorNoticePatch`(无作用域)。r17 记录的原始事故(timeout 横幅比工作着的会话活得久)在此路径上只修了寿命,没修退役通道。

**裁决:TRUE**(修复方向:让 `errorNoticePatch` 返回 `noticePatch(noticeFromError(error, link))` 的三字段,或显式记 `machineId: undefined` → "local")。

---

## B3(P2,expiry × bannerHold × 文本去重的三方竞态):`lastScheduledError` 在横幅离屏时从不复位、dismiss 不撤销定时器,同一文本重入时要么丢 6s 寿命、要么被旧定时器提前掐灭

**证据**(`src/client/src/components/PiWebApp.ts`):
- `:414` `lastScheduledError = ""` 只在 `:3782-3785` 被赋值;hide 分支(`:3776-3779`)只复位 `bannerShownAt`/`heldErrorBanner`,**不复位它**;
- dismiss 回调 `:3786` `errorBanner(error, () => { this.setState({ error: "" }); })` 不取消 `transientErrorTimer`;
- `scheduleTransientErrorDismissal`(`:1041-1057`)只在被调用时清旧定时器;定时器回调 `:1053-1055` 以 `state.error === error && reply` 判定;
- 调度门槛 `:3782`:`if (error !== this.lastScheduledError)`——文本相同即跳过。

**失败场景 1(提前熄灭)**:t0 poll 失败 "Failed to fetch"(reply)→ 调度 T@t0+6;t0+2 用户点 dismiss(错误清空,T 仍在);t0+5 同一失败再次发生 → 文本与 `lastScheduledError` 相同 → **不重新调度**;t0+6 T 触发 → `state.error === "Failed to fetch"` 且 reply → `setState({error:""})` → 新横幅只活了 ~1s(bannerHold 兜底到 1.5s),设计寿命 6s。
**失败场景 2(永生)**:同上,但 T 在重入之前已自然触发过 → 重入后无任何定时器 → 若叠加 B2 的陈旧作用域(恢复退役也够不着),横幅只能手动 dismiss。
全仓无任何测试钉住 dismiss→重入→再调度的循环(`errorBanner.test.ts`/`bannerHold.test.ts`/`PiWebApp.transportRecovery.test.ts` 均未覆盖)。

**裁决:TRUE**(代码路径推演完整;两分支共享同一根因:hide 分支应复位 `lastScheduledError` 并撤销定时器,dismiss 回调应撤销定时器)。

---

## B4(P2,旁路生产者):裸写 `setState({ error })` 的站点让 `errorRetiredBy` 停留在上一个通知的值——`errorNotice.ts` 的文档化不变量对它们是假的

**证据**:`src/client/src/errorNotice.ts:14-21` 声称 "Returning both fields together makes the pair impossible to set apart, so a call site added later cannot reintroduce either half"。但以下站点写非空 `error` 而不写 `errorRetiredBy`(也不写 `errorMachineId`),标记沿用历史值:
- `PiWebApp.ts:858`("Update failed: …")、`:866`("Update request failed")、`:1710`、`:2576`、`:2594`、`:3291`、`:3313`、`:3389`、`:3433`、`:3623`;
- `sessionController.ts:532`、`:655`;
- `authController.ts:104`、`:186`;
- `controllers/reportedError.ts:19`(休眠助手,仅测试引用)。

**最小失败场景**:机器 A 的重连声明(reply、作用域 A)在屏或刚被 reply 退役(标记仍 reply)→ 用户点 "Update now" 失败 → `:866` 写入 "Update request failed",标记仍 reply → A 的下一次成功请求经 `clearTransientError("A")` 在读者看到之前把它抹掉——正是本次提交承诺的 "no poll can erase them" 被旁路生产者复活。反方向:新页面(标记 reader)下 `:859/:867` 显式调用的 `scheduleTransientErrorDismissal` 在 `:1050` 守卫处静默 no-op——同一消息**有时 6s 消失、有时永驻**,取决于它之前屏上是什么。(`:1768-1770` 的 `openLazySurface` 是做对了的对照样本,注释原话:"The retired-by half must travel with the text, or the banner's lifetime is decided by whatever error was cleared before it"。)

**裁决:TRUE**。

---

## B5(P2,新代码的自我矛盾):interrupted-run 失败横幅承诺 "Retrying the connection will resolve it.",但代码里没有任何东西会兑现这句话

**证据**:`src/client/src/components/PiWebApp.ts:763-774`——失败分支 `:770` 以 `noticePatch(noticeForReader("Interrupted-run status is unknown: the read failed. Retrying the connection will resolve it."))` 抛出;成功分支 `:773` 只写 `this.interruptedSessionIds = ids`,**从不清 error**;reader 退役对 `clearTransientError` 免疫(`PiWebApp.ts:1025` 要求 reply;`notice.ts:36-37`)。该读取在每次连接与每次重连时触发(`:1904`、重连回调 `:1917`),`openQuickSwitcher` 也再触发一次。

**最小失败场景**:链接抖动一次导致 interrupted-runs 读取超时 → 常驻琥珀横幅;随后 socket 重连成功、重试读取成功(marker 恢复),横幅**纹丝不动**——横幅里那句话是假的,唯一退出是手动 dismiss 或被下一条错误替换。每次重连读取再失败还会重新抛同文(文本去重使其常驻,dismiss 后下次重连又再抛)。旁注(推测,标注为推测):若远端机器运行旧版无该端点,404 同样落入此分支,横幅将随每次重连循环重现。

**裁决:TRUE**(要么改文本去掉承诺,要么成功路径显式 `setState({ error: "" })` 退役自己)。

---

## B6(P2,替换交互回归):remote-route-restore 的门槛把"屏上有任何错误"读成"这台机器断了"——退役模型让 reader 通知变得常驻后,健康机器的深链恢复会先闪一条假的 "X is unavailable; reconnecting…"

**证据**:`PiWebApp.ts:1484-1487`——在 health、runtime、projects 三读**全部成功之后**才检查 `if (this.state.error !== "")`,任意陈旧 reader 通知(如 "Delete failed: …" 或 B5 的横幅)即触发 `scheduleNextRemoteRouteRestoreAttempt` → `setRemoteRouteRestoreMessage`(`:1519-1527`)对**健康机器**写入 reply 声明(替换掉读者未读的 reader 通知);下一跳的成功 health 读把假声明退掉(作用域匹配),恢复最终完成。
**最小失败场景**:用户有一条未 dismiss 的 reader 通知,点开健康远端机器 B 的深链 → 横幅先翻转成 "B is unavailable; reconnecting…"(bannerHold 保证 ≥1.5s),随后消失——机器从未断过,且读者未读的通知被无感替换。姊妹门槛 `shouldPreserveUnrestoredMachineNavigation`(`:1665-1668`)同样把任意 error 当"恢复失败"。
背景:该门槛先于 b0bce2a0 存在(ef22247d 引入),但 b0bce2a0 把 HttpError 从 reply 改为 reader 退役后,`state.error` 非空的常态时长大幅上升,门槛的误触发率随之上升——属于退役模型与既有门槛的**交互回归**。

**裁决:TRUE**(交互定级;建议门槛只看 reply 且作用域匹配本机的声明,或看 `machineStatuses[machineId].ok`)。

---

## B7(P3):interrupted-run 标记集与其失败横幅都不带机器作用域,跨机器切换时晚到结果可互相污染

**证据**:`PiWebApp.ts:303` `interruptedSessionIds` 是无作用域的裸 Set;`:763-774` 的异步结果**没有** "仍是当前机器" 守卫(对照:sessionController 各站点都有 `isCurrentSessionSelection`/`selectedMachineId` 守卫);消费点 `:3903` 只用 `quickSwitcherBrowsingElsewhere()`(`:2544-2548`,比较的是被浏览机器 vs 选中机器)把关,不校验标记来自哪台机器。
**最小失败场景**:A→B→A 快速连切:B 的晚到**成功**会用 B 的 marker 集覆盖当前 A 的集(id 不同,实际无可见害);B 的晚到**失败**会在用户已回到 A 时抛 "Interrupted-run status is unknown" 横幅——一条关于 B 的读取失败、无机器归属、reader 常驻的页面级通知。
**裁决:TRUE**(低危:形式上违反"数据必须携带作用域"的 standing rule,可观察危害目前接近零)。

---

## B8(P2/P3,调色板行为):"rail 随 dot"只对 session 行成立——machine/workspace 行的 unread dot 仍是 accent 蓝、rail 却改成了 purple;background 行的紫色 dot 没有任何 rail 规则

**证据**:
- rail:`src/client/src/components/shared.ts:439` `.action-row:has(:where(.activity-indicator.unread, .unread-ring, .session-state.unread)) { border-left-color: var(--pi-purple); }`;
- dot:同文件 `:453` `.activity-indicator.unread { … background: var(--pi-accent); … }`(注释原话 "keep it static and accent-colored");
- 插件行吃同一份样式:`pi-web-plugins/machines/browser/hostUi.ts:38` adopt `host.listStyles`;machine/workspace/project 行的 unread-only 标记经 `renderActionActivityIndicator` 输出 `.activity-indicator unread`(`pi-web-plugins/machines/browser/activityBadge.ts:40-52`);
- 对照组:session 行走仲裁器 `sessionRowIndicator.ts:69-70`,unread 输出 `.session-state.unread`(紫,`sessionStateBadgeStyles.ts:37-38`)→ session 行 dot 与 rail 一致,machine/workspace 行 **dot 蓝、rail 紫**——"a row no longer reads as one colour up close and another at scanning distance"(triage 决策 2)在插件行上恰好反向成立。这也意味着 "unread" 在两套词汇里仍是两种颜色(r17 发现的原话:"unread purple in one list and accent in another")。
- background 缺口:`.session-state.background` 紫色空心环(`sessionStateBadgeStyles.ts:24-25`)在 `shared.ts:439-447` 的 rail 规则中**无任何匹配项** → background 行 dot 紫、rail 透明。决策文本只枚举了三态(running/asking/unread),此为覆盖缺口而非规则被违反。

**最小失败场景**:机器列表里一台"有未读、无活动"的机器:近看 dot 蓝色,扫视 rail 紫色;会话列表里一个 background 会话:近看紫色环, rail 无色。

**裁决:TRUE**(machine/workspace unread 行的 dot/rail 不一致为中危;background 无 rail 为低危覆盖缺口)。

---

## B9(P3,死代码中的矛盾调色):`renderSessionStateBadge` 已无生产调用点,其 `.session-state.idle.unread` 仍是绿色,与仲裁器的紫色 unread 词汇冲突

**证据**:`activityBadge.ts:83-95`(`renderSessionStateBadge` 仅测试引用)、`sessionStateBadgeStyles.ts:31` `.session-state.idle.unread { background: var(--pi-success); }`;而行仲裁器对 idle+unread 输出紫色 `.session-state.unread`(`sessionRowIndicator.ts:69-70`)。该样式块 docstring 自称 "One style block for every surface … so the same state never reads differently in two places"。
**裁决:TRUE**(当前无可观察影响——纯死代码+矛盾文档;建议删除或对齐,防止下一个调用者复活绿色 unread)。

---

## B10(P3,docs-vs-code 漂移):`operation-model.md` 的"已落地"清单声称超时横幅会因 socket 活着而不出现,但生产代码无一处传 `live: true`,该分支不可达;文档自身"仍未落地"清单与之互相矛盾

**证据**:`docs/design/operation-model.md:120-126`("A timeout on a live link no longer claims the server did not answer — the banner stays down while the socket is alive")对比同文档 `:135-137`("Deadline does not consult liveness yet. … wiring `deadlineSignal` to the socket's keepalive facts is the remaining piece")。代码侧:`notice.ts:77-78` 的 `RequestTimeoutError && link.live → NO_NOTICE` 分支唯一入口是 `errorNotice.ts:27`,其 `link` 参数从未被任何调用者传过非默认值(全仓 grep 无 `live: true`)。即"已落地"清单里的那句话在代码上不成立,"仍未落地"清单才与树一致。另:`operation-model.md:24` 的行号引用 `notice.ts:70` 在 b0bce2a0 之后已漂移(现为 :77)。
**裁决:TRUE**(文档自相矛盾 + 行号漂移;代码与"仍未落地"半边一致)。

---

## B11(P3,测试漂移):`PiWebApp.transportRecovery.test.ts` 仍以措辞(`isTransientError`)而非退役标记建模,测的不再是它声称的模型

**证据**:`src/client/src/components/PiWebApp.transportRecovery.test.ts:17-35`——监听器以 `if (isTransientError(error)) error = "";` 决定清除,且忽略 `machineId` 参数。b0bce2a0 之后退役由 `RetiredBy.reply` + 作用域决定(`PiWebApp.ts:1024-1032`),措辞已被显式废弃(提交原话:"The six-second expiry checks the retirement mark instead of matching the wording")。该测试对 "clears the banner when a request succeeds" 的断言在新模型下即使实现退化(如作用域被忽略)也会通过——它已失去守卫力。
**裁决:TRUE**(仅测试债;建议改写为经由 `RetiredBy`/`errorMachineId` 的语义断言)。

---

## 已核查、判定干净/未发现问题的点(简列,免下轮重扫)

- **URL→机器提取**:`transportHealth.ts:31-40` 的 `/\/machines\/([^/]+)/` + `decodeURIComponent` 对全仓 URL 形态(`api/machines/{id}/...`,`api/urls.ts`)成立;roster 端点 `api/machines` 无尾段 → "local",与语义一致。未发现误提取路径。
- **"local" 被任意成功反驳**的守卫(`PiWebApp.ts:1026`)本身实现正确;问题在 B2 的上游(标记陈旧),不在守卫。
- **缓存/预取键**:`workspaceSessionsCache.ts:13-15`(machine\0path)、`machineKeys.ts`(`machineSessionKey` 用于 transcript 存储,`sessionController.ts:1543-1545`)、`cachedNewSessions.ts`(按 machineId+cwd 过滤)、`prefetchSession`(`sessionController.ts:1914-1929`,键含机器且失败即忘)——全部正确携带机器作用域。quick switcher 的浏览机器在每次打开时复位(`PiWebApp.ts:2432`),晚到的跨机器数据流受 `quickSwitcherBrowsingElsewhere` 把关。
- **MachineSwitcher 删除**:无残留引用(仅历史 research 文档提及,属既往记录,不属漂移);`audit-uiux-full.mjs:50` 的 contextSheet 触发确为 20×250ms 有界轮询,与 triage 描述一致。
- **interrupted-runs 的核心修复本身**(`sessionController.ts:1007-1016` 失败返回 `undefined`、成功采纳空记录)与 triage 决策 4 相符——问题只在 B5(横幅文案)与 B7(作用域)。
- `errorNotice.ts:23` 文档字符串中"两个 half 必须一起设置"的机制本身有效——失效的是 B4 列出的绕行者。

## 汇总

| # | 严重度 | 一句话 | 裁决 |
|---|---|---|---|
| B1 | P1 | round-17 triage 声称已修的 F1/F2 均未落地(死 coarse 地板 + 守卫首规则盲区) | TRUE(实测) |
| B2 | P1 | `errorNoticePatch` 漏 `errorMachineId`,通用路径的 transport 声明继承陈旧机器作用域 | TRUE |
| B3 | P2 | `lastScheduledError` 不随横幅离屏复位 + dismiss 不撤定时器 → 同文重入丢寿命或被提前掐灭 | TRUE |
| B4 | P2 | 14 处裸 `setState({error})` 旁路退役模型,`errorNotice.ts` 的不变量对它们为假 | TRUE |
| B5 | P2 | interrupted-run 横幅文案承诺自动解除,代码永不兑现 | TRUE |
| B6 | P2 | route-restore 门槛把任意 reader 通知读成"机器断了",健康机器闪假声明 | TRUE |
| B7 | P3 | interrupted-run 标记/横幅无机器作用域,晚到结果跨切换污染 | TRUE(低危) |
| B8 | P2/P3 | machine/workspace 行 unread dot=accent vs rail=purple;background dot 紫而 rail 无 | TRUE |
| B9 | P3 | 死导出 `renderSessionStateBadge` 的绿色 idle.unread 与紫词汇矛盾 | TRUE(无影响) |
| B10 | P3 | `operation-model.md` "已落地"清单与代码相反,自相矛盾;`notice.ts:70` 行号漂移 | TRUE |
| B11 | P3 | transportRecovery 测试仍按措辞建模,失去守卫力 | TRUE(测试债) |
