# Round 30 — Lane A（几何与契约）审查报告

- 仓库：/Users/hanxiao.du/Desktop/vincent/projects/pi-web，分支 refactor/plugin-architecture。任务给定基准 HEAD c4b23328；实际工作区在 cab1fe20（"Start convergence round 30"，仅新增未跟踪脚本/清单并改动 AGENTS.md、package.json，均不触及受审面），c4b23328 在其父链上。所有 file:line 以当前树核对。
- 本 lane 焦点：pointer-query 顺序、盒模型、触摸地板、间距/字号字面量、级联与规则顺序陷阱、rail 优先级。
- 结论：**6 项 TRUE（1 项 Medium-low 且纠正上一轮的一处错误再裁决；1 项潜伏 guard 盲区扩展；1 项同族残余；2 项在案 repeat 的现状确认；1 项文档第四次复发且 round-29 的"已修"只落了一半）**。rail 优先级、触摸地板机械顺序、盒模型抽算、字面量等本 lane 主检区全部干净（清单附后）。

---

## F1【TRUE · Medium-low · 新发现，并纠正 r28 的一处错误再裁决】TerminalSoftKeys 的软键按钮被后采纳的宿主表压到 32px/UI 字体 —— 且 r28-lane-a 对该 finding「36→32 已不成立」的再裁决是错的

证据（逐条核对当前 HEAD）：

- `pi-web-plugins/terminal/TerminalSoftKeys.ts:94` — 自有 `button { box-sizing: …; min-height: var(--pi-control-height-comfort); … padding: var(--pi-space-3) var(--pi-space-5); font: var(--pi-text-xs) var(--pi-font-mono, …); touch-action: pan-x; … }`（(0,0,1)）。
- `pi-web-plugins/terminal/TerminalSoftKeys.ts:89-92` — `createRenderRoot` 先 `super.createRenderRoot()`（装入 static styles），再 `adoptTerminalHostStyles(root)`；`pi-web-plugins/terminal/hostUi.ts:41-45` — `root.adoptedStyleSheets = [...root.adoptedStyleSheets, ...sheets]`，sheets = `[hostUi.surfaceStyles, hostUi.workspacePanelStyles]`（即 `interactiveSurfaceStyles` + `workspacePanelStyles`，`src/client/src/plugins/pluginHostUi.ts:34,38`）→ 数组序 = [自有, interactiveSurfaceStyles, workspacePanelStyles]，宿主表在后。
- 获胜的后置同特异性规则：`src/client/src/components/shared.ts:166`（workspacePanelStyles）`button { box-sizing: border-box; min-height: var(--pi-control-height); font: var(--pi-text-xs) var(--pi-font-ui); … padding: var(--pi-space-3) var(--pi-space-4); … }`；`src/client/src/components/shared.ts:33`（interactiveSurfaceStyles）`touch-action: manipulation`。token 值：`--pi-control-height:32px / comfort:36px / touch:44px`（`src/client/index.html:103-105`）。
- 逐属性结局：min-height **36→32**、font **mono→UI**、padding **6/10→6/8**、touch-action **pan-x→manipulation**。TerminalSoftKeys 自身无任何 coarse 地板（全文件 grep `pointer: coarse` 零命中）。
- 只在手机出现：`pi-web-plugins/terminal/TerminalPanel.ts:734`（base `terminal-soft-keys { display: none }`）→ `:736-739`（`@media (pointer: coarse), (max-width: 760px)` 内 `display: block`）。

最小失败场景：393×850 手机（coarse）打开工作区终端、点开软键条 → 每个键（Esc/Tab/Ctrl…）实高 **32px**——低于作者声明的 36 comfort、更低于本仓自己写下的 44px 触摸约定（`shared.ts:329-331` tile 豁免注释、`index.html:101-103` 注释都是这个档位的在案文字）；键帽以 UI 字体而非声明的终端等宽字体渲染。这正是整套 coarse-floor 程序要防的事故类别，只是机制换成了「跨 adoptedStyleSheets 的后到同特异性覆盖」。

