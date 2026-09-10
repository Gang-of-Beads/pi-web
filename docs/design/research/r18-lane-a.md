# Round 18 · Lane A（几何与契约）评审报告

范围：branch `refactor/plugin-architecture`，HEAD `b0bce2a0`。焦点：指针查询顺序、盒模型、触控地板、间距/字号字面量、级联与规则顺序陷阱、rail 优先级；外加 round-17 surface 上 b0bce2a0 触碰的几何/契约文件（shared.ts、PiWebApp.ts 横幅区、AppNavigationPanel、machines 插件）与 docs-vs-code 对账（review-triage-uiux-round17.md、两份 changeset）。

方法：逐文件读源 + 级联/特异性算术 + 两份修正版扫描脚本（/tmp/pqo-scan.mjs、/tmp/pqo-scan2.mjs，未入 repo）+ 实跑结构守卫（pointerQueryOrder、boxModelGuard、designTokens、tokenReferences、spacing/type/dot/radius/controlHeightScale、interactiveSurfaceContract：9 文件 58 用例全过）+ 实跑 banner 生命周期测试（errorBanner / transportRecovery / bannerHold / errorNotice / notice：43 用例全过）。只读，未改任何仓库文件。

结论先行：**本 lane 不是干净轮。9 项 TRUE 发现（2 项高、2 项中、5 项低），其中两项是"上一轮声称已修复、实际未修复"的回账项**。round-15/16 的几何修复（[hidden] 伴生规则、折叠按钮 44px、tile 行高、detail-copy coarse 24px、--pi-rail-width 声明）在 HEAD 逐项复核在场。

---

## TRUE 发现

### F1（高 · 级联/规则顺序 · 回账）self-update 横幅按钮的 coarse 44px 地板仍是死规则 —— round-17 声称"Fixed by ordering"，但排序从未改变

- 证据：`src/client/src/components/PiWebApp.ts:205`
  `@media (pointer: coarse) { .self-update-banner button { min-height: var(--pi-control-height-touch); } .error .error-dismiss { … } }`
  紧随其后 `src/client/src/components/PiWebApp.ts:206`
  `.self-update-banner button { box-sizing: border-box; min-height: var(--pi-control-height); … }`
- 两个选择器完全相同（0,1,1），media 查询不加特异性，author 层按源序取胜 → :206 的 32px（`--pi-control-height`，index.html:103）在**所有**指针下获胜，:205 给横幅按钮的 44px 从不生效。同块内 `.error .error-dismiss` 的地板是对的（其基础规则 :203 在 media 之前）。
- 回账证据：`docs/design/review-triage-uiux-round17.md`（"Fixed in this wave" 第 1 条："**Fixed** by ordering"）与 `.changeset/round-seventeen-fixes.md`（"Both fixed"）都声称已修；但 `git diff 0a7f8439 HEAD -- src/client/src/components/PiWebApp.ts` 对该区域为零改动，行号与 r17-lane-a.md:62-68 报告时逐字相同（:205 media、:206 base），基础规则上次改动还是 round nine（3e45b97c）。
- 最小失败场景：手机（coarse pointer）打开带待更新的页面 → self-update 横幅的 "Update now / Skip"（:922 区域）与 stale-client 横幅的 "Reload"（:893 区域）实测 32px 高，低于同列 transcript 控件的 44px 地板；:203-204 的注释（"a 32px row here was a second touch floor"）宣称的正是这个修复。
- 裁决：**TRUE**（CSS 级联确定性成立；文档-代码漂移同条成立）。

### F2（中 · 守卫盲区 · 回账）pointerQueryOrder 的"首条规则盲区"仍未修 —— round-17 声称"Fixed in the guard"，守卫文件自我审查以来零改动；实跑证明守卫照旧放行 F1

- 证据：`src/client/src/components/pointerQueryOrder.test.ts:20`
  `const SELECTOR = /(?:^|\})\s*(?<selector>[.#][\w-][^{}@]*?)\s*\{/gu;` 与 :63-66
  `open = media.index + media[0].length - 1`（media 块自身 `{` 的下标）→ `inside = source.slice(open, end)` **恒以 `{` 开头**；锚 `(?:^|\})` 在位置 0 匹配 `^` 后 `[.#]` 撞上 `{` 失败，于是每块里的**第一条 raised 规则永远匹配不到**。
