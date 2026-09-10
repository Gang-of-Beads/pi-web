# Round 29 收敛审阅 · Lane B —— 行为与数据：退役模型端到端 / interrupted-runs / 缓存键 / 切换后的状态

基线说明：任务给定 HEAD 2851f3fb；实际工作树在其后一个提交 5d09ff61（Start convergence round 29，仅 AGENTS.md/package.json 文档性改动，未触碰 client 源码），本报告全部行号对两者一致。本 lane 只读：未修改任何仓库文件；未运行 vitest / Playwright / 8505 探针（只读约束），结论来自源码阅读与只读 git 历史（log/show/diff）；未运行的验证如实声明。

## 结论摘要
4 个 TRUE 行为/数据缺陷（1 中等、2 中低、1 低）、2 个 TRUE 文档-代码漂移、1 个 guard 潜伏缝隙（无现行违例）、1 个已知已立案项的现状确认、1 个微小时序缝隙。重心：round-28 的 scope-switch clear-notify 决定在机器切换与浏览器 resume 路径仍未落地（loadProjects 无条件 clearErrorPatch）；三条产横幅路径把 web 进程自身的失败记到某台机器名下。

---

## B-1（Medium，TRUE）机器切换与浏览器 resume 仍然无声吃掉 reader-retired 横幅 —— round-28 owner 决定在这两条路径未落地

证据链：
- owner 决定注释：src/client/src/appState.ts:191-195（switching scope may not silently eat it —— 切换作用域不得无声吞掉横幅，回来时它还在）。
- 提交 0ae86be1（2026-09-10，Scope switches keep reader-retired failures visible; banners carry names）提交说明更强：leaving a workspace or machine no longer silently clears the banner。
- 但机器切换必然经过 loadProjects：src/client/src/controllers/machineController.ts:64（selectMachine 内 await this.projects.loadProjects()），而 loadProjects 第一步无条件清屏：src/client/src/controllers/projectController.ts:35（this.setState({ ...clearErrorPatch(), projectsLoad: "loading" })）。
- 同一 loadProjects 还被：boot（PiWebApp.ts:1198）、每次浏览器 resume（PiWebApp.ts:1243-1253 的 refreshAfterBrowserResume；BrowserResumeController 以 window focus 与 visibilitychange 触发，src/client/src/appShell/browserResumeController.ts:44-52）、remote-restore 阶梯内（PiWebApp.ts:1540）、retryProjectsLoad（PiWebApp.ts:2913）调用。

最小失败场景：读者在机器 A 上删除会话失败，横幅 Delete failed: …（reader-retired）在屏；切到机器 B —— selectMachine → loadProjects → clearErrorPatch，横幅消失；round-28 决定要求它回来时还在。甚至无需切机器：手机锁屏再点亮（window focus）→ refreshAfterBrowserResume → loadProjects → 横幅被吃，同一机器、同一工作区、无任何作用域切换。对照：workspace 切换（workspaceController.selectProject / selectWorkspace）不 clear，横幅存活 —— 同一 owner 决定在两条路径上行为相反。

裁决：TRUE（代码路径无任何守卫；且 src/client/src/controllers/machineController.test.ts:63 对 loadProjects 打桩 vi.fn()，恰好绕开真实 clear 路径，现有测试不可能发现）。

方向（产品语义归 owner）：load-start 不是一次退役事件。把 clearErrorPatch 移出 loadProjects 起点（失败时 catch 里 errorNoticePatch 自然覆盖；retry 场景由调用方清理自己的旧失败），或仅当旧横幅确属上一次 projects 加载失败时才清。

---

## B-2（Medium-low，TRUE）boot 的 projectsLoad-failed 分支给本地路由也立了 restore 阶梯，而两处守卫都规定本地永不进阶梯 —— 留下一条 reconnecting… 承诺无人兑现的横幅

证据：
- PiWebApp.ts:1205-1208：projectsLoad === "failed" 且深链带 projectId 时直接 deferRemoteRouteRestore(effectiveRoute) —— 无机器类型检查。
- 同函数另一入口 shouldDeferRemoteRouteRestore（PiWebApp.ts:1428-1435，:1431 本地直接 return false）与阶梯自身守卫 pendingRemoteRouteRestoreStillCurrent（:1582-1588，:1584 要求 machineId !== "local"）都把本地路由排除在阶梯之外。
- deferRemoteRouteRestore（:1498-1503）第一步 setRemoteRouteRestoreMessage（:1568-1580）即组合横幅「本机名 is unavailable; reconnecting… <health detail>」，noticeFromTransport(..., machineId = route.machineId ?? "local")（:1579）—— reply-retired、机器级、本地。

