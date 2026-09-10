# Round 30 — Lane B（行为与数据）：退役模型端到端 / interrupted-runs 诚实性 / prefetch 与缓存键 / 切换后的状态

审查对象：branch `refactor/plugin-architecture`，round-30 工作树（HEAD `cab1fe20`，含本轮 fixer 落下的未提交修改）。
审查期间工作树被并行修改（`notice.ts`、`components/PiWebApp.ts`、`components/errorBanner.ts` 出现未提交 diff）；以下每条发现都已按**当前树**逐行重验，行号为当前工作树行号。

---

## 发现 1（TRUE，属 round-28 已记录待 owner 裁决项的确认与收紧）— 网关失败应答会"替机器作证"，机器级掉线横幅被自己的 502 撤销

**锚点**
- `src/client/src/api/http.ts:50` — `reportTransportReachable(url);` 在 `if (!response.ok)`（http.ts:52）**之前**执行，注释理由是"a 500 from it disproves 'the link is down'"——但这对**页级**断言成立，对**机器级**断言不成立。
- `src/client/src/api/transportHealth.ts:49-56` — report 无 scope 时用 `machineIdFromUrl(url)` 从 URL 提取机器名，因此 `api/machines/lab/health` 的 **502** 也会以 `machineId="lab"` 上报"lab 可达"。
- `src/client/src/components/PiWebApp.ts:1062-1070` — `clearTransientError`：`disproved = errorMachineId === "page" || errorMachineId === machineId`，无法区分"来自机器的应答"与"网关替机器回答的失败"。
- 静默吞掉方（撤销后无人重新升起）：`src/client/src/controllers/machineController.ts:27-28`（loadMachines 后的 fleet 读取）→ `machineController.ts:218-228`（`refreshMachineHealthFor`/`refreshMachineRuntimeFor` 用 `Promise.allSettled`，拒绝被丢弃）；`sessionController.ts` 的 `hydrateSessionStatuses` catch 静默 return；`sessionUnread` 的失败只走 `console.warn`（`PiWebApp.ts:294-296`）。

**最小失败场景**（可静态推演，无竞态）
1. `machines.json` 含远程机 lab，lab 的 daemon 宕机（正是更新中断的常态）。刷新页面深链到 lab。
2. `loadMachines` → `selectInitialMachine`（machineController.ts:181-199）对 lab 健康检查得 502 → 升起组合式具名断言"lab is unavailable; reconnecting… <detail>"（reply+machine 作用域、无 6s 过期——round-28 owner 决议"banners carry names"的形态）。
3. 紧接着 `loadMachines` 第 27-28 行触发 `refreshMachineHealthFor/refreshMachineRuntimeFor`，对 lab 的每个 502 在 http.ts:50 上报 `machineId="lab"` → `clearTransientError("lab")` 把第 2 步的断言**当作 lab 的应答予以撤销**；allSettled 吞掉失败，无任何路径重新升起。
4. 结果：宕机期间这条"最常见横幅"只闪现约一个 RTT 后永久消失（除非走 ladder/手动 refresh），与 `errorBanner.ts` 当前未提交注释自述的契约"the machine's own answers … retire it"直接矛盾。

**裁决**：TRUE。非新发现——round-28 triage（`docs/design/review-triage-uiux-round28.md:68-74`）已把"200-with-ok:false 也被当作机器的存活证明 + 三条 no-re-raise 路径 + boot composed-claim flicker"列为**待 owner 裁决**，并给出第二原则"report only when the response truly touched the machine"。本轮确认该项在当前树**仍未落地**（http.ts / transportHealth.ts 本轮未改），并补充收紧：round-28 复现以"健康检查 200 但 ok:false"为中心，而 http.ts:50 的实现使**任何非 2xx**（502/504/500）都同样替机器作证——同一行、同一原则的第二个实例。

---

## 发现 2（TRUE，新）— 跨机器采用会永久逐出已在屏的 interrupted-run 标记，且注释自述的不变量被违反

