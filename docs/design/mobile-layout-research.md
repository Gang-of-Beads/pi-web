# Mobile/client layout research: pages, selection placement, and the plugin seams

Status: research in progress (goal mtqz5cwp-rndk4v). Evidence base: live 8505
stack, `scripts/research-layouts.mjs`, screenshots under
`/tmp/layout-research/{mobile,desktop}/` (393x850 coarse pointer and 1280x800),
geometry dumps with per-surface tap-target audits.

## 1. 实测矩阵（现状记录）

### 1.1 Boot 导航（mobile/01-boot-nav.png, desktop/01-boot-nav.png）

- 手机 boot 直落 Projects 网格：两列卡片，每卡 = 名称 + cwd 截断 + 徽标点 + `⋯` 行菜单。
  顶部三段：`Sessions` 折叠区标题、机器 chip（PI WEB + ⚙ + Actions）。
- 观察点：
  - `Add project` 按钮 32px 高，低于 44px 粗指针下限（metrics: 32x102）。
  - 项目卡 `⋯` 菜单为次要操作但与卡片同高可点；卡片主区与菜单的命中区分完全靠位置，无视觉分隔线。
  - `Sessions` 区在 Projects 之下折叠（▾），选择位置把"会话"放在"项目"之后——路径是 machine → project → workspace → session 的 drill，boot 不直达会话。
  - 桌面 boot 是三栏（nav panel + chat + Info panel），手机是单列 drill；同一组件树两种布局形态。
- 与插件的关系：boot 页的项目/工作区/会话列表已是 workspaces 插件贡献（ProjectList/WorkspaceList/SessionList 组件在插件树内）；机器 chip 是 machines 插件。

### 1.2 Context sheet（mobile/02-context-sheet-machines.png）

- 从机器 chip 呼出的全屏 sheet：Machines → Projects（内嵌搜索 + Add project）→ Workspaces → Sessions 四段纵向。
- 观察点：
  - "Projects" 段标题与内嵌 ProjectList 自己的 "Projects" 小标题重复出现（视觉重复；源码：ContextSwitcherSheet.ts:39 宿主 h2 + 贡献组件内部标题，display flag 无 bare 模式）。
  - Machines 行选中态红/橙边框：核实为主题 accent（shared.ts:342 `.action-row.selected { border-color: var(--pi-accent) }`），与会话行/项目行一致，非孤例（初判撤销）。
  - Sheet 内 Projects 行是完整列表而非最近常用子集；长列表在 sheet 中滚动，段与段之间无吸附或分组锚点。
  - 关闭按钮 44x44（ContextSwitcherSheet.ts:91），合规。

### 1.3 Project → 会话列表（mobile/03-project-sessions.png, desktop/03-project-sessions.png）

- 手机：顶部上下文条（session 标题 + 机器 chip + Actions）、Sessions 工具行（全选、unread 计数、Clean up、+ New session）、搜索、会话行列表、底部 2x3 插件面板 tile 网格（Files/Terminal/Tasks/Relays/Updates/Info）。
- 观察点：
  - `Clean up` 27x66（metrics 最小 27x66）、`Select current sessions` 36x36——工具行的次要按钮低于/贴着 44px 下限。
  - tile 网格是插件面板的入口（files/git/relays/terminalSessions/updates 等插件贡献）；2 列网格在内容为空的插件上仍然全额占位（Relays 空态一整屏）。
  - 桌面同一表面是三栏 + 右侧 Info panel 常驻 + tile 网格在 nav 栏底部。
- 与插件的关系：tile 网格是 panels 缝（workspace panels）的入口面；每个 tile 打开的面板由插件提供（panelHeading + panel body）。

### 1.4 聊天视图（mobile/05-chat.png, desktop/05-chat.png）

