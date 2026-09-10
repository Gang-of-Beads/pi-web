# Round B · Lane A — 手机 393×850 全表面复审（re-review）

评审对象：http://localhost:8505/（refactor/plugin-architecture @ 3442b587，Round A 修复波 cad91351 已含在产物内）。
方法：Playwright 真机浏览（手机 393×850 hasTouch isMobile dpr2；桌面 1280×850、768×850 复核），全部间距/对齐用 `getBoundingClientRect` + `getComputedStyle` 实测；按压态用真实 mouse-down-hold 读 computed background。未改仓库文件、未重启栈；脚本在 /tmp/roundb/，截图副本在 /tmp/roundb-lane-a/（与 /tmp/roundb/ 同名同图）。

**本轮使命**：(1) 逐项核验 Round A 修复波是否"到达读者"；(2) 猎 Round A 漏掉的。每条给出 file:line、双方元素实测数字、截图、TRUE/FALSE 裁决。

---

## 一、Round A 修复核验总表

| Round A 修复项 | triage 声称 | 复测裁决 |
|---|---|---|
| 边线对比 #3a424e（index.html:148-149） | 已修 | ✅ 已到达（live token + 控件边线实测 rgb(58,66,78)） |
| 折叠按钮圆角+呼吸（AppNavigationPanel.ts:447,463） | 已修 | ✅ 已到达（radius 2px；呼吸 2/2px） |
| Sessions 标题行分布 | 已修（25.9 均匀） | ✅ 均匀 25.9×3；"绝对过松"仍开放（见 3.8/五） |
| 导航列边缘归一 | 已修 | ⚠️ 部分到达：导航面板内部已齐（10/10/10），但同面板相邻带 6 vs 10（见 3.1）、聊天列 6 vs 10（见 3.2） |
| 快切 create-row 居中 | 已修 | ✅ 已到达（title 中心 196.4 = 行中心 196.5） |
| 空态居中（new-session） | 已修 | ❌ **未到达**（见 1.1，最大核验失败） |
| Files 工具栏触控下限 | 已修 | ✅ 已到达（Upload 61.4×44、Refresh 68.6×44） |
| 无边框族按压态 | 已修 | ⚠️ 部分到达：已覆盖 6 处；**漏 5 个同族生产者**（见 1.2） |
| 磁贴左缘 | 已修 | ✅ 已到达（tiles padding `4px 0`，tile x=10 = 行 x=10 = h2 x=10） |
| 标题节奏（h2 margin 4px + sheet 4/4/4） | 已修 | ✅ 已到达（全列表面 h2 mb=4px；sheet 三节标题 mb 均 4px） |
| tasks/relays 虚线空态居中 | 已修 | ❌ **未到达**（margin:auto 实测为 no-op，见 1.3） |
| Appearance 主题卡叠压（P0） | （Round A P0，未列入修复） | ❌ 仍在，三断点全坏（见 1.4） |

---

## 二、Round A "已修"但实测未到达读者的（本轮最重要发现）

### 1.1 New-session 空态"垂直居中"未生效 — ❌ triage 声称 FALSE
- 代码：`ChatView.ts:367` `.empty-session { … margin: auto; align-content: center; … }`；父容器 `.chat`（`ChatView.ts:205`）是 `display: block` 的滚动容器（`overflow:auto` + padding `24px 6px 16px`）。
- 机制：块级格式化上下文里纵向 `margin:auto` 解析为 0（实测 computed `margin: 0px`），`align-content:center` 只作用于元素自身 121px 高度的内部，救不了外部定位。
- 实测（393）：`.empty-session` y=114（=聊天区顶 90 + `.chat` padding-top 24），块高 121（114..235），composer 顶 709.8 → **下方空黑 474.8px**，距"真正居中位置"偏 217px。768：y=114、下方 458.8、偏 217.4；1280：y=114、下方 476.3、偏 226.1。三个宽度全部顶部锚定、数字几乎一致（同一个 24px padding 决定一切）。
- 截图：/tmp/roundb-lane-a/phone-13-new-session.png、d1280-newsession.png、d768-newsession.png。
- **裁决：TRUE（修复未到达读者）**。修法方向：让 `.chat` 在无消息态成为 flex 列（或给 `.chat` 加 `display:flex; flex-direction:column` 时空态 `margin:auto` 才生效）；一行改动。