**锚点**
- `src/client/src/components/PiWebApp.ts:765-770` — 模块不变量："a later read adopts new markers but **never erases the ones already on screen**"。
- `PiWebApp.ts:775-776` — `interruptedRunsBootReadDone` 是**页级单布尔**，而 daemon 记录是**按机器**的（`api/machines/<id>/sessions/interrupted`，clients.ts:265，read-and-clear）。
- `PiWebApp.ts:796-800` — `plan.adoptMarkers && ids !== undefined` 时**整体替换**单槽存储：`interruptedSessionIds = ids; interruptedSessionIdsMachine = machineId`。
- 唯一消费方按机器过滤：`PiWebApp.ts:4035`（quick switcher，`interruptedSessionIdsMachine !== selectedMachineId(state)` 时给空集）。

**最小失败场景**
1. 页面在机器 A 上启动，A 的记录含 {s1,s2} → boot read 采用，keyed A（bootReadDone=true）。quick switcher 中 s1/s2 显示中断标记。
2. 切到机器 B（`handleMachineChange` → `connectRealtime` → `refreshInterruptedRuns(B)`，PiWebApp.ts:2101/1978）。B 的 daemon 记录未花掉且含 {s9} → `ids.size > 0` 即采用 → **A 的标记被整体逐出**。
3. 切回 A：A 的记录已在第 1 步花掉 → 空集；`adoptEmpty = options.adoptEmpty ?? !bootReadDone = false`（PiWebApp.ts:786，且注释明确"re-entry must not wear boot semantics"）→ 不采用 → 集合仍是 {s9}（keyed B）→ 过滤后 A 显示**无中断标记**。
4. A 的 s1/s2 仍是被重启打断且未继续的会话，但本页生命周期内该线索永久消失——A 的记录已花，无任何读取可恢复。

**裁决**：TRUE（medium-low）。`interruptedRunsRead.ts` 的纯函数（failed/adoptMarkers/resolveUnknown）没有机器维度，单槽存储使 round-23/26 修复承诺的"never erases the ones already on screen"在跨机器场景下不可满足。诚实形态是按机器分槽（`Record<machineId, Set>`，与 `sessionUnread`/`cachedNewSessions` 的既有做法一致）。无组件级测试覆盖（`interruptedRunsRead.test.ts` 只测纯函数；与 round-23 记录的"deep-link boot race"defer 是两个不同问题）。

---

## 发现 3（TRUE，新，low）— 同一次网关宕机，因捕获的生产者不同呈现两套横幅契约（具名+常驻 vs 匿名+6s 过期）

**锚点**
- `src/client/src/controllers/sessionController.ts:1478-1481`（`refreshSelectedSession` 的 catch）与 `sessionController.ts:971`（`refreshCurrentWorkspaceSessions` 的 catch）— 都用 `errorNoticePatch(error)` 升起网关 502："Remote machine unavailable (…)"（`src/server/web/machines/machineProxyRoutes.ts:367`）。
- `src/client/src/components/errorBanner.ts:83-85` — wording 表把该文本**整条**改写为匿名"Reconnecting to the machine…"，且该 notice 是 reply+transient → 6s 过期（`PiWebApp.ts:1102-1103` 的双重门只放过被 wording 表改写的文本）。
- 对照：`machineController.ts:126-136`（`machineDownNotice`）把同一 502 组合为"lab is unavailable; reconnecting… <detail>"——具名、常驻（composed 不被改写、无过期）。

**最小失败场景**
1. 读者正在 lab 的会话里，lab daemon 中途死亡。
2. transcript 刷新（`requestSelectedSessionRefresh` → `api/machines/lab/sessions/…`）得 502 → catch 升起**匿名**"Reconnecting to the machine…"，6 秒后自动过期。
3. 具名版本永远不会出现：`refreshMachineHealth` 只在 boot/手动选择/ladder/名册加载时触发，中途宕机路径不含它；过期后横幅层归于沉默，读者失去"哪台机器"这一信息——正是 round-28（0ae86be1）决议要保住的事实。

**裁决**：TRUE（low，作为 round-28 "composed-named" 决议的未闭合残余：该决议明文只覆盖"health and runtime gateway paths"，listing/transcript 的 502 兄弟生产者未被纳入，同一证据类两种渲染+两种寿命）。

---

## 发现 4（TRUE，minor）— 相同文本的"替换式重升"不重置过期计时器，新断言继承旧断言的剩余寿命

