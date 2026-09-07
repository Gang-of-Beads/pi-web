# Mobile/client layout research: pages, selection placement, and the plugin seams

Status: **research complete, bllm-reviewed（task-1..5 全部完成）**。Evidence base: live 8505 stack,
`scripts/research-layouts.mjs` + `research-drawer-targets.mjs` + `research-quick-switcher.mjs`,
screenshots under `/tmp/layout-research/{mobile,desktop}/`（393x850 coarse pointer 与 1280x800，21 张），
全量几何 `/tmp/layout-research/metrics.json`（评审后重跑版）。产品代码零改动；实施建议见 §6，待 owner 发令。

## 0. 截图索引

| 前缀 | 表面 |
|---|---|
| 01-boot-nav | boot 导航（机器 chip + Projects 网格 + 宿主 Sessions 折叠区） |
| 02-context-sheet-machines | 机器 chip 呼出的 context sheet |
| 03-project-sessions | project → 会话列表 + 插件 tile 网格 |
| 04-panel-{files,terminal,tasks,relays,updates,info} | 六个插件面板手机形态 |
| 05-chat | 聊天视图（含扩展对话框/ask/composer） |
| 06-drawer-expanded | 顶抽屉展开（Goals 空态） |
| 07-settings | 设置主列表 |
| 08-quick-switcher | 快速切换器（mobile only） |

## 1. 实测矩阵（现状记录）

### 1.1 Boot 导航（mobile/01-boot-nav.png, desktop/01-boot-nav.png）

- 手机 boot 直落 Projects 网格：两列卡片，每卡 = 名称 + cwd 截断 + 徽标点 + `⋯` 行菜单。
  顶部三段：`Sessions` 折叠区标题、机器 chip（PI WEB + ⚙ + Actions）。
- 观察点：
  - `Add project` 按钮 32px 高（实测 32x102）。归因：宿主 `shared.ts:272 .section-add { min-height: 32px }`（listStyles，经 PluginHostUi 下发到插件列表），非插件自有样式。
  - 项目卡 `⋯` 菜单为次要操作但与卡片同高可点；卡片主区与菜单的命中区分完全靠位置，无视觉分隔线。
  - `Sessions` 区在 Projects 之下折叠（▾），选择位置把"会话"放在"项目"之后——路径是 machine → project → workspace → session 的 drill，boot 不直达会话。
  - 桌面 boot 是三栏（nav panel + chat + Info panel），手机是单列 drill；同一组件树两种布局形态。
- 与插件的关系：boot 页 Projects/Workspaces 两段是 workspaces 插件贡献（pi-web-plugins/workspaces/browser/ 的 ProjectList/WorkspaceList）；**SessionList 是宿主组件**（src/client/src/components/SessionList.ts，AppNavigationPanel.ts:359 渲染）——贡献段全空时 boot 面板仍渲染完整宿主会话列表 + 工具行，列表行高/搜索框/tile 网格的样式源自宿主 listStyles。

### 1.2 Context sheet（mobile/02-context-sheet-machines.png）

- 从机器 chip 呼出的全屏 sheet：Machines（≥2 台才出现，ContextSwitcherSheet.ts:59 `machineCount() < 2 → null`）→ Projects（内嵌搜索 + Add project）→ Workspaces 三段纵向；无 Sessions 段（保留 navSection id 只有 projects/workspaces，AppNavigationPanel.ts:279 / ContextSwitcherSheet.ts:52）。
- 观察点：
  - "Projects" 段标题与内嵌 ProjectList 自己的 "Projects" 小标题重复出现（视觉重复；源码：ContextSwitcherSheet.ts:39 宿主 h2 + 贡献组件内部标题，display flag 无 bare 模式）。
  - Machines 行选中态红/橙边框：核实为主题 accent（shared.ts:342 `.action-row.selected { border-color: var(--pi-accent) }`），与会话行/项目行一致，非孤例（初判撤销）。
  - Sheet 内 Projects 行是完整列表而非最近常用子集；长列表在 sheet 中滚动，段与段之间无吸附或分组锚点。（上两行合并自初稿，保留观察）
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
  - composer 工具簇（393px 实见）：模型 chip、thinking 档位 gauge（:497，柱状图外观）、history（:683）、Dictate（voice 插件 composer 贡献）、发送、停止；attach（:389）上下文出现。共 6-7 目标横排。**全部 icon 按钮走 `.icon-button`：36px base、≤430px 40px、全文件无 coarse 规则**（PromptEditor.ts:78/:183）→ 手机上发送/停止实际 40x40。
  - 状态条常驻（token/ctx/cost），占一行高度；它不是插件缝（native StatusBar，owner ruled）。
