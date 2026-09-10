# Round 31 — Lane B（行为与数据）：退休模型端到端 / interrupted-runs 诚实性 / 预取缓存键 / 跨切换状态

审查对象：PI WEB @ refactor/plugin-architecture，工作树 HEAD 31560179（round-31 起点；任务书写的 45691527 是 round-30 修复提交，本轮在其之上复审）。只读审查，未改动任何仓库文件。

方法：通读 notice.ts / errorNotice.ts / errorBanner.ts / bannerHold.ts / transportHealth.ts / http.ts 全文，追完每个 errorNoticePatch / noticePatch / clearErrorPatch 调用点（含 machineController / sessionController / projectController / workspaceController / authController / PiWebApp），并对照 docs/design/review-triage-uiux-round17/18/19/30.md、operation-model.md 与 .changeset/banner-retirement-model.md、round-eighteen-audit.md。round 20-30 的 research/ 文档已入账事项只做核对，不重复上报。

## 一、核对成立的主干（抽验通过，不作为发现）

- 三字段成对写入的契约成立：全仓库 app 状态的 error 写入只经 errorNoticePatch / noticePatch / clearErrorPatch（src/client/src/errorNotice.ts:25-38）；grep 未发现绕过者（settings 与 sessionCleanup 的 error 是对话框私有状态，不进 appState）。
- HttpError 分支按消息证据分类并携带机器戳：src/client/src/notice.ts:102-103（transport 与 reader 两分支都传 error.machineId，round-30 F3 修复在位）；RequestTimeoutError 经 machineIdFromUrl(error.url) 带机器作用域（notice.ts:108-109）。
- reportTransportReachable 在状态码判定之前触发（src/client/src/api/http.ts:47-50），作用域取 URL 中的机器段（src/client/src/api/transportHealth.ts:26-40）；两条 fetchWithDeadline 腿（clients.ts:379-384、409-413）失败时以 HttpError(…, 0, machineId) 补上机器戳、成功时也上报可达。
- clearTransientError 的作用域判定（PiWebApp.ts:1055-1074）：page 声明被任何应答驳倒，机器声明只被该机器的应答驳倒；清除同时重置 schedule 标记对与定时器。
- 6s 过期同时检查 errorRetiredBy 与措辞裁决（PiWebApp.ts:1085-1125），与 changeset errata 一致；定时器回调用 text + machineId + retiredBy 三重身份核对，防止同名新声明被旧钟清掉。
- interrupted-runs：loadInterruptedRuns 失败返回 undefined（sessionController.ts:1007-1016）；interruptedRunsReadPlan（interruptedRunsRead.ts:19-26）failed / adoptMarkers / resolveUnknown 三态齐备；记录与 boot-read 标记按机器分存（PiWebApp.ts:302-303），switcher 按 selectedMachineId 读取（PiWebApp.ts:4036），browsing-elsewhere 时全量置空（PiWebApp.ts:4030-4045）。
- 切换 stale 守卫：refreshInterruptedRuns 先行 selectedMachineId 复核（PiWebApp.ts:786）；refreshMachineHealth / refreshMachineRuntime 有 seq + selection 双守卫（machineController.ts:141-156、161-180）；transcript 与 draft 缓存统一 machineSessionKey 键（sessionController.ts:1543-1545）。
- rail 与 dot 的一致性由单点仲裁结构性保证：sessionRowIndicator.ts:11-27 的排名（asking > running > unread > error > background > idle）每行只渲染一个 session-state 类，shared.ts:439-458 的 rail 规则只能看到仲裁选中的那个类，两者不会对同一行给出两种颜色；machine-status offline/error 的 danger 规则置于最后（shared.ts:456），与注释 health-outranks-unread 一致。
- MachineSwitcher 删除无残留：src/ 与 pi-web-plugins/ 中无 machine-switcher 引用；AppNavigationPanel 的 query(machine-list) 指向插件渲染的真实列表（AppNavigationPanel.ts:115、121、494）。

## 二、发现（每条附 file:line、最小失败场景、判定）

### F1【中等偏低】round-30 F3 的读者机器戳修复停在 noticeFromError，手工组合的 noticeForReader 调用点把机器戳再次丢掉 —— 判定 TRUE

证据：
- 修复本体：notice.ts:102-103 已让 reader 分支携带 error.machineId；单会话 archive / archiveWithDescendants / restore / reload / detach 走 errorNoticePatch(error)，戳在位（sessionController.ts:845-846、862-863、1118、1132、1144）。
- 但以下组合点调用 noticeForReader(文本) 时不传 machineId，即使手里的 error 是携带 .machineId 的 HttpError：
  - sessionController.ts:881 `Archive failed: …`（批量归档）
  - sessionController.ts:905 `Delete failed: …`（批量删除归档会话）
  - sessionController.ts:1540 applyBulkSessionFailures 的 `… failed for N sessions: …`
  - sessionController.ts:1701 `Failed to start session: …`（failPendingSessionStart，pending.machineId 在手却不传）
  - PiWebApp.ts:3406 `Failed to start workspace removal: …`（机器作用域操作）

