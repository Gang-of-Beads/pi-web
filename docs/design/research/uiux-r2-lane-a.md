# UIUX R2 — Lane A: app shell 与 chrome 几何(刻度化之后)

审计对象:PI WEB client(src/client/src),分支 refactor/plugin-architecture,当前 HEAD。
本 lane 聚焦:boot / sessions / chat / chat-drawer / context-sheet 的外壳与 chrome 几何。
方法:逐行读取源码,所有结论均给出已核实的 file:line。未做浏览器实测的几何推断均在 confidence 中注明。
不含 round one 已修复项,不含任务声明为 deliberately open 的三项。

---

## F1 会话多选模式下,行首复选框被子树折叠控件覆盖(命中区重叠)

- file:line: src/client/src/components/SessionList.ts:399-400(render 顺序:checkbox 先、subtree-toggle 后)、723(.session-checkbox top:9px; left:calc(8px + depth*16px); 24x24; z-index:2)、724(.subtree-toggle top:8px; left:calc(6px + depth*16px); 24x24; z-index:2)、740(coarse 下 toggle 变为 top:0, 36x44)
- surface: sessions
- finding: 两个行首控件各自独占同一条 38px 前导槽(has-subtree-toggle 的 padding-left,见 728 行),而不是并分它:checkbox 盒占 x[8,32]、y[9,33],toggle 盒占 x[6,30]、y[8,32],重叠宽 22px/24px;两者 z-index 相同,toggle 在 DOM 中靠后故绘制在上层。coarse 指针下 toggle 放大到 36x44、top:0,把 24x24 的 checkbox 完全包住。子树折叠时 toggle 还是带 14% 底色的 inert span(455 行),同样盖在 checkbox 上。
- minimal failure scenario: 长按一个带 subagent 的父会话行进入多选:点击行首 checkbox 的可视位置,实际命中的是折叠按钮/ inert span——点击展开子树而不是勾选该行;在手机上 checkbox 无任何可点区域,该行只能靠整行点击来切换勾选。
- confidence: 高(几何全部来自已核实源码;未做浏览器复现)

## F2 会话标题栏:Clean up 按钮与相邻控件不等高,且低于 32px 控制下限

- file:line: src/client/src/components/SessionList.ts:690(.cleanup-entry 仅 padding: var(--pi-space-3) var(--pi-space-4),无 min-height/height)对照 684(.bulk-select-entry height: var(--pi-control-height))、685(.start-session-button height: var(--pi-control-height));标题行 h2 为 676(min-height: var(--pi-control-height))
- surface: sessions
- finding: 细指针下同一 h2 工具行里,☑(32px)与 New session(32px)是固定高度,夹在中间的 Clean up 是 6px+6px 内边距加约 15px 文本行高,约 27px:三个并排控件两条高度,且 Clean up 低于 --pi-control-height(32)的鼠标档下限。粗指针档已补齐(768 行 min-height 44),细指针档没有。
- minimal failure scenario: 桌面宽度打开会话面板:标题栏三个控件底边不齐,Clean up 的可点击高度约 27px,是整行里唯一低于控制高度刻度下限的按钮。
- confidence: 高(规则已核实;渲染差值约 5-6px 依赖字体度量,标高)

## F3 上下文切换芯片的微标签 font-size:10px 逃逸字号刻度

- file:line: src/client/src/components/appShell/AppContextSwitcher.ts:109(.chip-label { ... font-size: 10px; ... });刻度最小档为 --pi-text-2xs: 11px(src/client/index.html token 块)
- surface: sessions(面板 chrome,Machine/Project/Workspace 芯片)
- finding: 每个芯片里常驻的大写微标签用 10px,比已发布字号刻度的最小档还小 1px,且无任何豁免记录;同一文件其余字号全部走 token(如 115 行 --pi-text-lg)。
- minimal failure scenario: 打开任一导航面板:三个芯片的 MACHINE / PROJECT / WORKSPACE 标签是全应用唯一不在字号刻度上的文字;把 --pi-text-2xs 调到 12px 时它们不动,视觉上与刻度脱钩。
- confidence: 高

## F4 工具区(tools-section)的间距写成像素字面量,刻度上存在同值 token

