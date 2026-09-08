# UI 视觉几何审计 — Lane A:应用壳与 chrome 几何(nav panel / headers / context bars / drawer chrome / status bar / session rows / project cards)

审计范围表面:boot、sessions、chat、chat-drawer、context-sheet。
所有 file:line 均已在分支 refactor/plugin-architecture 的工作区源码中逐行核实。

## F1 刷新控件与同排头部按钮的几何不一致(36 vs 44、圆角 pill vs 8px、图标 18 vs 16)
- file:line:
  - src/client/src/components/appShell/AppRefreshControl.ts:40 — `.app-refresh-button { ... width: 36px; height: 36px; ... border-radius: 999px; ... }`
  - src/client/src/components/appShell/AppRefreshControl.ts:41 — 刷新图标 18px
  - src/client/src/components/appShell/AppNavigationPanel.ts:148(桌面 header 的 .header-actions 第一个子元素)与 :180(compact header 同样插槽)
  - src/client/src/components/appShell/AppNavigationPanel.ts:458 — 同排兄弟按钮 height: var(--pi-panel-header-control-height)
  - src/client/src/components/appShell/AppNavigationPanel.ts:460 — 齿轮 SVG 16px;:463、:467 — compact 兄弟按钮 min-height 44px 且 coarse 断点抬到 44
  - src/client/index.html:78 — --pi-panel-header-control-height: 44px
- surface: boot; sessions; chat(导航面板头部在三个表面常驻)
- finding: 同一个头部行里,刷新按钮是 36px 的正圆(radius 999px 裸值),而紧邻的齿轮/Actions 按钮是 44px 高、8px 圆角的方圆角矩形;齿轮图标 16px、刷新图标 18px。手机 compact header 中兄弟控件在 coarse 断点统一抬到 44px 触控下限,刷新控件没有任何 coarse 覆盖,仍停留 36px,低于同排其余控件 8px。
- minimal failure scenario: 打开 sessions 面板看一眼头部:圆形刷新按钮比旁边的齿轮按钮矮 8px、角形完全不同(圆 vs 8px 圆角);在手机上同样的排里,刷新按钮是唯一没到 44px 触控下限的控件。
- confidence: high

## F2 顶部 chrome 三段高度互不相等(约 44 / 40 / 52),36px 的 header token 实际无人达到
- file:line:
  - src/client/index.html:77-78 — --pi-panel-header-height: 36px;--pi-panel-header-control-height: 44px(token 自身矛盾:控件 token 比头部 token 高 8px)
  - src/client/src/components/appShell/AppNavigationPanel.ts:457-458 — header 无纵向 padding、min-height 36px,但按钮高 44px,实际约 44px
  - src/client/src/components/ChatView.ts:134 — .drawer-header min-height 用同一 token、纵向 padding 4px,子控件 :163/:165 均为 32px,实际约 40px
  - src/client/src/components/appShell/AppContextBar.ts:70、:72 — context bar 纵向 padding 4px,panel-toggle 44px,实际约 52px
  - src/client/src/components/designTokens.test.ts:124-131 — 测试文件自述的不变量:the rail and the drawer sit either side of one vertical divider, so their headers share a horizontal rule only while they agree on a height;测试只断言 token 被引用,不断言计算高度相等
- surface: sessions; chat; chat-drawer
- finding: 发布的 36px panel-header 尺度没有任何消费者真正算出 36px:桌面导航栏头部约 44px、chat 抽屉头部约 40px、与其并排的 context bar 约 52px。同一水平线上的顶栏底边各自为政。
- minimal failure scenario: 桌面端选中会话:左侧 rail 头部的底边框(y 约 44)与右侧 context bar 的底边框(y 约 52)隔着 1px 分隔线错开 8px,顶边呈台阶状;展开抽屉后其头部又是第三种高度(约 40px)。三列布局相邻关系由 PiWebApp.ts:131-136 的 grid 证实。
- confidence: high

