# Round C · Lane A — 手机 393×850 收敛复审（Round B 修复核验 + 全表面清扫）

评审对象：http://localhost:8505/（refactor/plugin-architecture @ 720b589c，Round B 修复波 1dde944d 已含在产物内）。
方法：Playwright 真机浏览（手机 393×850 hasTouch isMobile dpr2；桌面 1280×850、768×850 复核），全部间距/对齐/对比用 `getBoundingClientRect` + `getComputedStyle` 实测；按压态用真实 mouse-down-hold 读 computed background（正控组用 Round B 同款脚本复跑校准）；关键裁决用 CSSOM（`adoptedStyleSheets` 规则枚举）做机制级确认。未改仓库文件、未重启栈；脚本在 /tmp/roundc/，截图在 /tmp/roundc-lane-a/。

**本轮使命**：(1) 逐项核验 Round B 修复波是否"到达读者"；(2) 全手机表面清扫，门槛 = 除 owner 挂账（docs/design/review-triage-goal-round-b.md 末节）外零新增 TRUE。每条给出 file:line、实测数字、截图、TRUE/FALSE 裁决。

---

## 结论（先说）

**收敛未达成。** Round B 七项修复中 **三项未到达读者**（其中一项根本没进代码），另有一族同症状生产者仍未覆盖；Round B 自己判 TRUE 但既没修也没挂账的 4 项全部原样复测命中。共 **4 条新 TRUE + 3 条 Round B 遗留 TRUE**（其中 1 条部分被 Round A 挂账覆盖）。

---

## 一、Round B 修复核验总表

| Round B 声称修复 | 复测裁决 | 关键数字 |
|---|---|---|
| New-session 空态居中（min-height:100%） | ✅ 已到达（见 1.1，残差已量化） | 盒填满滚动区；内容在盒内精确居中 |
| Appearance 主题卡放开（button min-height） | ✅ 已到达（393+1280） | 卡高 183.1/193.1，主题名回到卡内 |
| Tasks/Relays 查看器填满面板 | ⚠️ 半到达：Relays ✅ / **Tasks ❌**（见 2.2） | Relays 空态居中 ±4.5px；Tasks 顶锚 y=122 |
| 五个新按压态 | ⚠️ **3/5 到达，AppNavigationPanel 一族 3 个全死**（见 2.1） | context-bar ✓ / QS close ✓ / drawer-tab ✓ / compact 三钮 ✗ |
| Extension 卡按钮边界 | ✅ 已到达 | 按钮 1px 边 rgb(58,66,78) + bg 对比 1.281 |
| Actions-row 读边 | ✅ 已到达 | header 带与 actions 带左右缘均 10..383，无 10↔6 跳变 |
| 消息头分隔线改实线 | ❌ **未到达：代码里根本没有这次修改**（见 2.3） | live 仍是 35% alpha mix，中性面 ≈1.02:1 |

### 1.1 New-session 空态（✅ 到达，附残差机制说明）
- 代码：`src/client/src/components/ChatView.ts:367` `min-height: 100%` 已在产物内；实测 computed `min-height: 100%`、盒 h=552.8（393）填满 `.chat`（y=90 h=560.8，padding 24/6/16）。
- 内容块（h2..button 并集）393: 上隙 227.9 / 下隙 286.9，中心偏上 **29.5px**；768 与 1280 同为 232.6/291.7、偏上 29.5px —— 三个宽度完全一致。机制：`min-height:100%` 使盒比内容区高 32px，滚动区被自动滚到底（scrollTop=32），盒顶被卷入 8px；内容在盒内是精确居中（317.9 = 82 + (552.8−89)/2）。偏上 ~5% 在光学中心惯例内，且三断点一致。
- 截图：/tmp/roundc-lane-a/v4b-newsession-{393,768,1280}.png。
- **裁决：FALSE（修复到达读者；29.5px 偏上记录在案，不构成对齐缺陷）**。