### 1.2 无边框触控控件按压态：6 处已覆盖，5 个同族生产者漏网 — ⚠️ TRUE
已覆盖并实测/查证：SessionList `.action-menu-toggle`/`.cleanup-entry`（真实按下实测 bg 变 rgb(27,32,39)=surface-hover，SessionList.ts:818）✓；`.bulk-select-entry` 规则同在（:818 同一规则）✓；PromptEditor 全部按钮（PromptEditor.ts:180）✓；ChatView `.msg-action`/activity-dock（ChatView.ts:408）✓；SettingsDialog close（SettingsDialog.ts:769）✓；ContextSwitcherSheet close（ContextSwitcherSheet.ts:90）✓；Files 工具栏（filesPanelElement.ts:503）✓。
**漏网（无边框 + transparent + coarse 无 hover + 无 ：active，按压实测/查证零反馈）**：
1. `.compact-scope`（AppNavigationPanel.ts:484）— 手机头部最大的触控目标（140.7×44），按下实测 bg 仍 rgba(0,0,0,0)。
2. `.compact-session`（AppNavigationPanel.ts:448）— 同排 176.3×44，同上实测无反馈。
3. `.panel-toggle` ☰ 与 `.session-title`（AppContextBar.ts:74,78）— 聊天侧头部两个 44px 无边框控件，文件内无任何 ：active 规则。
4. QuickSwitcher `.close` ×（QuickSwitcher.ts:420）— 44×44 无边框，文件内无 ：active（对照：sheet-close 有）。
5. ChatView `.drawer-tab`（未选中态 border 1px transparent + bg transparent，ChatView.ts:154）与 `.drawer-header-actions` 内的无边框钮 — 触屏按压无反馈。
- 截图：按压过程截图 phone-15-goals-strip.png（列表面）；实测数据见 /tmp/roundb/p19b-pressed.mjs 输出（menu/cleanup = surface-hover ✓，compact-scope/compact-session = transparent ✗）。
- **裁决：TRUE（"同一症状第二次"——修复波只枚举了部分生产者，正是 AGENTS.md 警告的模式）**。

### 1.3 tasks/relays 插件空态"居中"是 no-op — ❌ triage 声称 FALSE
- 修复波给 `.empty-state` 加了 `margin: auto`（tasksPanelElement.ts:302、relaysPanelElement.ts:571），但实测 Tasks 空态盒 x=12、y=122、w=369（=面板全宽 393−2×12）、h=80.8，紧贴工具栏（toolbar 底 110 + 12）；Relays 同（y=122, h=97）。
- 盒宽已是 100%，水平 margin:auto 无自由空间可言；父容器非 flex/grid，垂直也不动；`text-align: start`（继承）而非共享 `.empty-state` 的 center（shared.ts:169）。同一个类名两套设计（Round A D1 的原始发现）在修复后依旧。
- 截图：/tmp/roundb-lane-a/phone-tool-tasks.png、phone-tool-relays.png。
- **裁决：TRUE（未到达）**。

### 1.4 Appearance 主题卡叠压（Round A P0）未修，三断点复现 — ❌ TRUE
- 根因未动：`settingsControlStyles.ts:16/20` 对**所有** button 硬设 `height: var(--pi-control-height[-touch])`（不止 min-height），`.theme` 卡（SettingsAppearancePanel.ts:149）是 button、内容 ~150-180px。
- 实测 393：11 张卡全部 `height: 44px`、overflow visible；网格行距 52px（44+8 gap，SettingsAppearancePanel.ts:148 `.theme-grid` gap space-4）。"Pro (native)" 卡盒 y=328.2..372.2，其 `.theme-name` 渲染在 y=383.2 —— **标题在自家卡片底边之下 11px**，画在下一行卡上；第三行卡（y=380.2）与第一行卡内容（预览+名+描述，伸到 ~y=430+）互相叠写。1280：height 32px、nameY − card y = 55px，同病。768 同。
- 截图：/tmp/roundb-lane-a/phone-10-appearance.png（可读性实际受损：主题名被上一行卡的预览画盖住）、d1280-03-appearance.png。
- **裁决：TRUE，Round A P0 原样开放**。修法：settingsControlStyles 的 height 放开为 min-height，或 `.theme { height: auto }` 豁免。

---

## 三、Round A 修复波引入/暴露的新错位（本轮新猎物）

### 3.1 同一面板两条相邻 chrome 带左缘 10 vs 6 — TRUE
- `.compact-header` padding `2px 10px`（AppNavigationPanel.ts:447，修复波改为 reading-edge）；紧贴其下的 `.compact-actions-row` padding `4px 6px`（AppNavigationPanel.ts:461，仍是 chrome-inset）。
- 实测：header 内控件 x=10、右缘 383；折叠展开后 Settings/Actions 按钮 x=6、右缘 387。同屏同面板，展开折叠的瞬间两条带的左右边缘各跳 4px。
- 截图：/tmp/roundb-lane-a/phone-07-actions-row.png（对照 phone-01-boot.png 的 header）。
- **裁决：TRUE**。修法：461 行的 `--pi-chrome-inset` 改 `--pi-reading-edge`（或两者统一收紧为一档）。

