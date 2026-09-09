# UIUX 收敛审计 · ROUND THREE · Lane A — 应用外壳与镶边几何(scale 落地之后)

- 仓库: /Users/hanxiao.du/Desktop/vincent/projects/pi-web (refactor/plugin-architecture @ HEAD 19bcd230)
- 本 lane 焦点面: boot; sessions; chat; chat-drawer; context-sheet
- 主读文件: src/client/src/components/appShell/*.ts, SessionList.ts, StatusBar.ts, ChatView.ts, shared.ts, src/client/index.html(token 块)
- 方法: 全部结论来自对源码与机械测试(含其豁免条款)的逐行核对;几何数字由 token 值与盒模型推导。本 lane 未做运行时/Playwright 测量,凡属推导而非实测处均已注明。
- 已核对且不再重报的 round-1/2 修复(verification 通过): 未读数是徽章 (SessionList.ts:682)、chip 标签在字阶上 (AppContextSwitcher.ts:110)、会话行状态标记已定位 (SessionList.ts:723 附近)、msg-action 命中区 -10px/-3px 扩边与 6px gap 恰好相切不重叠 (ChatView.ts:374-375 附近)、dot 三档全部读 token、refresh 控件与 header 控件同高 (AppRefreshControl.ts:40)。已知故意开放的 modal 层级、picker current value 散文、drawer tab 22px 均未报。

TOTAL: 11 findings

---

## F1 两个面板头没有共享它们被立 token 承诺的那条水平线(44px vs 40px)
- file:line: src/client/src/components/appShell/AppNavigationPanel.ts:457-458; src/client/src/components/ChatView.ts:134,168; 合同原文 src/client/index.html:70-77
- surface: chat / chat-drawer / sessions(桌面外壳镶边)
- finding: --pi-panel-header-height 的注释写明 One height for every panel header, so the left rail and the chat drawer share a horizontal rule instead of each picking its own。实际推导:导航面板头 = min-height 36px + 内部按钮 height: var(--pi-panel-header-control-height)(44px)→ 头部实高 44px;chat 抽屉头 = min-height 36px(border-box)+ 上下 padding 各 4px(--pi-space-2)+ 内部最高子元素 .drawer-collapse 32px → 40px。两个并排出现的头部一条 44px、一条 40px。
- minimal failure scenario: 桌面宽度装上 goals 之类抽屉节并打开:左栏头部的下边框线与 chat 抽屉头部的下边框线相差 4px,token 注释承诺的 shared horizontal rule 在屏上断开。
- confidence: 高(token 与盒模型推导;未运行时实测,特此注明)

## F2 常驻条会话名把 text-overflow: ellipsis 写在 flex 容器上,长名硬切无省略号
- file:line: src/client/src/components/appShell/AppContextBar.ts:76;对照正确写法 src/client/src/components/appShell/AppNavigationPanel.ts:482
- surface: chat(常驻上下文条)
- finding: .session-title 同时声明 display: inline-flex; overflow: hidden; text-overflow: ellipsis; white-space: nowrap,但文本是裸字符串、按钮本身是 flex 容器——text-overflow 只作用于块容器的行内内容,匿名 flex 项在 nowrap 下不收缩,溢出被 overflow: hidden 直接剪掉,省略号永不出现。同屏的手机 scope 芯片用的是正确的三层写法(按钮 > span.compact-scope-name 上做 ellipsis)。
- minimal failure scenario: 选一个长标签会话,在手机宽度(panel toggle 44px + working 三点再占一截)下,常驻条里的名字在字中间被切成半截字形,没有省略号;切到同一会话的手机面板头部,scope 芯片却有正常省略号——同一个名字两种截断语言。
- confidence: 中高(CSS 机制确定;未运行时实测)

## F3 多选时前导槽里的 checkbox 与 subtree toggle 同为 24px 方块却不同心(细指针偏 2px/1px,粗指针中心差 4px)
- file:line: src/client/src/components/SessionList.ts:727(checkbox top 9px / left calc(8px + depth*16) / 24×24 / z3),728(toggle top 8px / left calc(6px + depth*16) / 24×24 / z2 / 14% muted 底 + chevron 字形),744(coarse: toggle 36×44 top 0);两控件同时渲染见 renderSession(约 360-375 行,showsCheckbox 与 hasSubagents 条件相互独立)
- surface: sessions(多选 × 有子代理的行)
- finding: round-2 (commit 9b08fa0e) 修的是命中与遮挡(pointer-events: none + checkbox 提到 z3),没有修几何:两个本应共占一个前导槽的方块,细指针下错位 (2px, 1px)——toggle 的半透明底与 chevron 作为 ghost 从 checkbox 左上方露出;粗指针下 toggle 变为 36×44,中心 (24,22) 对 checkbox 中心 (20,21),水平差 4px。
- minimal failure scenario: 对一个有子代理的行长按进入多选:checkbox 背后浮出一个偏左上 2px 的灰晕方框(触屏上是一个宽出 12px、中心右偏 4px 的大框),读作印歪了的阴影而不是仍然可用的展开控制。视觉显著度依赖原生 checkbox 的绘制方式,此点标注为推断。
- confidence: 中(CSS 数值全部核实;视觉效果未运行时复现)

## F4 .tools-section 的顶 padding 是藏在 calc/env 豁免背后的 10px 节奏字面量
- file:line: src/client/src/components/appShell/AppNavigationPanel.ts:469;豁免条款 src/client/src/components/spacingScale.test.ts:13-19;--pi-space-5 = 10px 见 src/client/index.html:34
- surface: sessions(导航面板底部 tools 网格)
- finding: padding: 10px var(--pi-space-4) calc(10px + env(safe-area-inset-bottom))——顶部 10px 是与 --pi-space-5 完全相等的普通节奏步,只因声明底部含 env() 整条值被 spacingScale 的 calc/env 豁免放过。测试自己的注释说豁免很窄、以免普通节奏字面量藏身其中,这里恰是被点名禁止的形态(同一声明里左右两侧都用了 token,唯独顶面没有)。
- minimal failure scenario: 将 --pi-space-5 从 10px 调到 12px:全 app 所有 10px 节奏步跟着走,tools 网格的顶 padding 仍停在 10px,与侧距的相对节奏悄悄改变,机械测试依旧绿。
- confidence: 高

## F5 同一个粘性头贴平卡片上缘的偏移,兄弟规则一个读 token、一个写死 -10px
- file:line: src/client/src/components/ChatView.ts:372(.msg > .msg-header 的 margin 用 calc(-1 * var(--pi-space-6)),与 :271 .msg 的 padding --pi-space-6 配对)对比 :379 + :312(.group-msg > .msg-header 的 margin 写死 -10px,父级 .group-msg 的 padding 是 --pi-space-5 = 10px)
- surface: chat(转录卡片的粘性消息头)
- finding: 同一个几何意图(把粘性头拉出父卡片自身 padding、贴平上缘)在普通消息卡上由 token 派生,在事件组卡片上是不与任何 token 挂钩的裸 -10px。spacingScale 的负值不匹配其正则,静默漏过。
- minimal failure scenario: --pi-space-5 重定为 12px:group-msg 的 padding 变 12px,粘性头仍只上提 10px,组卡顶端露出 2px 卡片底色;同一屏里普通消息卡(跟随 token)仍然贴平,滚动中一平一翘。
- confidence: 高(字面量与配对关系均核实)

## F6 字阶从 font: 简写漏出:16px 与 10px 两个不在字阶上的尺寸逃过 typeScale
- file:line: 测试 regex 只匹配 font-size 加数字 px(src/client/src/components/typeScale.test.ts:16),而其注释(:9-11)声称带像素的简写也应当被匹配;逃逸实例: src/client/src/components/ChatView.ts:62,305 与 src/client/src/components/shared.ts:159,243(font: 16px/1 system-ui,两个图片灯箱关闭钮;16px 不在 11/12/13/14/15/17/20 阶上)、src/client/src/components/PromptEditor.ts:155(font: 700 10px/1,低于字阶底步 11px)、同尺度值却写字面量的 src/client/src/components/ChatView.ts:419 与 src/client/src/components/shared.ts:460(font: 13px ui-monospace,值等于 --pi-text-sm 却未读 token)
- surface: chat(两个图片灯箱、composer 附件芯片、bash 输出与行内 code)
- finding: 机械字阶测试的正则与它自己写下的合同不一致:所有藏在 font: 简写里的像素尺寸全部免检。其中 16px 与 700 10px 是字阶上根本不存在的步,正是 round-2 立项时点名的 token 移动跟不动的尺寸。
- minimal failure scenario: 主题/字阶整体上调一档:全 app 文字跟随,唯灯箱的乘号停在 16px、附件芯片的 PDF 角标停在 10px——测试全绿,无人知晓。
- confidence: 高

## F7 Clear queue 药丸在细指针下约 22px 高:低于 house 自己的 24px AA 地板,也低于 32px 鼠标控高,且因只声明 padding 而免检
- file:line: src/client/src/components/ChatView.ts:324(条 font-size --pi-text-xs = 12px),335(按钮 padding: var(--pi-space-1) var(--pi-space-3); font: inherit,无 height/min-height),338(仅 coarse 给了 44px);同面近例 :318(.history-load-button 推导约 30px,低于 32px 鼠标步但高于 24px)
- surface: chat(队列条)
- finding: 按钮高 = 12px 字的 normal 行高(约 16px)+ 上下 padding 各 2px + 上下边框各 1px ≈ 22px。controlHeightScale 只抓 28-44px 的 height/width 字面量,padding-only 的控件全部绕行;这正是 round-2 给 cleanup entry 立过的同类标准。
- minimal failure scenario: 桌面端另一台设备向本会话排队消息,转录底部出现唯一的 Clear queue 控制:目标高约 22px,低于 WCAG 2.5.8 的 24px 地板;行内没有更高大的兄弟可对照,静默存在。
- confidence: 中高(由继承行高推导;未运行时实测)

## F8 idle 状态的 activity dock 文字对比度约 3.9:1,低于 AA(12px 正文)
- file:line: src/client/src/components/ChatView.ts:222(dock 基色 var(--pi-muted) = #8b949e,见 index.html:125)、232(.activity-dock.idle { opacity: .75; font-size: var(--pi-text-xs); },底为 --pi-bg-overlay #0d1117e6)
- surface: chat(状态坞;idle 是回合之间的常态)
- finding: 12px 的 --pi-muted 文字整体乘 0.75 不透明度,对合成底色约等于 #6c737c on #0e1218,算得约 3.96:1;同文字不透明时约 5.9:1。AA 正文阈值 4.5:1,差距正来自那层 ghost 化的透明度。
- minimal failure scenario: 默认深色主题下空闲会话:底部药丸里 12px 的 Idle/完成字样长期以约 3.9:1 悬在屏上——不是瞬态,是回合之间的常驻状态。
- confidence: 中高(token 数值计算;未用 axe/运行时探针)

## F9 同层兄弟各自发明阴影:--pi-elevation 三档已发布并被同层邻居使用,chat/sessions 镶边仍在手写 0 8px Npx
- file:line: token 及 a layer never invents its own blur and spread again 的承诺 src/client/index.html:164-169;违例: src/client/src/components/ChatView.ts:222(dock 0 8px 28px)、ChatView.ts:372(粘性头 0 8px 18px)、src/client/src/components/shared.ts:436(会话行菜单面板 0 8px 24px);守规对照: QuickSwitcher 的同类行菜单 src/client/src/components/QuickSwitcher.ts:475 用 var(--pi-elevation-2)
- surface: chat + sessions(行菜单、状态坞、粘性头)
- finding: 同一个浮层角色——会话行菜单与快速切换器行菜单——一个手写 0 8px 24px,一个读 --pi-elevation-2;同一 chat 面里 dock、粘性头、行菜单三种自创 blur/spread。主题只能通过重定 elevation token 调整阴影,手写者全部失联。
- minimal failure scenario: 换一个把 --pi-elevation-2 调柔和的主题:快速切换器行菜单的影子变了,点开旁边会话行的菜单,影子还是旧的 0 8px 24px——同一层、同一动作、两种深度。
- confidence: 高

## F10 字重 650 在镶边里多处使用而字阶只命名了 400/500/600
- file:line: token src/client/index.html:48-50;本 lane 实例: src/client/src/components/appShell/AppContextBar.ts:76(常驻条会话名)、src/client/src/components/SessionList.ts:705(未读行标题);范围外佐证: AskUserCard.ts:534,627、QuickSwitcher.ts:421,423、ExtensionDialogCard.ts:371,478
- surface: chat 镶边 + sessions
- finding: 650 已是事实上的房内字重(七处声明一致),但 --pi-weight-* 只有 regular/medium/semibold 三档,650 无名。这与 control-height token 立项时点名的历史(30, 34, 36, 38, 40 全是同一种意图)同构:一致但未命名的步,主题与测试都追不上。
- minimal failure scenario: 主题把 --pi-weight-semibold 定为 550:chip 值、抽屉标签跟随,而未读会话名与常驻条标题仍停在 650——未读比已读重一点的强调关系在换主题后失效,且无测试报警。
- confidence: 中(数值一致是事实;应当命名是设计判断,已标注)

## F11 round-2 声称 cleanup entry 达到鼠标控高,细指针下仍约 28px,比同排兄弟矮 4px
- file:line: src/client/src/components/SessionList.ts:690(.cleanup-entry 仅 padding 6px/8px,无 height/min-height)对比 :684(.bulk-select-entry 32×32)、:685(.start-session-button height 32);coarse 修复在 :775;round-2 声明原文见 .changeset/round-two-polish-fixes.md(The cleanup entry meets the mouse control height its neighbours already had)
- surface: sessions(会话节标题工具排)
- finding: 标题行 h2 虽有 min-height 32px,但 listStyles 的 h2 是 align-items: center,按钮不被拉伸:cleanup entry 实高约 12px 字行高(约 16px)+ 12px padding ≈ 28px。它是 ghost 按钮,高度只在 hover/focus 的 surface-hover 底色上显形——那块高亮比左右两个 32px 控件矮一截。coarse 指针已被 :775 修到 44px,细指针路径没有落改。
- minimal failure scenario: 鼠标悬停会话头部的 Clean up:高亮条约 28px,紧邻的多选钮(32px)与 New session(32px)在同一行各高出 2px——round-2 修复单声称已消除的工具排里唯一矮一头的控件,在鼠标下仍在。
- confidence: 中(CSS 推导;round-2 修复未完全落地的判定基于修复单声明与现行规则的比对)

---

## 本 lane 核对为干净、未发现新问题的点
- boot 空态(PiWebApp.ts:2675-2696):加载/失败/空三态措辞诚实,.empty 与按钮读 token,无几何问题。
- context-sheet(ContextSwitcherSheet.ts):关闭钮 44×44、乘号用 --pi-text-xl、标题 600,未发现错位或逃逸。
- StatusBar.ts:点用 --pi-dot-sm、padding/gap 全 token(其 .activity/.dot/@keyframes pulse 为无引用死样式,非视觉问题,不计入)。
- AppPanelEdgeControl:edge-button 48px、命中扩边 5px 的推导有注释与计算支撑,判为有意设计。
- SessionList 树缩进 calc(…*16px) 系列属 spacingScale 文档写明的布局数学豁免,不报。