- 手机纵向结构：上下文条（☰ + 标题）→ 抽屉折叠 chip（Goals ›）→ 转录 → waiting/ask 行 → composer（draft 行 + 模型 chip + 工具簇）→ 状态条（token/成本）。
- 观察点：
  - 扩展对话框（Update all/Skip…）渲染在转录流内，占约 60% 视口高度；它把 composer 推到屏幕下缘——这是 pending-input-stability spec 的"waiting area"场景，实测中 ask 行与 composer 同时可见，符合规范。
  - 抽屉 chip "Goals ›" 22x49（metrics 最小 22px 高）——高度不足 44，靠 49px 宽度补偿；展开箭头在右端但整个 chip 才是命中区，视觉上 chip 与箭头是两个目标。
  - composer 工具簇：模型 chip、usage meter、○、Dictate、发送、停止——六个目标横排，停止按钮为方形小目标（方块图标无文字），粗指针下与发送相邻。
  - 状态条常驻（token/ctx/cost），占一行高度；它不是插件缝（native StatusBar，owner ruled）。
- 桌面对照：同结构三栏，右侧 Info panel 常驻（Expand panel 可折叠），composer 工具簇同款横排。

### 1.5 抽屉展开（mobile/06-drawer-expanded.png）

- Goals 段展开后：段标题 "Goals" + 刷新按钮 + 空态句。抽屉体占约 12% 视口（空态），无内容时也保留段框与标题行。
- 观察点：
  - 空态文案 "No goals recorded for this workspace." 符合 honesty（有完成的读才说空）。
  - 展开时转录被压缩到剩余空间，但 ask 对话框（fixed 定位）不受影响——符合 panel-load-honesty/pending-input 的分层。
  - 段标题行没有关闭整段抽屉的次级操作；折叠只靠 chip 本身（展开/收起同点）。

### 1.6 插件面板（mobile/04-panel-*.png）

- Files：**裸 HTML 形态**——"Upload/Refresh" 是原生样式按钮、文件列表是裸链接文本、"Select a file." 居中空态。与全应用的卡片/字体系统完全脱节（metrics: Upload 21x58）。
- Updates：内容丰富（installed services + suggested commands），但 Copy/Run 按钮 29-30px 高，命令文本横向溢出截断（无换行/复制整行 affordance）。
- Relays：空态诚实（"No relays in this workspace." + 路径提示），但整屏只有一段文字 + 右上 30x30 Refresh。
- Tasks/Info：结构化卡片，布局尚可；Info 在桌面是常驻第三栏、手机是 tile 面板，同一插件两种宿主形态。
- 观察点（横向）：**六个插件面板的手机形态质量参差**——files 是未设计态、updates 是功能全但触目标不达标、relays/tasks/info 是可接受态。面板宿主（panelHeading/panel body 缝）没有对插件面板施加共享的布局/样式基线。

### 1.7 设置（mobile/07-settings.png）

- 设置是全屏列表（General/Appearance/Machines/Session daemon/Pi packages/PI WEB plugins/Keyboard），每行标题 + 副题 + ›。
- 观察点：
  - 行高充足、层级清晰——这是全应用里手机形态最成熟的列表。
  - "PI WEB plugins" 是插件 settingsSections 缝的宿主入口（插件贡献进 Machines/General 等 section）。
  - 无搜索/过滤；七个入口一屏放下，暂不需要。

### 1.8 Dock（05-chat/06-drawer-expanded 中可见）

- ask 态："Waiting for your answer" 黄色胶囊，位于转录与 composer 之间。
- 后台工作胶囊（紫色、非交互 div）在无后台工作时缺席——诚实缺席。
- 桌面同位。

## 2. Tap-target 审计（393x850，metrics 汇总）

每表面交互元素与 <44px 目标（完整 JSON 在 /tmp/layout-research/）：

| 表面 | 交互元素 | <44px | 最小目标 |
|---|---|---|---|
| boot-nav | 32 | 12 | Add project 32x102 |
| context-sheet | 65 | 12 | Add project 32x102 |
| project-sessions | 28 | 11 | Select current sessions 36x36 |
| panel-files | 7 | 4 | Upload 21x58 |
| panel-updates | 12 | 10 | Copy 29x47 |
| panel-relays | 3 | 1 | Refresh 30x30 |
| chat | 208 | 12 | Goals chip 22x49 |
| settings | 216 | 12 | 同 chat（共用壳） |
| desktop boot-nav | 38 | 12 | Actions for test 32x32 |

（桌面 chat 系列的 12 个 <44px 全部来自 nav 栏残留的会话行菜单，同一组。）

## 3. 插件 seam × layout 关系（task-2，源码核对完毕）

