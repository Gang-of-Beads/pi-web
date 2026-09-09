# UIUX ROUND 5 - Lane A: app shell / chrome geometry after the scale work

分支 refactor/plugin-architecture。方法:通读 appShell/*.ts、SessionList.ts、StatusBar.ts、ChatView.ts、shared.ts、index.html token 块及 PiWebApp.ts 壳层样式;每个发现均给出已核实的 file:line。守卫测试本地复跑确认绿:typeScale / spacingScale / controlHeight / dotScale 共 7 项全部通过(因此以下"scale 逃逸"均为守卫盲区内的逃逸,已逐一说明落在哪个盲区)。

sticky 位移结论用 Playwright 1.62.1 实测(无头 Chromium):padding-top:24px 的滚动容器内,sticky top:-24px 静止于容器可见顶边 0px,top:-16px 静止于 8px。

TOTAL: 11 findings

## F1 聊天滚动容器内两族 sticky 头部的停靠位相差 8px,卡片头部钉住后上方留出 8px 活动缝隙
- file:line: src/client/src/components/ChatView.ts:203(`.chat { ... --pi-chat-sticky-top: calc(-1 * var(--pi-space-9)); ... padding: var(--pi-space-9) var(--pi-chat-gutter) var(--pi-space-7); }`)、:297(事件组 summary `top: var(--pi-chat-sticky-top)`)、:383(组内 `.group-msg > .msg-header` 同用该变量)、:374(`.msg > .msg-header { position: sticky; top: calc(-1 * var(--pi-space-7)); ... }`)
- surface: chat
- finding: 滚动容器 padding-top 是 --pi-space-9(24px),仓库自己的约定是"sticky 偏移与其 padding 成对"(19bcd230 提交原文 "pair the sticky offset with its padding"):事件组 summary 与组消息头部都用 `--pi-chat-sticky-top`(=-24),实测停靠在可见顶边 0px;但普通消息卡头部写死 `calc(-1 * var(--pi-space-7))`(=-16),实测停靠在可见顶边下方 8px。第四轮只把 -16px 字面量换成了 token(8e131a16),没有把它与滚动容器 padding 重新配对——同一个滚动器里两种 sticky 头部停在不同的高度。
- minimal failure scenario: 打开一条较长的 assistant 消息向上滚动,让 `.msg-header` 钉住:角色标签距顶边 8px,8px 缝隙里能看到正文从钉住的头部上方滑过(头部 z-index:4、背景 surface-card 只盖住自身);同一屏内一个钉住的 event-group summary 却紧贴顶边,两种钉住高度肉眼可辨。
- confidence: high(实测探针:top:-16 停在 8px,top:-24 停在 0px)

## F2 context sheet 机器组把 "Machines" 标题画了两遍,且两个标题字号/字重/间距互不相同
- file:line: src/client/src/components/appShell/ContextSwitcherSheet.ts:70(`<h2>Machines</h2>` 轻端标题)、:88(`.sheet-body h2 { margin: 0 0 var(--pi-space-2); font-size: var(--pi-text-sm); font-weight: var(--pi-weight-semibold); ... }` = 13px/600/下距4px);pi-web-plugins/machines/browser/MachineList.ts:106 与 :196-197(shadow 内再渲染 `<h2><span>Machines</span>...`,adopted listStyles:`h2 { ... margin: 0 0 var(--pi-space-4); ... font-size: var(--pi-text-xs); }` = 12px/UA bold/下距8px,src/client/src/components/shared.ts:276)
- surface: context-sheet
- finding: 机器 ≥2 台时,`renderMachineGroup` 先在轻端写一个 "Machines"(13px/600,下距 4px),随后 `section.render(context)` 里 MachineList 的 shadow DOM 又渲染一个 "Machines"(12px/bold,下距 8px)——同一个词在同一张 sheet 里上下相邻出现两次,字号、字重、节奏三重不一致;同屏的 Projects / Workspaces 组(renderNavSection 不加轻端标题)只有一个 shadow 标题,机器组是唯一的双标题组。
- minimal failure scenario: 两台机器的手机上打开 Change context sheet:第一行是 13px 的 "Machines",紧接着第二行是 12px 加粗的 "Machines",再往下才是机器行;Projects 组只有一行标题,三组头部节奏对不齐。
- confidence: high

## F3 常驻栏的 working 三点绕开了共享 session-state 徽章:同一工作状态在同屏是 6px 与 4px 两套点
- file:line: src/client/src/components/appShell/AppContextBar.ts:85(`.working-dot { width: var(--pi-dot-sm); ... animation: working-bounce 1.2s ease-in-out infinite; }`)、:88(`working-bounce ... translateY(-3px)`);src/client/src/components/sessionStateBadgeStyles.ts:39(共享 `.state-dot { width: var(--pi-dot-xs); ... animation: session-state-bounce 1.1s ... }`,振幅 -2px)及其文件头注释 :3-4("One style block for every surface (list rows, chat dock, quick switcher, context bar) so the same state never reads differently in two places")
- surface: sessions / chat(壳层 chrome)
- finding: 共享徽章自声明覆盖 context bar,但 AppContextBar 自建了一套 `.working-dot`:点径 --pi-dot-sm(6px)对共享的 --pi-dot-xs(4px),跳动幅度 3px 对 2px,周期 1.2s 对 1.1s。会话工作时,resident bar(顶部)与 activity dock(底部,ChatView.ts:1317/1345 渲染共享 `.state-dots`)同屏各显示一套 "working" 三连点。第四轮已把 quick switcher 收编进 sessionRowIndicator 仲裁器,context bar 未收编。
- minimal failure scenario: 同一正在流式输出的会话:顶栏三个 6px 点按 3px 幅度弹,聊天底部 dock 三个 4px 点按 2px 幅度弹,两个"同义"标记在同一屏以不同尺寸、不同节奏运动。
- confidence: high(事实);是否属有意保留无注释背书

## F4 手机 compact 头部一排三个实心描边控件两种圆角语言:refresh 8px 方角夹在两个全圆角 pill 之间
- file:line: src/client/src/components/appShell/AppNavigationPanel.ts:179-182(compact-header 内 `${this.refreshControl}` + gear + Actions)、:463(`.compact-header-action { ... border-radius: var(--pi-radius-pill); ... }`);src/client/src/components/appShell/AppRefreshControl.ts:40(`.app-refresh-button { ... border-radius: var(--pi-radius-md); ... }` 44x44);对照桌面头部 :457-458 + :501(所有 header 按钮统一 radius-md)
- surface: sessions(phone 面板头部)
- finding: 同一 44px 高的 compact 头部行内,gear 与 Actions 是 `--pi-radius-pill`(22px 圆角),紧邻的 app-refresh-control 是 `--pi-radius-md`(8px)方块——三个同为 border+surface 填充的兄弟控件,一个方角两个全圆;桌面同一面板的头部按钮全部统一 radius-md,只有 compact 行分裂。refresh 在手机 PWA 模式进入该行(appShellController.ts:46-53,`shouldShowAppRefreshInContextBar` 为真时 refreshControl 仍渲染进 compact-header)。
- minimal failure scenario: 手机 PWA 打开应用:compact 头部从左到右为 44x44 圆角 8px 的刷新方块、44px 高全圆角的齿轮 pill、全圆角的 Actions pill,三个相邻实心控件圆角跳变。
- confidence: high(几何事实);pill 是否为手机语言有意选择无注释背书

## F5 chat 抽屉头部折叠钮在鼠标端是 32px,未读 panel-header 控件高度 token(左栏同位控件为 44px)
- file:line: src/client/src/components/ChatView.ts:168(`.drawer-collapse { ... width: var(--pi-control-height); height: var(--pi-control-height); }`,仅 coarse 媒体在 :172 抬到 touch 44);对照 src/client/src/components/appShell/AppNavigationPanel.ts:458(`header button { ... height: var(--pi-panel-header-control-height); }` = 44)与 index.html:82-85(token 注释:"One height for every panel header, so the left rail and the chat drawer share a horizontal rule";`--pi-panel-header-control-height: 44px`)
- surface: chat-drawer
- finding: `--pi-panel-header-control-height` 这个 token 就是为"面板头部内的控件"命名的,左栏 header 按钮(44px)与 refresh 控件(44px)都读它;chat 抽屉是另一个面板头部,其折叠钮在鼠标端读的是普通 `--pi-control-height`(32px),只有触屏被抬到 44。同为面板头部控件,鼠标端 44 对 32。
- minimal failure scenario: 桌面同时展开左栏与 chat 抽屉:左栏齿轮/Actions/刷新是 44px 高的头部控件,右侧抽屉头部的折叠钮 32px,两个并排面板的头部控件不等高。
- confidence: medium(22px 抽屉 tab 是已钉死的既有决定,32px 折叠钮无同等注释背书)

## F6 触屏端消息头部 ⓘ 元数据钮是 26x24 原始字面量(且被自身 max-width 压成 24 宽),没有命中区扩展,而同排动作钮的触屏命中区是 44x44
- file:line: src/client/src/components/ChatView.ts:404(`@media (hover: none) { ... .msg-meta { ... max-width: var(--pi-space-9); } }`,space-9=24px)、:405(`.msg-meta:not(.expanded) { display: inline-grid; width: 26px; height: 24px; ... }`);对照 :389-390(`.msg-action::after { inset: -10px -3px; }`、coarse `inset: -10px` → 44x44 命中区)
- surface: chat
- finding: 触屏下 `.msg-meta` 收缩为 "ⓘ" 控件:声明 width:26px 但同 media 里 max-width:24px 把它压回 24 宽,26px 是死字面量;高 24px 也是字面量,落在 controlHeightScale 守卫的 28-44 扫描窗外(守卫因此放行)。同排的 copy/recall `.msg-action` 是 24px 绘制但带 ±10px 命中扩展(触屏 44x44),ⓘ 没有任何命中扩展——同一头部行里兄弟触控目标 44 对 24。
- minimal failure scenario: 手机上点消息头部右侧的 ⓘ:有效命中 24x24,而它左边 20px 处的复制钮命中区 44x44;指尖落点偏 1px 即落空,兄弟控件却宽容得多。
- confidence: medium

## F7 context sheet 关闭钮在鼠标端 44px,打破了第四轮"对话框关闭钮统一鼠标尺寸"的收敛(settings/cleanup 为 36px)
- file:line: src/client/src/components/appShell/ContextSwitcherSheet.ts:85(`.sheet-close { ... width: var(--pi-control-height-touch); height: var(--pi-control-height-touch); ... }`,无 coarse 媒体,恒为 44);对照 src/client/src/components/SettingsDialog.ts:766(comfort 36)+ :778(coarse 抬到 touch)、src/client/src/components/SessionCleanupDialog.ts:244 + :251(同款 comfort→touch 两段式)
- surface: context-sheet
- finding: 第四轮把 settings 与 cleanup 的关闭钮收敛为"鼠标端 comfort(36)、触屏 touch(44)"的两段式;context sheet 的 × 一步到位恒为 44,鼠标用户(窄窗 ≤760px 触发 compact 布局即可打开该 sheet)看到的是与同页对话框族不同号的关闭钮。
- minimal failure scenario: 鼠标用户把桌面窗口缩到 760px 以下,打开 Change context sheet:× 钮 44px;再打开 Settings:× 钮 36px——同一指针、同类对话框族、两种关闭钮尺寸。
- confidence: medium

## F8 workspace 视图行(tool-row)高度是裸 52px 字面量:既非控制高度 token,也偏离同壳层卡片行的 56px 地板
- file:line: src/client/src/components/appShell/AppNavigationPanel.ts:471(`.tool-row { ... min-height: 52px; ... }`,它是一个 `<button>`);对照 src/client/src/components/shared.ts:341(`.list-body.tiles .action-main { ... min-height: 56px; }` 同为面板内的卡片行地板)
- surface: sessions(面板 tools 网格)
- finding: `.tool-row` 是真实按钮(control),其高度 52px 是裸字面量——高于守卫扫描的 28-44 窗口所以放行,也不在任何 token 上;同壳层的卡片行地板是 56px。52 既不是 --pi-control-height-touch(44)加某个 rhythm 步,也不是 56:一个 token 改动无法跟随它。
- minimal failure scenario: 触屏调大 --pi-control-height-touch 时,面板里所有控件升到 44+,tool-row 仍钉在 52;或未来把卡片行地板调到 60,tools 网格保持 52,同一面板两种卡片行高差 8px。
- confidence: medium-low

## F9 tiles 角落标记:menu 钮的 top/right 写死 6px/4px,而同一注释声称由 `--pi-tile-menu-inset` 派生的几何只覆盖了 activity dot
- file:line: src/client/src/components/shared.ts:318(`.list-body.tiles .action-menu { position: absolute; top: 6px; right: 6px; }`)、:346(coarse `{ ... .action-menu { top: 4px; right: 4px; } }`)、:337/:344(`--pi-tile-menu-inset` 分别定义为 space-3=6px / space-2=4px)、:351(activity dot 用 `calc(var(--pi-tile-menu-inset) + ...)` 派生)
- surface: sessions(面板机器/项目/工作区 tiles)
- finding: 同一条注释(:347-350 "Both the menu button's own corner and the activity dot's offset are derived from these")声明两个角标都从 inset token 派生,但 menu 钮本体把 inset 写死为 6px/4px 字面量,只有 dot 走 token。今天数值恰好相等(6=space-3,4=space-2),几何关系却被写了两遍:改 token 时 dot 移动、menu 钮不动,两者脱钩。
- minimal failure scenario: 把 `--pi-tile-menu-inset` 调到 space-4(8px):activity dot 右移 2px 与 menu 钮重新对中,而 menu 钮仍在 6px 处——同一角落的两个标记错位,恰是这条派生关系要防的事故。
- confidence: high(事实;当前无数值漂移,属关系未收敛)
  
## F10 同一份 session 列表里两种 disclosure 语言:标题 chevron 用文字字形瞬间换字,子树 chevron 用旋转动画
- file:line: src/client/src/components/SessionList.ts:273(`${this.collapsed ? "▸" : "▾"} Sessions` 文字换字)、:321(`archivedOpen ? "▾" : "▸" Archived`)、:755-756(`.subtree-chevron { transition: transform 120ms ease; } .subtree-chevron.collapsed { transform: rotate(-90deg); }`);对照 src/client/src/components/ChatView.ts:179 + :440(抽屉折叠用 SVG chevron 旋转)
- surface: sessions / chat-drawer
- finding: 同一个"展开/收起一个分区"动词,SessionList 的 Sessions/Archived 标题用裸文字 ▸/▾ 换字(无过渡、无旋转),同一文件 200 行之下的子树开关用单个 ▾ 旋转 120ms,chat 抽屉用 SVG chevron 旋转——三种绘制、两种运动模型。房子模式(图标即 mark)在抽屉与壳层是 SVG,列表标题退回裸文字。
- minimal failure scenario: 点击 Sessions 标题:chevron 瞬间从 ▾ 变 ▸;点击它下面某行的子树开关:chevron 平滑旋转 -90°;再开 chat 抽屉折叠:SVG 旋转。同一屏三种 disclosure 手感。
- confidence: medium-low

## F11 top-notices 容器与 top-drawer 各画一条 1px 底边,抽屉下方叠成 2px 双色横线
- file:line: src/client/src/components/ChatView.ts:110(`.top-notices { ... border-bottom: 1px solid var(--pi-border); ... }`)、:118(`.top-drawer { ... border-bottom: 1px solid var(--pi-purple-border); }`);:1010-1012(renderTopNotices 把 drawer 作为 top-notices 的唯一子元素,容器无 padding)
- surface: chat-drawer
- finding: top-notices 只在抽屉有内容时渲染且仅包含抽屉:抽屉自己的紫色 1px 底边紧贴容器的标准色 1px 底边,叠成 2px、上下两色的横线;壳层其余所有分区边界都是单条 1px。容器底边是 notifications 时代的遗留,被抽屉整体覆盖后成为冗余的第二条边。
- minimal failure scenario: 打开任一会话的抽屉:抽屉下缘是 2px 双色线(上紫下灰);收起抽屉(仍渲染为条)同样如此;对比其上方 context-bar 与下方转录区的单线边界,抽屉边界凭空厚一倍。
- confidence: medium

## 附:复核与边界说明
- 复跑通过:typeScale.test.ts、spacingScale.test.ts、controlHeightScale.test.ts、dotScale.test.ts(7 tests passed)。F5/F6/F8 的字面量分别落在 controlHeight 守卫的 28-44 扫描窗外、hover:none 分支与 >44 区间。
- 已知/不重报项均已避开:drawer tab 22px(pinned)、--pi-muted 对比度(轮四判否)、dock 静默态、quick switcher 仲裁器(轮四已修)。
- 未报告(证据不足/判为有意):F3 的 pill 语言、F5 的 32px 若 owner 认可为"鼠标端抽屉是紧凑条"的一部分,则 F5 应判 not-true;F9 属关系未收敛而非当前视觉缺陷。