- 桌面对照：同结构三栏，右侧 Info panel 常驻（Expand panel 可折叠），composer 工具簇同款横排。

### 1.5 抽屉展开（mobile/06-drawer-expanded.png）

- Goals 段展开后：段标题 "Goals" + 刷新按钮 + 空态句。抽屉体占约 12% 视口（空态），无内容时也保留段框与标题行。
- 观察点：
  - 空态文案 "No goals recorded for this workspace." 符合 honesty（有完成的读才说空）。
  - 展开时转录被压缩到剩余空间；**ask 卡不是 fixed 定位**——它在转录流尾（.waiting-slot，正常文档流，源注释 ChatView.ts:219-226 "Nothing is pinned"），随压缩后的转录滚动，仍可达但不钉在视口。
  - 段标题行没有关闭整段抽屉的次级操作；折叠只靠 chip 本身（展开/收起同点）。

### 1.6 插件面板（mobile/04-panel-*.png）

- Files：**裸 HTML 形态**——"Upload/Refresh" 是原生样式按钮、文件列表是裸链接文本、"Select a file." 居中空态。与全应用的卡片/字体系统完全脱节（metrics: Upload 21x58）。**根因是时序 bug 而非缺架构**（见 §4 P0.1）。
- Terminal：手机上唯一键盘替身。软键盘 min-height 34px、12px mono（pi-web-plugins/terminal/TerminalSoftKeys.ts:88），touch 设备默认启用（TerminalPanel.ts:52/:67）；初掃 3 个交互元素全达标，但软键本体 34px 高。
- Updates：内容丰富（installed services + suggested commands），但 Copy/Run 按钮 29-30px 高，命令文本横向溢出截断（无换行/复制整行 affordance）。
- Relays：空态诚实（"No relays in this workspace." + 路径提示），但整屏只有一段文字 + 右上 30x30 Refresh。
- Tasks/Info：结构化卡片，布局尚可；Info 在桌面是常驻第三栏、手机是 tile 面板，同一插件两种宿主形态。
- 观察点（横向）：**六个插件面板的手机形态质量参差**——files 是时序 bug 导致的无样式态、updates 是功能全但触目标不达标、terminal 软键 34px、relays/tasks/info 是可接受态。面板体基线（workspacePanelStyles）存在但未进下发缝（详见 §3/§4）。

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

### 1.9 Quick switcher（mobile/08-quick-switcher.png，宿主自有非插件缝）

- 从上下文条会话标题呼出。实测（research-quick-switcher.mjs）：Close 28x20、行菜单 32x32、上下文 chip 32px 高、machine-tab 36px、Add project 32x102；"Open settings" 26x44（窄但达 44 高）。
- 搜索输入 34px 高（shared.ts:259 `.list-search-input`）——首轮 metrics 过滤器只数 button/a，input 类目标漏计（已修脚本重跑）。

## 2. Tap-target 审计（393x850，全量 metrics）

**方法学说明（评审后重跑）**：初版脚本 `under44` 被 `slice(0,12)` 截断且 "worst" 从截断集取最小——表格数字系统性偏低且不可复核（三车道评审 F1 指出）。脚本已修：全量落盘 `/tmp/layout-research/metrics.json`（顺带 metrics.json 纳入 input/textarea/select），worst 按面积升序取全量最小；重跑后的真实数字如下。