### 1.2 其余四项 ✅（证据数字）
- 主题卡：393 卡高 **183.1**（min-height 44px，height 不再硬夹），`.theme-name` 底边距卡底 80.6–95.6px（名字在卡内）；1280 卡高 **193.1** 同样在卡内。截图 v5-01-appearance.png、s7-01-appearance-1280.png。对照 Round B 修复前（44px 夹扁、名字画在下一行卡上）已闭环。
- Relays 空态：`.viewer` h=740 填满、`align-content: stretch`、空态盒 y=431.5，中心偏差 **+4.5px** —— 居中到达。
- Extension 卡：三钮（Update now/Skip/Cancel）`border: 1px rgb(58,66,78)`（`ExtensionDialogCard.ts:470`）、bg rgb(27,32,39) vs 卡面 rgb(53,56,60) 对比 **1.281** —— 边界到达（bg 仍比卡面暗一档，方向问题 Round A 已挂账为惯例裁量，不重复计）。
- Actions-row 读边：展开折叠后 header 控件 x=10..383，actions-row 内 Settings/Actions x=10..383 —— 两带逐像素同缘，Round B 3.1 闭环。
- 折叠按钮（投诉 4 复测）：盒 44×44 @ (339,2)，radius 2px，顶隙 2、底隙 3（含 1px 线）、右 inset 10 —— 持续闭环。

---

## 二、新 TRUE 发现（Round C 新增，均不在 owner 挂账内）

### 2.1 T1 · Round B 按压态修复"死在到达前"：@media 被嵌进未闭合的规则 — TRUE（P0）
- 代码：`src/client/src/components/appShell/AppNavigationPanel.ts:462-464`：
  `.compact-header-action { …; color: var(--pi-text);` ← **没有闭合花括号**
  `@media (pointer: coarse) { .compact-scope:active, .compact-session:active, .compact-header-action:active { background: var(--pi-surface-hover); } }}`
  原生 CSS 嵌套把三条 `:active` 选择器编译成 `.compact-header-action ** …** :active`（后代选择器）；而 `.compact-scope`/`.compact-session`/`.compact-header-action` 在 DOM 里是**兄弟**（AppNavigationPanel.ts:181-197，compact-header 行内平级）——后代关系不存在，三条全不匹配。
- 实测（393，真按下）：`.compact-scope` `:active` **matches=true** 而 bg 保持 `rgba(0,0,0,0)`；`.compact-session` 同；`.compact-fold`/actions-row 的 Settings 钮按下 bg 停在 resting `rgb(19,22,27)`（surface-hover 应为 rgb(27,32,39)）。
- CSSOM 确认：app-navigation-panel 的 adoptedStyleSheets 里**不存在任何** `:active` 规则（activeCount=0；与 SessionList 的对照规则形成反差）。
- 正控组（同法同轮复跑 Round B 的 p19b 脚本）：`menu` 按下 bg=rgb(27,32,39) ✓ —— 方法有效，阴性结果可信。
- 截图：/tmp/roundc-lane-a/v1c-pressed-compact-scope.png、v1c-pressed-actions-row-settings.png。
- **裁决：TRUE**。Round B 声称"五个生产者已修、家族完整"，其中最大的一族（手机头部最常用三个触控目标，44–262px 宽）按压反馈为零。修法：把 `@media` 移出未闭合规则（补上 :462 行尾的 `}`），一行。