核对基线：`src/client/src/plugins/types.ts`（各 Contribution 接口）、`registry.ts`（qualify/get）、消费点（PiWebApp/AppNavigationPanel/ContextSwitcherSheet/PromptEditor/ChatView/SettingsDialog/WorkspacePanel）。

| Seam | 落位表面 | 消费点 | 无贡献时 | 对布局的约束 |
|---|---|---|---|---|
| navSections | ① AppNavigationPanel（手机=整个 boot drill 面；桌面=340px 左栏）② ContextSwitcherSheet（Projects→Workspaces→Sessions 段） | PiWebApp.ts:2149（panel）/3788（sheet）；context 带 `surface: "panel"\|"sheet"`，一个贡献要同时伺服两形态 | 槽位渲染为空；面板只剩机器 chip+设置 | 手机上它就是页面本身；列表行高/搜索框/tile 网格全由贡献方（workspaces 插件）决定 |
| machineSections | ① nav 面板机器 chip（localId=="machines" 特判）② sheet 的 Machines 段 | AppNavigationPanel.ts:227/251/266；ContextSwitcherSheet.ts:21 | 无机器 chip、sheet 无 Machines 段 | 手机唯一的机器入口就是 chip（⚙ 32px + Actions）；触面小 |
| drawerSections | 仅 ChatView 顶抽屉（chip 行→展开段） | ChatView.ts `renderTopDrawer()` ~1050；`topDrawerKey` 按 [machine,workspace,session] 作用域 | 抽屉整体不渲染（诚实缺席，不是空壳） | 折叠=一行 chip（22px 高）；展开压缩转录但 ask 对话框（fixed）不受影响 |
| composerContributions | PromptEditor 工具簇（按 slot 过滤）+ 输入下方 status 行 | PromptEditor.ts:737/757 | 工具簇缩回原生六件套 | 393px 已横排 6 目标；每加一个贡献挤压发送/停止的命中区；status 行可动态占高 |
| messageRenderers | 转录流内（claim 自定义 tag） | ChatView.ts:1659 `findMessageRenderer` | unknown-tag 诚实卡 | 内联渲染可占手机视口 ~60%（更新对话框实测）；影响阅读位置，composer 仍可达 |
| settingsSections | SettingsDialog 各 section（含插件节） | PiWebApp.ts:3830 `.pluginSections` | 列表更短 | 手机全屏行列表，行高足；无过滤但暂不需要 |
| workspacePanels | ① tile 网格入口（2x3）② 手机全屏面板/桌面右栏 | PiWebApp.ts:2611 `visibleWorkspacePanels()`；AppShell 网格第 5 列 `minmax(340px,32vw)`，fullscreen 类收成单列 | visible() false 不出 tile；零面板无网格 | **宿主对面板体零样式基线**——七个插件（files/info/relays/terminal/updates/tasks/git）各写各的 HTML；files 裸按钮 21px、updates 29px 即证据 |
| workspaceLabels | 经 NavSectionContext.labelItems 进入 workspaces 插件的列表行 | PiWebApp.ts:2684→registry.getWorkspaceLabelItems | 行内无标签件 | 与 navSections 同生命周期（panel/sheet 双形态） |
| actions / themes | 命令面板（quick switcher）/ 设置外观页 | getDefaultActions、getThemes | 略 | 对 layout 无独立表面 |

关键结构性发现：

1. **双形态伺服是 navSections 的内建复杂度**——panel 与 sheet 共用一个 context，靠 `closeSheet` 区分；手机与桌面的差异不是断点样式，而是两种宿主形态（drill 全屏 vs 340px 栏），贡献方必须一次写对两种。
2. **workspacePanels 是唯一无样式契约的缝**——其余缝都渲染进宿主壳（有宿主 CSS），只有面板体是插件自由 HTML。手机形态质量参差直接源于此。
3. **抽屉是纯贡献驱动**（contributed-only-session-drawer 提案落地后），无贡献=无 chip=无布局占位；这是各缝里缺席语义最干净的一个。
4. **composer 是零和空间**——工具簇横排无换行，贡献越多原生目标越小；status 行是唯一可纵向生长的位置。

## 4. 问题清单与优化机会（task-3 分拣）

实测证据（§1/§2）× seam 结构（§3）交叉后的分拣。P0=违反已立规范或触不可用；P1=一致性问题；P2=机会。

