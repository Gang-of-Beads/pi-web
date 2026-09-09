# Round 17 收敛审查 — Lane B(行为与数据)

配置:分支 refactor/plugin-architecture,HEAD 0e40b77c。只读审查,未修改任何仓库文件。对照对象:5b63f491(round-15 九项修复)、d5e0de1e(round-15 跟进)、0e40b77c(round-16 十项修复)、docs/design/review-triage-uiux-round15.md 与 review-triage-uiux-round16.md。所有行号基于 HEAD 0e40b77c。

## 结论

**本轮不是 clean round:8 项 TRUE 发现(2 medium,6 low),另附 3 项被源码否决的候选(FALSE)。** round-15 的九项修复与 round-16 的十项修复在 HEAD 上逐项验证全部在场(见文末清单);以下发现全部位于该修复面之外或由修复本身引入的残留。

## 已验证在场、无发现的部分(抽查记录)

- 预取:sessionController.prefetchSession(src/client/src/controllers/sessionController.ts:1917-1930)按请求时的 machineId 键写 mergeHistory,失败即遗忘,存放位置与打开时的读取键一致;与 inFlight 共享同一 GET(http.ts:19-21),不会重复一次 round trip。
- inFlight 共享:仅 GET、按 URL 键(client URL 自带 machine 前缀,clients.ts:75-82),带 signal 的调用方不参与共享(http.ts:19-21),结算即删、失败也删(api/inFlight.ts:28-40),拒绝会送达每个共享方。
- 转录缓存:所有 merge/discard/cachedView 调用点都用 machineSessionKey 键;TTL、配额驱逐(永不驱逐正在写的键)、tail 截断与 mergeChatHistory 的 complete-replacement/sparse 守卫互相咬合,未找到 ghost 行路径。
- 隐藏标记级联:.working[hidden]、.compact-working[hidden]、.action-activity[hidden]、.drawer-body[hidden]、:host([hidden]) 五处 persistent mark 全部有 companion 规则,round-15 F1/F2 的模式没有漏网的活生产者。
- 跨切换状态:selectMachine/selectWorkspace/selectProject 全量清除 sessionStatuses/sessionActivities/sendingPrompts 并 resetWorkspaceScopedState;selectedChatIdentity 含 machineId,PiWebApp.updated 在聊天身份变化时清 dock 状态。
- 三份文档(operation-model.md、surfaces-as-plugins.md、phone-quality.md)对 in-flight 共享、prefetch、lazy surfaces、配额驱逐的描述与代码一致(唯一例外见 B7)。

## 发现

### B1(medium)状态 rail 的颜色映射与同一行上状态点自己的颜色表互相矛盾 — TRUE

- 证据:shared.ts:419-421 自述 rail 的颜色「from the state the row already reports」;shared.ts:433 把 .session-state.running 与 .session-state.asking 一并映射到 --pi-success(绿);但 sessionStateBadgeStyles.ts:32 asking 的点是 --pi-warning(琥珀),:39 running 的三个点是 --pi-accent(蓝,index.html:157),:37 unread 是 --pi-purple(index.html:172)。sessionRowIndicator.ts:17-21 的表格更自称「Priority and color are decided here and documented here」。
- 最小场景:读者正读某个 session(已读),agent 发起 ask_user 后读者切到导航面板:该行近看是琥珀色「Waiting for your answer」点,远看 rail 是绿色——扫描语义是 work in flight,与 blocking-on-user 恰好相反。同理 running+read 行是蓝点绿 rail,idle+unread 行是紫点蓝 rail;五个 session 态里只有 error(danger 对 danger)一致。
- 裁决:TRUE。该映射是 0e40b77c 写下的(修复 round-16 发现 1 时);machine/workspace 词表自身绿点绿 rail 一致,session 词表接上后颜色没有对齐。shared.ts:426-432 的注释解释了 specificity,却没有任何一句话解释为什么 asking 映射为成功色。若 green-for-running 是有意为之,asking 一例仍与产品语义冲突,且与该注释自称的「the one place this design spends colour on identity」相抵触。

### B2(medium-low)一次失败的 interrupted-runs 读取会把 daemon 仍持有的中断标记当成「无」采纳 — TRUE

- 证据:refreshInterruptedRuns(PiWebApp.ts:762-770)注释「Adopt the record verbatim, empty or not」;而 loadInterruptedRuns(sessionController.ts:1005-1007)在 catch 里返回**空集合**——失败与「daemon 说没有」共用同一个返回值,调用方无从区分,空集被 verbatim 采纳。
- 触发点:首连(PiWebApp.ts:1882)、每次 reconnect(PiWebApp.ts:1899,恰恰发生在 daemon 重启之后)、每次打开 quick switcher(PiWebApp.ts:2432)。
- 最小场景:daemon 重启 → socket 重连 → refreshInterruptedRuns 的读取超时或闪断 → catch 返回空 → 本次重启亲手造成的中断标记(hollow ring)从 switcher 上消失,直到某次成功的重读才回来。失败被当成否定采纳,与本仓库成文的「absence is not negation」规则以及该函数自己的注释(空读 = retraction)都矛盾——失败的读取不是 retraction。
- 裁决:TRUE。代码早于本 wave(471df5f4,2026-08-19),但位于本轮受审的 quick-switcher 打开路径上,且 round-15/16 均未覆盖。