### 2.2 T2 · Tasks 空态居中被同文件的后一条规则抵消 — TRUE（P0）
- 代码：`pi-web-plugins/workspace-tasks/tasksPanelElement.ts:287`（Round B 修复）`.viewer { … display: flex; flex-direction: column; }`；但 **:288** `.tasks-viewer { display: grid; align-content: start; gap: … }` 同特异性（0-1-0）、靠后 → 胜出；模板 :84 渲染 `<section class="viewer tasks-viewer">` —— 两个类同挂。
- 实测（393）：`.viewer` computed **display: grid、align-content: start**（style 元素里的 flex 规则在但被覆盖）；唯一子元素 `.empty-state` computed **margin: 0px**，盒 y=122（=viewer 顶 110 + padding 12），viewer h=740 —— 空态顶锚，下方 **627px 空黑**（截图 v6b-01-tasks.png 可见虚线框贴工具栏、其余全空）。Relays（单类 `.viewer`，relaysPanelElement.ts:515 `align-content: stretch`）居中正常 —— 同一修复一份到达、一份没到。
- Round B triage 对这条修复的"验证"是"两 lane 的机制说明"，不是像素复测 —— 本轮是它第一次被像素验证，未通过。
- **裁决：TRUE**。修法：删 `:288` 的 `display: grid`（保留 gap 用 flex column + gap 等价值）或给 `.empty-state` 单类豁免；一处一行。

### 2.3 T3 · "消息头分隔线改实线"从未进代码 — TRUE（P1）
- Round B triage/commit message/changeset 三处声称："the message-header dividers lose their sub-perceptible alpha mix — solid muted border instead"。git 层面：`git show 1dde944d -- src/client/src/components/ChatView.ts` 只有 empty-session 与 drawer-tab 两个 hunk，**无分隔线 hunk**。
- 代码现状：`src/client/src/components/ChatView.ts:379`（.msg）、`:380/:381/:385/:386/:387`（user/tool/queued/bash/skill 各 role 块）、`:388`（.group-msg）全部仍是 `border-bottom: 1px solid color-mix(in srgb, … 35%, transparent)`；:288 queued 变体同。
- 实测（393，77 条消息的会话）：中性 assistant 头 computed border `color(srgb 0.149 0.173 0.208 / 0.35)`、卡面 `color(srgb 0.141 0.152 0.171)` → 复合对比 **≈1.02:1**（Round B lane-c N2 修复前实测 1.03:1 —— 逐字相同，即修复前状态原样在线）；user 头在 selection 面上 1.408:1。
- **裁决：TRUE（声称的修复不存在于代码，读者看到的是 Round B 判定"不可感知"的原值）**。修法即 lane-c N2 的处方：每 role 块一行换 `var(--pi-border-muted)`。

### 2.4 T4 · 按压态家族第二次声明"完整"后仍有 4 个未覆盖生产者 — TRUE（P1，同症状第 N 次）
全 app 边框 0 + bg transparent 的可见触控 button 枚举（两轮审计：面板开/关各一轮），逐一匹配各 shadow root 的 `:active` 规则（剥掉 `:active` 后 matches）：
| 生产者 | 尺寸 | :active | 证据 |
|---|---|---|---|
| `.action-main`（session-list 会话行，×7 屏显） | 65px 高 | **无**（SessionList.ts:818 规则只覆盖 menu/cleanup/bulk；行上无 hover 无 active） | 审计 covered=false |
| `.drawer-control` / `.drawer-collapse`（chat 抽屉头部） | 44×44 | **无**（ChatView.ts:168-179 仅 hover/focus-visible） | 审计 covered=false |
| goals 贡献节 `.refresh` | 44×44 | **无**（pi-web-plugins/goals/goalsSectionElement.ts:22-25 仅 hover） | 审计 covered=false |
| ActionPalette `.options button` + header close | 72.1 / 44 | **无**（ActionPalette.ts:109-113 全文件无 :active） | 实测面板行 bg transparent |
- Round B triage 的家族完整性声明（"the family is now complete per lane B's stylesheet scan"）与 Round B lane-c N7（"finish the pressed-state family (7 files)"）互相矛盾；triage 采纳了"完整"，实际未完整。
- **裁决：TRUE**。修法：每处一行 `@media (pointer: coarse) { X:active { background: var(--pi-surface-hover); } }`（与既有家族同款）。

---