**锚点**
- `src/client/src/components/PiWebApp.ts:3899` — schedule 门 `error !== lastScheduledError || errorMachineId !== lastScheduledMachineId`：仅当文本或机器变化才重排 6s 过期。
- `PiWebApp.ts:1071-1076` 注释承诺"a re-raised identical text - for the same machine or for the page - must re-arm its own expiry"——但该承诺只覆盖"先清除后重升"（marker 已被 clear/expire/dismiss 重置）的路径。

**最小失败场景**：T0 页级断言"Lost connection to PI WEB. Reconnecting…"升起并武装 6s 计时；T0+4s 另一次失败以完全相同文本**替换**（状态从未清空）→ 门判定相同 → 不重排 → 旧计时器在 T0+6 触发，第二个断言只活了 2s（模型承诺 6s）。

**裁决**：TRUE 但 minor（≤6s 的寿命漂移，"long enough to read at a glance"基本不受损）；同一轮询风暴下"清除后重升"路径已正确重置（round-22 item 4 / round-23 item 4 已修），本条仅是剩余的未覆盖路径。

---

## 与既有记录对表（避免重复报告）

- **round-23 deferred"restore ladder 把共享横幅当自己的信号"**：本轮 fixer 已在未提交树中改为 `this.state.projectsLoad !== "loaded"`（`PiWebApp.ts:1554-1557`），defer 项已闭合；我按旧逻辑推出的同一发现**作废**，改为确认修复在树中且方向正确（诚实信号本就是 `restoreBootRoute:1213` 在用的 `projectsLoad`）。
- **round-22 FALSE 名单中的"transcript cache scope / prefetch keys"**：本 lane 独立重验后同意原裁决——transcript store 的全部调用方都传 `machineSessionKey`（sessionController.ts:297、345、436、1127、1504、1926），prefetch 键含机器（sessionController.ts:1915-1931）；`chatHistoryCache` 自身 API 形参名叫 `sessionId` 但实收复合键，仅是类型命名松散，无行为缺陷。`cachedNewSessions`（逐条带 machineId）与 `workspaceSessionsCache`（键含机器）均合格。
- **本轮 fixer 的另外两处未提交修改已核验无回归**：unknown-banner 的机器戳从私有字段移到 state（`notice.ts:37-41` `noticeForReader(text, machineId?)`；`PiWebApp.ts:791-792、810-812` 的重traction 改为 `errorMachineId === machineId`）——`clearTransientError` 对 reader 级早退，故新戳不影响 report 清除路径；`deleteMachine` 的 `errorMachineId === machine.id` 检查现在也会连带清除该机器的 reader 级断言（含 unknown banner），语义合理（scope 已消失）。

## 已核验为净的区域（本 lane 范围内）

- 裸 `setState({ error })` 生产者：仅剩组件内局部字段（authController 的 authDialog、SessionTreeNavigator/settings 的局部 error），页面级三字段全部走 seam——round-18 item 8 的声明在当前树成立。
- `bannerHold` 与新寿命的交互：hold 分支清 transientErrorTimer、重置 schedule marker、contextKey 切换清 heldErrorBanner（PiWebApp.ts:3851-3860、3876-3892），dismissal one-shot 与"dismiss 期间新断言"路径均自洽（round-19 item 7 成立）。
- wording 表整条锚定（errorBanner.ts:69-86）、6s 过期双门（mark+wording，banner-retirement-model.md 的 ERRATA 与代码一致）、`machineIdFromUrl` 的解码容错（transportHealth.test.ts 全绿路径与实现一致）。
- AppNavigationPanel/MachineSwitcher 残留：`src/` 下无任何 `MachineSwitcher` 引用；machines 插件在 nav/sheet 两处统一经 `machineSections` 渲染 `machine-list`（pi-web-plugins/machines/browser/pi-web-plugin.ts:21-38、56）；audit 的 contextSheet 触发器带 20×250ms 有界轮询（scripts/audit-uiux-full.mjs:50）——round-17 决议 3 的声明成立。
- rail 规则与点色板的对应及优先级注释（shared.ts:439-453）与 sessionRowIndicator 仲裁器（单点保证）一致；机器行 offline/error 优先于 unread 的次序与注释相符。