| 表面（mobile） | 交互元素 | <44px | 面积最小目标 |
|---|---|---|---|
| boot-nav | 32 | 15 | Add project 32x102、导航折叠 48x14 |
| context-sheet | 65 | 31 | Add project 32x102 |
| project-sessions | 28 | 11 | Select current sessions 36x36 |
| panel-files | 7 | 4 | Upload 21x58 |
| panel-terminal | 3 | 0 | — |
| panel-tasks | 4 | 2 | Refresh 30x69 |
| panel-relays | 3 | 1 | Refresh 30x30 |
| panel-updates | 12 | 10 | Run 29x40 |
| panel-info | 2 | 0 | — |
| chat | 208 | **126** | 回填 composer 24x24（消息级 affordance：copy/info/回填/steer 图标 24-30px） |
| drawer-expanded | 209 | 127 | 同 chat |
| settings | 216 | 126 | 同 chat（共用壳） |
| quick-switcher | 149 | 71 | Close 28x20、chips 32px、machine-tab 36px |

- **chat 系 126 个 <44px 是真图景**：初版 "12" 是 DOM 截断假象。大头是转录内消息级操作（copy/info/回填 24x24-30px），其次是抽屉 chip 22px、collapse 32px。
- 桌面（1280x800，非 coarse）数字仅作记录，不用 44px 粗指针下限评判（初版把桌面 32x32 当违规是范畴错误，已撤）。
- input 类：搜索输入 34px（shared.ts:259）；chat 内 79 个 input 类目标多为隐藏/零尺寸测量噪声。

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
| workspacePanels | ① tile 网格入口（2x3）② 手机全屏面板/桌面右栏 | PiWebApp.ts:2611 `visibleWorkspacePanels()`；AppShell 网格第 5 列 `minmax(340px,32vw)`，fullscreen 类收成单列 | visible() false 不出 tile；零面板无网格 | **基线存在但未进下发缝**：workspacePanelStyles（shared.ts:145-215，含 button/toolbar/list/empty-state 基线）被宿主 WorkspacePanel.ts:86 用，但 PluginHostUi 只暴露 surfaceStyles/listStyles/textStyles（plugin-api.ts:116-124）——面板体基线进不去；files/terminal 已 adopt surfaceStyles 却因静态 import 时序冻结为空（见 P0.1） |
| workspaceLabels | 经 NavSectionContext.labelItems 进入 workspaces 插件的列表行 | PiWebApp.ts:2684→registry.getWorkspaceLabelItems | 行内无标签件 | 与 navSections 同生命周期（panel/sheet 双形态） |
| actions / themes | 动作面板 action-palette（PiWebApp.ts:3828）+ 键盘快捷键 + 设置对话框动作 / 设置外观页 | getDefaultActions、getThemes | 略 | 对 layout 无独立表面（quick switcher 是另一宿主组件——会话/工作区浏览器，非 actions 面） |

关键结构性发现：

1. **双形态伺服是 navSections 的内建复杂度**——panel 与 sheet 共用一个 context，且贡献方**无法感知**自己被渲染在哪个表面（NavSectionContext 无 surface 字段；panel/sheet 差异只烤进宿主回调 closeSheet，PiWebApp.ts:2703-2730）——必须一次写对两种且无从分支。手机与桌面的差异不是断点样式，而是两种宿主形态（drill 全屏 vs 340px 栏）。
2. **workspacePanels 的样式链断在交付通道**——基线（workspacePanelStyles，shared.ts:145-215）存在，插件也在 adopt（files/terminal adopt surfaceStyles），但（a）workspacePanelStyles 不在 PluginHostUi 暴露面（plugin-api.ts:116-124 只有 surfaceStyles/listStyles/textStyles）；（b）files/terminal 的 adopt 因静态 import 时序冻结为空。两层都是小修（见 P0.1），不是缺架构。
3. **抽屉是纯贡献驱动**（contributed-only-session-drawer 提案落地后），无贡献=无 chip=无布局占位；这是各缝里缺席语义最干净的一个。
4. **composer 是零和空间，且宿主自己的 icon 按钮无 coarse 规则**——工具簇横排无换行，`.icon-button` 36/40px（PromptEditor.ts:78/:183），贡献越多原生目标越拥挤；status 行是唯一可纵向生长的位置。

## 4. 问题清单与优化机会（task-3 分拣）

实测证据（§1/§2）× seam 结构（§3）交叉后的分拣。P0=违反已立规范或触不可用；P1=一致性问题；P2=机会。