## 三、Round B 判 TRUE 但既未修也未挂账的遗留（本轮原样复测命中）

- **C1 · 聊天语境条 44px 控件贴顶贴线**（Round B 3.3）：AppContextBar.ts:72 `padding: 0 var(--pi-chrome-inset)` 未加纵向呼吸。复测：`.panel-toggle` y=0..44，条 h=45 → 顶隙 **0**、底隙 **1**（正好压分隔线）；同屏对照已修的 compact-header 顶隙 2/底隙 3。两条 chrome 带高 45 vs 49 并存。截图 s2-01-chat.png、v2d-toggle-pressed.png。**TRUE（遗留）**。
- **C2 · goals 贡献节全出血**（Round B 3.4）：复测 `pi-web-goals-section` 宿主 x=0 w=393、`.goal-row` x=0、**状态点 x=0..8 触屏缘**；同屏会话行盒 x=13。goalsSectionElement.ts:12 假设宿主有内距，插槽没给。截图 s1b-03-goals.png。**TRUE（遗留）**。
- **C3 · Settings drill-in 双标题**（Round B 3.5）：SettingsDialog.ts:209 `<h1>${detailTitle()}</h1>`（20px，y=56）+ SettingsGeneralPanel.ts:58 `heading="General configuration"` → SettingsPanelFrame.ts:51 h2（17px，y=105），相距 25px 同屏双题（截图 s4-02-general.png："General" + "General configuration"）。**TRUE（遗留；若读作挂账里"settings dialog title edges"的一部分则降级为待 owner 裁量——挂账文本只提 edges 不提重复）**。
- **C4 · 工具面板工具栏三节奏**（Round B 3.7，其中 Files vs Tasks/Relays 部分 = Round A 挂账）：复测六面板——Files h=**61**（pad 8，题 x=8）、Tasks/Relays h=**65**（pad 10/12，题 x=12）、**Updates/Info h=33.3**（pad 8，纯 strong 词标题，兄弟面板一半高）。同一手机三档带高、两档题缘。截图 s5-tool-*.png。**TRUE（遗留；半额被 Round A 挂账覆盖，Updates/Info 33.3 是超出挂账的部分）**。

---

## 四、干净账（本轮实测证明干净，后来者不必再猎）

1. 折叠按钮：radius 2px、44×44、顶 2/底 3、右 inset 10 —— 投诉 4 闭环保持。
2. Sessions 标题行分布：三个控件间隙 25.9/25.9 均匀（挂账绝对松紧不变）。
3. Actions-row 读边统一（10..383 两带同缘）。
4. 主题卡（393/1280）：高度放开、名字在卡内。
5. Relays 空态居中（±4.5px）；Tasks/Relays 空态**水平**居中精确（x=12，左右各 12 padding）。
6. New-session 空态：盒填满、内容盒内居中，三断点一致（残差 29.5px 偏上已记录）。
7. Extension 卡按钮 1px 边界 + 1.281 对比。
8. Quick switcher：chips radius 2px、machine-tab 2/2/0/0、create-row 块居中（title+sub 并集中心 = 行中心 329）；sheet 标题 "Change context" x=19 与列表同缘；close 44×44。
9. Context sheet（Round A 清单维持）：标题/内容 x=19 对齐。
10. Row menu（Round A 清单维持）：正控组按下 surface-hover 生效。
11. 聊天列内自洽：卡片/composer x=6 同缘（6 系挂账不变）；composer footer 与 status bar pad 同为 `8px 6px`。
12. 工具网格：2 列 182.5 等宽、行距 60、x=10 与列表齐。
13. 边线 token：live --pi-border #3a424e / --pi-border-muted #262c35（Round A lift 保持）。