- `git log --all -- pointerQueryOrder.test.ts` 只有 d167533d（round nine）；646a0d5a 与 b0bce2a0 都没碰它 —— triage 第 2 条"**Fixed** in the guard"没有落地。
- 实证（本 lane 实跑）：`npx vitest run src/client/src/components/pointerQueryOrder.test.ts` 在 HEAD **通过**，而 F1 的违规真实存在于同一棵树 —— 正是 r17-lane-a.md:74-76 预言的共存互证。
- 附带盲区（扫描器核对，今日无活体）：(a) `repeated.exec(after)`（:70，非全局）只查**第一个**后置重复；(b) 选择器须以 `.`/`#` 开头，元素选择器（如 `textarea { min-height: 40px }`，PromptEditor.ts:101）不在守卫内；(c) MEDIA_BLOCK（:19）要求 `\)\s*\{`，多条件块 `@media (pointer: coarse), (max-width: 760px)`（PiWebApp.ts:175、AppPanelEdgeControl.ts:233、SettingsDialog.ts:781、pi-web-plugins/terminal/TerminalPanel.ts:736）整体不可见。用修正版脚本（首条规则修复 + 全部 media 块 + 元素选择器）全树扫描：**唯一**活体违规就是 F1。
- 裁决：**TRUE**（结构性证明 + 实跑复现）。

### F3（高 · 不完整删除 · 手机几何）"Dead mount removed"并未发生：header 挂载点存活，且删掉隐藏 switcher 后变成一块**始终可见的完整机器列表**，与主列表重复渲染

- 证据链（全部确定性代码路径）：
  1. b0bce2a0 只删了 `MachineSwitcher.ts`、其测试，和 AppNavigationPanel 里一行 CSS（`machine-switcher { flex: 1 1 auto; min-width: 0; }`）；
  2. 但挂载点没删：`src/client/src/components/appShell/AppNavigationPanel.ts:203` 仍调用 `this.renderMachineHeaderSwitcher()`，方法体在 :281-294 —— 给 machines section 构造 `display: { hidden: false, collapsible: false, collapsed: false, tiles: true, withCreate: false }` 并调用 `section.render(context)`；
  3. 插件侧 `pi-web-plugins/machines/browser/pi-web-plugin.ts:41` 现在无条件 `render: (context) => renderMachinesList(context)`，:20 传 `.hidden=${display.hidden}`（header 上下文里是 false）—— `machine-list` 不再带任何 hidden；
  4. `MachineList.ts:110-117` 渲染 `<section><h2>…</h2>` + 搜索框 + 全部行；header 上下文 `collapsible:false` 使 :201-203 返回纯文本标题 "Machines"；
  5. `AppNavigationPanel.ts:537` `machine-list, project-list, … { flex: 1 1 auto; min-height: 0; }` 给这块列表分走主区一半以上的高度。
- 同时主列表仍渲染同一 section：`renderCompactPrimaryList`（:237）`renderMachineSectionSlot(visible !== "machines")`，而 `compactVisibleSection()`（:265-267）在机器可见且未折叠时**默认返回 "machines"** → 两份完整机器列表同屏。
- 最小失败场景：393×850 手机、machines 插件（bundled 默认启用，piWebPluginCatalog.ts:301-306）、≥1 台机器（shouldShowMachinesSection 对 1 台即真，AppNavigationPanel.test.ts:27）→ 每个手机屏的 header 条下方都插着一块 "Machines" 标题 + 机器行列表；当 machines 是当前展开 section 时，同一份列表在 header 和 body 各渲染一次，会话列表被挤出首屏。b0bce2a0 提交信息与 `.changeset/banner-retirement-model.md` 都写"Dead mount removed"——挂载点其实还在，且从"永久隐藏"变成了"永久可见"。
- 连带：:275-280 的 docblock 仍写 "the element stays mounted but hidden for keyboard navigation, its own `:host([hidden])` contract" —— 描述的是已删除的 machine-switcher 的契约，对 machine-list 不成立（文档-代码漂移）。
- 裁决：**TRUE**（渲染链确定性成立；本项为源码推导，未跑浏览器 probe —— 如需 I 类证据可按 8505 栈补一条 probe）。