### B3(low)读者未做任何操作,一次上下文切换就抹掉 reader-retired 的 lazy-load 失败横幅 — TRUE

- 证据:lazy surface 失败横幅经 errorNoticePatch(new Error(...))(PiWebApp.ts:1752)落为 RetiredBy.reader(notice.ts:70-71:非 HttpError、非 Timeout → noticeForReader),契约是「Only the reader can retire it」;但 resetWorkspaceScopedState 带 error: ""(appState.ts:189),在 selectProject/selectWorkspace/selectMachine 时无条件执行(workspaceController.ts:42、55、76;machineController.ts:60)。
- 最小场景:Settings 块加载失败 → 横幅「Settings could not load … reload to get it」;读者不关横幅,直接切了一个 workspace → 横幅消失,而「面板打不开、需要 reload」的事实原封未动。下一次点击 Settings 会重试并重新种回横幅,但在那之前屏幕与状态相反。
- 裁决:TRUE(机制已核实)。定级 low:若把全局单槽 error 的「上下文切换 = 新上下文」视为既定设计,此项是设计张力而非新缺陷;但它与 reader-retired 的字面契约冲突,而 round-15 B3 与 round-16 发现 4 修复的正是同一横幅的生命周期诚实性。

### B4(low)openSettings 的 docstring 描述一种代码并未采用的加载策略,并与 lazySurfaces 的总设计自述相反 — TRUE

- 证据:PiWebApp.ts:1757-1760「The dialog module is loaded before it is shown. Rendering the element first would put an empty frame on screen」;但紧接着的代码是 fire-and-forget 的 openLazySurface 加立即 settingsOpen = true,模板(PiWebApp.ts:3912)在模块到达之前就渲染 settings-dialog(未升级的 unknown element,视觉上什么都没有)。lazySurfaces.ts:1-9 写的是相反且实际生效的设计:「The open path is fire-and-forget: the surface renders as soon as its flag is set」。两段文档不可能同时为真。
- 最小场景:冷缓存下点 Settings,元素先渲染、后升级;docstring 许诺的先加载后显示并不存在,其 empty-frame 论据对 unknown element 也不成立;读代码的人被引导向一个不存在的实现。
- 裁决:TRUE(stale docstring;行为与 lazySurfaces 一致)。同类树对话框(session-tree)的 render-then-fill 路径没有这句反向注释。

### B5(low)客户端侧 activityBadge 的五个渲染/分类函数已无任何生产调用方,却仍由自己的测试文件供养 — TRUE

- 证据:src/client/src/components/activityBadge.ts:19(renderActivityIndicator)、39(statusActivityKind)、48(hasStatusUnread)、83(renderSessionStateBadge)、111(renderActionActivityIndicator)在 src/client/src 全树的非测试代码中零调用;存活的 import 只有类型与常量(sessionRowIndicator.ts:2、QuickSwitcher.ts:10、ChatView.ts:24、PiWebApp.ts:23、SessionList.ts:17、quickSwitcher.ts:3)。activityBadge.test.ts 仍完整断言这些死函数的「unread-ring 包住 working 点」的组合行为。
- 最小场景:下一位贡献者要给某行加状态点,搜到 renderSessionStateBadge 与它的绿灯测试,直接采用——恰好复活 sessionRowIndicator.ts:8-12 注释所记载、已被 arbiter 废除的「two rings in a slot meant for one mark」缺陷,且测试全绿。round-16 在同一文件族里清了 dead sending rail 规则和 unstyled ring class,却留下这组死的渲染生产者。
- 裁决:TRUE(grep 全树核实,非测试引用为零)。

### B6(low)unpaired error 生产者的补录范围写的是「controller-level」,但同一缺陷类也存在于 shell 组件与 wave 文件内 — TRUE