## 五、挂账确认（owner 账面，本轮数字不变）
- 手机标题行 25.9 vs 桌面 9.6（均匀性保持，绝对松紧归 owner）。
- 节 padding 体系（导航 10 / 聊天 6 / 桌面 16）+ chrome-inset 契约注释——本轮数字与 Round B 记录一致。
- Settings 面板缩进 13px、Save 折叠线下、三种创建形态、徽章 pill、工作区面板左缘多值（本轮 wpLeftEdges 扫描与工具栏 x 值一致：8/12 系）。

## 六、优先级建议
1. **P0** T1（补 AppNavigationPanel.ts:462 的 `}`，一族按压态复活）与 T2（删 tasksPanelElement.ts:288 的 grid 覆盖）——都是一行级，且都是"修复波自己没到达读者"。
2. **P1** T3（分隔线 35%→实线，六行）+ T4（四个生产者各一行）。
3. **P1** C1（context-bar 纵向呼吸，与 compact-header 对齐）。
4. **P2** C2（贡献节插槽统一 inset）、C3（双标题二选一）、C4（工具栏节奏 token 化）。

## 七、证据索引
- 截图（/tmp/roundc-lane-a/）：v1c-pressed-*（按压四连）、v2d-toggle-pressed、v3-02-qs-close-pressed、v3-03-drawer-tab-pressed、v4b-newsession-{393,768,1280}、v5-01-appearance、v6b-01-tasks（T2 顶锚现场）、v6b-02-relays、v7-01-chat、v7b-ext-hunt（extension 卡+分隔线）、s1b-03-goals（C2）、s2-01-chat（C1）、s4-02-general（C3）、s5-tool-{files,tasks,relays,updates,info}（C4）、s6-01-qs、s7-01-appearance-1280、s7-02-qs-empty、s8-01-bottom。
- 脚本：/tmp/roundc/{helpers,v1-pressed,v1b-pressed-touch,v1c-pressed,v1d-cssom,v2d-toggle,v3-qs-empty,v4b-newsession2,v4c-newsession3,v5-panels,v6b-tasks-relays,v6c-tasks-children,v6e-matched,v7-chat,v7b-divider-ext,s1-nav,s1b-nav,s2-chat,s2e-sheet2,s3c/s3d-active-audit,s4-settings,s4b-h2,s5-toolbars,s6-qs-palette,s7-final,s8-bottom}.mjs（node，cwd=仓库根；helpers 的 goto 已改 domcontentloaded 以避开长连接 networkidle 超时）。
- 关键源码位：AppNavigationPanel.ts:462-464（未闭合规则+死 @media）、:181-197（兄弟结构）、:461（actions-row reading-edge ✓）；tasksPanelElement.ts:84（双类）、:287（flex 修复）vs :288（grid 覆盖）、:302（margin:auto）；relaysPanelElement.ts:515（stretch ✓）；ChatView.ts:367（min-height ✓）、:379-388+:288（35% 分隔线未修）、:408（drawer-tab:active ✓）；AppContextBar.ts:72（0 呼吸）、:74（button:active ✓）；QuickSwitcher.ts:421（close:active ✓）；SessionList.ts:818（家族规则的覆盖面）；goalsSectionElement.ts:22-25（refresh 无 active）；ActionPalette.ts:109-113（无 active）；SettingsDialog.ts:209 + SettingsGeneralPanel.ts:58 + SettingsPanelFrame.ts:51（双标题）；ExtensionDialogCard.ts:470（1px 边界 ✓）；settingsControlStyles.ts:16-24（min-height ✓）。

## 八、过程披露
- 为测空态/会话切换共点开若干既有会话与一次 "+ New session"（test·main 下可能留有一个 0 消息临时会话，与 Round A/B 同类副作用）；未做删除等破坏性操作。
- 探测期间出现数次 503/404（服务端瞬时，含一次新建会话 503），不影响布局测量；QuickSwitcher 的"无结果空态"因键盘输入未落入搜索框未能驱动，未裁决（标注：未验证）。
- 8505 栈未重启；仓库零写入；Guard 测试未跑（live 测量轮）。