### F4（中 · rail 优先级/特异性 · 决策 #2 半实现）`.action-row.unread` 的 (0,2,0) 特异性压过全部 `:has(:where(...))` 规则 —— unread+working / unread+asking 行**近看蓝/琥珀点、远看紫 rail**，恰是决策 #2 宣布消灭的缺陷

- 证据：
  - `src/client/src/components/shared.ts:435-437`（b0bce2a0 新注释）："Source order is the precedence (equal specificity): unread < running < asking, matching the row indicator's own arbiter."
  - `shared.ts:439-444`：五条 `.action-row:has(:where(...))` —— `:where()` 零特异性，`:has()` 取其参数特异性 → 每条整选择器 (0,1,0)。
  - `shared.ts:445`：`.action-row.unread { border-left-color: var(--pi-purple); }` —— **(0,2,0)**，按特异性压过上面全部规则，与源序无关；:446-447 的 archived/selected 同理。
  - `SessionList.ts:398`：行类名里 `${unread ? "unread" : ""}` **无条件**跟随 `sessionRowUnread`（:393），不管仲裁器（sessionRowIndicator.ts:52-55：asking > running > unread）最终选了哪个点。
- 最小失败场景：
  - unread + working（上一轮产出未读、后台继续出活）：仲裁器渲染三连蓝点（`.session-state.running`，sessionRowIndicator.ts:69），rail 期望 :441 accent；实际 :445 紫色获胜 → 近看蓝、远看紫。
  - unread + asking（未读产出上又来了 ask_user）：仲裁器琥珀点（:52-53），rail 期望 :442 warning；实际紫色获胜 → 近看琥珀、远看紫。
  - changeset（banner-retirement-model.md）宣称 "so a row reads as one state at any distance" —— 这两类行不成立。
- 佐证矛盾记录：round-16 triage finding 2（review-triage-uiux-round16.md:19-22）明文 "selected, archived and unread now win over the work states"；新决策把 unread 在**点**词汇表里降级了，但让 unread 在 **rail** 上获胜的机制（行类规则）原样保留，新注释又宣称相反的优先级 —— 代码、注释、changeset 三者互不一致。
- 注：:445 目前是 `.action-row.unread` 唯一的非冗余效果（unread+idle/unread+error 行 :439 与其同色，仲裁器保证行内只渲染一个状态点）—— 即该规则的存活只服务于"压过 running/asking"这一个与决策相悖的行为。
- 裁决：**TRUE**（特异性算术 + 两处无条件类名生产者核实）。

### F5（低 · 调色板契约 / 死 CSS）`.session-state.idle.unread` 绿色规则无任何活生产者，且与仲裁器对同一语义态的紫色互相矛盾

- 证据：`src/client/src/components/sessionStateBadgeStyles.ts:14` `.session-state.idle.unread { background: var(--pi-success); }`；唯一合成该类名的代码是 `activityBadge.ts:93`（renderSessionStateBadge），而 r17-lane-b.md:47 已核实 core 全树非测试调用为零 —— HEAD 复核仍为零（grep `renderSessionStateBadge` 仅 activityBadge.ts 自身与测试）。仲裁器对同一语义（idle + 未读）渲染 `.session-state.unread` → 紫（sessionRowIndicator.ts:54-55、:71）。
- 最小失败场景：下一位贡献者按 activityBadge.test.ts 的绿灯示例采用 renderSessionStateBadge → 同一"已完成且未读"状态在两个 surface 一绿一紫，违反该文件自述契约（sessionStateBadgeStyles.ts:5-7 "the same state never reads differently in two places"）。
- 裁决：**TRUE**（死生产者 + 双表矛盾；低危，因生产者为零）。

### F6（低 · rail 缺色）background 态的点 wears 紫色空心环，rail 规则表没有它的名字 → 该行 rail 透明