### 3.2 手机的"读边契约"被修复打破：chrome-inset 注释已失真 — TRUE
- `index.html:81-84` 对 `--pi-chrome-inset` 的自述："Where stacked chrome rows start their text. One value, so **the bar, the compact header and the conversation** below them share a reading edge."
- 修复波把 compact-header 改用 reading-edge（手机 10px）后，该承诺不成立：实测 compact header x=10，chat 语境条 `.context-bar` x=6（AppContextBar.ts:72，padding `0 6px` 未动），聊天卡片/composer x=6；列表面（行、h2、tiles）x=10。同一台手机、一次返回手势的两端：10 ↔ 6。
- 桌面同源未修：1280 语境条 padding `0 6px`、☰ x=347，而聊天正文 gutter 16（Round A C1 桌面聊天半边原样）。
- 截图：/tmp/roundb-lane-a/phone-03-chat.png（☰ 贴顶、6px 系）对照 phone-02-sessions.png（10px 系）。
- **裁决：TRUE**。这是"对齐"投诉的现存主根：token 层需要一个决定——手机读边是 6 还是 10，然后 chrome-inset 与 reading-edge 在 ≤640 收敛为同一值（或恢复 header 用 chrome-inset）。

### 3.3 聊天语境条 44px 控件贴顶贴线（修复波只修了导航侧的同款）— TRUE
- Round A 投诉 4 的几何问题在 `.context-bar` 原样：条高 45（44+1 border），`.panel-toggle` 44×44 y=0..44 → **顶隙 0px、底隙 1px（正好压在分隔线上）**（AppContextBar.ts:72 `padding: 0 var(--pi-chrome-inset)`，对照已修的 `.compact-header` padding `2px …`）。
- 截图：/tmp/roundb-lane-a/phone-03-chat.png 顶部。
- **裁决：TRUE**。与 Round A 的折叠钮同因同解（header 加 2px 纵向 padding 或控件 42）。

### 3.4 贡献型抽屉节在手机面板全出血 — TRUE（新）
- 手机 sessions 面板里，goals 插件节（AppNavigationPanel.renderContributedSections，AppNavigationPanel.ts:270-277）渲染为 session-list 的兄弟，宿主无内距：`pi-web-goals-section` 宿主 x=0 w=393，`.goal-row` x=0（pad `6px 0`），**状态点 x=0 触到屏幕左缘**，文字 x=16；同屏 session 行盒 x=10、行文字 x=23。
- 一个滚动面里两套左缘（0/16 vs 10/23），且"点贴屏缘"读作杂点（我最初把它当成未知渲染残缺追了三轮——见 3.4 附注）。
- 拥有方：AppNavigationPanel 贡献节插槽没有给 inset；goalsSectionStyles `.goal-row`（pi-web-plugins/goals/goalsSectionElement.ts:12）假设宿主有内距。
- 截图：/tmp/roundb-lane-a/phone-02-sessions.png 底部（Goals 行）、phone-15-goals-strip.png。
- **裁决：TRUE**。修法：贡献节插槽统一给 `padding-inline: var(--pi-reading-edge)`（或插件 host 样式统一注入，像 adoptGoalsHostStyles 的既有通道）。
- 附注（未定位，一次捕获）：phone-03-chat.png 转写顶部左缘曾见一枚 2-3×22px 蓝色刻痕（y≈90-112）；三次回访未复现，elementsFromPoint 无命中。推测为某个状态性 rail 的瞬态渲染（猜测，未证实），仅记录。

### 3.5 Settings 手机 drill-in 的双重标题 — TRUE（新）
- 手机 drill-in 面板：dialog 头 `<h1>${detailTitle()}</h1>`（SettingsDialog.ts:209，20px）与面板自己的 frame 标题 `<h2>${heading}</h2>`（SettingsPanelFrame.ts:51，17px）同屏渲染同一个词。七个面板全传 `heading=`（grep：SettingsAppearancePanel.ts:34、SettingsGeneralPanel.ts:58 等），即**每个设置面板在手机上都标题两遍**："Appearance" h1 y=56 (20px) + h2 y≈107 (17px)，相距 ~27px；General 则是 "General" + "General configuration" 近重复。
- 截图：/tmp/roundb-lane-a/phone-10-appearance.png（两枚标题同屏可见）。
- **裁决：TRUE**。修法方向：手机 drill-in 时 h1 与 frame h2 二选一（frame 是内容语义头，h1 留给索引页）。

