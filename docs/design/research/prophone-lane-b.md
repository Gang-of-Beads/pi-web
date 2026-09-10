# Pro Native 风格一致性评审 — Lane B(手机 393×850 coarse + 桌面 1280×850 fine)

评审对象:`http://localhost:8505/`(未重启、未改仓库文件;探针脚本只写 /tmp)。
主题:pro native(monospace、方角 0–4px、flat 暗色)在两类视口下的布局一致性,以及手机上"点按钮出现多层面板叠成一堆"的报告。
所有结论均给出 file:line、对比的两个 surface、截图路径;推测一律标注。

---

## 0. 走查覆盖(每面:能否打开 / 是否叠层 / 能否关闭 / 关闭后状态)

| Surface | 打开 | 叠层 | 关闭 | 关闭后 | 截图 |
|---|---|---|---|---|---|
| Boot(手机项目网格) | ✅ | 无 | — | — | `00-phone-boot.png`, `05-phone-boot.png` |
| More actions 折叠行 | ✅ | 无(内联推下行,非浮层) | ✅(按钮 title 变为 Fewer actions) | 回到 boot | `06-phone-more-actions.png`, `07-phone-after-fold-close.png` |
| Context switcher sheet(PI WEB 按钮) | ✅ | 无(backdrop 全屏覆盖,`elementFromPoint` 全部命中 backdrop) | ✅ Esc | ✅ | `10-phone-context-sheet.png` |
| 项目 → 会话列表 | ✅ | 无(整屏替换,`main.navigation-view` 下 chat `display:none`,PiWebApp.ts:175-179) | — | — | `12-phone-project-sessions.png`, `02a-phone-session-list.png` |
| 会话 → 聊天 | ✅ | 见 A1(meter 压卡片头) | — | — | `13-phone-chat.png`, `14-phone-chat-top.png` |
| 抽屉(Open panel) | ✅ | 无(整屏替换) | ✅(选会话/工具返回) | ✅ | `20-phone-drawer-over-chat.png`, `21-phone-after-drawer-close.png` |
| 抽屉工具:Files/Terminal/Tasks/Relays/Updates/Info | ✅ 全部 | 无 | ✅ | ✅ | `22-phone-files-panel.png`, `23-phone-tool-*.png` |
| 项目行 ⋯ 菜单 | ✅(但只有一项,见 A2) | 覆盖卡片文字(popover 正常行为) | ✅ Esc | ✅ | `30-phone-project-row-menu.png`, `31-phone-after-row-menu-esc.png` |
| Settings(手机) | ✅ | 无 | ✅ | ✅ | `32-phone-settings-root.png` |
| Settings → Appearance(手机) | ✅ | 无(见 D4 双标题、D2 clamp 破损) | ✅ | ✅ | `33-phone-settings-appearance.png` |
| Actions palette(手机) | ✅ | 无 | ✅ Esc | ✅ | `34-phone-actions-palette.png`, `35-phone-after-actions-esc.png` |
| Quick switcher(手机 Sessions 按钮) | ✅ | 无 | ✅ Esc | ✅ | `36-phone-quick-switcher.png`, `37-phone-after-switcher-esc.png` |
| 快速连点(6× toggle;Files→Updates→Terminal 各 120ms) | ✅ | 无(最终状态收敛正常) | — | — | `50-phone-stress-after-rapid-toggle.png`, `51-phone-stress-after-rapid-tools.png` |
| 桌面 boot / 项目 / 聊天 | ✅ | 见 A1(meter 同样存在) | — | — | `60-desktop-boot.png`, `61-desktop-project.png`, `62-desktop-chat.png` |
| 桌面 Settings / Appearance / Actions / Quick switcher(mod+p) | ✅ | 无 | 见 A4(Esc 一次未关,不稳定) | ✅ | `63/64/65/67-desktop-*.png` |

**总体**:没有发现"两整页互相叠画"的硬叠层——手机导航/聊天/工具面板都是整屏替换(`main.navigation-view chat-view … { display:none }`,PiWebApp.ts:175-179;workspace-view 同理,168-171)。owner 感知的"叠成一堆"最接近的真实缺陷是 **A1(进度条横条压在消息卡 sticky 头上,双端复现)** 与 **A2(行菜单 popover 盖住卡片文字且只剩一项)**;另有快速切换器 chips 被面板边缘切断(A3)。