- 证据:round-16 triage(review-triage-uiux-round16.md:56-58)把该类 deferred 为「controller-level unpaired error producers … the sites predate this wave」。但 setState({ error: ... }) 不带 errorRetiredBy 的生产者同样遍布 shell:PiWebApp.ts:853、861、1503、2559、2577、3274、3296、3372、3416、3606。
- 最小场景(双向):上一条 reply-retired 横幅被清除后 retiredBy 残留 reply,读者一次操作失败写入「Action failed: …」(PiWebApp.ts:3416,unpaired)→ 下一次 socket 重连的 clearTransientError(PiWebApp.ts:1014-1024,经 1889 行调用)把这个 reader 事实擦掉——正是 round-16 修复过的「unrelated success erases a real failure」。反向上 setRemoteRouteRestoreMessage(PiWebApp.ts:1503)写入的是 transport 语义的「…is unavailable; reconnecting…」,却可能带着残留的 reader 标记,机器恢复后永不被 clearTransientError 撤回,横幅活得比它描述的失败久。
- 裁决:TRUE(机制与行号均已核实;若 deferral 有意覆盖全部 pre-wave 站点,本条降级为 triage 措辞与文件范围的偏差)。

### B7(low)round-16 triage 的 deferral 指针悬空:自称记录在 surfaces-as-plugins,该文档里并没有 — TRUE

- 证据:review-triage-uiux-round16.md:51-55「recorded in surfaces-as-plugins」;surfaces-as-plugins.md 全文 234 行,无 section focus contract、per-surface refs 的任何记录;该 deferral 实际只存在于 triage 页自身与原始车道报告 docs/design/research/r16-lane-c.md:41-58。
- 最小场景:owner 按 triage 指针打开 surfaces-as-plugins.md 找这条 owner-track 决议,找不到,track 静默丢失。
- 裁决:TRUE(文档指针失效;低危,补一段即可闭合)。

### B8(low)rail 自己的设计注释仍许诺「an upload」有颜色,而给 upload 上 rail 的规则已在同一 wave 里作为死代码删除 — TRUE

- 证据:shared.ts:420「work in flight, an upload, something unread」;0e40b77c 删除了 .action-row:has(.activity-indicator.sending) 的 warning 规则(triage:dead sending rail rule,no producer inside a row),现存规则(shared.ts:433-439)没有任何 upload/sending 分支;唯一的 sending 生产者(SessionList.ts:318)也确实不在 .action-row 内。
- 最小场景:读 listStyles 的人按注释预期 uploading 行有琥珀 rail;规则里没有,注释许诺了规则不给的东西。
- 裁决:TRUE(同块注释与规则漂移;纯文档级,一行注释可闭合)。

## 被否决的候选(附裁决,供 triage 汇总)

1. 疑点:loadSurface 残留 Promise<void> | undefined 死返回类型与 ?. 调用(round-15 B3 第一次修复的残留)。**FALSE** —— HEAD(lazySurfaces.ts:35、49)已是 Promise<void> 与 void loadSurface(...),d5e0de1e(round-15 follow-ups,即 triage lane C 所称 leftover declaration)已清理;疑点来自 5b63f491 的 diff 而非 HEAD。
2. 疑点:quick switcher 跨机器浏览时 quickSwitcherLoading 可能永久卡 true(旧机器 load 的 finally 因机器已切换而跳过清除,新机器 load 又命中新鲜度早退)。**FALSE** —— browseQuickSwitcherMachine(PiWebApp.ts:2536-2544)先置 quickSwitcherMachineId = undefined 再发起加载,新鲜度早退(loadQuickSwitcherData:2478-2483)在其后不可能命中。
3. 疑点:transcript 收缩(compaction)后 mergeChatHistory 会在 start=0 之外留下 ghost 行。**FALSE** —— isCompleteReplacement 与 hasSparseEntries 双守卫(chatHistoryCache.ts:157-193)覆盖收缩加部分页两种形状,稀疏直接退回 incoming。

## round-15/16 修复在场核验(逐项)

R15:F1 working[hidden](AppContextBar.ts:86-88);F2 插件 activityBadge 的 markKind(pi-web-plugins/machines/browser/activityBadge.ts:40-44 与 workspaces 同文件)与 idleMarkHonesty.test.ts;F3 .compact-fold 真盒(AppNavigationPanel.ts:594-596);F4 tile path 行高(shared.ts tiles small 的 line-height);F5 collapsed footer 对齐 --pi-chat-gutter(PromptEditor.ts);B1 树对话框加载移出 render(PiWebApp.ts:663-671 加 lazySurfaces.ts);B2 prefetch 机器键(sessionController.ts:1927);B3 横幅退役(PiWebApp.ts:1739-1756);B4 prefetch 失败遗忘(sessionController.ts:1921-1924)。R16:1/2/3 rail 三条(shared.ts:433-439);4 成对 producer(PiWebApp.ts:1750-1755);5 settings 路由 willUpdate 宣告(PiWebApp.ts:672-677);6 detail-copy coarse 24px(shared.ts:398-399);7 machines 列表 hidden 退查(MachineList.ts:73,与 Project/Workspace 一致);8/9 死规则清除与 --pi-rail-width 声明(index.html:90);10 boxModelGuard 第二形态真报(boxModelGuard.test.ts)与 CommandPicker、MachineSwitcher 的 box-sizing 修复。全部在场。