最小失败场景：读者在机器 B 批量归档会话，B 的网关对 bulk/archive 返回 500 → 横幅 Archive failed: … 为 reader-retired、errorMachineId=page；读者随后删除机器 B → machineController.deleteMachine 的退休身份测试（machineController.ts:107，errorMachineId === machine.id）永不匹配 → 关于 B 的失败横幅在 B 删除后仍存活并显示在机器 A 的屏幕上。这正是 r30-lane-c F3 点名的场景（a failed archive on machine B outlived B itself）；round-30 的 fixed 条目只封闭了 noticeFromError 一条腿，组合腿未扫。同屏不同命：单会话归档失败带戳（删 B 时被一并退休），批量归档失败不带戳。

建议方向：给上述组合点补 machineId 参数（戳已在 error.machineId / pending.machineId / 局部 machineId 里）。

### F2【中等偏低】recreateCachedNewSession 在 await 之后缺少机器守卫，可把选中态整体拽到另一台机器 —— 判定 TRUE

证据：src/client/src/controllers/sessionController.ts:1781-1800。入口捕获 machineId（:1783），但 await api.startSession(session.cwd, machineId) 之后：moveDraft 用 sessionCacheKey（:1543-1545，按**实时** selectedMachineId 取键）、setState 把 replacement 前插进当前 sessions 列表（:1789）、然后无条件 await this.selectSession(cachedReplacement)（:1792）——三处都没有 selectedMachineId(machineId) 复核。姊妹路径全部有守卫：resolvePendingSessionStart 用 isCurrentPendingStart（:1713-1716，比对 selectedMachineId === pending.machineId），applyReleasedCreatedSessions（:1769）与 refreshCurrentWorkspaceSessions 亦有守卫。

最小失败场景：
1. 读者在机器 A 点击一个 cached-new（此前 start 失败的）会话行 → selectSession 的 join 404 → 进入 recreateCachedNewSession，startSession 对 A 在途（网关慢）。
2. 读者切到机器 B 并开始读 B 的会话列表。
3. startSession 返回：A 的新会话被前插进 **B 的** sessions 列表；A 的 composer 草稿被 move 到 **B 的** draft 键下；随后 selectSession(cachedReplacement) 关闭读者正在看的 B 会话 socket，把 selectedSession 换成 A 的会话，并以 B 的 URL 前缀去 join A 的会话 → 404 横幅加跨机器错选。

判定 TRUE。触发窗口需要 start 在途期间完成一次机器切换，概率低但后果是跨机器状态污染（正是本 lane 猎区）。建议方向：continuation 开头补 selectedMachineId(this.getState()) !== machineId 即 return（丢弃或延后重建）。

### F3【低】machineDownNotice 把回答形 HttpError 一律组合成传输声明 —— 判定 TRUE（低危，场景罕见）

证据：src/client/src/controllers/machineController.ts:129-135：只要 error instanceof HttpError 且 machineId 非 undefined 就无条件组合 `X is unavailable; reconnecting… <detail>` 并 noticeFromTransport(…, machineId)。分类只看异常血统，不看消息证据——与 notice.ts:81-95 自述的模型（An HTTP status is an answer… Retirement follows the evidence in the message, not the exception pedigree）相悖。health/runtime 失败里 502 与网关标签确实是传输声明（组合正确）；但 500 / 401（web 进程或远端网关**应答了**）按 round-17 决策 1 应为 reader-retired，却被改写成未应答的措辞：composed 文本不被改写、无 6s 过期（errorBanner.ts:58-63 的 composed 规则）、永久样式，只能靠该机器的下一次成功应答或读者退休。

最小失败场景：机器 B 的 pi-web 网关活着但对 /api/machines/b/health 返回 500（其健康检查自身抛错）→ 读者看到 `B is unavailable; reconnecting… Internal Server Error`——B 明明应答了；横幅为 reply + machine 作用域、永久样式，直到 B 的下一次健康成功才退休。

判定 TRUE（低）：health/runtime 失败多数确是传输故障；此条只覆盖应答形 5xx 的错分类。与 round-30 pending 的 vouching 事项（非 2xx 也 vouch）相邻但不同层：那是上报侧，这是分类侧，均未入账处置。

### F4【低】文档-代码漂移：round-17 决策 5 的措辞未随 round-22 实现修正回写 —— 判定 TRUE

证据：docs/design/review-triage-uiux-round17.md:62 写 decided by the retirement model, not by matching the wording；实现在 PiWebApp.ts:1102-1103 同时检查 errorRetiredBy === reply **与** normalizeTransientError(error) !== undefined。修正说明只存在于 .changeset/banner-retirement-model.md 的 ERRATA（the six-second expiry gates on BOTH the retirement mark and the wording verdict (round 22)），round-17 文档本身无对应勘误。同理 round-18 文档（review-triage-uiux-round18.md 第 16-17 行 Error reporting now always travels with its retirement mark and machine scope）在 round-30 F3 揭示 reader 分支丢戳之前是过强声明，round-18 页无勘误指向 round-30。