---

## A. 重叠 / 堆积证据(点名两个 surface + 截图)

### A1(主发现)conversation-meter 横条压在第一条消息卡片的 sticky 头上 —— 手机+桌面都复现
- 两个 surface:**`conversation-meter`**(滚动位置指示条)与 **`.msg > .msg-header`**(消息卡 sticky 头)。
- 实测(手机 393×850@2x,session "Standing instruction…"):meter 盒 y=86..98、z=6、宽 381;sticky 头 y=90..119、z=4 → **重叠 8px**,紫色轨道+圆形 marker 正好横跨卡片顶边,视觉上像一根"压在卡片上的滚动条"。
- 第二次独立复现:另一 session("Slow Lighthouse Keeper Story",41-phone-goals-tab.png)同位置同样重叠;桌面 1280 同样可见(`62-desktop-chat.png`、`67` 中未滚动时位于 Goals 条下方)。
- 归属样式:`src/client/src/components/ConversationMeter.ts:32`(`:host { position:absolute; top: calc(-1 * var(--pi-space-2)); z-index: 6 }`,track/progress `border-radius: var(--pi-radius-pill)`,marker 50% 圆)vs `src/client/src/components/ChatView.ts:379`(`.msg > .msg-header { position: sticky; top: var(--pi-chat-sticky-top); z-index: 4 }`)。挂载点 ChatView.ts:1613。
- 判定:真实视觉缺陷(读作滚动条/叠层)。两表面名、截图:`14-phone-chat-top.png`(3x 特写最清楚)、`41-phone-goals-tab.png`、`62-desktop-chat.png`。

### A2 项目行 ⋯ 菜单弹出后覆盖卡片文字,且菜单只有一项 "Close"
- 两个 surface:**action-menu-panel(fixed z=30)** 与 **项目卡片文字**(`.action-main` 里的路径行)。
- 实测(手机):面板 120×54 @ (67,200),唯一子项文本 "Close",正好压住 "test" 卡的路径文字 `/private/tmp/test`。
- 归属:`pi-web-plugins/workspaces/browser/ProjectList.ts:122-127`(菜单模板只有 `<button title="Close project">Close</button>`);面板样式 `src/client/src/components/shared.ts:483-488`。
- 注:菜单内容只有一项是插件现状(非渲染 bug);但渲染标签 "Close" 丢掉了 title 里的宾语("Close project"),在项目网格上读作"关闭这个弹窗"。重叠本身是 popover 常规行为,列为轻微。截图:`30-phone-project-row-menu.png`。

### A3 Quick switcher 的项目 chips 行在面板右缘被切断(双端)
- 两个 surface:**filter chips 行** 与 **switcher 面板右边框**。手机:`36-phone-quick-switcher.png` 最右 "opus-b" 半个字母被切;桌面:`67-desktop-modp-switcher.png` "defi…" 被切。
- 行本身可横向滚动但刻意隐藏滚动条:`src/client/src/components/QuickSwitcher.ts:465-466`(`.filters { overflow-x: auto; … scrollbar-width: none }`)。切断处无渐隐/提示。判定:轻微(可滚动但无 affordance)。

### A4(不稳定,单次复现)桌面 Actions palette 对 Esc 的响应不一致
- 一次复现:打开 palette → Esc → 500ms 后 DOM 里 `action-palette` 仍在(`65/66-desktop-*.png` 相同画面);复检(同一操作序列)Esc 正常关闭(count=0)。手机端 Esc 两次均正常。判定:不稳定观察,建议单独核查 ModalSurface 的 Esc 焦点前提(`src/client/src/components/ModalSurface.ts` 键处理依赖焦点在 surface 内)。无截图差异证据(两图相同即证据)。

---

## B. Pro look 半径语言破裂(pill/圆 vs 0–4px)

发布的方角刻度:`src/client/index.html:55-63`(`--pi-radius-xs:0 … --pi-radius-xl:4`,pill=999 仅供徽章类)。以下控件把 pill 用在了"按钮/条"上:

| # | 位置 | 值 | 归属 | 对比面 | 截图 |
|---|---|---|---|---|---|
| B1 | 手机 compact header 的 Settings/Actions 折叠按钮 + 圆形 fold 按钮 | `--pi-radius-pill`(=999px 圆) | `AppNavigationPanel.ts:444`(`--pi-header-control-radius: var(--pi-radius-pill)`,注释自认 "The compact row speaks pills")+ `:460`(`.compact-header-action { border-radius: var(--pi-radius-pill) }`) | 桌面同一头部位置 `header-icon-action`/`Actions` 是 2px 方角(实测 r=2px) | `06-phone-more-actions.png` vs `60-desktop-boot.png` |
| B2 | 面板边缘的 edge-button(折叠手柄) | 999px 圆 | `AppPanelEdgeControl.ts:212`(`border-radius: var(--pi-radius-pill)`) | 同屏一切方角;`AppRefreshControl.ts:40` 还会继承 B1 的 pill 变量 | `62-desktop-chat.png` 左右缘 |
| B3 | Quick switcher 内:机 tabs 方 vs 项目 chips 圆(同一 surface 相邻两行) | tab `--pi-radius-md` top-only vs chip `--pi-radius-pill` | `QuickSwitcher.ts:460`(machine-tab)vs `:469`(`.chip { border-radius: var(--pi-radius-pill) }`) | 同屏 | `36-phone-quick-switcher.png`, `67-desktop-modp-switcher.png` |
| B4 | pill 徽章族(activity-dock "idle"、drawer-tab 数字、tool-badge、unread 计数、environment override) | pill | `ChatView.ts:224,160`;`AppNavigationPanel.ts:480`;`SessionList.ts:710`;`SettingsGeneralPanel.ts:281` | 方角语言 | `13-phone-chat.png`(idle)、`63-desktop-settings.png`(override) |

判定:B1/B2/B3 是明确的风格破裂(B1 的注释说明这是上一代设计的残留:"The compact row speaks pills");B4 徽章类 pill 可辩护为有意,但与"0-4px 方角"的对照需要 owner 裁决(列为产品决定,非 bug)。

---

## C. 间距 / 尺寸节奏(附实测数字)

### C1 同一表单里 input 32px vs select 43px(桌面 Settings→General)
- 实测(1280):Port 输入框 h=32,"Allowed hosts" select h=43;手机(393)两者都 44 ✓。
- 归属:`src/client/src/components/settings/settingsControlStyles.ts:16`(`button, input, select { min-height: var(--pi-control-height) }` 只管 min-height;原生 select 在 16px 字号下的 UA 固有高度把 32 顶到 43)。
- 对比面:同一表单相邻控件。截图:`63-desktop-settings.png`(Port 薄、Allowed hosts 厚,肉眼可见)。

### C2 "Search sessions" 同名搜索框两种字号:17px vs 16px
- 实测:Quick switcher 搜索框 fs=**17px**(`--pi-text-lg`),两个抽屉的搜索框 fs=**16px**(`--pi-control-font-size`)。高度一致(桌面 36/36,coarse 44/44/44)。
- 归属:`QuickSwitcher.ts:417`(`font: var(--pi-text-lg) …`)vs `shared.ts:243`(`.list-search-input` → `var(--pi-control-font-size, 14px)` = index.html:146 的 16px)vs `SessionList.ts:792`(同 16px)。
- 对比面:QuickSwitcher vs SessionList/ProjectList。截图:`36-phone-quick-switcher.png` vs `12-phone-project-sessions.png`。

### C3 上下文 chips 的值文字随容器宽度 11px↔13px 跳变(核verified 机制)
- 归属:`AppContextSwitcher.ts:118-123`:`@container (max-width: 140px) { .chip-label { display:none } .chip-value { font-size: var(--pi-text-2xs) } }` —— 值字号由 step 容器宽度决定,不由 surface 决定。
- 实测:桌面 1280 rail 每 step w=103(<140)→ 值全为 **11px**(projects 视图与 sessions 抽屉都如此);>140px 的 step 会渲染 13px(`.chip-value { font-size: var(--pi-text-sm) }`,:111)。owner 报告的"projects 11px / sessions 13px"与此机制吻合(哪一步隐藏、rail 多宽决定落在哪一侧);同屏步进 103px 时三类 chip 全 11px。手机上 compact header 不渲染 chips,context sheet 是另一种钻取 UI(无 chip)。
- 判定:同类元素一个尺寸 per 布局的原则被容器查询打破;归 `AppContextSwitcher.ts:118-123`。截图:`60-desktop-boot.png`(11px 值)。