最小失败场景：深链指向本地 project；loadProjects 失败（web 进程 500 或 daemon 瞬断）→ :1205 进入 defer → 横幅「<本机名> is unavailable; reconnecting…」上屏；1s 后首次 retry → stillCurrent=false（本地）→ clearPendingRemoteRouteRestore 直接放弃（:1519-1527）。结果：没有任何东西在 reconnecting，承诺是假的；横幅只能等下一次 api/machines/local/* 成功（boot 已 return，未必再来）或读者手点 dismiss。round-25（3ec25d8d）刚为 interrupted-runs 修过同一形状的「承诺不可兑现」。

裁决：TRUE（入口缺 :1431/:1584 同款守卫，可直接对照；行为后果由 :1584 的早退保证）。

---

## B-3（Low-medium，TRUE）web 自有的机器名册失败被记到路由机器名下：exhausted 横幅的主体与证据主体不一致，且真正的治愈者（名册恢复）永远无法退役它

证据：
- 机器装载阶梯只对 remote 深链开启（PiWebApp.ts:1181-1188），但其中失败的读是 api.machines() —— api/machines 集合路由由 web 进程的 machines 插件（runs: "web"）自己应答（AGENTS.md:15-17；machineProxyRoutes.ts 只接带 :machineId 段的路径）。
- 阶梯耗尽：PiWebApp.ts:1474-1478 setRemoteRouteRestoreMessage(route, { exhausted: true }) → 「<路由机器名> is still unavailable.」，noticeFromTransport(..., machineId = route.machineId)（:1579）—— reply-retired、机器级。
- 阶梯总窗约 57s（REMOTE_ROUTE_RESTORE_RETRY_DELAYS_MS = 1s/3s/8s/15s/30s，PiWebApp.ts:252、:4162-4165）：一次超过 57s 的 web 更新/重启窗口即可触发。
- 退役语义：机器级 claim 只有路由到该机器的成功能反驳（PiWebApp.ts:1055-1060），而名册成功是 page 级（machineIdFromUrl 对 api/machines 无 machines/<段>/ 可匹配，transportHealth.ts:30-44）→ 永远无法退役这条横幅；boot 又在耗尽时被放弃（:1477 clear 后 return），恢复后没有 selectMachine 的 health 读来救。

最小失败场景：web 进程更新窗口超过 57s；期间读者停在带 remote 深链的页面；名册读取连续失败 5 次 → 「lab-mac is still unavailable.」（scope=lab-mac）上屏；web 恢复、页面恢复可用后，所有 web 自有读成功也不能退役它；lab-mac 本身可能一直好好的。claim 的主体（lab-mac 的链路）不等于证据的主体（web 进程的名册路由）。

裁决：TRUE（范围归属错位，可由 transportHealth.ts:30-44 与 :1579 直接对照）。方向（owner 裁量）：名册失败属 page 级 claim，机器名横幅只能由机器级证据（health/runtime 失败）支撑。

---

## B-4（Low，TRUE，潜伏 —— guard 缝隙，当前树未发现现行违例）pointerQueryOrder 守卫只查同一选择器的第一处后续重复，且从不检查元素选择器

证据：src/client/src/components/pointerQueryOrder.test.ts
- :25 SELECTOR 正则要求 raised 选择器以 . 或 # 开头：媒体块内的 button { … } 这类元素选择器永远不会被当作 raised 检查。
- :74-79 laterMatch = repeated.exec(after) 只取第一处后续重复；若第一处无共同属性（无害）、第二处才覆盖同一属性（有害），守卫放行。

最小失败场景（构造性）：媒体块内 .x { min-height: var(--pi-control-height-touch); }；其后 .x { color: … }（第一处，无共同属性，查后放行）再加 .x { min-height: 36px; }（第二处，有害）—— 手机上 36px 落地而守卫绿。与 round-18 修掉的 first-rule 盲区同族（那次也是锚点少看一处）。

裁决：TRUE（正则与 exec 单次匹配语义直接可证）；严重度 Low（guard 自身盲区；本次未在全树找到现行违例，故标潜伏而非现行）。

---

## B-5（文档-代码漂移，TRUE）孤儿注释：interruptedRunsUnknown 旗标在 round-26 被删，注释活了下来，如今贴在毫不相干的 unreadSessionIds 头上；round-19 triage 第 8 条在 HEAD 已不成立

证据：
- PiWebApp.ts:302 注释写「Whether the last interrupted-runs read failed; a flag, not a wording match」，:303 却是 @state() private unreadSessionIds —— 注释描述的字段不存在。
- git：00220101（Round 26）的 diff 只删了 private interruptedRunsUnknown = false; 一行，注释行留在原地（diff 上下文可见），从此挂到下一个字段上。
- HEAD 的实际收回路径是措辞匹配：PiWebApp.ts:806（this.state.error === INTERRUPTED_RUNS_UNKNOWN_MESSAGE 时 clearErrorPatch）—— 与注释 not a wording match 相反；宣布在 :792，守卫在 :786。
- docs/design/review-triage-uiux-round19.md:34（第 8 条：unknown banner 的收回跟踪旗标、非措辞匹配）在 HEAD 为假：round-25 先把旗标变成 write-only，round-26 连旗标带门一起换成 plan + 措辞匹配（两轮提交说明可证）。

失败场景：下一个读者按注释或 round-19 找旗标，找不到；或据注释推断收回是机器感知的（旗标从未带机器维度），而实际是全局措辞匹配。这是 round-18 页面记录过的「fix 脚本吃掉代码、留下断言」事故的又一次变体。

裁决：TRUE。修法：删除该注释，或在 refreshInterruptedRuns 写清「收回 = 本特性私有文案（INTERRUPTED_RUNS_UNKNOWN_MESSAGE 为模块私有常量，无第二生产者）的同一性匹配」，并给 round-19 页补勘误。

---

## B-6（文档-代码漂移，TRUE）renderErrorBanner 注释宣称机器/工作区切换会经 reset 清掉横幅 —— reset 恰恰（按 owner 决定）不清；真正清掉它的是 B-1 的 loadProjects，且只清机器切换、不清工作区切换

证据：
- PiWebApp.ts:3834-3837 注释：A machine or workspace switch clears the banner through the reset; holding the old context banner across the switch would replay a complaint about a place the reader has left…
- resetWorkspaceScopedState 已不含 error 三元组（appState.ts:167-175 的 Pick 列表、:191-195 注释，0ae86be1 有意移除）；contextKey 分支（:3839-3845）只重置 hold 记账（bannerShownAt / lastScheduledError / lastScheduledMachineId / heldErrorBanner），state.error 仍在 → bannerHoldDecision 见 next !== "" 返回 show → 旧文案立刻在新上下文原样重画。
- 实际在机器切换时清横幅的是 loadProjects（B-1），与 through the reset 无关；工作区切换则完全不清。三方（注释、代码、owner 决定）互斥。

失败场景：读者按注释理解行为（切换 = 横幅随 reset 消失），在 workspace 切换后看见旧上下文的失败横幅仍压在新上下文顶端；或据此把行为「修齐」成切换必清 —— 直接推翻 owner 决定（appState.ts:191-195）。

裁决：TRUE。修法：改写注释（reset 只重置 hold 记账；横幅本体是否存活见 appState 的 owner 决定与 loadProjects 的现状），或推动行为与注释对齐 —— 但那是产品决定。

---

## B-7（现状确认，非新发现）round-28 已立案的「web 进程自答的机器命名空间路由（缓存 health 200 ok:false）被当作机器存活证明」在 HEAD 仍然活着

证据：src/client/src/api/http.ts:47-50 —— reportTransportReachable(url) 在判定 status/body 之前对任何响应触发；api/health 命中 web 进程快照缓存时同样触发并 vouch 该机器。docs/design/review-triage-uiux-round28.md:66-73（Pending with the owner）已记录该缝（banner flashes for one round trip and vanishes；词汇决定归 owner）。本 lane 确认 HEAD 未修、仍待裁定；不计为新缺陷，防止重复立案。

---

## B-8（Low，TRUE，时序相关、现行难复现）bannerDismissedByReader 的一次性消费可能把同批到达的新错误吞掉一个渲染周期

证据：PiWebApp.ts:3846-3855 —— 该分支无条件 return null 并消费掉本次渲染。dismiss 处理器（:3881-3892，置 flag + setState(clearErrorPatch())）与下一次渲染之间，若恰有 in-flight 请求的 controller setState 写入新错误（同一渲染批次），新横幅在这一帧被吞，要等下一个状态变化才上屏。

失败场景：读者点 dismiss 的同一毫秒，某个 30s 截止的请求恰好落选并写入新失败 → 新横幅延迟到下一次轮询渲染才出现（通常几百 ms 内自愈，故标潜伏/low）。裁决：TRUE（依代码可证；未运行时复现）。修法：该分支在 state.error !== "" 时不 return null，改走正常 show 路径。

---

## 交互警告（写给将来修 B-1 的人）：B-1 修好后，interrupted-runs 的收回会立刻跨机器误清

PiWebApp.ts:786 的守卫只保证成功读属于当前所选机器；:806 的措辞匹配不带机器维度（B-5）。今天跨机器场景被 B-1 的 loadProjects 清屏意外掩护（切机器时横幅先被清）。一旦按 owner 决定修 B-1（横幅跨机器存活），机器 A 失败读立起的 Interrupted-run status is unknown 会被机器 B 的成功读清掉 —— claim 撒谎。修 B-1 时应同步给收回加机器维度（未知横幅也带 errorMachineId=A，收回要求 readMachine === A），interruptedRunsReadPlan 的 resolveUnknown 语义按机器展开。

---

## 已核对为一致的主要声称（不立案）

- noticeFromError 的 HttpError 先判分支与 machineId 携带（notice.ts:97-108、errorNotice.ts:23-33）；machineDownNotice 组合命名横幅 reply+machine（machineController.ts:129-135、:154、:179、:195）。
- 6s 过期门检查 retiredBy（PiWebApp.ts:1095）加文案/机器/retiredBy 三重计时器守卫（:1097-1112）；替换自带新 hold/expiry（:3872-3880）。
- bannerHold 1.5s 窗：hold 中 dismiss 即隐藏、hold 中替换立即走 show、与新 lifetimes 组合无冲突（bannerHold.ts 全文、PiWebApp.ts:3856-3871）—— 除 B-8 微缝。
- interrupted-runs：loadInterruptedRuns 失败返回 undefined（sessionController.ts:1007-1014）；boot 读每页一次（PiWebApp.ts:773-777、:787；:1958 默认 boot 语义 vs :1977/:2513 显式 adoptEmpty:false）；失败只在安静屏宣布未知（:792）；markers 带机器进渲染（:4011）。
- 缓存/预取键全部带机器维度：workspaceSessionsCache（machineId+path，workspaceSessionsCache.ts:20-22）、cachedNewSessions（machineId 字段，cachedNewSessions.ts:17-44）、prefetch 键 machineId:sessionId 与 transcript 键 machineSessionKey 同构（sessionController.ts:1914-1930、:1543-1545）、workspaceSelection 用 machineProjectKey、terminalCommandRunRuntimes 用 machineScopedKey（PiWebApp.ts:1741-1752）；prefetch 只挂导航面板（PiWebApp.ts:2294），用调用时机器。
- XHR 上传成功为所触机器作证（workspaceUploads.ts:152；machineId 贯通 urls.ts:25-30 与 workspaceUploads.ts:266-272）；pluginBackends 显式 scope（pluginBackends.ts:66-70）；local 的 /api/plugin-backends 确为 daemon 代理（pluginBackendProxyRoutes.ts:15-27），vouch local 成立。
- machineIdFromUrl 的 %2F 解码、畸形转义不抛（transportHealth.ts:30-44）与 clearTransientError 的 page/机器 disproved 规则（PiWebApp.ts:1055-1060）一致；删除机器时按 scope 清 claim（machineController.ts:104-107）。
- round-17 五决定核对：retirement model；rail follows dot（shared.ts:439-458 源序即优先级，未读行类 rail 规则确已移除，machine offline danger 后置覆盖 unread :451-456）；MachineSwitcher 移除（src/ 与 pi-web-plugins/ 全树无命中）；contextSheet 有界轮询指向真实触发行（scripts/audit-uiux-full.mjs:50）；interrupted-runs；6s expiry。
- 自更新横幅 coarse 44px 地板：基础规则 PiWebApp.ts:199 在 coarse 块 :200 之前，round-18 的 really above 成立；round-18 claim 5/6/7/9 与代码一致；round-28 B-1 的五个 late-failure 写入选择守卫在场（sessionController.ts:724/:776/:809 等）。

## 验证声明

- 只读 lane：未修改任何仓库文件；仅运行只读 git（log/show/diff）与文件读取。
- 未运行：vitest 全套、Playwright/8505 探针、以及 B-1/B-2/B-3 的运行时复现 —— 裁决基于源码与 git 历史；B-4、B-8 标注为「未发现现行违例 / 未运行复现」，不谎称已复现。