对台账的更正：`docs/design/research/r28-lane-a.md:52` 称「其 '36px comfort 变 32px' 的表述按现码已不成立——own `min-height: comfort` 无后到冲突，现活冲突是字体/内边距/touch-action 三项」。该再裁决**为假**：它把覆盖表记成 listStyles，而 TerminalSoftKeys 实际采纳的是 `workspacePanelStyles`（`hostUi.ts:43` 明写），其 `button` 规则自带 `min-height: var(--pi-control-height)`——r23-lane-a.md:19-24 的原始逐属性表（含 36→32）才是对的。

裁决：**TRUE**（级联机制为规范行为，三方印证：自有表→追加宿主表→同特异性后者胜；与 r23 原表一致）。scope 说明：terminal 插件严格说不在 round-17 受审面内，但 r26 起守卫 root 已含 pi-web-plugins，r28/r29 的 lane 文档均把该 cascade family 当 live family 处理；round-29 triage 把「Host stylesheet order」挂起给 owner——本条的价值除了缺陷本身（手机上 32px 触控目标），还在于 ledger 里 r28 的再裁决需要按事实更正，否则下一轮会沿错误基线继续。

## F2【TRUE · low · 新实例（r29-F1「预留跟随绘制」同族）】SessionTreeNavigator 的 tree 行给 disclosure 预留 20px 首列，coarse 却把它画成 24px

证据：

- `src/client/src/components/SessionTreeNavigator.ts:551`（桌面）`.tree-row { grid-template-columns: 20px minmax(82px, auto) minmax(0, 1fr) auto; … gap: var(--pi-space-4); }`；`:624`（≤760px）`grid-template-columns: 20px minmax(0, 1fr)` —— 两个变体的首列 track 都按基础绘制约 20px 预留。
- `:563-566` — `@media (pointer: coarse) { .disclosure { width: 24px; } … }`（round-18 加的 AA 地板，`:559` 基础宽 20px）；`:570` — `.tree-row > .disclosure { grid-column: 1; grid-row: 1; }`。

盒模型实算：track 20px + gap 8px（space-4）；coarse 下 item 24px → 右溢 4px 进入 gap，kind 列起点 28px 处不变 → **今日无碰撞、剩 4px 呼吸**；但 track 中心(10px)与控制中心(12px)错位 2px。

最小失败场景：coarse 打开 session tree 对话框任意行 → disclosure 可视盒越出自己 track 4px、在 8px gap 里吃掉一半；今后任何把该 gap 收窄到 ≤4px 的改动（如 space-4→space-2）立即变成重叠，而「预留 20 / 绘制 24」这组数字没有任何一处把它绑在一起——与 r29 刚修掉的 SessionList 沟槽（c4b23328「预留跟随绘制」）是同一形状，本文件没有对应处理。

裁决：**TRUE**（纯推导，无运行时复现）；low（今日 4px<8px，不重叠、AA 由绘制盒满足）。

## F3【TRUE · low · repeat（r24-lane-a F2 / r29-lane-a F3，仍活；family 已由 round-29 triage 挂起给 owner）】MachineList 的两条必输死声明未随 r29 修复落地

证据（当前行号核对）：

- `pi-web-plugins/machines/browser/MachineList.ts:258` — `:host { display: block; min-width: 0; }`；`shared.ts:233` — listStyles `:host { display: flex; flex-direction: column; … }`。adopt 序 = [MachineList 自有, interactiveSurfaceStyles, listStyles]（`MachineList.ts:64-68` + `pi-web-plugins/machines/browser/hostUi.ts:40` 追加在后）→ 同特异性后者胜，`display: block` 永不生效（`min-width: 0` 共享表没有，存活）。
- `MachineList.ts:262` — `.machine-row { border-radius: var(--pi-radius-lg); }` vs `shared.ts:354` `.action-row { … border-radius: var(--pi-radius-md); … }` —— 同为 (0,1,0)、后采纳者胜 → lg 圆角死亡（`:263` 的 `.machine-row.no-actions .action-main` 因 `.action-main` 无 border/background 实际也不可见）。
- `git show c4b23328 -- pi-web-plugins/machines/browser/MachineList.ts`：round-29 修复只改了 renderAdd 的可达性注释（:189-198），:258/:262 未动。

最小失败场景：下一位编辑者按 `:258` 依赖块级行为或按 `:262` 期待 12px 圆角——所读非所跑；round-28 的 updates-panel 实测故障（commit 2851f3fb 记录「lost the specificity tie against the adopted host sheet」）证明该形状会造成真实故障。

