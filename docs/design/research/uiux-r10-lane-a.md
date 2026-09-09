# 第十轮 · A 道：规模化之后的 app 外壳与 chrome 几何

阅读范围：src/client/index.html（token 块）、src/client/src/components/appShell/*.ts、SessionList.ts、StatusBar.ts、ChatView.ts、shared.ts，以及 PiWebApp.ts 的外壳与横幅样式表和 boot / context-sheet 两个表面所依赖的对话框 chrome。所有 file:line 均在当前工作树（分支 refactor/plugin-architecture，HEAD）逐行核实；已知故意保留项与第一至九轮已修项均已排除。

## F1 自更新 applying 横幅画不出工作标记：三个圆点在本 shadow root 里没有任何尺寸规则
- file: src/client/src/components/PiWebApp.ts:890（标记）、:212（唯一相关规则）、:3861（styles 列表）；尺寸规则在 src/client/src/components/sessionStateBadgeStyles.ts:38-39，但未被本组件引入
- surface: chat（会话列顶部的横幅行；boot/空态同样可见）
- finding: applying 横幅渲染 `<span class="state-dots">` 内含三个空的 `<span class="state-dot">`，而 pi-web-app 的样式表只有 `.self-update-banner .state-dot { background: currentColor; }`。给这两个类以形状的规则——`.state-dots { display: inline-flex; ... }` 与 `.state-dot { width: var(--pi-dot-xs); height: var(--pi-dot-xs); ... }`——在 sessionStateBadgeStyles 里，ChatView 与 SessionList 引入了它，PiWebApp 没有。三个无内容、无宽高、只有背景色的行内 span 画出来是 0x0。
- minimal failure scenario: 自更新开始、横幅切换到 applying 态：读者只看到一行文字，没有任何动效标记；而同一「工作」状态在 chat dock 和会话行里画的是三颗 4px 跳动圆点——同一状态处处有标记，唯独这里不可见。
- confidence: high（静态 CSS 分析；空行内 span 尺寸为零，appStyles 中无任何规则赋予尺寸）

## F2 消息头部的角色标签比它所标题的正文列左偏 2px
- file: src/client/src/components/ChatView.ts:374（头部水平 padding 为 `var(--pi-space-5)`，配合 calc(-1 * var(--pi-space-6)) 的外拉边距）对照 :273（`.msg` padding 为 `var(--pi-space-6)`）；对照组 :383 的 `.group-msg > .msg-header` 完全对齐
- surface: chat
- finding: `.msg` 以 12px（space-6）留出内容列；吸顶头部用 -12px 外拉贴到内边框边缘后，水平方向却只 padding 10px（space-5）：角色标签起笔于卡片外缘 11px 处，而正文各 part 起笔于 13px——每张消息卡片内部，标签列与正文列之间差 2px。分组变体（383 行）水平 padding 为 0、完全同列；且第六轮 ask-user 修复已确立「卡片头部与内容共列」这一家法。
- minimal failure scenario: 打开任意 assistant 消息：mono 角色标签悬在下方正文左侧 2px；同一 transcript 里的分组卡片却是标签与正文共享一条边——两种兄弟卡片对「头部列」的定义不一致。
- confidence: medium-high

## F3 会话分区标题：展开箭头浮在文字基线之上
- file: src/client/src/components/SessionList.ts:274 与 :322（箭头 SVG 与标题文字同行内联）；src/client/src/components/disclosureIcon.ts:11-16（未设 vertical-align）；shared.ts 的 `.section-toggle` / `.section-title` 未对内层 span 做居中
- surface: sessions
- finding: 16px 的 chevron SVG 是标题文字的行内内容，盒底落在文字基线上。可见笔画占 viewBox 24 中的 y 6..18——即基线以上 4..12px；而 12px 标题词的大写高度约 0..8.5px。标记中心比文字中心高出约 3.5-4px。同一图标在 `.subtree-toggle`（SessionList.ts:468）和抽屉折叠钮里都是 grid 居中——只有标题这一处是行内基线对齐。
- minimal failure scenario: 看面板里的 Sessions 或 Archived 标题：箭头明显悬在词的中线之上，而非与之居中——正是第九轮注释里归罪于被替换的文字箭头的那类基线毛病。
- confidence: medium

## F4 对话框关闭钮的鼠标尺寸不一致：同一家族里 32px 与 36px 并存
- file: 32px：src/client/src/components/AuthDialog.ts:273、ModelPicker.ts:286、CommandPicker.ts:112、SessionRenameDialog.ts:37；36px：src/client/src/components/appShell/ContextSwitcherSheet.ts:87、SettingsDialog.ts:766、SessionCleanupDialog.ts:244、QuickSwitcher.ts:403、SessionTreeNavigator.ts:537
- surface: boot（auth 对话框）与 context-sheet，及整个对话框家族
- finding: 第二轮以「dialog close controls agree on a mouse size」收尾，如今不再成立：四个对话框用 --pi-control-height（32px）关闭，五个用 --pi-control-height-comfort（36px），粗指针下都升到 44px。两个值都在控制高度刻度上，守卫全数通过；兄弟之间只是单纯不等。
- minimal failure scenario: 先开 context sheet（关闭钮 36px），再从设置进入 auth 对话框（关闭钮 32px）：同一个 × 字形、同样的 20px 字号，装在两个尺寸不同的框里，鼠标热区随打开的对话框不同缩水 4px。
- confidence: 分裂本身 high；哪个是正典尺寸 medium

## F5 桌面 rail 头部私用 12px 内缩，其余 chrome 行全部读 chrome inset
- file: src/client/src/components/appShell/AppNavigationPanel.ts:457（`padding: 0 var(--pi-space-6)`）对照 :466（紧凑头部 `padding: 0 var(--pi-chrome-inset)`）；src/client/src/components/appShell/AppContextBar.ts:73；src/client/src/components/appShell/AppContextSwitcher.ts:98；src/client/index.html:83 与 :196
- surface: sessions（导航面板 chrome）
- finding: --pi-chrome-inset 的设立理由（index.html:83）就是让堆叠的 chrome 行共享一条阅读边：驻留条（6px）、手机紧凑头部（6px）、抽屉头部（gutter）都在读它，唯独桌面 rail 头部 pad 12px（space-6）。同一列内部主体行又是 10px（space-5）：一个面板从上到下叠出三条左缘——头部 12px、分区标题 10px、chip 文字 14px。
- minimal failure scenario: 桌面窗口里，面板头部标题比共一条 1px 分隔线的 Machines/Projects/Workspaces/Sessions 标题右偏 2px；同一角色在手机上却是 6px——这个 token 生来要钉住的那条阅读边，偏偏在设立惯例的那一行没被钉住。
- confidence: medium（不一致属实；视觉权重有限）

## F6 手机上 chat-drawer 吸顶头画的紫色与抽屉自身的紫色不是同一个
- file: src/client/src/components/ChatView.ts:131（吸顶 `.drawer-header` 背景 `var(--pi-purple-surface)` = #21132f）对照 :127（`.top-drawer` 背景 `color-mix(in srgb, var(--pi-purple) 7%, var(--pi-bg))` ≈ #1b1c27）
- surface: chat-drawer
- finding: 抽屉表面是 7% 紫色叠在应用背景上的调色；其手机专属的吸顶头部却用主题实色档 --pi-purple-surface 自我声明——另一个配方。两个「近似却不相等」的紫色在同一组件内上下相叠。应用里其他吸顶头都重申自己的表面色（消息头用 --pi-surface-card，见 :374；会话搜索用 --pi-bg），此处独破例。
- minimal failure scenario: 手机上展开抽屉：即使什么都没滚动，头部色带也比下方身体略深、偏暖；滚动时滑过其下的表面依然是另一种紫。
- confidence: medium-low（两个取值已核实；色带在实际观感上的可见度属我的推测，按低报）

## F7 一个展开动词、两套字形语言：sessions 画共享 chevron，machines/projects/workspaces 仍是文字箭头
- file: src/client/src/components/SessionList.ts:274 与 :322（SVG chevron）对照 pi-web-plugins/machines/browser/MachineList.ts:200、pi-web-plugins/workspaces/browser/ProjectList.ts:229、pi-web-plugins/workspaces/browser/WorkspaceList.ts:198（三目文字箭头）；四者采用同一份共享 listStyles（pi-web-plugins/machines/browser/hostUi.ts:38）
- surface: context-sheet（该 sheet 叠放的正是这三个列表）与 sessions
- finding: 第九轮「shared disclosure chevron replaces text arrows」只落到了 SessionList。三个管理列表用完全相同的 `.section-toggle` / `.section-name` 标记与同一份共享样式表，却仍以文字字符画这个动词——恰是第九轮注释点名的缺陷机制（文字字符随字重与基线走）。在 context sheet 与面板里，Machines/Projects/Workspaces 标题用字形拼写展开，而同一样式表养出的 Sessions 标题画的是 16px 描边 chevron。
- minimal failure scenario: 打开 context sheet：三个标题以字体字形表示展开态；收起面板里的 sessions 分区，它的动词却是描边 chevron——一个动词、两套语言，出现在共用一张样式表的表面上。
- confidence: 分裂属实 high；第九轮修复是否有意止步于 SessionList 未知

## F8 批量选中行用第二套机制画强调边，组合态把 3px 叠成 6px
- file: src/client/src/components/SessionList.ts:724（`box-shadow: inset 3px 0 0 var(--pi-accent)`，且对无边框元素声明了失效的 border-color）对照 shared.ts:413（`.action-row { border-left: var(--pi-rail-width, 3px) ... }`）及 shared.ts:414-426 的着色状态
- surface: sessions
- finding: 该行本来就拥有一条强调边——以 border-left 画的 3px 状态轨，由 selected / unread 着色。批量选中却在 `.action-main` 上另加 3px 内阴影，而不是给同一行（bulk-selected 就在行类名里）的状态轨上色。当一行既是批量选中又是 selected（或 unread）时，画出 3px 轨 + 3px 阴影 = 一条连续 6px 强调边；列表里其他所有带强调边的行都是 3px。
- minimal failure scenario: 进入多选并勾选当前打开的会话：它的左缘变成 6px 强调，旁边的行仍是 3px——同一条状态轨在同一列表里画出两种宽度。
- confidence: medium-low

TOTAL: 8 findings