### P0（带证据；触面基准待 owner 裁决，见前置说明）

**前置说明（评审 F8，需要 owner 裁决的基准冲突）**：本文档初稿以"44px 粗指针下限"为 P0 准绳，但仓库自身存在三个互相矛盾的数字：`e2e/mobile.spec.ts:1039` 把 **30px** 叫 "The tap-target floor"；`shared.ts:270/319-320` 把 **32px**（coarse 36px）叫手指可靠下限并自称已达成；`--pi-control-height-touch: 44px`（index.html:81）全仓只被 2 处消费。且 `CHECKLIST.md:694` 明载 "**Touch targets under 44px** — owner chose to keep the current density"（已记录的裁决）。因此下列 P0.3/P1.6/P2.8 类发现不是"违反已立规范"，而是**重开一条已关闭的裁决**——需 owner 在 30 / 32-36 / 44 三档中择一后才能定级动工。P0.1/P0.2 不依赖此裁决（它们是缺陷，非密度偏好）。

1. **files/terminal 面板体无样式：基线存在但断在两处交付点（缺陷，非缺架构）**。证据链：（a）基线存在——`shared.ts:145-215 workspacePanelStyles`（button/toolbar/list/empty-state），宿主 WorkspacePanel.ts:86 在用；（b）通道缺失——`PluginHostUi`（plugin-api.ts:116-124）只暴露 surfaceStyles/listStyles/textStyles，无 workspacePanelStyles；（c）**时序 bug**——`pi-web-plugins/files/pi-web-plugin.ts:5` 静态 `import "./filesPanelElement"` 先于 activate() 的 `rememberFilesHostUi` 求值，`filesPanelElement.ts:489 static styles = [filesSurfaceStyles(), ...]` 在模块加载时冻结为 `[]`（files/hostUi.ts:22-24 的 docstring 前提 "imports the elements afterwards" 被自家静态 import 摧毁）；terminal 同构（TerminalPanel.ts:721）。**workspaces 已修过同一 bug 类**：`workspaces/browser/hostUi.ts:31-40` 在 `createRenderRoot` 逐实例 adopt，docstring 明写 "`static styles` freezes at module load"——同一症状第二次出现（AGENTS.md：同症状报两次停止打补丁）。实测后果：Upload 21x58 裸按钮、无卡片/字体系统。修复代价：小——把 workspacePanelStyles 加进 PluginHostUi（跨 plugin-api 契约，但只是加一个字段）+ files/terminal 改用 workspaces 式逐实例 adopt。
2. **抽屉 coarse 触面规则被级联顺序打败（复发）**。证据链：ChatView.ts:164-167 coarse 媒体查询设 `.drawer-collapse { 44px }`（声明在 ：166），但 base `.drawer-collapse { 32px }` 在 ：170 **之后**重新声明——同特异性后者胜，coarse 44px 死代码；实测（research-drawer-targets.mjs，393x850 coarse）"Show session sections" 渲染 **32x32**。这是**本仓第二次犯同一错**：shared.ts:313-317 记录了完全相同的机制与事故，CHANGELOG.md:1560 是同族已修记录；旁边注释（:159-163）自己写着 "Placed after every base declaration it overrides"——修复违反了自己的放置原则。drawer-tab（Goals chip）min-height 22px（:152）无 coarse 覆盖，实测 22x49，同病。修复代价：小——把 32px base 移到媒体查询前，或改用 `--pi-control-height-touch` token（ChatView.ts:363 已有用例）；建议加级联顺序守卫测试（composerRoom.test.ts 已有 CSS 字符串层规则检查先例）。
3. **boot 页 `Add project` 32x102**——主操作按钮低于 44px token，但**挂在待裁决的密度基准上**（见前置说明；e2e floor=30 则合规，CHECKLIST 则属 owner 已选密度）。归因：宿主 `shared.ts:272 .section-add`（初稿误归因插件贡献，评审 G2/S2/F3 纠正）；同族：SessionList 工具行 30px（:684-685，宿主自有）、quick switcher chips 32px / machine-tab 36px / Close 28x20（宿主 QuickSwitcher.ts:434/:461）。若 owner 选择提高密度：修复点是宿主 listStyles 一处 + QuickSwitcher 局部，代价小。