- 证据：`src/shared/sessionActivityState.ts:37` `if ((status.backgroundRunCount ?? 0) > 0) return "background";` → SessionList 经仲裁器渲染 `.session-state.background`（sessionStateBadgeStyles.ts:15，紫空心环）；`shared.ts:439-444` 的 :has 规则只命名 unread/session/running/asking/terminal/error，无 background → rail 保持 :427 的 transparent。
- 最小失败场景：一个带后台任务、无未读的会话行：近看紫色空心环（"turn ended, children still running"），扫描距离下该行完全无 rail —— "rail wears the very colour the row's own dot wears"（shared.ts:420-424 新注释）在这一态不成立。idle 无 rail 是自洽的（灰点=无事）；background 的点带强色相（紫）而 rail 无色，不对称且无注释声明是有意的安静态。
- 裁决：**TRUE**（契约缺口；有意与否未记录，低危）。

### F7（低 · 收敛账目）r17 lane-A 两项已裁 TRUE 的发现（QuickSwitcher 行菜单裁切、会话树 disclosure 触点）从 triage 页面消失，且在 HEAD 仍然在场

- 证据：
  - r17-lane-a.md F3（:78-92，裁决 TRUE）：`QuickSwitcher.ts:484` `.row-menu { position: absolute; … }` 挂在 :405 `.body { … overflow: auto; … }` 滚动容器内；全应用其余行菜单均为 fixed + 视口约束（shared.ts:457）。HEAD 复核两行原样在场。
  - r17-lane-a.md F4（:94-101，裁决 TRUE）：`SessionTreeNavigator.ts:559` `.disclosure { width: 20px; … }` 是真实折叠控件（:150-158 有 `@click`/title），全文件 0 个 `pointer: coarse` 块（grep 计数为 0）；:539 close 按钮 coarse 下停留 36px（`--pi-control-height-comfort`），姊妹对话框（SettingsDialog:781、QuickSwitcher:496 区域）coarse 均为 44。HEAD 复核原样在场。
  - 而 `docs/design/review-triage-uiux-round17.md` 全文（59 行）对这两项零提及 —— 既不在 "Fixed in this wave" 七条里，也没有 deferred-with-reason。收敛流程要求"triage in writing (fixed / not-fixed-with-reason / judged-not-true) before fixing"，这两项的处置记录缺失，下一轮清点会漏掉它们。
- 裁决：**TRUE**（两项发现本身与账目缺失均经源码核实）。

### F8（低 · 生命周期契约）`lastScheduledError` 永不清零：同一文本的 reply-retired 横幅**第二次**出现起不再获得 6 秒寿命；`bannerShownAt` 不随替换重置，1.5 秒最短可见被前一条借用

- 证据：`src/client/src/components/PiWebApp.ts:3781-3785`
  `this.bannerShownAt ??= Date.now(); if (error !== this.lastScheduledError) { this.lastScheduledError = error; this.scheduleTransientErrorDismissal(error); }`
  —— :414 的 `lastScheduledError` 只被不同文本覆盖，横幅被清除（6s 到期、transport recovery、读者关闭）后不清零。
- 最小失败场景（模型偏差）：reply-retired 的 "X is unavailable; reconnecting…"（setRemoteRouteRestoreMessage → noticeFromTransport，:1518-1520）首现获得 6s 定时器并自然到期；同一机器、同一 health.detail 再次失败 → 文本逐字相同 → :3782 判等跳过调度 → 这次横幅**没有** 6s 寿命，只能等 transport recovery 或被替换。决策 #5（"only reply-retired claims expire on the timer"）对复现实例失效。危害有限（恢复事件通常兜底），但寿命变成了"自冷启动以来的第一次"的函数。
- 次要：`bannerShownAt ??=`（:3781）在替换时不重置 —— A 于 t=0 显示、B 于 t=1.4s 替换、B 于 t=1.5s 被撤 → B 实际可见 0.1s，1.5 秒最短可见是按"槽位"而不是按"消息"计的。
- 裁决：**TRUE**（两处均为源码可证的状态机缺口；低危）。

### F9（低 · 文档-代码漂移）`isTransientError` 的 docblock 仍许诺一个已被决策 #5 废除的用途，且导出已无生产调用方