裁决：**TRUE**（机制 r23/r24/r29 三轮在案一致，本轮只做现状核对）。明确标注：**repeat，非新发现**，triage 状态 = pending-with-owner（"Host stylesheet order (fourth live instance recorded round 28)"），本轮确认其仍未修。

## F4【TRUE · low · repeat（r23-lane-a F1 次要实例，仍活）】MachineDialog 裸 `button { font: inherit }` 被后采纳的 listStyles 压成 12px，同族 ProjectDialog 却因选择器写法幸存 —— 同一插件族一输一赢

证据：

- `pi-web-plugins/machines/browser/MachineDialog.ts:131` — `:host { … font: var(--pi-text-base) … }`（14px）；`:145` — `button { font: inherit; … }`（(0,0,1)）。
- `MachineDialog.ts:15` + `pi-web-plugins/machines/browser/hostUi.ts:38` — 追加采纳 `[surfaceStyles, listStyles]`；`shared.ts:341`（listStyles）`button { font: var(--pi-text-xs) var(--pi-font-ui); … }`（(0,0,1)，后到）→ footer 的 Cancel / Add machine 以 **12px** 渲染，声明的继承意图静默丢失。
- 对照：`pi-web-plugins/workspaces/browser/ProjectDialog.ts:376` 写成 `.dialog button { font: inherit; … }`（(0,1,1)）→ 赢回继承。同族两个对话框，一个被覆盖一个没有。

最小失败场景：打开 Add machine 对话框 → 动作按钮 12px 与表单 14px 正文、header 的 text-xl 混排；而 Add project 对话框同位置是 14px —— 同一词汇表在同一屏的两个对话框上读数不同。

裁决：**TRUE**；repeat（r23-lane-a.md:28 在案），family pending-with-owner；本轮确认仍活并补充了「ProjectDialog 幸存」的对照组（说明修法应是统一提特异性或改 adopt 序，owner 裁决）。

## F5【TRUE · Low · 潜伏（扩展 r29-lane-b B-4 的 guard 台账）】pointerQueryOrder 守卫仍有两类「raised 但不被检查」的结构盲区，并新增一处「later 块首规则逃逸」

证据（`src/client/src/components/pointerQueryOrder.test.ts`）：

- `:20` — `SELECTOR = /(?:^|\})\s*(?<selector>[.#][\w-][^{}@]*?)\s*\{/gu` 要求 raised 选择器以 `.`/`#` 开头：元素选择器与 `:host` 的 raised 地板整条跳过。现行「raised 但不被守卫看见」的实例（全树逐一核对过，均无 live 违例）：AuthDialog.ts:275（`header button`、`… input`）、SessionCleanupDialog.ts:252（`button, input.days`）、SessionRenameDialog.ts:42（`footer button, header button`、`input`）、ModelPicker.ts:296（`header button`）、CommandPicker.ts:127-128（`header button`、`input`）、MachineDialog.ts:152-154、ProjectDialog.ts:361/366/378、ActionPalette.ts:111/129（`header button`、`kbd`）、tasksPanelElement.ts:300（`button`）、QuickSwitcher.ts:409 与 SessionList.ts:697（`:host`）。AuthDialog.ts:276 是唯一「coarse 块之后又出现同元素 base 规则」的活体（`input { margin; border; … }`）——恰好未重声明 min-height，所以潜伏。
- `:65-66,70-72` — round-18 的 "first rules" 修复只落到**被检块内部**（`inside = slice(open + 1, …)`）；对 `after` 段的重复定位用 `(?:^|\})\s*selector\s*\{` —— 后续任何块（如 `@media (max-width: 760px) {`）的**第一条**规则前面是 media 的 `{` 而非 `}`，逃过匹配；块内第二条起才可见。即：coarse 地板之后若出现「某个后续 media 块的第一条规则重声明同一选择器同一属性」，守卫绿、手机上地板被吃。top-level 紧随其后的一条不受影响（slice(end) 以 coarse 块自己的 `}` 开头，`(?:^|\})` 命中）。

最小失败场景（构造性，非现行）：`@media (pointer: coarse) { .x { min-height: var(--pi-control-height-touch); } }` 之后任何位置出现 `@media (max-width: 760px) { .x { min-height: 36px; } }` 作为该块第一条规则 → ≤760px 的 coarse 设备渲染 36px，守卫绿。