### C4 列表 section 的手机内边距是"三处拼装"的 6/10/10,与桌面 16px 及聊天 6px 不同
- 实测:
  - 桌面:`project-list section` padding **16px**;`session-list section` **16px**;`tools-section` **16px**。
  - 手机:同两个 section padding **6px 10px 10px**(顶 6、侧 10、底 10);`tools-section` **10px**;聊天卡片/ composer gutter **6px**(`--pi-chat-gutter`,index.html:206-207)。
- 归属(拼装链):基础 `section { padding: var(--pi-reading-edge) }` = `shared.ts:256`;手机把 token 改成 10px = `index.html:205-207`(`@media (max-width:640px) { --pi-reading-edge: var(--pi-space-5) }`);顶 6px = `shared.ts:276-279`(`@media (max-width:760px) { section { padding-top: var(--pi-space-3) } }`);tools-section = `AppNavigationPanel.ts:470`。
- 判定:聊天 6px 是有意的(注释:conversation 和 composer 共享 gutter,index.html:202-204),但同一手机屏上"列表 10 / 工具区 10 / 聊天 6 / 顶部 6"四值并存且无单一 owner,正是"spacing feels globally uneven"的可核查样本。

### C5 列表行 vs 卡片瓦片:同源组件两套 padding/radius
- 实测(两端一致):列表行 `.action-main` pad **8/8**、r=2px;瓦片 `.list-body.tiles .action-main` pad **10/10**、r=3px;`list-body` 容器 pad 4px 2px(瓦片)vs **0**(会话列表)。
- 归属:`shared.ts:300`(tiles pad 10 + radius-lg)vs `shared.ts:361`(行 pad 8,无 radius);容器 `shared.ts:291`(tiles pad 4px 2px)。
- 对比面:同一 nav 面板里 Projects(瓦片)与 Sessions(列表)。判定:轻微(瓦片是"卡"语义,可辩护),但 8 vs 10 的纵节奏差是 owner 可感的。

### C6 同类标题两种字号:手机 compact 标题 13px vs 桌面 session-title 14px
- 实测:手机 `compact-scope`/`compact-session` fs=13px(`AppNavigationPanel.ts:445` 的 `--pi-text-sm`);桌面 `app-context-bar .session-title` fs=14px(`font: inherit` 继承 app base 14,AppContextBar.ts 样式块未设字号)。
- 对比面:同一个"当前会话标题"控件的两端形态。判定:轻微。

### C7 搜索框高度(ProjectList vs SessionList,coarse)—— 实测相同(裁决 owner 线索 3)
- 实测:桌面 36/36;手机 393 coarse 44/44;900/1024 coarse 44/44。**两个列表的搜索框高度一致**,不能复现差异。真正分裂的是 C2(QuickSwitcher 17px)。
- 归属(两处同配方的重复实现,非差异):`shared.ts:243,252-254`(ProjectList 用)与 `SessionList.ts:792,806-808`(自持一份)。判定:owner 线索按字面 **not reproduced**;同配方双实现本身是维护性味道。

### C8 panel-toggle 用到 UA 13.3333px(测试套件自己点名的那类 bug,今天还活着)
- 实测:`app-context-bar .panel-toggle` fs=**13.3333px**(UA 默认),因其 shadow root 的 `button` 规则(`AppContextBar.ts:73`)只设 cursor/touch-action 无 font。视觉无害(内含 SVG),但 `designTokens.test.ts:156-160` 明文把 "13.333px、不在任何刻度上" 列为要消灭的 bug 类,而该测试只扫共享 sheet,扫不到这个 shadow root。判定:真实(测试盲区 + 注释与现实脱节)。