### P0（规范违反/触达，带证据）

1. **workspacePanels 无样式/触面基线**。证据：pi-web-plugins/files/filesPanelElement.ts:103-104（`<button @click=...>Upload</button>` 无 class 无样式），实测 Upload 21x58、原生素钮外观；updates Copy/Run 29-30px。对照：interactiveSurfaceContract（宿主自有元素执行 44px）与 AGENTS.md "coarse-pointer floor" 规则只约束宿主。最小失败场景：手机上 Upload/Refresh 触碰命中率低、视觉与应用脱节。代价分级：宿主面板 body 基线样式（小）vs 插件 API 契约（大，跨仓）。
2. **抽屉 coarse 触面规则被自己人打败**。证据链：ChatView.ts:164-168 coarse 媒体查询设 `.drawer-collapse { width:44px; height:44px }`，但 ChatView.ts:171 base `.drawer-collapse { width:32px; height:32px }` 写在媒体查询**之后**——同特异性后者胜，coarse 44px 死代码。实测（research-drawer-targets.mjs，393x850 coarse）："Show session sections" 实际渲染 **32x32**。旁边注释（:159-163）自己写着 "Placed after every base declaration it overrides... the same rule written earlier in the sheet loses"——修复违反了自己的放置原则。最小失败场景：手机上抽屉开合命中区只有 32px。修复代价：小（把 32px base 移到媒体查询前）。另：drawer-tab（Goals chip）min-height 22px（ChatView.ts:152）无 coarse 覆盖，实测 22x49，同病。
3. **boot 页 `Add project` 32x102、desktop `Actions for test` 32x32**——主操作低于粗指针下限。证据：research-layouts.mjs metrics；按钮出自 workspaces 插件贡献（pi-web-plugins/workspaces/browser/ProjectDialog.ts:282 / MachineList 同族）。最小失败场景：boot 页误触相邻卡片。代价：小（贡献组件触面 class）。

### P1（一致性）

4. ~~context sheet 选中态用警示色~~ **判为不成立，撤销**：`.action-row.selected`（shared.ts:342）统一用主题 accent；截图中的红/橙是 clay 主题 accent 本色，机器/会话/项目行全部一致。
5. **sheet 内 "Projects" 标题重复**。证据：ContextSwitcherSheet.ts:39 宿主 `<h2>Projects</h2>` + :42-44 嵌入贡献的 projects navSection（`withCreate: true`）→ ProjectList 组件自带 "Projects" 工具栏标题。根因：NavSectionDisplay flags（hidden/collapsible/collapsed/tiles/withCreate）没有 bare 模式，宿主段标题与组件标题无法协调。最小失败场景：sheet 里连续两行 "Projects"。代价：display 加一个 flag（小）或 sheet 去掉宿主 h2（更小，但机器段标题风格需跟着看）。
6. **手机工具行次按钮贴线**：`Select current sessions` 36x36、`Clean up` 27x66（SessionList 工具行）。不足 44 但属密集工具行；owner 裁决触面政策（全 44 或次要目标豁免）。
7. **面板 tile 空态全额占位**（Relays 空态 tile + 面板全屏空态）。honesty 正确（absence is not negation 达标）；布局机会：badge 缝已在（panel.badge），可空态弱化，但 tile-geometry spec 已规范网格——改动需过 spec，属 owner 决策。

### P2（机会，不急）

8. **composer 工具簇拥挤**：393px 六目标横排，停止按钮为无文字小方块。可评估：贡献位折叠进溢出菜单（slot 语义不变）、或停止按钮加大。
9. **updates 命令文本溢出截断**：Copy 按钮存在但截断的命令无法确认完整性；可换行或跑前预览。
10. **抽屉空态仍占整段框**：诚实但可再紧凑（空态时折叠高度减半）；与 contributed-only 提案的缺席语义一致性需 owner 裁决（空 vs 缺席的边界）。
11. **settings 无过滤**：七入口一屏内，暂不需要；插件节增多后回看。

### 不动项（有裁决在先）

- StatusBar 常驻（token/ctx/cost）：native 面（owner ruled）。
- tile 网格 2x3 几何：tile-geometry spec 已规范网格。
- ask 对话框内联转录流：pending-input-stability spec 覆盖，实测合规。