## F3 「会话正在工作」圆点母题在同一屏上出现 4/6/7/8px 四种尺寸、2/3px 两种间距
- file:line:
  - src/client/src/components/appShell/AppContextBar.ts:80-81 — 顶栏 working 点:gap: 3px,.working-dot { width: 6px; height: 6px; }
  - src/client/src/components/sessionStateBadgeStyles.ts:38-39 — dock 的跳动点:.state-dots { gap: 2px },.state-dot { width: 4px; height: 4px; }
  - src/client/src/components/ChatView.ts:39(chatStyles 内联引入 SessionStateBadgeStyles)、:1308、:1336(dock 渲染 state-dots)、:252(.dot 8px,dock 的单点状态)
  - src/client/src/components/StatusBar.ts:12 — 状态栏活动点 7px
  - src/client/src/components/shared.ts:389 — 会话行 .activity-indicator 7px
- surface: chat; sessions
- finding: 同一语义(会话有工作在跑)在 chat 表面同时存在三种跳动点实现(6px/3px 间距、4px/2px 间距)和两种单点(7px、8px),没有任何 token 统一。
- minimal failure scenario: 发送一条消息:顶部 context bar 弹跳三个 6px 点(间距 3px),底部 activity dock 同时弹跳三个 4px 点(间距 2px),状态栏的活动点是 7px、dock 的静默态点是 8px——一屏之内同一母题四种尺寸。
- confidence: high

## F4 多选模式下 checkbox 与惰性子树折叠钮近乎完全叠印(错位 2px/1px)
- file:line:
  - src/client/src/components/SessionList.ts:399-400 — 同一行内两个绝对定位控件都渲染
  - src/client/src/components/SessionList.ts:450-455 — 多选时子树折叠钮渲染为 .subtree-toggle.inert(仍占位)
  - src/client/src/components/SessionList.ts:723 — .session-checkbox { top: 9px; left: calc(8px + var(--depth)*16px); width: 24px; height: 24px; }
  - src/client/src/components/SessionList.ts:724 — .subtree-toggle, .subtree-toggle.inert { top: 8px; left: calc(6px + var(--depth)*16px); width: 24px; height: 24px; }
  - src/client/src/components/SessionList.ts:740 — coarse 下折叠钮变为 36x44、top 0,checkbox 仍为 24px/top 9
- surface: sessions
- finding: 两个 z-index 相同的 24px 覆盖控件,一个定位 (top 9, left 8+d),另一个 (top 8, left 6+d),水平错 2px、垂直错 1px,21/24px 面积互相重叠;触屏下尺寸还不同(36x44 vs 24x24)。
- minimal failure scenario: 长按一个带 subagent 的父会话行进入多选:半透明灰底 chevron 方块与勾选框以 2px/1px 的偏移双重曝光,读作一个重影控件;手机上错位更明显。
- confidence: high

## F5 列表标题工具条 sibling 控件四种高度(30 / 30 / 约28 / 32 / 34),32px 的 control token 谁都不用
- file:line:
  - src/client/src/components/SessionList.ts:684 — .bulk-select-entry { width: 30px; height: 30px; }
  - src/client/src/components/SessionList.ts:685 — .start-session-button { ... height: 30px; }
  - src/client/src/components/SessionList.ts:690 — .cleanup-entry { padding: var(--pi-space-3) var(--pi-space-4); font-size: var(--pi-text-xs); }(6px+8px padding、12px 字号,总高约 28px)
  - src/client/src/components/shared.ts:280 — 相邻 section 标题共用的 .section-add { min-width: 32px; min-height: 32px; }(裸 32,不用 token)
  - src/client/src/components/SessionList.ts:749、:753 — 同一列表的搜索行 34px
  - src/client/index.html:80 — --pi-control-height: 32px 存在但以上全部未引用