### C9 `--pi-control-font-size: 16px` 不在 published type scale 里
- `index.html:146` 定义 16px,而 scale 是 11/12/13/14/15/17/20(index.html:39-45)。16px 同时出现在两个列表搜索框与 settings 输入上,是"published scale 有洞"的实例。判定:刻度完整性问题(需 owner 决定 16 是新刻度成员还是应改 15/17)。

### C10 同一抽屉里两个"创建"动作重量不同:实心 accent vs ghost
- "＋ New session" 实心 accent 蓝底(`SessionList.ts:725`),"＋ Add project" ghost 描边(`shared.ts:266` `.section-add`)。
- 对比面:同一 nav 面板相邻 section 头。Quick switcher 里的 "+ New session" 又是第三种形态(大号蓝色描边卡,QuickSwitcher)。判定:可能是主次设计,但同一动作三种形态值得 owner 裁决。截图:`50-phone-stress-after-rapid-toggle.png` vs `05-phone-boot.png` vs `36-phone-quick-switcher.png`。

---

## D. 面板内部不一致(sibling 应一致而不同)

### D1 主题卡:Pro (native) 的预览与所有其他主题卡不同构
- 其他卡 = 迷你窗口框(表面+两条线+4 个彩点,h=64);Pro (native) = 无框三条灰线(h=47.5)。同网格同高卡片(183/193px)里两种预览解剖。
- 归属:`SettingsAppearancePanel.ts:70,169-171`(`.pro-preview`)vs `:104-131,173-176`(`.preview` 窗口 + dots)。判定:有意("the core's own look",:56-57 注释)但同网格异构,建议给 Pro 卡也画一扇无彩色的"窗"。截图:`33-phone-settings-appearance.png`, `64-desktop-settings-appearance.png`。

### D2 Pro (native) 卡描述在手机上 line-clamp 渲染破损(第三行被切一半)
- 实测(手机 393):`.theme-description` 盒高 **38.3px**(≈2.28 行),文本换行成 3 行,`-webkit-line-clamp: 2` + `overflow:hidden` 下第三行 "theme extension" 以半行高度露在卡底边处被切;桌面同文案 2 行正常收尾。
- 归属:`SettingsAppearancePanel.ts:163-164`(`display:-webkit-box; -webkit-line-clamp:2; min-height: calc(2*1.4em); overflow:hidden`)。判定:手机 393 宽下的真实渲染缺陷。截图:`33-phone-settings-appearance.png`(Pro 卡下半)。

### D3 同心圆角注释已死(半径换到 pro 刻度后算式失效)
- `SettingsAppearancePanel.ts:166-168` 注释:"Card lg(12) - space-5(10) = 2 for the preview inside the card"。现在 `--pi-radius-lg` = **3px**(index.html:58)→ `calc(var(--pi-radius-lg) - var(--pi-space-5))` = −7 → `max(--pi-radius-xs, …)` = 0。注释描述的"两弧保持平行"的设计在 pro 刻度下恒为 0,文档与实现脱节。判定:注释/设计漂移(低危,但说明半径切换没有同步审计这些派生算式)。

### D4 手机设置钻取页出现双标题 "Appearance/Appearance",且各节策略不一致
- 机制:手机 detail 头渲染 `<h1>${detailTitle()}</h1>`("Appearance",`SettingsDialog.ts:205-211` + `:231` 映射),面板框又渲染 `<h2>Appearance</h2>`(`SettingsAppearancePanel.ts:34` → `SettingsPanelFrame.ts:48-51,101`)。
- 不一致:General 节用改词避开("General configuration",`SettingsGeneralPanel.ts:58`),Machines/Appearance 不避(`SettingsMachinesPanel.ts:37` heading="Machines")。判定:真实(同屏同词两遍;桌面双栏布局只有一处标题,不受影响——这本身也是两端结构差异)。截图:`33-phone-settings-appearance.png`。

### D5 工具面板标题与抽屉 tab 不一致(仅 Tasks 面板)
- tab "Tasks"(`pi-web-plugins/workspace-tasks/pi-web-plugin.ts:29`)→ 打开的面板标题 "Workspace Tasks"(`tasksPanelElement.ts:77`);Files/Relays/Updates/Info 的面板标题与 tab 同词;Terminal 面板头无标题(只有 "+ Shell")。判定:轻微命名不一致(六个兄弟面板两种做法)。