- 证据：`src/client/src/components/errorBanner.ts:47-50` "Exported so the owner of the banner can let those expire on their own." —— b0bce2a0 从 PiWebApp 移除了 `isTransientError` import（只留 `TRANSIENT_ERROR_TIMEOUT_MS`），到期判定改为 `errorRetiredBy !== RetiredBy.reply`（PiWebApp.ts:1050-1052 区域）。现存调用方只有 errorBanner.test.ts 与 PiWebApp.transportRecovery.test.ts。
- 最小失败场景：读者按 docblock 理解"横幅按措辞自我到期"，与模型注释（"Expiry is a property of the retirement model, not of the words"，PiWebApp.ts:1048-1049）直接矛盾；措辞匹配现在只服务 `.transient` 着色。
- 裁决：**TRUE**（stale docstring + 测试供养的死导出；一行注释可闭合）。

---

## 已核查、裁决为 not-true / 无缺陷的疑点

1. **`.session-state.working` 无自身 CSS 规则** → not-true：working 徽标是 `.state-dots` 子元素的定心容器（sessionStateBadgeStyles.ts:21-22 place-items + 子点自带 accent 底色），盒子本身不需要颜色。
2. **ContextSwitcherSheet 在 switcher 删除后受影响** → not-true：sheet 上下文恒传 `tiles: false`（ContextSwitcherSheet.ts:59），插件删除 switcher 前后在该路径都渲染 machine-list，无变化。
3. **多条件 media 块（4 处）里藏死地板** → not-true（今日）：修正版扫描脚本覆盖全部 media 块与元素选择器后，除 F1 外全树 CLEAN；盲区已记入 F2 的守卫缺口，不是活体缺陷。
4. **tile 角标几何、QuickSwitcher 行内三连点溢出、`.drawer-control` 32px**（r17 已裁 not-true 的三项）→ 复核维持 not-true，未发现新证据。

## 修复复核（round-15/16 几何项 + round-17/18 声明项，均在 HEAD 验证）

- [hidden] 伴生规则三处在位：shared.ts:411、AppContextBar.ts:89、AppNavigationPanel.ts:493。
- `--pi-rail-width` 声明在位（index.html:90，3px）；结构守卫 9 文件 58 用例实跑全过。
- rail 调色映射本体（B1 修复）：running accent / asking warning / unread purple / session-activity success / terminal accent / error danger，与点调色板逐态一致（:439-444）—— 失配只发生在 F4 的组合态与 F6 的 background 态。
- fetch 族措辞锚定整条消息（errorBanner.ts:76-79 `^…$`）✓；远端路由横幅 detail 只取 health 读数（PiWebApp.ts:1515-1517）✓；audit-uiux-full 的 contextSheet 触发已带 20×250ms 有界轮询并指向 "Change machine, project or workspace"（scripts/audit-uiux-full.mjs:50）✓；AppNavigationPanel 的 machine-switcher 孤儿 CSS 行已删 ✓（但挂载点残留见 F3）；round-16 账目已补计数口径（round16 triage:69-72）✓。

## 裁决汇总

| # | 发现 | 裁决 | 严重度 |
|---|---|---|---|
| F1 | self-update 横幅 coarse 地板死规则（声称已修，未修） | TRUE | 高（回账） |
| F2 | pointerQueryOrder 首条规则盲区（声称已修，未修；实跑放行 F1） | TRUE | 中（回账） |
| F3 | header 机器列表挂载点未删，删除 switcher 后变可见重复列表 | TRUE | 高 |
| F4 | `.action-row.unread` (0,2,0) 压过 :has 规则，rail 决策 #2 半实现 | TRUE | 中 |
| F5 | idle.unread 绿点规则死代码且与仲裁器紫矛盾 | TRUE | 低 |
| F6 | background 态无 rail 颜色 | TRUE | 低 |
| F7 | r17 lane-A F3/F4 从 triage 页消失且仍活体 | TRUE | 低（账目） |
| F8 | lastScheduledError/bannerShownAt 不重置，复现横幅失去 6s 寿命 | TRUE | 低 |
| F9 | isTransientError docstring 许诺已废除的用途 | TRUE | 低 |