- file:line: src/client/src/components/appShell/AppNavigationPanel.ts:469(.tools-section { ... gap: 8px; padding: 10px var(--pi-space-4) calc(10px + env(safe-area-inset-bottom)); ... })
- surface: sessions(面板底部 workspace 视图卡片网格)
- finding: 同一条声明里,8px 与 10px 正是 --pi-space-4 与 --pi-space-5 的值,却写死为字面量,同行另一段 padding 又用了 token:同一盒模型一半走刻度一半不走。
- minimal failure scenario: 把间距刻度整体加密或放大(如 --pi-space-4 调为 6px)时,工具卡网格的 gap 和上下 padding 纹丝不动,卡片与相邻 section 的节奏脱节。
- confidence: 高

## F5 卡片行高 52px 与 56px 无 token 定义,控制高度测试在 >44px 区间失明

- file:line: src/client/src/components/appShell/AppNavigationPanel.ts:471(.tool-row { ... min-height: 52px; ... });src/client/src/components/shared.ts:314(.list-body.tiles .action-main { ... min-height: 56px; ... });controlHeightScale.test.ts 的正则 (2[89]|3\d|4[0-4])px 只覆盖 28-44px
- surface: sessions(面板工具卡)与 shared 列表 tile
- finding: 两类可点卡片的最小高度各写一个字面量,且互不一致(52 vs 56);它们都在控制高度刻度之外,而防字面量的测试恰好扫不到 >44px 的值,因此这条逃逸是被测试结构 itself 漏掉的。
- minimal failure scenario: 触屏下限上调时,--pi-control-height-touch 跟随变化,但工具卡仍是 52px、tile 仍是 56px;两个同层卡片族从此静默分叉,测试依旧绿。
- confidence: 中(逃逸事实确凿;52/56 是否刻意留白无注释佐证)

## F6 appShell 通用按钮规则 padding: 7px 9px 脱离 2px 间距网格(当前被遮蔽的死规则)

- file:line: src/client/src/components/appShell/AppNavigationPanel.ts:498(button { ... padding: 7px 9px; ... })
- surface: sessions(导航面板 shadow root 内的兜底按钮样式)
- finding: 7px 与 9px 都不在 2px 间距刻度(2/4/6/8/10/12...)上。核查面板内全部按钮:header button、.tool-row、.compact-header-action、.compact-scope 均覆写了 padding,故该值当前不直接成像——但它是最具体的兜底规则,下一个漏写 padding 的按钮会以 7/9px 成像。
- minimal failure scenario: 面板里新增一个未指定 padding 的按钮:它比任何刻度档都怪(高约 7+7+文本),与标题栏 32px 控件不齐。
- confidence: 低(几何当前不可见,属卫生类发现)

## F7 跳到底部按钮字形 18px 逃逸字号刻度

- file:line: src/client/src/components/ChatView.ts:105(.jump-to-bottom { ... font-size: 18px; line-height: 1; ... })(块起于 97 行)
- surface: chat
- finding: 字号刻度的档位是 11/12/13/14/15/17/20;18px 不在其上。该字形(向下的箭头字符)是刻度外字号在 chrome 控件里的唯一直接成像点之一。
- minimal failure scenario: 与使用 --pi-text-lg(17px)或 --pi-text-xl(20px)的同类单字形按钮并排时,视觉尺寸差 1-3px 且无法随刻度调整。
- confidence: 高(逃逸本身);低(视觉后果轻微)

## F8 活动坞下边距 10px 字面量,刻度上有同名档位

- file:line: src/client/src/components/ChatView.ts:222(.activity-dock { flex: 0 0 auto; margin: 0 var(--pi-chat-gutter) 10px; ... })
- surface: chat(底部状态坞)
- finding: margin 的三个值里两个走 token(--pi-chat-gutter),唯独与 composer 之间的 10px 写死,而 --pi-space-5 正是 10px;同一文件的注释(见 217 行附近)明确把坞与 composer 的间距当作设计值对待。
- minimal failure scenario: 调整 --pi-space-5 时,transcript 与 composer 之间这一段的节奏不变,坞与上方消息卡(margin 走 --pi-space-7)的间距关系被单方面改变。
- confidence: 高

## F9 聊天顶部 26px 内边距与 -26px 粘滞偏移:token 已存在却被同文件字面量复制