- surface: boot; sessions
- finding: 同一导航面板里同一「标题行按钮」角色:会话区 30px(勾选/新建)与约 28px(Clean up),项目/机器区 32px(Add project / Add machine),搜索行 34px——四种高度无一使用已发布的 32px 控件 token。
- minimal failure scenario: 在项目区看到 32px 的 Add project 标题按钮,切到 sessions 区,New session 是 30px 而旁边的 Clean up 只有约 28px——同一行内两个按钮高度不同,跨 section 再换一号。
- confidence: medium(30/32/34 为源码事实;约 28 依赖按钮 UA line-height 计算)

## F6 同族「空状态 CTA」两套几何与两套强调(44px/强调边 vs 32px/普通边)
- file:line:
  - src/client/src/components/PiWebApp.ts:195 — .empty button { min-height: var(--pi-control-height-touch); ... border: 1px solid var(--pi-accent-border); color: var(--pi-accent); }
  - src/client/src/components/ChatView.ts:359 — .empty-session button { min-height: var(--pi-control-height); ... border: 1px solid var(--pi-border); color: var(--pi-text); };:363 coarse 才抬到 44
- surface: boot; chat
- finding: 同为「主区居中空状态 + 单个 CTA」的模板:boot/未选会话态是至少 44px、accent 边框、accent 文字;空 transcript 态是 32px、普通边框、普通文字。同一家族两套尺寸与两套视觉权重,无 token 协调。
- minimal failure scenario: 桌面端先看未选会话的空态(CTA 44px、蓝描边),再打开一个 transcript 为空的新会话(CTA 32px、灰描边)——同类界面按钮高度差 12px、强调级别不同。
- confidence: medium

## F7 关闭「×」字形的三种处理:context sheet 漏掉了 sibling 已有的 line-height 归一
- file:line:
  - src/client/src/components/appShell/ContextSwitcherSheet.ts:85 — .sheet-close { display: grid; place-items: center; width: 44px; height: 44px; ... border-radius: var(--pi-radius-md); font-size: var(--pi-text-xl); }(20px 裸文本 ×,未设 line-height: 1)
  - src/client/src/components/SessionList.ts:753 — 同为 × 的 .session-search-clear { ... place-items: center; ... font-size: var(--pi-text-lg); line-height: 1; }
  - src/client/src/components/appShell/AppNavigationPanel.ts:16-18 — 代码库自述家规:a text glyph rides font baselines and never sits in the center of its button, so both headers draw this icon instead
  - src/client/src/components/appShell/AppContextBar.ts:72 — panel-toggle 用 SVG + place-items
- surface: context-sheet; sessions
- finding: 同一个关闭字形在三个 sibling 表面有三种做法:context sheet 用 20px 裸文本且没有兄弟实现都有的 line-height: 1 归一(还配 8px 圆角,而同为 44px 无边框图标钮的 panel-toggle 是 12px 圆角);会话搜索的 × 有 line-height:1;面板头部直接改 SVG。
- minimal failure scenario: 手机上打开 context sheet:头部 × 的行盒未归一,字形沿基线略偏离按钮几何中心(正是 AppNavigationPanel.ts:16-18 记录过的失效模式),与列表里居中准确的搜索清除 × 同一应用内对比。
- confidence: medium

## F8 context 行 eyebrow 标签 10px,越出已发布字阶(最小步长 11px)
- file:line:
  - src/client/src/components/appShell/AppContextSwitcher.ts:109 — .chip-label { color: var(--pi-muted); font-size: 10px; ... }
  - src/client/index.html:38 — --pi-text-2xs: 11px(尺度最小步长)
  - src/client/src/components/designTokens.test.ts:30-37 — 字阶作为契约发布到每个 shadow root
- surface: boot; sessions(导航面板 context 行)
- finding: 壳自己的 context chips 使用 10px 标签,这个字号在 :root 发布的类型尺度(11/12/13/14/15/17/20)中不存在;共享样式表被测试禁止越阶,而壳 chrome 本体越阶无人拦截。
- minimal failure scenario: 桌面端看导航面板顶部:MACHINE/PROJECT/WORKSPACE 眉标是全应用唯一的 10px 文字,与紧邻的 11px(2xs)徽标并排时差 1px 却来自两个体系。
- confidence: medium