### D6 注释漂移:字体栈注释仍描述旧 sans 设计
- `index.html:128-130` 注释 "UI prefers the platform's own interface face (SF, Segoe, Roboto)…mono is the terminal's face",而 `:139-141` 三个栈全部是 ui-monospace(pro native)。判定:文档漂移(说明 pro 化是"换 token"完成,周边解释文字未同步)。

---

## E. Owner 补充四条线索的裁决

1. **"间距全局不均"** — 成立,已量化:C4(6/10/10 vs 16 vs 6 的拼装)、C5(8 vs 10)、C1(32 vs 43)、C2(16 vs 17)。最实的一击是 C1(同表单 32 vs 43)与 C4(手机 6/10/10)。
2. **"chips 11px(projects) vs 13px(sessions)"** — 机制成立:`AppContextSwitcher.ts:118-123` 容器查询按 step 宽度切 11/13;实测桌面 rail(103px steps)两视图全 11px,>140px step 即 13px。手机无 chips(sheet 是钻取列表)。
3. **"ProjectList 与 SessionList 搜索框 coarse 高度不同"** — **not reproduced**:36/36(fine)、44/44(coarse@393 与 @900/1024)全部相等。真正被证实的是 C2 的字号差与"同配方两处维护"(shared.ts:243/252 vs SessionList.ts:792/806)。
4. **"手机 sessions 抽屉 bulk-select 勾选框压住 'Sessions' 标题"** — **not reproduced at 393×850/DPR2/默认内容**:实测 h2 文本 "Sessions" 止于 x≈68,勾选框起于 x=105.5(44×44),间隙 37px;三连截图 `70-phone-sessions-header.png`(3x)无重叠。**结构风险属实**:`.subheading` h2 是全宽 flex 行(shared.ts:258 + SessionList.ts:703-708 `h2 { … } h2 > .bulk-select-entry { margin-left: auto }`),标题文本无 ellipsis、无预留 gutter(h2 实测 w=373 全宽、三个控件浮在其上),标题变长/系统字体放大即会相撞。建议给 h2 文本加 `min-width:0; overflow:hidden; text-overflow:ellipsis` 或为控件组预留固定槽位。

---

## F. 修复优先级建议(按 owner 可感度)

1. **A1** conversation-meter 与 sticky msg-header 的 8px 重叠(双端,天天可见)→ 给 meter 挪出 sticky 层或让 chat 顶部预留 meter 高度(ChatView.ts:205 的 `padding: var(--pi-space-9) …` 需要吸收 meter 的 12px)。
2. **B1/B2** 手机 header pill 族与 edge 圆钮换回 `--pi-radius-md/lg`(AppNavigationPanel.ts:444/460、AppPanelEdgeControl.ts:212)。
3. **C1** select 高度对齐 input(settingsControlStyles.ts:16 需针对 select 的实际高度,不只是 min-height)。
4. **D4** 手机设置节标题去重(Appearance/Machines 对齐 General 的做法)。
5. **D2** Pro 卡 clamp 破损(393 宽)。
6. **C2/C9** 搜索框字号统一到 scale(17 vs 16;16 是否入 scale 请 owner 定)。
7. **A3** switcher chips 切断(渐隐或显示滚动提示)。
8. **C3** chips 容器步降改为同字号策略(11/13 二选一)。
9. 其余(C5/C6/D5/D6/A2 标签语义)为打磨项。

## G. 截图索引(/tmp/pro-walk/)
00,02a,05,06,07,10,12,13,14(3x 特写),20,21,22,22a,23-(terminal/tasks/relays/updates/info),30,31,32,33,34,35,36,37,40,41,50,51,52,60,61,62,63,64,65,66,67,70(3x header 特写),71(tablet coarse)。

## H. 未覆盖(诚实清单)
- AskUserCard / ExtensionDialogCard / model picker / thinking picker / Auth 与机器添加对话框、context sheet 内的机器/项目钻取二级页、长按(contextmenu)手势、软键盘弹起的 keyboard-inset 行为、goal 命令流程、ChatView 内 image zoom。这些不在本次两视口走查内。
- A4(Esc 不关 palette)为单次复现,判定为"不稳定观察",非结论。