### 3.6 Extension 弹窗卡片：按钮比卡片暗（方向反转 + 一卡两向）— TRUE（Round A 遗留未修）
- 实测（p4，393）：`.card` bg = rgb(53,56,60)（--pi-surface-raised，ExtensionDialogCard.ts:346），"Update now"/"Skip"/"Cancel" bg = rgb(27,32,39)（--pi-surface-hover，:469-472）、border 0。全 app 惯例按钮比底亮一档，此处反转为**暗三档**，截图里读作三块浮灰。
- 更拧的是同一张卡内两向：Cancel 落在 `.dialog-footer`（bg `--pi-surface` #13161b，ExtensionDialogCard.ts:439-466）上时按钮又是**亮**的一侧。同一按钮样式，在一个卡片里对比方向相反。
- 截图：/tmp/roundb-lane-a/phone-03-chat.png（Update now / Skip / Cancel）。
- **裁决：TRUE**。修法：按钮 bg 在 raised 卡上用 --pi-surface-card/raised 上一档（或恢复 1px 边）。

### 3.7 六个工具面板的工具栏仍是三种节奏（修复波只抬了 Files 的下限）— TRUE（triage 已挂账，补充新数字）
- 实测（393，全部 coarse 44px 按钮已达标）：Files 带 h=61、pad 8px、标题 x=8；Tasks/Relays 带 h=65、pad `10px 12px`、标题 x=12；**Updates/Info 带 h=33.3、pad 8px、标题 x=8** —— Round A 只对比过 49 vs 65，现在的第三组 Updates/Info 高度只有兄弟面板的一半（33.3 vs 61/65），纯 `<strong>` 词标题（updates/pi-web-plugin.ts:88、infoInternals.ts:225）。
- 标题 x 三个值：8 / 12 / 8；左右读边：8 / 12 / 8 —— 与全 app 的 6/10 并存后，同一手机上共 5 个左缘值。
- 截图：/tmp/roundb-lane-a/phone-tool-{files,tasks,relays,updates,info}.png。
- **裁决：TRUE（挂账项的量级扩大：不是 8 vs 10/12 两档，是 61/65/33.3 三档）**。

### 3.8 顺带实测仍未修的 Round A 观察项
- 模型 chip 前缀截断：393 显示 "a…claude-fable-5"（provider span 压到 1 字符+省略号，PromptEditor `.select-model` 131px；截图 phone-03-chat.png 底 dock）——mono 面孔下像渲染残缺。仍开放，owner 裁量。
- Settings Save 在折叠线下（手机：Save gateway y=1220、Save upload y=2032，视口 850）——既有取舍，挂账。
- 边线对比虽从 1.35 提到 ~1.74:1（#3a424e on #13161b），仍低于 WCAG 3:1 非文本线；配合按压态/图标可用，记录数字供 owner 再裁量。

---

## 四、干净账（实测证明无需再猎）
1. 折叠按钮：radius 2px、盒 44×44 @ (339,2)，顶隙 2px、底隙 2px（+1px 线）、右 inset 10 —— 投诉 4 的圆与"顶天立地"两项均已闭环（AppNavigationPanel.ts:447 padding `2px 10px` + :463/:471）。
2. 边线 token：live `--pi-border`=#3a424e、`--pi-border-muted`=#262c35（index.html:148-149），有边框控件全部受益。
3. 导航面板（手机）左缘三方齐：h2 x=10 = 行 x=10 = 磁贴 x=10（tiles padding `4px 0`，shared.ts:295）。
4. 桌面导航列（1280）左缘三方齐：header 16 = chips 16 = section 16（Round A C1/C2 桌面半边闭环）。
5. Sessions 标题行分布：手机 25.9/25.9/25.9 均匀；桌面 9.6/9.5/9.6 均匀（SessionList.ts:707-711 margin-left 0 + shared space-between 单机制）。
6. 快切 create-row：title 中心 196.4 = 行中心 196.5（place-items center + text-align center，QuickSwitcher.ts:444）——Round C F4 闭环。
7. 行菜单：174.5×186、border+radius 2、条目 44×44（与 Round A 一致）✓；快切 chips radius 2px、machine-tab 2/2/0/0 —— 无 pill 存活于控件（徽章 pill 是声明惯例）。
8. 语境 sheet：标题 x=19 与三节列表内容 x=19 对齐；三节标题 mb 均 4px（Round A H1 闭环）；close 44×44 coarse ✓。
9. 会话行节奏：58px 高、x=10、12px 行距（66.8 的行是徽章换行内容所致，非漂移）。
10. 工具网格：2 列等宽 182.5、gap 8、x=10 与列表齐、底缘 10 收边。
11. 聊天列内自洽：卡片 x=6 w=381 = composer x=6 w=381 逐像素相等；状态条 padding `8px 6px`。
12. 活动卡 radius 2px（.activity-dock，pill 已归一）。
13. 空态水平居中全部精确（0 偏差）——垂直问题见 1.1/1.3。