## F9 行/卡家族的圆角与最小高度漂移:8 vs 12px、52 vs 56 vs 58px,且在 context sheet 内同列混排
- file:line:
  - src/client/src/components/shared.ts:357 — .action-row { ... border-radius: var(--pi-radius-md); }(8px,项目/工作区/会话行的行态)
  - pi-web-plugins/machines/browser/MachineList.ts:253-255 — .machine-row { border-radius: var(--pi-radius-lg); }(12px)+ .machine-row .action-main { min-height: 58px; }
  - src/client/src/components/shared.ts:312 — .list-body.tiles .action-main { border-radius: var(--pi-radius-lg); ... min-height: 56px; }
  - src/client/src/components/appShell/AppNavigationPanel.ts:471 — .tool-row { ... border-radius: 12px; ... min-height: 52px; }(裸值)
  - src/client/src/components/appShell/ContextSwitcherSheet.ts:55-64 — 机器组与 projects/workspaces section 在同一个 .sheet-body 内纵向堆叠
- surface: sessions; context-sheet; boot
- finding: 同一 .action-row 卡片家族出现三种圆角/三种最小高度:机器行 12px/58px、项目与工作区行态 8px、瓦片态 12px/56px、工具卡 12px/52px(裸值)。context sheet 在至少两台机器时把 12px 的机器行与 8px 的项目行直接叠在同一列里。
- minimal failure scenario: 双机器环境打开 context sheet:上半部机器行是 12px 圆角、58px 高的卡片,紧接其下的项目行是 8px 圆角、内容高的卡片——同一列相邻两类「同一张卡」。
- confidence: high(数值与堆叠关系均为源码事实;是否属有意分层未在注释中声明)

## F10 工作区行的名称→次行间距比同族其他行多 3px
- file:line:
  - src/client/src/components/shared.ts:372 — .workspace-secondary { margin-top: 3px; }
  - pi-web-plugins/workspaces/browser/ProjectList.ts:118 — 项目行次行为裸 small(无 margin)
  - pi-web-plugins/machines/browser/MachineList.ts:141 — 机器行同为裸 small
  - src/client/src/components/SessionList.ts:417 — 会话行 meta 亦为裸 small
  - src/client/src/components/shared.ts:429 — listStyles 的 small { display: block; ... } 基线规则无 margin
- surface: sessions; context-sheet
- finding: 四种 sibling 行共用 .action-row 模板与同一条 small 基线,唯独工作区行的次行带 3px margin-top(3px 也不在 2px 基的间距尺度上);项目/机器/会话行的名称与次行间距为 0。
- minimal failure scenario: 在导航面板先看工作区列表再看项目列表:同为「名称+灰色路径行」的卡片,名称与次行之间的呼吸空间差 3px,行内节奏不一致。
- confidence: medium(数值差异确凿;3px 量级较细)

## F11 同一槽位的空态文案两种字号(search-empty 14px vs list-empty/loading 13px)
- file:line:
  - src/client/src/components/SessionList.ts:754 — .search-empty { padding: ...; color: var(--pi-muted); }(继承 :host 的 base 14px)
  - src/client/src/components/SessionList.ts:755 — .list-empty, .list-loading { ...; font-size: var(--pi-text-sm); }(13px)
  - pi-web-plugins/workspaces/browser/ProjectList.ts:260 — 项目列表复刻了同样的分裂(自身 list-empty/loading 13px,search-empty 走 host listStyles 14px)
- surface: sessions; boot
- finding: 同一列表体同一「状态行」角色:搜索无结果的提示 14px,No sessions yet / Loading 13px,两种字号交替占用同一视觉槽位。
- minimal failure scenario: 在会话列表搜索一个不存在的词(14px 的 No sessions match),清空查询后同一位置出现 13px 的 No sessions yet——同槽文字在两次渲染间变字号。
- confidence: medium

TOTAL: 11 findings.