### P1（一致性）

4. ~~context sheet 选中态用警示色~~ **判为不成立，撤销**：`.action-row.selected`（shared.ts:342）统一用主题 accent；截图中的红/橙是 clay 主题 accent 本色，机器/会话/项目行全部一致。
5. **sheet 内 "Projects" 标题重复**。证据：ContextSwitcherSheet.ts:39 宿主 `<h2>Projects</h2>` + :40 嵌入贡献的 projects navSection（withCreate: true 在 :55）→ ProjectList 自带 "Projects" 工具栏标题（ProjectList.ts:89/:225-229，`collapsible: false` 时渲染 `<span>Projects</span>`）。根因：NavSectionDisplay flags（hidden/collapsible/collapsed/tiles/withCreate，types.ts:200-209）没有 bare 模式，宿主段标题与组件标题无法协调。最小失败场景：sheet 里连续两行 "Projects"。代价：display 加一个 flag（小）或 sheet 去掉宿主 h2（更小，但机器段标题风格需跟着看）。
6. **composer `.icon-button` 无 coarse 规则（升 P1，重写自初稿 P2.8）**：全文件无 `pointer: coarse` 规则（初稿漏检）；36px base、≤430px 40px（:78/:183，注释自称 "Narrow screens are phones: the touch targets get bigger"，但 40px 仍低于 44px token）→ 手机上发送/停止 40x40。根因是**一条规则**，不是"拥挤"；修复 = 一条 coarse 规则（393px 下 5×44=220px 横向有余）。但同挂前置说明的密度裁决（owner 已选保持现状）。
7. **面板 tile 空态全额占位**（Relays 空态 tile + 面板全屏空态）。honesty 正确（absence is not negation 达标）；布局机会：badge 缝已在（panel.badge），可空态弱化，但 tile-geometry spec 已规范网格——改动需过 spec，属 owner 决策。

### P2（机会，不急）

8. ~~composer 工具簇拥挤~~ **升级重写为 P1.6**（初稿的 "usage meter" 幽灵项已更正：那是指示 thinking 档位的 gauge 图标；修复粒度应是单条 coarse 规则而非"加大停止按钮"）。
9. **updates 命令文本溢出截断**：Copy 按钮存在但截断的命令无法确认完整性；可换行或跑前预览。
10. **抽屉空态仍占整段框**：诚实但可再紧凑（空态时折叠高度减半）；与 contributed-only 提案的缺席语义一致性需 owner 裁决（空 vs 缺席的边界）。
11. **settings 无过滤**：七入口一屏内，暂不需要；插件节增多后回看。
12. **消息级 affordance 24-30px**（chat 表面 126 个 <44px 的大头：copy/info/回填 24x24）——同挂密度裁决；若 owner 维持现状则记录归档。

### 不动项（有裁决在先）

- StatusBar 常驻（token/ctx/cost）：native 面（owner ruled）。
- tile 网格 2x3 几何：tile-geometry spec 已规范网格。
- ask 对话框内联转录流：pending-input-stability spec 覆盖，实测合规。

## 5. 评审分拣（task-4，bllm 三车道）

三车道：glm-5.3-flash（CSS/几何）、glm-5.3-flash（seam 图）、qwen3.8-flash-next（红队）。第一轮全 502（网关），重跑成功。产物：`~/.pi/agent/sessions/.../subagent-artifacts/{fbd2d5d3,7f4dbacc,ce4a91b6}_reviewer_0_output.md`。逐条分拣：