裁决：**TRUE**（正则语义可证）；潜伏、Low、无现行违例 —— 与 r29 B-4 的「latent, no live offence」同判，但 B-4 台账只记了元素选择器与 exec-首匹配两类；`:host` 类与 after-段首规则逃逸是本条新增，建议 ledger 合并记档（守卫属测试代码，修否由 triage 决定）。

## F6【TRUE · low · 文档 · 同一缺陷第四次出现，且 round-29 的"已修"只落了一半】capability-map-draft.md 仍把已删除的 MachineSwitcher 当 live 违例引用，且 MachineList 引用已漂移

证据：

- `docs/capability-map-draft.md:242` — "delete the QuickSwitcher 240/140 pair **and the MachineSwitcher leftover 140/6px pair**" —— 对 b0bce2a0 已整文件删除的组件下达删除指令，本行无历史注。
- `docs/capability-map-draft.md:247` — "Exact violations to fix against those rules: … `MachineSwitcher.ts:303,309` (third grid), …" —— 同一行里的 Historical note 只covers 140/6px pair，`:303,309` 引用仍以 live 口吻列出。
- 同文件 :231 表行 "MachineList rows | min-height: 58px (own override) … | C:../../pi-web-plugins/machines/browser/MachineList.ts:243" —— 现行 :243 是 `this.onRemove…`，实际规则在 :270 且已 token 化为 `var(--pi-row-min-height)`（56px，`index.html:93`），"58px" 数值与行号双漂移。
- round-29 triage（docs/design/review-triage-uiux-round29.md "Fixed (lane C) F7"）宣称 capability map 的 MachineSwitcher 复发"fixed beyond the one line round 27 touched"——diff 只清了 :231 与给 :247 加了半条历史注；:242 的指令与 :247 的 `:303,309` 引用是残余。复发链：r25-lane-b B-7 → r27-lane-c C12（只修一行）→ r29-lane-a F4（修 :231+半条注）→ 本轮。

最小失败场景：owner 按 :247 的 "Exact violations to fix" 清单执行 → 打开不存在的 `MachineSwitcher.ts:303`；或按 :231 找 58px 行高证据 → 行号与数值都不对。

裁决：**TRUE**；low（纯文档），但属同一缺陷第四次出现、且与上一轮"宣称已修"的差距正是 round-18 头条事故的类型。倾向本轮直接清 :242/:247 的两处引用并把 :231 的 58px→`var(--pi-row-min-height)`（56px）、:243→:270 更新（修否属 triage）。

---

## 核对为干净的区域（本 lane 实际跑过的检查）