最小失败场景：后续收敛轮的 lane 只读 round-17/18 文档推导契约，会把 6s 过期条件推错（以为只看退休标记），或认为 reader 失败天然带机器戳——两处都会产生假阳性发现；capability-map 的行号引用腐化（round-30 F6 第四次复发）已是同类教训。

判定 TRUE（低，文档）。建议：把 changeset 的 errata 一句抄进 round-17 页决策 5 与 round-18 页对应行。

### F5【低】r30-lane-c F4 的显示侧残端未处置：机器作用域横幅的文本不带机器名，跨切换后被错归属 —— 判定 TRUE（低）

证据：r30-lane-c（docs/design/research/r30-lane-c.md 第 150-166 段）F4 场景的后半句（banner asserts something about a machine the reader is no longer looking at, and the message itself never says which machine）在 round-30 triage 的 fixed / pending / deferred 任何一栏都没有——fixed 条目只收编了退休身份那一半（round-30 triage F4：机器戳移到 state）。现状代码：INTERRUPTED_RUNS_UNKNOWN_MESSAGE 不含机器名（PiWebApp.ts:250）；失败分支的 quiet-screen 守卫（PiWebApp.ts:792-797，if (this.state.error === "")）使 B 的失败不取代 A 的未知横幅；退休身份按 errorMachineId 匹配（:813-815）但文本对读者完全匿名。同类：被缩短的传输声明（A request timed out. Polls retry on their own. / Lost connection to PI WEB. Reconnecting…，errorBanner.ts:76-88）——reply + machine 作用域、匿名文本。

最小失败场景：读者在机器 A，A 的 interrupted-runs 读失败 → 横幅（reader、scope=A）；读者切到机器 B（横幅按 owner 决策存活）；B 侧一切正常，读者把屏幕上的 Interrupted-run status is unknown 读成 **B** 的状态未知——而它的退休只等 A 的成功读；B 侧没有任何可见线索说明这是 A 的声明。

判定 TRUE（低）。这与项目自身的数据必须携带作用域原则在显示层有缺口：state 带了作用域，文本没带。建议方向：机器作用域 reader 横幅在文本中具名（machineDownNotice 已做对），或作用域切换时对匿名 reader 横幅降级或清除——归 owner 决策。

### F6【低，良性方向】作用域切换的 hold 记账重置会顺带重启 6s 过期时钟 —— 判定 TRUE（行为属实，影响良性）

证据：PiWebApp.ts:3862-3875：contextKey（机器|工作区）变化的分支重置 bannerShownAt / lastScheduledError / lastScheduledMachineId；随后的 show 路径（:3909-3912）因 error !== lastScheduledError("") 必然重新 bannerShownAt = Date.now() 并 scheduleTransientErrorDismissal → 可缩短声明（deadline / fetch 族）的 6s 时钟从**最后一次进入该作用域**起算，而非首次显示。注释只声明 hold 记账重置、横幅本身存活（:3863-3867），未声明过期时钟随之重置。

最小失败场景：机器 B 的 deadline 声明 t=0 显示（过期 t=6s）；t=3s 读者切换工作区 → 时钟重置至 t=9s；来回切换可无限推迟。与 round-30 deferred F4（同名替换继承旧钟剩余寿命）方向相反、不重复：那条是缩短，这条是延长。退休仍由该机器的应答治理，实际风险是横幅比文档承诺的 6s 更长寿，方向保守。

判定 TRUE（低、良性）。若 owner 在意 6s 是硬寿命，需把过期基准改为随状态 travels 的首次显示时间戳，而非渲染私有。

## 三、已入账、本轮不复审为发现的事项

- reportTransportReachable 对任何非 2xx 也 vouch 该机器（web 进程应答不等于机器应答）+ fleet sweep（refreshMachineHealthFor / refreshMachineRuntimeFor，machineController.ts:182-198）静默吞掉本可重新 raise 的失败 —— round-30 triage Pending with the owner 已录（machine-namespace vocabulary）。
- 同文替换继承旧过期钟剩余寿命（≤6s）—— round-30 deferred（需 producer 侧 claim nonce）。
- QuickSwitcher fetch race、手机 add-machine 入口、context sheet 的 ≥2 机器规则、宿主样式表顺序、collapse-toggle 链、row-fold —— round-30 pending 列表在案。
- deadline 不咨询 socket liveness（operation-model.md Still open 在案，notice.ts:36-38 注释一致）。
- bannerDismissedByReader 一次性消费的吞批与复活边界 —— r21/r22/r23/r29 各 lane 已反复裁决，现行结构与结论一致。

## 四、结论

本 lane 不干净：6 条发现（F1/F2 行为与数据类，F3/F6 模型缝，F4/F5 文档与显示诚实性），全部给出 TRUE 判定；本轮无被否掉的怀疑需要剔除——r30-lane-c F5（local 声明不可驳倒）经复核维持 FALSE 结论（clients.ts:77 的 machinePrefix 无条件带 /machines/local/，所有本地调用都按 local 作用域上报）。退休模型主干（分类、作用域、过期、hold、interrupted-runs 三态）自洽且与文档声明一致；剩余缝隙集中在 round-30 修复波的半途（F1/F5）与一条此前各轮未覆盖的跨机器续行路径（F2）。