- file:line: src/client/src/components/ChatView.ts:203(.chat { --pi-chat-sticky-top: -26px; ... padding: 26px var(--pi-chat-gutter) var(--pi-space-7); })、295(.msg.event-group > summary { position: sticky; top: -26px; ... })、379(.group-msg > .msg-header { position: sticky; top: -26px; margin: -10px 0 ... });token 的实际消费者是 src/client/src/components/AskUserCard.ts:488(top: var(--pi-chat-sticky-top, 0px))
- surface: chat / chat-drawer
- finding: --pi-chat-sticky-top 已为「粘滞头须清除聊天顶衬」这一耦合命名,但同一文件里 event-group 摘要与 group-msg 头仍把 -26px 写死;26px 顶衬本身也不在间距刻度上(最近档 --pi-space-9 为 24px)且无 token。
- minimal failure scenario: 把 --pi-chat-sticky-top 改为 -30px(配合更大的顶衬):AskUserCard 的粘滞头移动,event-group 摘要与 group 头不动,滚动时消息卡内容从粘滞头下方露出 4px。
- confidence: 高(字面量已核实);影响为漂移风险,非当前可见错位

## F10 同一文件里两个图片灯箱的关闭按钮不等高:44px vs 32px

- file:line: src/client/src/components/ChatView.ts:62(.attachment-zoom-close { ... width/height: var(--pi-control-height-touch) ... font: 16px/1 system-ui, sans-serif; ... })对照 305(.image-zoom-close { ... width/height: var(--pi-control-height) ... font: 16px/1 system-ui, sans-serif; ... });粗指针在 337 行统一为 44
- surface: chat(待发送附件灯箱与图片查看灯箱)
- finding: 同一 surface、同一角位、同一 × 字形、同一字号的两个关闭按钮,细指针下一个 44px 一个 32px;粗指针下才统一。两处还各带一份 font: 16px/1 system-ui 字面量(可读 --pi-control-font-size)。
- minimal failure scenario: 桌面上先点开一张聊天图片(× 32px),再从输入框附件预览点开同一位图(× 44px):同一交互目标在两个兄弟对话框里尺寸差 12px。
- confidence: 中高(规则差异确凿;是否刻意无注释)

## F11 等宽代码字号与字体栈写字面量,且字体栈副本已与 --pi-font-mono 漂移

- file:line: src/client/src/components/shared.ts:453(formattedTextStyles 的 code { ... font: 13px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; ... })、shared.ts:214(workspacePanelStyles 的 pre { ... font: 12px ui-monospace, ... })、src/client/src/components/ChatView.ts:419(.shell-output { ... font: 13px ui-monospace, ... })
- surface: chat(消息内代码、shell 输出)
- finding: 13px 即 --pi-text-sm、12px 即 --pi-text-xs,却全部写字面量;三份字面量字体栈都是 --pi-font-mono 的近似复制且已漂移——token 里含 SF Mono,字面量里没有。聊天正文里最高频的等宽文本不走任何 token。
- minimal failure scenario: 用户主题把 --pi-font-mono 换成自定义等宽字体:transcript 正文与 composer 跟随,而消息内 code、shell 输出、代码块仍是系统 ui-monospace,同屏两种等宽字。
- confidence: 高

## F12 空闲态活动坞文字对比度约 4.0:1,低于 AA(12px 正文需 4.5:1)