1. **rail 优先级组合矩阵（对照当前规则全表重扫，非沿用 r29）**：`shared.ts:439/446/447/448/449/450/456` 七条 `:has(:where(…))` 全部 (0,1,0)、源序即优先级 unread/background < session-success < running < asking < terminal < error < machine-health，与 b0bce2a0 宣示及 task 简报一致；行级 (0,2,0) 覆盖（archived/selected、SessionList `.bulk-selected`）在案且有注释声明 "co-owned, not table-exhaustive"（`shared.ts:429-432`）。可组合态逐一走查：unread-ring 复合由被环点决定（`shared.ts:429-436` 注释 ↔ 两份 `activityBadge.ts:36-48` 实现一致，b0bce2a0 时曾入紫规则的 `.unread-ring` 已按 round-18+ 语义退出紫规则）；offline/error 行的 work dot 被 `MachineList.ts:160-167` 置空，与「health outranks unread」的位置注释互证；`.activity-indicator.sending` 只出现在无 rail 的 `.pending-session-row`（`SessionList.ts:323/748`），与注释一致；arbiter 单点保证（`sessionRowIndicator.ts:46-56`）使 session 行内 session-state 各规则两两不可组合。
2. **c4b23328 的 SessionList 沟槽修复算术复核**：coarse 预留 = 6+44+8 = 58（`SessionList.ts:762/770`，`--pi-row-gutter-size` 现为 touch，`:697`），绘制开关右缘 6+44 = 50（`:758/774`）→ 8px 呼吸；selecting 公式 6+10+24+6 = 46 vs checkbox 16..40（`:777`）→ 6px 呼吸 —— 与 :755-757 的「one breathing step」契约相符，r29-F1 修复在位且自洽。
3. **pointer 顺序机械复扫**：src/client/src + pi-web-plugins 全部 `@media (pointer: coarse)` / `(hover: …)` / `(hover: none)` 块（grep 全量清单），逐块查「raised 选择器文本在块后被同选择器 base 重声明同属性」——0 命中；Guard 的 round-18/19 两步修复（first-rule、多条件 media）在位（`pointerQueryOrder.test.ts:20,26,65`）。
4. **触摸地板抽查（round-17 面 + b0bce2a0 面 + 本轮新查的文件）**：`.error .error-dismiss`/`.self-update-banner button`（PiWebApp.ts:190→200，coarse 在 base 后——round-18 修复仍在位）；AppContextSwitcher `.add`（base→coarse 相邻，:110 区）；ContextSwitcherSheet `.sheet-close`（coarse 紧随 base）；AppNavigationPanel `.compact-header-action`（coarse 后无 base 重声明）；QuickSwitcher 全套（:508-516、:522、:525，均为「coarse 在 base 后、无后到 base」）；SessionList 末位 coarse 块（:801-808 后无 base）；ChatView drawer（:168-176 注释与实际顺序相符）；CommandPicker/ModelPicker/AskUserCard/SessionCleanupDialog/SessionTreeNavigator/SessionRenameDialog/ActionPalette coarse 块均在其所提升 base 之后。`.detail-copy` fine 18/coarse 24（shared.ts:379-380）维持 r16/r17 在案裁决。
5. **`?hidden`/`.hidden`/`hidden` 伴生规则**：6 处 markup 站点（AppNavigationPanel.ts:188→:450、:361→listStyles `:host([hidden])` shared.ts:238、AppContextBar.ts:61→:89、ChatView.ts:1154→:163、两份 activityBadge.ts:42→shared.ts:393）+ 3 处插件 `.hidden=`（machines/workspaces pi-web-plugin.ts:23/24/48，经采纳的 listStyles `:host([hidden])` 生效）+ relays 的两处 imperative `hidden`（relaysPanelElement.ts:286/318 → :509 伴生）全部有伴生，无新裸站点；c4b23328 扩展后的 designTokens 守卫（双 root、双 hidden 语法）在位（designTokens.test.ts:96-125）。
6. **盒模型抽算（非 r29 已算部分）**：tile 角标数学 fine（menu 6..38、dot 42..50、padding 右 54）与 coarse（menu 4..40、dot 44..52、padding 右 56）两支各留 4px，与「one row of corner affordances」的推导注释一致；QuickSwitcher `.row-flag/.row-state` 右偏移的 -1px 为边框校正，居中成立；AppNavigationPanel compact 头 44px 三件套（panel-header-height/control-height/touch）与 token（index.html:97-98）一致且 designTokens 测试钉住；`.error` 条（padding 10/16 + 44px dismiss，flex-start）无盒冲突。
7. **字面量**：round-29/30 三个修复 commit 的 CSS diff 无新的失守字面量（typeScale/spacingScale/dotScale 三守卫域内）；唯一新见的 `font-size: 0`（ChatView.ts:416）是 glyph 折叠技法、非比例字；`SessionTreeNavigator` 的 `20px/82px/48px` 属 grid-track 结构值，spacing 守卫的属性清单本就不辖 `grid-template-columns`。
8. **audit 脚本**：`scripts/audit-uiux-full.mjs:50` 的 contextSheet 触发器现按 aria-label "Change machine, project or workspace"（AppNavigationPanel compact-scope）匹配并带 20×250ms 有界轮询 —— 与 b0bce2a0 宣称一致。

## 标注为推测的观察（不立案）

- F2 的 4px 溢出在真实设备上的视觉显著性未实测（无 8505 探针运行）；裁决基于 token 代入的静态推导。
- F1 的实际渲染高度按「min-height 胜出、内容 ~27px < 32px」推得；未在浏览器实测 computed style —— 但级联归属（哪条规则赢）不依赖该实测。
- `.machine-status` 角点 6px vs `.session-state` 8px 的跨表差异维持 round-27 以来的 pending-owner 状态，非新发现，不重复立案。