---

## 五、挂账确认（Round A deferred，本轮不动）
- 手机 Sessions 标题行绝对松紧：均匀但 25.9px（桌面同位 9.5）， coarse gap token（SessionList.ts:703 现 space-6=12px）在 space-between 下其实不参与分配——要收紧只能动 space-between 的语义或控件宽度；交 owner。
- 节 padding 手机 6/10/10 vs 桌面 16 vs 聊天 6（现在导航内部 10 与聊天 6 的并存使其更显眼，见 3.2）。
- 三种"创建"形态（实心 +New session / 描边 + Add project / 快切 create-row）。
- 徽章 pill 惯例（unread、drawer-tab-badge、tool-badge）。
- Settings Save 低于折叠线（手机 y=1220/2032；桌面 y=972/1623 同 Round A）。
- Files vs Tasks/Relays 工具栏节奏（现在加 Updates/Info 33.3，见 3.7）。

---

## 六、优先级建议
1. **P0** Appearance 主题卡叠压（1.4）——三断点可读性受损，一行豁免可解。
2. **P0** New-session 空态居中未生效（1.1）——triage 声称已修而读者看不到；`.chat` flex 化一行可解。
3. **P1** 手机读边二元（3.2/3.1/3.3）：6 vs 10 贯穿 header/actions-row/context-bar/聊天列——token 层一个决定，四处受益。
4. **P1** 按压态补齐同族 5 生产者（1.2）。
5. **P2** Extension 卡按钮对比反转（3.6）；贡献节全出血（3.4）；settings 双标题（3.5）；tasks/relays 空态（1.3）。
6. **P3** 工具栏三节奏收敛（3.7，refactor）；模型 chip 截断样式；Save 折叠线下。

## 七、证据索引
- 截图（/tmp/roundb-lane-a/，原始在 /tmp/roundb/ 同名）：phone-01-boot、02-sessions、03-chat、04-chat-detail、05-context-sheet、06-quick-switcher、07-actions-row、08-action-palette、09/11/12-settings+general、10-appearance（P0 叠压）、13-new-session、14-row-menu、15-goals-strip、phone-tool-{files,terminal,tasks,relays,updates,info}、d1280-01/02/03、d1280/d768-newsession、d768-01。
- 脚本：/tmp/roundb/p1…p22*.mjs + helpers.mjs（node，cwd=repo 根）。
- 关键源码位：index.html:81-84（chrome-inset 契约）、:148-149（border）；AppNavigationPanel.ts:447（header 2/10）、:484/:448（scope/session 无 :active）、:461（actions-row 4/6）、:463/:471（fold radius/floor）；AppContextBar.ts:72/:74/:78（context-bar 6px、无 :active）；ChatView.ts:205（.chat 块级滚动）、:367（empty-session margin:auto 失效）、:408（按压态 ✓）、:154（drawer-tab 无按压）；SessionList.ts:703/:707-711（gap+分布）、:818（按压态 ✓）；settingsControlStyles.ts:16/20（height 硬夹，P0 根）；SettingsAppearancePanel.ts:148（theme-grid）、:149（.theme 卡）；SettingsPanelFrame.ts:51 + SettingsDialog.ts:209（双标题）；ExtensionDialogCard.ts:346/:439-466/:469-472（卡/脚/钮三面）；QuickSwitcher.ts:420（close 无 :active）、:444（create-row 居中 ✓）；tasksPanelElement.ts:302、relaysPanelElement.ts:571（空态 no-op）；filesPanelElement.ts:502-503（floor+按压 ✓）；updates/pi-web-plugin.ts:88、info/infoInternals.ts:225（33.3 工具栏）；pi-web-plugins/goals/goalsSectionElement.ts:12（.goal-row 全出血）。

## 八、过程披露
- 复现副作用：为测空态点了三次 "+ New session"（393/1280/768 各一），可能在 test·main folder 留下 0 消息临时会话（与 Round A 两 lane 同类副作用）；未做删除等破坏性操作。探测期间 Tasks/Relays 面板有 400、新建会话一次 503（服务端瞬时），均不影响布局测量。
- 8505 栈未重启；仓库零写入； Guards（spacing/type/radius scale tests）未跑（本轮为 live 测量轮）。
