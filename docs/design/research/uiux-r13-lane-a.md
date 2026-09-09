# ROUND 13 — Lane A：应用外壳与 Chrome 几何（scale 工作之后）

审查范围：boot / sessions / chat / chat-drawer / context-sheet。
主文件：src/client/src/components/appShell/*.ts、SessionList.ts、StatusBar.ts、ChatView.ts、shared.ts、src/client/index.html（token 块），以及向 context-sheet 供行的 pi-web-plugins 列表（MachineList / ProjectList / WorkspaceList）。
所有行号均在当前 HEAD（branch refactor/plugin-architecture）实读核对；对比度用 WCAG 公式实算。

## F1 活动 dock 的状态圆点在 idle/asking/error 三态低于非文字对比度下限，且与 working/background 两态不对称
- file:line: src/client/src/components/ChatView.ts:259（.dot 声明 opacity: .45）、ChatView.ts:260（只有 .activity-dock.working .dot 提回 opacity: 1）、ChatView.ts:249（只有 .activity-dock.background .dot 提回 opacity: 1）、渲染点 ChatView.ts:1349 与 1359（idle/asking/error 共用 span.dot）
- surface: chat
- finding: dock 的单点状态标记基础透明度是 .45，五个状态里只有 working 和 background 被显式拉回 1。实算（#8b949e/#d29922/#ff7b72 各自按 .45 叠在各自 dock 底色上）：idle 点 2.18:1、asking 点 2.42:1、error 点 2.37:1，全部低于图形对象 3:1 的 AA 下限；而同一枚点在 working/background 是全强度。round 11 的修复（idle dock 以颜色而非透明度层保安静）只治了文字层，点的 .45 是旧设计残留。
- minimal failure scenario: 会话出错（error）或向你提问（asking，Waiting for your answer）时，dock 上唯一的状态标记是一枚 45% 透明度的 8px 点（2.37:1 / 2.42:1），最需要被注意的两个状态反而比 working 的三个点更不可见；同一屏幕上 session 列表行的同状态点（sessionStateBadgeStyles，无透明度）是全强度，两处状态标记深浅不一。
- confidence: 高（数值实算；ask/error 是否有意调暗无注释佐证，但与 working/background 的不对称本身就是缺陷形态）

## F2 --pi-row-min-height 声明为四列表一个值，实际只有 machines 与 tiles 模式在读它
- file:line: src/client/index.html:84-86（token 注释：A list row that carries a title and a second line. One value, so four lists cannot drift to 52, 56, 58 and 60）；src/client/src/components/shared.ts:373（.action-main 无 min-height）对比 shared.ts:318（仅 .list-body.tiles .action-main 有 min-height: var(--pi-row-min-height)）；pi-web-plugins/machines/browser/MachineList.ts:261（machine 行两种形态都声明 56）；SessionList.ts 样式块（683-793 行区间）无任何行高声明，session 行为内容高
- surface: context-sheet（主）；sessions（token 目的违约）
- finding: context sheet 以 tiles:false 渲染三份列表：machine 行钉在 56px（MachineList.ts:261），紧随其下的 project 行与 workspace 行走 shared.ts:373 的裸 .action-main（8px 上下 padding + 名字行 + small 路径行，内容高约 47px）。同一张竖排表单里相邻两份列表行高差约 9px——正是该 token 注释宣称要消灭的漂移。session 行（同样标题+第二行形状）也不读该 token。
- minimal failure scenario: 手机上不少于 2 台机器、1 个项目时打开 context sheet：Machines 区每行 56px，越过一个 8px 的列表间距就是 Projects 区约 47px 的行，同屏两种行高；列表间距（--pi-space-4 = 8px）小于行高差本身，接缝读成两套密度。
- confidence: 高（声明逐条核对；47px 为按 type/leading 推算的近似值，56 对约 47 的方向确定）

## F3 桌面 rail 头部两个相邻描边图标按钮宽度不等：齿轮 32x44，刷新 44x44
- file:line: src/client/src/components/appShell/AppNavigationPanel.ts:147-150（同一 .header-actions 行并排放 refreshControl 与齿轮）、AppNavigationPanel.ts:458（header button 的 padding: 0 var(--pi-space-4)，16px 图标 + 2x8px = 32 宽）、AppRefreshControl.ts:40（.app-refresh-button width/height 均为 var(--pi-panel-header-control-height) = 44）
- surface: sessions（桌面导航面板头部）
- finding: 同一行、同角色（描边 icon-only 按钮、同 1px var(--pi-border) 描边、同 16px 图标、同 44px 高）的两个控件一个 32 宽一个 44 宽，盒形不齐。手机侧对应规则（AppNavigationPanel.ts:471 coarse 下 .compact-header-action min-width 44）已把同排拉齐到 44——意图存在，桌面头部漏掉。
- minimal failure scenario: 桌面宽度打开面板：刷新是 44px 方块，紧邻的齿轮是 32px 竖长条，两个描边盒宽差 12px；把设置与刷新读成同一组控件时，宽度差被误读为层级差，而实际同级。
- confidence: 中（声明与布局关系核实；同类先例 round 2 的 refresh 控件高度对齐说明此类 Sibling 对齐归本审计管）

## F4 紧凑（手机）头部字号倒挂：标题 13px/600 小于同一行 Actions 动词 14px/400；同一动词在桌面又是 12px
- file:line: src/client/src/components/appShell/AppNavigationPanel.ts:484（.compact-scope font-size: var(--pi-text-sm) + font-weight: var(--pi-weight-semibold) = 13px/600）、AppNavigationPanel.ts:467（.compact-header-action font: inherit，沿宿主链落到 --pi-text-base = 14px/400）、AppNavigationPanel.ts:458（桌面 header button font-size: var(--pi-text-xs) = 12px）、AppNavigationPanel.ts:146 与 490（桌面标题是裸 strong 元素，字重落在 UA bold 700，未读任何 --pi-weight-* token）
- surface: sessions
- finding: 同一个面板头部的两种呈现互相矛盾：手机行内次要动词（Actions 14px）比主标题（scope 13px）大一号；桌面行内同一动词是 12px、标题是 14px/UA-700（token 阶梯里有 --pi-weight-strong 650 与 --pi-weight-bold 700，均未被读取）。三处标题/动词组合给出三套字号字重关系。
- minimal failure scenario: 同一应用的手机 compact 头部与桌面 rail 头部并排对比：Actions 在手机上 14px、桌面 12px；手机上标题比按钮还小。读者感知为手机头部字更大而非同一控件；桌面标题的 700 也与全局权重 token 化的意图脱钩。
- confidence: 中（声明全部核实；跨断点同控件字号是否须统一属判断）

## F5 投递状态标记仍是打字字符（U+25CC、U+2713、双勾、感叹号），靠 letter-spacing: -1px 硬压双勾
- file:line: src/client/src/components/ChatView.ts:495-506（chatDeliveryPresentation 的 glyph 字段为打字字符）、ChatView.ts:350-351（.delivery-mark .delivery-glyph 的 font-size: var(--pi-text-xs) 与 letter-spacing: -1px）
- surface: chat
- finding: round 12 已把 transcript/status bar 的动作与状态标记（copy/resend/recall/tick/cross/run/up/down）收进 uiIcons 画的 SVG，理由正是打字字符吃字体墨量与基线；气泡右下角的投递标记（Sending/Sent/Queued/Read/Not sent 的状态符）仍走字体字符，其中双勾需要 -1px 字距补丁才不散架——被该修复宣告淘汰的模式还剩这一处。
- minimal failure scenario: 发送一条消息：气泡角先出现虚线圆加 Sending（U+25CC 随系统字体渲染，墨量与旁侧 14px SVG 不一致），落到双勾 Read 时两勾靠 -1px 字距挤在一起；在缺该字形备选字体的平台上双勾间距回弹，标记形状改变。
- confidence: 中（事实确定；是否有意保留为文字型标记无记录，标注为疑似漏网）

## F6 index.html token 块自身的 scale 逃逸：手机覆盖写死 6px，而正确写法在三行之上
- file:line: src/client/index.html:199（max-width 640px 覆盖 --pi-chat-gutter: 6px 与 --pi-chrome-inset: 6px）、index.html:83（基线 --pi-chrome-inset: var(--pi-space-3)，同文件已示范应读 token）、index.html:80（--pi-chat-gutter: 16px 未读 :36 的 --pi-space-7）
- surface: 外壳 chrome 几何（boot/chat/context-bar 共用的读边与沟槽）
- finding: 两个决定 stacked chrome 行与对话列读边的 token，在手机断点写死 6px，而 6px 就是 --pi-space-3；基线 --pi-chrome-inset 已用 var(--pi-space-3) 建模正确写法。spacingScale 守卫的 ROOTS 只扫 src/client/src 与 pi-web-plugins，token 块在守卫窗外，逃逸不会被 CI 拦下。
- minimal failure scenario: 将 --pi-space-3 从 6px 调整（或被主题覆写）：桌面 chrome 内缩随 token 走，手机上 --pi-chrome-inset 仍是写死的 6px——同一 token 两种值，context bar 与 compact header 的文字边跨断点错位，且无测试拦截。
- confidence: 高（声明核实；当前数值恰好相等，属应读 token 而未读的机械逃逸）

## 已核对、未立案（clean notes）
- round 12 验证：panel-toggle / header-icon-action / app-refresh / drawer / jump 的 SVG 均为统一 16px 画法（AppContextBar.ts、AppNavigationPanel.ts:460、AppRefreshControl.ts、ChatView.ts .jump-icon）；SessionList 勾选标记 16px（.selection-mark）与 round 12 记录一致。
- 三处徽章（drawer-tab-badge、tool-badge、section-unread-count）数值一致（min-width 14 / line-height 16 / text-2xs），无漂移。
- session 行 leading gutter 公式（--pi-row-gutter-start/-size）与 coarse 下 checkbox 在 44px toggle 槽内的居中推导逐项复算，同心。
- MachineList 状态为 mark-and-word（::before 圆点加词），offline 用 --pi-danger 点（对 card 5.57:1），与 round 10 记录一致。
- close 控件族（乘号文字字符加 place-items center）是全应用一致的家法（ModelPicker/QuickSwitcher/Settings/ContextSwitcherSheet 等 19 处），不立案。
- 曾怀疑后排除：context sheet 内 .list-search（sticky top 0, z 3）被 sticky .sheet-header（top 0, z 4, 不透明）盖住——追栈后确认 sheet 里各列表 section 为 flex 0 0 auto 自然高，.list-body（overflow auto）不产生内部滚动，sticky 不触发，不立案。