| # | 车道/发现 | 裁决 | 处置 |
|---|---|---|---|
| G1 | ask 卡不是 fixed（在流内） | 属实（源注释 :219-226 "Nothing is pinned"） | fixed：§1.5/§3 已改 |
| G2/S2/F3 | Add project 归因插件错，实为宿主 shared.ts:272 | 属实（读源证实） | fixed：§1.1/P0.3 归因与修复点已改 |
| G3/F6 | 行号漂移（coarse 块 ：164-167，base :170 非 :171） | 属实 | fixed：行号已改 |
| G4/F6 | 修复应用 token（--pi-control-height-touch）+ 加级联守卫 | 采纳 | fixed：P0.2 已补；守卫列入提案 |
| S1 | sheet 无 Sessions 段；Machines 段条件性（≥2 台） | 属实（读源证实；截图所见与三段一致，初稿误写四段） | fixed：§1.2/§3 已改 |
| S3/F10 | SessionList 是宿主组件，非插件贡献 | 属实（grep 证实） | fixed：§1.1/§3 已改 |
| S4 | NavSectionContext 无 surface 字段 | 属实（types.ts 全接口无此成员） | fixed：§3 已改（结论反而更强） |
| S5/F4 | "零样式基线"不成立：workspacePanelStyles 存在，断在交付通道 | 属实（读源证实） | fixed：§3/P0.1 已重写 |
| S6 | actions 面写成 quick switcher | 属实 | fixed：§3 已改 |
| S7/S8/S9 | P0.2、P1.5、seam 清单本身成立 | 三车道一致 | 保留（P1.5 行号 ：40/:55 已修） |
| F1 | §2 数字被 slice(0,12) 截断 + metrics.json 缺失 | 属实（脚本自证） | fixed：脚本改全量落盘+面积排序，重跑，§2 全表重写 |
| F2 | 桌面半边是范畴错误（非 coarse）+ 32px 是已记录豁免 | 属实 | fixed：P0.3 删桌面半边 |
| F5 | files/terminal 静态 import 时序 bug（workspaces 已修过同类） | 属实（读源证实：pi-web-plugin.ts:5 静态 import + hostUi docstring 前提自相矛盾） | fixed：升入 P0.1 根因 |
| F7 | §2 漏 4 表面行、terminal 未讨论、QuickSwitcher 未抓、input 类漏计 | 属实 | fixed：§2 全表重写 + §1.6 terminal + §1.9 新增 |
| F8 | 44px 前提与 CHECKLIST.md:694（owner 已选保持密度）/e2e floor=30 冲突 | 属实（读源证实） | fixed：§4 前置说明；P0.3/P1.6/P2.12 挂裁决 |
| F9 | composer 升 P1 + 幽灵项 + 单规则根因 | 属实 | fixed：P1.6 重写 |

两车道打架处（无）：三车道对 P0.2 级联机制、SessionList 归属、归因纠错完全一致；F4 与 S5 是互补非冲突（一个找通道缺失，一个找已有通道），合并写入 P0.1。

**裁决后剩余的 owner 决策点**：① 触面密度基准三选一（30/32-36/44，重开 CHECKLIST.md:694 已关闭裁决）；② files/terminal 时序 bug + workspacePanelStyles 下发是否立即修（与密度无关，缺陷）；③ 抽屉级联修复 + 守卫测试。②③不依赖①，可作为无争议 wave 先行。

## 6. 建议实施 wave 提案（供 owner 择项，未动工）

### Wave L1（无争议缺陷修复，可先行）

1. files/terminal 静态 import 时序 bug：改用 workspaces 式 `createRenderRoot` 逐实例 adopt（pi-web-plugins/files/hostUi.ts、terminal 同构）；files 面板手机形态随之恢复卡片/字体系统。
2. workspacePanelStyles 进 PluginHostUi（plugin-api.ts 加一个字段 + 基线重生成），面板体基线可达全部七个面板插件。
3. 抽屉级联修复：ChatView.ts base `.drawer-collapse` 32px 移到 coarse 块之前（或改 token）；drawer-tab 补 coarse 覆盖；加级联顺序守卫测试（composerRoom.test.ts 先例）。
4. sheet 双标题：ContextSwitcherSheet 宿主 h2 去重（小改）。

### Wave L2（需 owner 裁决密度基准后动工）

5. 按①的裁决结果调整：boot `Add project`/SessionList 工具行/quick switcher chips/消息级 affordance/composer `.icon-button` coarse 规则——同一裁决一次覆盖全部条目（P0.3/P1.6/P2.12）。

### 不建议现在做

- 面板空态弱化（过 tile-geometry spec 需提案）；updates 命令换行（功能层面 owner 未抱怨）；抽屉空态紧凑化（缺席语义待 contributed-only 提案落地后再看）。
