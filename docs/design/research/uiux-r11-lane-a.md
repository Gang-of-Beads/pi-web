# ROUND ELEVEN — Lane A：应用外壳与 chrome 几何（scale 工作之后）

分支 refactor/plugin-architecture，HEAD 843e103e。本 lane 只报新问题；round 5–10 已修条目不复报。
主查文件：src/client/src/components/appShell/*.ts、SessionList.ts、StatusBar.ts、ChatView.ts、shared.ts、PiWebApp.ts、index.html。
焦点面：boot；sessions；chat；chat-drawer；context-sheet。所有行号均在当前 HEAD 上逐一核对。

## F1 working 状态的 activity dock 永远拿不到它声明的 success 配色（.active 死规则）
- file:line: src/client/src/components/ChatView.ts:252、258（`.activity-dock.active` 两条规则）；1352（渲染的 class 由 `category` 拼出）；1564-1572（`activityCategory()` 只返回 working/idle/asking/error）；259-260（`.activity-dock .state-dot { background: currentColor; }` 与 `.activity-dock.working .state-dot { opacity: 1; }`）
- surface: chat（activity dock）
- finding: 渲染端在 1352 行拼出的是 `activity-dock working`，而 252/258 行的完整 working 配色（`border-color: var(--pi-success-border); color: var(--pi-success); background: var(--pi-success-bg-overlay)` 与 `.active .dot` 的 pulse）写在永远不会匹配的 `.active` 类名下。几何结果：working dock 落回基座样式——文字 --pi-muted、边框 --pi-border、背景 --pi-bg-overlay，且三颗 state-dot 因 259 行 `background: currentColor` 被染成灰（muted），而不是同一 working 状态在其它两处使用的 accent 蓝（sessionStateBadgeStyles 的 `.state-dot { background: var(--pi-accent) }`；AppContextBar.ts 的 `.working-dot { background: var(--pi-accent) }`）。这是改名事故的半途现场：提交 bfd2c3fc（Four-state session badge）把类从 active 改为 working 时，260 行的 `.working .state-dot` 改了名，252/258 行的 `.active` 主体规则漏改。
- minimal failure scenario: 用户发起一个正常流式回复：左侧 session 行与顶部 resident bar 同时亮起蓝色跳动圆点，而正下方的 dock 显示「Working · 0:42」为灰字、灰点、中性边框——与 idle dock（round nine 定义的「安静灰」）几乎同貌，唯一区分是拉长的行宽和秒表；252 行声明的 success 皮肤永远不出现。
- confidence: high（渲染与样式两侧均已核对；测试只钉 class 名与点数，ChatView.activityDock.test.ts:69/222，不钉颜色，故 guard 全绿）

## F2 消息卡片的 sticky 头部与它所标注的正文不在同一条左缘线上（10px 对 12px）
- file:line: src/client/src/components/ChatView.ts:273（`.msg { ... padding: var(--pi-space-6); ... }`）、374（`.msg > .msg-header { ... margin: calc(-1*var(--pi-space-6)) calc(-1*var(--pi-space-6)) ...; padding: var(--pi-space-1) var(--pi-space-5); ... }`）、383（对照：`.group-msg > .msg-header { ... padding: var(--pi-space-4) 0 var(--pi-space-3); ... }` 内联 padding 为 0）
- surface: chat（每条消息卡片的头部）
- finding: 卡片正文左右内缩 12px（space-6）；头部用负 margin 拉通整卡后只给自身 10px（space-5）内联 padding，于是角色标签（You/Assistant/…）的左缘落在 10px 处，正文落在 12px 处——同一张卡片内两条左缘差 2px。姊妹几何（383 行 group 头部）内联 padding 为 0、与 group 正文齐平，即同一「头部对齐正文」的关系在两种消息容器里一个齐、一个差 2px，无注释声明 10px 是有意的光学内缩。
- minimal failure scenario: 一张助手卡片：sticky 头部里的角色名比下面正文块凸出 2px；滚动时头部钉在卡口上，这条错位线在每张卡片上重复出现；把窗口拉宽让消息列满宽时，2px 的台阶在 1px 边框旁边可辨。
- confidence: medium（几何事实确凿；不排除 10px 是无记录的有意选择，若是有意，应在注释里写明，与本项目「corner 皆有名分」的惯例一致）

## F3 jump-to-bottom 仍是一个裸文本箭头字形坐在 36px 方形控件里
- file:line: src/client/src/components/ChatView.ts:1015（`>↓</button>`）、97-106（`.jump-to-bottom` 36px 方形、place-items 居中、font-size: var(--pi-text-lg)）；对照 AppNavigationPanel.ts:16-18（house 理由原文：「a text glyph rides font baselines and never sits in the center of its button」）
- surface: chat（跳到最新消息的浮动控件）
- finding: round 九/十已把 disclosure 箭头、dictation、prompt history、bulk selection、settings drill-in 的文字字形全部换成画出来的 SVG，理由在代码里写明：字形墨迹随字体基线与平台度量浮动，在 place-items:center 的方块里不保证居中。`.jump-to-bottom` 的「↓」是这一类里剩下的最后一只：U+2193 的墨迹位置随平台字体（SF/Segoe/Roboto/Android 回退）上下漂移，36px 方块里没有第二根轴线可以兜底。
- minimal failure scenario: 同一构建在 macOS 与 Windows/Linux 上并排打开同一长会话：两台机器上 ↓ 的墨迹相对按钮几何中心的垂直位置不同（Segoe 的箭头偏上、SF 的偏下），一个读作「靠上的方块里悬着符号」，一个读作「压底的箭头」；与 1513 行 command-dismiss、ModalSurface 系的 × 字形家族不同，× 是已被三轮钉过尺寸的既定家族，↓ 不属于任何已钉家族。
- confidence: medium（house 模式与代码内理由均已核对；未做跨平台实测，字形漂移幅度属推断）

## F4 boot/空会话面 `.empty` 声明的 10px 节奏被 UA 段落边距放大成 24px，姊妹空态却归了零
- file:line: src/client/src/components/PiWebApp.ts:195（`.empty { ... gap: var(--pi-space-5); ... }`，无任何 p margin 重置）、3807（`<div class="empty"><p>…</p>${…button}</div>`）；对照 src/client/src/components/ChatView.ts:363（`.empty-session p { margin: 0; }`）
- surface: boot（主列空态，即 boxModelGuard 记录里「boot screen 的唯一 primary button」所在面）
- finding: `.empty` 是 flex 列、gap 声明为 space-5（10px），但第一个子元素是无重置的 `<p>`（text-base 14px → UA margin 1em≈14px 上下）。flex 列里 margin 不折叠：标题上方 14px、标题与按钮之间 14+10=24px——声明的节奏步骤被悄悄放大一倍多。同一应用里另一个「空会话」空态（ChatView `.empty-session`，同样 gap space-5）显式 `p { margin: 0 }`，两块同物种空态一齐一不齐。
- minimal failure scenario: 首次启动进入未选项目/会话的主列：提示句到「Start a session / Add a project」按钮之间的空隙是 24px，而切进一个空 session 后「This session is empty…」到「Write the first message」之间是 10px；两个空态在一次演示里先后出现，按钮像是从两个不同的间距规范里各自长出来的。
- confidence: medium-high（CSS 事实两侧均核对；视觉幅度小但可测）

## F5 手机上叠放的两条 chrome 横条使用不同的分隔线重量（border 对 border-muted）
- file:line: src/client/src/components/appShell/AppContextBar.ts:73（`.context-bar { ... border-bottom: 1px solid var(--pi-border); ... }`）；src/client/src/components/appShell/AppNavigationPanel.ts:466（`.compact-header { ... border-bottom: 1px solid var(--pi-border-muted); }`）；对照桌面同位关系 AppNavigationPanel.ts:457（rail `header` 用 --pi-border）
- surface: chat-drawer 之下的手机 chrome 堆栈（sessions/phone panel）
- finding: 手机布局（coarse/≤760px）里 main 列先渲染 resident context bar，再在其正下方渲染 compact panel header：两条 44/45px chrome 横条背靠背，下缘分隔线一条是全重 --pi-border、一条是弱化 --pi-border-muted，同一竖向堆栈里两种线重相隔 44px。桌面上同一几何关系（rail header 与 context switcher 的相邻分隔线）两条都是 --pi-border（457 行与 AppContextSwitcher :host 的 border-bottom）。round seven 把 resident bar 的线重对齐到「header set」，compact header 的 muted 是后来加入堆栈的第三个值。
- minimal failure scenario: 393x850 手机上同时看到两条横线：resident bar 下一条较亮、compact header 下一条较暗；侧向对比桌面端同结构的两条等重横线，手机的堆栈读作「两条不同层级的栏」，而它实为同一层 chrome。
- confidence: low（可能是刻意的弱化降噪，无注释佐证；如是有意，应与 round seven 的「线重对齐」决定一样落字）

## 已核对、无新发现的部位（防止复报）
- session 列表 h2 工具行（bulk-select/cleanup/start 三控件 32/44 同高同中线，SessionList.ts:566-591）；checkbox 与 subtree-toggle 同心（粗指针公式两侧均核对，SessionList.ts:693-700）；context-sheet 的 sticky 头、close 尺寸家族、标题层级（ContextSwitcherSheet.ts:70-92）；drawer header 高度 44/touch 44 与 collapse 控件（ChatView.ts:135-166）；rail/desktop header 三控件同高（AppNavigationPanel.ts:457-462）；index.html token 块无未定义引用；`.start-session-button` accent 填充对 --pi-on-accent ≈ 7:1，达标。
- StatusBar.ts:31-38 的 `.dot/.activity` 样式已无渲染方（死样式），非视觉缺陷，不列为 finding。

TOTAL: 5 findings
