# UIUX 收敛审计 · 第十四轮 · Lane A（应用外壳与 chrome 几何）

分支 refactor/plugin-architecture，当前 HEAD。主查文件：src/client/src/components/appShell/*.ts、SessionList.ts、StatusBar.ts、ChatView.ts、shared.ts、src/client/index.html（token 块）。聚焦面：boot / sessions / chat / chat-drawer / context-sheet。

机械守卫（spacing/type/controlHeight/radius/dotScale/tokenReferences）在本 HEAD 全部通过（vitest 6 文件 10 用例通过），因此以下发现均为守卫覆盖不到的几何/级联问题。第 13 轮修复项抽查（rail 头部图标按钮等宽、activity dock 状态点取 currentColor、列表行读 --pi-row-min-height）均已确认在位，不重复上报。

TOTAL: 6 findings

## F1 boot/空态主视图画出一个 3px 虚线框，且内容零内边距贴边
- file: src/client/src/components/PiWebApp.ts:139（`.empty { border-style: dashed; color: var(--pi-muted); }`）；:190（`.empty { margin: auto; display: flex; ... }` 无 padding）；:3802（`<div class="empty"><p>…</p><button>…</button></div>`）
- surface: boot（桌面端未选会话/引导空态）
- finding: 该规则只声明 border-style 未声明宽度，计算 border-width 落到 UA 默认 medium（约 3px）、颜色 currentColor(--pi-muted)、无 border-radius。git 溯源：964ada31（Round eleven lanes A and B）把原 `.context-chip.empty { border-style: dashed; … }`（一个自带 1px 边框、圆角、内边距的胶囊）泛化到了整个 `.empty` 容器。容器 shrink-to-fit（margin:auto 抑制 stretch）且无 padding：最宽子元素（按钮）左右边贴死虚线；`<p>` 保留 UA 1em 外边距造成上方约 16px、按钮下方 0px 的不对称留白；方角虚线框套着 radius-md 的按钮。
- minimal failure scenario: 桌面端打开 PI WEB 且无选中会话 →「Select or start a session.」与「Start a session」按钮被一个 3px 灰色虚线矩形紧裹，按钮下边缘直接压在虚线上。
- confidence: high（CSS 默认宽度与级联均已核对，未运行浏览器，但无任何规则给 .empty 补宽度或 padding）

## F2 会话列表「Starting session…」占位行的虚线框是死的：style 落在 0 宽边框上
- file: src/client/src/components/SessionList.ts:732（`.pending-session-row.starting-session .action-main { border-radius: …; border-style: dashed; color: … }`）与 src/client/src/components/shared.ts:373（`.action-main { … border: 0; … }`）
- surface: sessions
- finding: listStyles 的 `.action-main` 用 shorthand `border: 0` 把 border-width 归零；732 行只覆盖 border-style，宽度仍为 0 → 任何样式的 0 宽边框都不渲染。radius 也在圆一个不存在的框。同为临时态的姊妹表面都有框：`.bulk-row.selecting` 有完整 1px 框（SessionList.ts:727），shell 空态有虚线框（F1）。
- minimal failure scenario: 点「New session」→ 列表顶部出现「Starting session…」行，只有灰字加琥珀脉冲点，设计意图中的虚线临时框完全不可见。
- confidence: high（级联：宽 0 + style dashed → 不绘制；DOM 结构 313-317 行已核对）

## F3 共享弹层外壳自造海拔：0 20px 60px 不在命名的 --pi-elevation 阶梯上
- file: src/client/src/components/ModalSurface.ts:177（`box-shadow: var(--modal-surface-shadow, 0 20px 60px var(--pi-shadow-strong))`）对照 src/client/index.html:190-192（--pi-elevation-1/2/3 = 0 1px 2px / 0 2px 10px / 0 12px 40px）
- surface: context-sheet（ModalSurface 的默认值未被覆盖时同样作用于 settings/auth/cleanup/tree 及非全屏 plugin dialog）
- finding: 共享弹壳的 fallback 阴影是第四档海拔（blur 20/spread 60），阶梯上最接近的 --pi-elevation-3 是 blur 12/40。index.html:186-188 的注释写明「Elevation composes full box-shadows … so a layer never invents its own blur and spread again」，该 fallback 正是自造 blur/spread。主题只能换 --pi-shadow-strong 的颜色，改不动这套几何。
- minimal failure scenario: 手机上从 scope chip 打开 context-sheet → 其投影 blur/偏移与全应用任何 token 都对不上；把 --pi-elevation-3 调深也影响不到它。
- confidence: medium（逃逸事实确凿；类别是 elevation，属于本轮列举尺度（radius/control/dot/spacing/type）的邻近项，请 owner 裁量）

## F4 状态栏的水平内边距既不读 gutter 也不读 chrome-inset，是底部 chrome 栈里唯一的 12px 行
- file: src/client/src/components/StatusBar.ts:9（`.bar { … padding: var(--pi-space-4) var(--pi-space-6); … }`）对照 src/client/src/components/PromptEditor.ts:60,177（composer footer 左右 padding 为 --pi-chat-gutter）与 src/client/index.html:80-83（--pi-chat-gutter「transcript、composer、status dock 共享一条边」；--pi-chrome-inset「堆叠 chrome 行的文字起点，一个值」）
- surface: chat（composer 与状态栏这条底部 chrome 叠栈）
- finding: 同一条竖直栈上出现三个左右起点：顶部 context-bar = --pi-chrome-inset（6px），composer footer = --pi-chat-gutter（桌面 16 / 手机 6），状态栏 = --pi-space-6（12px，两种指针都一样）。状态栏右对齐文本的右缘与上方 composer 的内容右缘在手机上错开 6px、桌面错开 4px。
- minimal failure scenario: 393x850 手机 → composer 输入区文字边缘距面板右缘 6px，紧邻其下的「ctx … / cost」文本距右缘 12px，两条相邻 chrome 行的边缘肉眼可见地错位。
- confidence: medium（数值全部核实；无注释表明 12px 是有意选择，也可能被 judged not true）

## F5 紧凑头部焦点环画在行外被裁：scope chip 用了这行装不下的宽 offset，桌面 rail 头部按钮则完全没有 app 焦点环
- file: src/client/src/components/appShell/AppNavigationPanel.ts:461（`.compact-shell { … overflow: hidden; }`）、:466（头部行 min-height 44）、:467-468（Actions/gear 环 offset-tight）、:484-485（`.compact-scope:focus-visible` 用 --pi-focus-ring-offset(2px, 向外)）、:458（桌面 `header button` 无任何 :focus-visible 规则）
- surface: sessions（手机面板头部）/ 壳层 chrome
- finding: 紧凑头部两个 44px 控件恰好填满 44px 行，outline-offset 向外画 → 环的上下带落在行外：顶部被 .compact-shell 的 overflow:hidden 裁掉，底部压过头部 1px border-bottom；scope chip 用 2px 宽 offset（姊妹控件用 tight 1px），被裁得更多。同一文件里桌面 `header button`（Actions、齿轮）没有任何 focus-visible 规则，落回平台默认环——与第八/九轮「ModalSurface/设置面板补 accent 环」的既有裁定同类。
- minimal failure scenario: 键盘 Tab 到手机面板头部的 scope chip → 只看到下半段弧线横穿头部底边；Tab 到桌面 rail 头部齿轮 → 平台蓝环出现在一排 accent 环旁边。
- confidence: medium（offset/裁剪由声明值推得，未在浏览器实测；桌面按钮缺环为规则缺失，事实确定）

## F6 「Actions」动词在两个头部字号不同，且紧凑头部同一行里 13px 与 14px 相邻
- file: src/client/src/components/appShell/AppNavigationPanel.ts:458（桌面 `header button { … font-size: var(--pi-text-xs); }` = 12px）对照 :467（`.compact-header-action { … font: inherit; }` = 14px）与 :484（`.compact-scope { font-size: var(--pi-text-sm); }` = 13px）
- surface: sessions / 壳层 chrome
- finding: 同一个「Actions」标签在桌面 rail 头部是 12px、在紧凑头部是 14px（跨过 760px 断点会跳一档）；紧凑头部一行之内，scope chip 文字 13px、Actions 药丸 14px，相邻姊妹控件在 type scale 上差一步。
- minimal failure scenario: 桌面窗口从 761px 缩到 760px → 头部从桌面版切到紧凑版，「Actions」文字从 12px 跳到 14px；紧凑版内 scope 与 Actions 并排时字号不同。
- confidence: medium-high（数值确定）；也可能被判为触屏可读性的有意选择（judged-not-true 风险明示）