- file:line: src/client/src/components/ChatView.ts:232(.activity-dock.idle { width: fit-content; ... opacity: .75; ... font-size: var(--pi-text-xs); })基色为 222 行的 color: var(--pi-muted)(#8b949e)叠 --pi-bg-overlay 背景
- surface: chat(底部状态坞 idle 态)
- finding: 整坞 opacity .75 把 --pi-muted 文字向背景混合,有效前景约 #6e7680,对约 #0d1117 的有效底,按 WCAG 公式计算约 3.8-4.0:1,在 12px(--pi-text-xs)字号下低于 AA 的 4.5:1;working/asking 等深色态不受此影响。
- minimal failure scenario: 会话空闲但后台仍有任务时,坞内 "idle · N background runs" 以 12px、约 4:1 的对比度呈现,低视力用户读不出;同坞 working 态的同一位置却达标,同一控件两种达标状态。
- confidence: 中(按公式计算,未做浏览器取色实测;混合底色随背后内容略有浮动)

## F13 「工作三连点」同屏两种尺寸,单点状态标记三种尺寸并存于常驻 chrome

- file:line: src/client/src/components/appShell/AppContextBar.ts:81(.working-dot 用 --pi-dot-sm = 6px,常驻上下文栏);src/client/src/components/sessionStateBadgeStyles.ts:26、39(.session-state 盒 --pi-dot-md、.state-dot 用 --pi-dot-xs = 4px,chat 活动坞与会话行共用,坞内 markup 见 ChatView.ts:1326/1335/1342);单点:src/client/src/components/ChatView.ts:255(坞的 .dot 用 --pi-dot-md = 8px)对照 src/client/src/components/StatusBar.ts:12(状态栏 .dot 用 --pi-dot-sm = 6px)
- surface: boot / sessions / chat(跨 chrome 的一致性)
- finding: dotScale 建了三档 token,但没有为「同一个语义」指定同一档:同为「正在工作」的三连点,常驻栏是 6px、其正下方的活动坞是 4px,聊天同屏可见;同为单点状态标记,活动坞 8px、状态栏 6px。dotScale.test.ts 的注释自己记载的正是这个事故(「a 6px triplet in the context bar above a 4px triplet in the activity dock」),刻度化只命名了档位,没有消除该事故。
- minimal failure scenario: 会话工作时,顶部常驻栏的三连点(6px)与其正下方活动坞的三连点(4px)同屏跳动,读作两种强度;把任一 token 调档只改变其中一处,同屏尺寸差随之变化却无测试拦截。
- confidence: 事实高(全部行号已核实);判定为缺陷的置信度中(可能被当作分_surface 的刻意选择,但两处同屏)

## F14 同一面板里两个「+ 文本」创建控件,+ 字形一个 12px 一个 17px

- file:line: src/client/src/components/SessionList.ts:302(.start-session-button 内 <span aria-hidden="true">+</span> 无字号覆盖,继承 button 的 --pi-text-xs 12px;样式 685 行亦无字号)对照 src/client/src/components/shared.ts:282(.section-add { ... font-size: var(--pi-text-lg); line-height: 1; ... }),projects/workspaces 标题的创建控件即用 .section-add(标签类同为 .section-add-label,见 SessionList.ts:686 与 shared.ts:281)
- surface: sessions(同一导航面板,projects 标题与 sessions 标题上下相邻)
- finding: 两个结构完全相同的「+ 标签」图标文本行共享同一个标签类,唯独 + 字形一个走 12px 继承、一个走 17px token:图标文本行内字形与文本的比例在上下两个标题里分别是 1:1 与 1.4:1。
- minimal failure scenario: 展开项目 section(带 Add project)再收起它、露出 sessions 标题(带 New session):两个 + 基线与字重不同,读作两种组件而非同一模式。
- confidence: 高(规则与继承链已核实)

## F15 会话标题的未读数是裸文本,而计数徽章已是本应用的家法

- file:line: src/client/src/components/SessionList.ts:283-286(renderUnreadCount 输出 <small class="section-unread-count">N unread</small>)、683(样式:color: var(--pi-accent); font-size: inherit);对照家法:ChatView.ts:2352 抽屉标签计数用 .drawer-tab-badge(round one 定为徽章)、AppNavigationPanel.ts:479 工具卡计数用 .tool-badge
- surface: sessions
- finding: 同类「数量即状态」的标记在抽屉标签和工具卡上都是胶囊徽章,唯独 sessions 标题的未读数以强调色裸文本内联在标题行里,无底、无胶囊,与相邻的 .section-count(灰色裸计数)仅差颜色。
- minimal failure scenario: 有 3 条未读时,面板标题行显示蓝色裸文本 3 unread;同屏 chat-drawer 的标签上是胶囊徽章:同一个「有新东西要看」的计数在一屏内以两种形态出现。
- confidence: 低中(模式不一致的事实确凿;标题空间紧凑,可能属刻意取舍)

---

## 已核实但未列为发现(避免误报)

- .drawer-tab min-height 22px:任务已声明 deliberately open(composerRoom.test.ts 钉死),未报。
- picker 层级与「current value」prose:任务已声明 deliberately open,未报。
- .msg-action 24px 尺寸与 ::after 扩展命中区:round one 已修命中区重叠,24px 为既定图案,未报。
- 图标尺寸 12/16/17/20px(AppPanelEdgeControl/AppRefreshControl/AppNavigationPanel/ChatView .drawer-icon):应用未发布图标尺寸刻度,不构成「应读 token 而未读」。
- AppContextBar 的 panel-toggle/session-title/working 三者均为 44px 对齐,未发现失配。
- StatusBar 的间距、字号全部走 token,未发现逃逸。
- ContextSwitcherSheet:关闭按钮 44px、标题行几何走 token,未发现新问题。

TOTAL: 15 findings
