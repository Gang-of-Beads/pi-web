# ROUND TWELVE — Lane A：app shell 与 chrome 几何（scale 工作之后）

分支 `refactor/plugin-architecture`，HEAD `b3ae9c83`。方法：通读主文件（appShell/*.ts、SessionList.ts、StatusBar.ts、ChatView.ts、shared.ts、index.html token 块），并在 8505 实机上以 393x850 粗指针与 1280 鼠标两种环境做了 Playwright 探测（pageerrors: 0）。所有行号均已核对源码。

TOTAL: 7 findings

---

## F1 bulk-selection 勾选图标没有自己的尺寸规则，撑满整个控件（鼠标 32px、粗指针 44px）

- file:line: src/client/src/components/SessionList.ts:39（`renderSelectionMark` 的 `<svg class="selection-mark">` 无 width/height，全仓库无任何 `.selection-mark` 样式规则，grep 仅此一处）；SessionList.ts:691（`.bulk-select-entry` 32px，未约束内部 svg）；SessionList.ts:787（粗指针放大到 44px）；对照房子图标尺寸：src/client/src/components/appShell/AppNavigationPanel.ts:460（`.header-icon-action svg { width: 16px; height: 16px }`）、src/client/src/components/disclosureIcon.ts:17（16px）
- surface: sessions（当前与 Archived 两处标题工具栏）
- finding: 圆十一之前的“drawn not typed”把批量选择从文字勾改成了这只 SVG（commit 843e103e），但只画了形、没有给尺寸；svg 在 `inline-grid; place-items: center` 的按钮里按替换元素默认尺寸铺满 content box。图标=控件本身：鼠标 32×32，粗指针 44×44，是同一面板里 16px 齿轮的 2–2.75 倍，且 viewBox 24 下 stroke-width 2 的视觉描边从 1.33px 放大到 2.7–3.7px，比旁边的所有 chrome 图标都重一档，并且随指针类型变尺寸。
- minimal failure scenario: 实机实测（8505，coarse 393x850 与 mouse 1280）：`{"svg":[44,44],"btn":[44,44]}` / `{"svg":[32,32],"btn":[32,32]}`。Sessions 标题行里 44px 的勾选块紧挨 16px 的面板图标与文字按钮，读作一个实心大方块而不是一行工具栏里的一个动作。
- confidence: high（实机测量）

## F2 context sheet 的 sticky 标题带用 --pi-surface，贴在 --pi-bg 的弹层卡上，差一个表面阶梯

- file:line: src/client/src/components/appShell/ContextSwitcherSheet.ts:85（`.sheet-header { position: sticky; ... background: var(--pi-surface); margin-inline: calc(-1 * var(--pi-space-4)); ... }` 全宽负 margin）；弹层卡默认底色：src/client/src/components/ModalSurface.ts:177（`section[role="dialog"] { ... background: var(--pi-bg); }`，该 sheet 未覆盖任何 `--modal-surface-*`）
- surface: context-sheet
- finding: sticky 标题带比它吸附的卡片亮一个表面阶梯（实机 light 主题实测：header `rgb(255,255,255)` vs 卡片 `rgb(250,249,245)`；dark 默认 token 亦为 `#161b22` vs `#0d1117`）。带子经负 margin 全宽出血，静止时就画在卡顶 8px 内衬之下，列表滚动时内容从这条异色带下滑过。同族先例：ChatView 的 drawer sticky header 特意把背景调成与容器同色（ChatView.ts:130-133 `background: color-mix(in srgb, var(--pi-purple) 7%, var(--pi-bg))` 与 `.top-drawer` 底色一致），context-sheet 是唯一不一致的一个。
- minimal failure scenario: 打开 context sheet（compact-scope），标题行是一条横贯全宽、比卡片亮一档、且不带任何分隔线的色带，读作渲染残影而非页眉；实测 8505 sheet 可滚动，滚动后带子下方内容被异色带切断。
- confidence: high（实机取色）

## F3 shell 样式里的成片死规则：.context-chip 家族、delivery-mark 基色、StatusBar 状态点块

- file:line: src/client/src/components/PiWebApp.ts:138-148（`.context-item` / `.context-actions`(+::after, 26px 字面量) / `.context-chip` 全家族 / `.context-kind` / `.context-value` / `.tab-badge`——appStyles 只作用于 PiWebApp 自身 shadow root，其模板中无任何元素带这些 class）；src/client/src/components/ChatView.ts:349（`.delivery-mark { ... color: var(--pi-dim); }` 基色永远被 351-355 行的四个 tone 类 `.pending/.received/.delivered/.failed` 覆盖，`chatDeliveryPresentation` 只会返回这四种 tone）；src/client/src/components/StatusBar.ts:10-15（`.activity`、`.activity.active`、`.dot`、`.activity.active .dot`、`@keyframes pulse`——render() 只输出 `.bar` 与四个 span（StatusBar.ts:33-37），不渲染任何 activity/dot 元素）
- surface: app shell / chat / chat（状态栏）
- finding: 11 条 appStyles 规则、1 条基色声明、整块状态点样式在渲染树中零匹配（实机验证：全 shadow 树查询 `.context-chip,.context-item,.context-actions,.tab-badge` 两种环境均返回空数组）。这是圆十一“context bar dead declaration removed”同一缺陷的剩余兄弟：死规则继续声明几何（26px 宽度、32px 控件语汇、--pi-dot-sm 圆点），却对任何真实控件不负责，掩盖真实产量。
- minimal failure scenario: 后续 lane 或守卫读到 StatusBar 的 `.dot { width: var(--pi-dot-sm) ... opacity: .45 }` 会以为状态栏有状态点并按它调标——实际状态栏从未画点；同理圆十一在 AppContextBar 删掉的死声明，其在 PiWebApp 的同族仍在。
- confidence: high（模板 grep + 实机零匹配双重验证）

## F4 消息头动作钮仍是打字字符（⧉ ↻ ↩ ✓），而同一行右侧的 info 标记是画出来的 mask——同一行两套图形语言

- file:line: src/client/src/components/ChatView.ts:1833（`<span aria-hidden="true">↩</span>` recall）、:1847（`↻` resend）、:1852（`${copied ? "✓" : "⧉"}` copy）；同行已画出来的兄弟：ChatView.ts:418（`.msg-meta::before` 用 `--pi-info-mask` 画的 14px info 标记，圆十一“info mark are drawn, not typed”）；房子自己的理由：src/client/src/components/appShell/AppNavigationPanel.ts:16-18（“a text glyph rides font baselines and never sits in the center of its button”）
- surface: chat（msg 头部动作排；msg-row-menu 打开后的同族面板）
- finding: 24px `inline-grid; place-items: center` 盒（ChatView.ts:387）里放的是裸字符：复制/重发/召回/已复制四个状态全靠系统字体的字形度量居中与落 Baseline，`⧉`（U+29C9）在很多 UI 字体栈里还要回退到别的字体，墨迹大小与垂直心随平台漂移；而紧挨它的 info 控件（hover:none 分支）已经是 14px mask 图形。一个头部行里，两个相邻 24px 控件一个是画的一个是打的。
- minimal failure scenario: 实机验证当前渲染出的即是 `↻`/`⧉` 字符串；在 Windows/Segoe 或 Android/Roboto 上 ⧉ 若回退，其字形偏大偏下，与左侧 14px info mask 并排时明显错位——这正是圆十/十一在 dictation、prompt history、bulk selection、jump-to-bottom、info mark 上逐一修掉的同一缺陷，唯一漏下的就是这排按钮。
- confidence: medium-high（实机确认仍是字符；居中漂移依字体栈推断）

## F5 StatusBar 用打字的 ↑/↓ 表达输入/输出方向，且坐在 mono 字体的基线上

- file:line: src/client/src/components/StatusBar.ts:34-35（`<span>↑ ${...} tok</span>` / `<span>↓ ${...} tok</span>`）；:9（`:host { ... font: var(--pi-text-xs) var(--pi-font-mono); }`）
- surface: chat（底部状态栏）
- finding: 方向记号是裸文本箭头。房子已把同类的方向动词全部画掉：disclosure 箭头（disclosureIcon.ts:14-18）、jump-to-bottom 下箭头（ChatView `renderJumpToBottom` 的 SVG）、面板边缘 chevron（AppPanelEdgeControl.ts:151-153）、返回动词（圆十一）。状态栏的 ↑/↓ 与这些是同一语义类（方向记号），却是仅剩的打字版本，且 12px mono 字体的箭头墨迹高度/基线随平台 mono 栈（SF Mono/Menlo/Consolas）变化。
- minimal failure scenario: 同一屏内，composer 工具栏与 header 的方向图标是 16px 描边 SVG，底部状态栏的方向是 12px mono 字符——三处方向记号两种画法；换平台后箭头的字重与位置再次漂移。
- confidence: medium（图形语言判断；字符存在性已实机确认：状态栏文本 “↑ 136k tok ↓ 7.6k tok ctx 6.7% of 524k $0”）

## F6 transcript 部件行仍用打字状态符：tool 行的 “▶”、tool result 摘要的 “✖/✓”

- file:line: src/client/src/components/ChatView.ts:1941（`<div class="part tool-line">▶ ${part.toolName}...`）、:1945（`<summary>${part.isError ? "✖" : "✓"} ${part.toolName} result</summary>`）
- surface: chat（transcript 内的 tool 行与 tool result 折叠摘要）
- finding: “▶” 是圆九“shared disclosure chevron replaces text arrows”同族的文本箭头（且画在一个不可点的 div 上，读作可展开却不是）；“✖/✓” 是错误/成功状态记号，正是圆十、十一逐一把“bare text carrying UI state”换成画出来的 mark 的那类。transcript 是最长被扫读的表面，这两处是仅剩的字符状态符。
- minimal failure scenario: 一条含工具调用的消息里，`▶ toolName` 的三角字符与旁边 `.drawer-disclosure-icon`/`.disclosure-icon` 的 16px 描边 chevron 并存；`✖` 在部分字体里缺字形回退为粗体叉，与 `--pi-danger` 的红点状态语言（sessionStateBadgeStyles）不一致。
- confidence: medium（字符存在性已核实；是否属“房子图案”依圆九至十一的修法判断）

## F7 粗指针下工具栏相邻 44px 控件的间隙只有 4–6px，低于本应用自己为同一问题定下的 20px

- file:line: src/client/src/components/SessionList.ts:683（`h2 { min-height: var(--pi-control-height); gap: var(--pi-space-2); }`——粗指针下全部按钮升到 44px，间隙仍是 4px）、:708（`.bulk-row { ... gap: var(--pi-space-3); }` 6px，:791 粗指针下按钮 44px）；本应用自己的相邻命中区修法：src/client/src/components/ChatView.ts:400-402（粗指针把 `.msg-header-trailing`/`.msg-actions` 的 gap 提到 `--pi-space-8`（20px）并外扩命中区，注记“a symmetric 10px expansion over a 6px gap made each button's right edge belong to its neighbour”）
- surface: sessions（标题工具栏与批量选择工具行）
- finding: 同一粗指针表面里，消息行动作把相邻控件间隙修到 20px，而 sessions 标题的 “Clean up”↔“New session”（均 44px 高）只隔 4px，批量工具行的 44px 按钮只隔 6px，且这些按钮没有任何命中区外扩。间隙不足时拇指的落点误差直接落到相邻控件上——这正是 msg-action 修过的那个几何问题。
- minimal failure scenario: 实机 393x850 coarse 实测（选中模式开启后）：`{"between":"cleanup-entry->start-session-button","gap":4}`。手机上 “Clean up” 右缘 4px 之外就是 accent 填充的 “New session”，滑一点即误开新会话；Bulk 工具行 “Archive”↔“Mark read” 同理 6px。
- confidence: medium（间隙已实测；“20px 是房子标准”取自 ChatView 粗指针分支的自述）

---

## 核对为干净的区（本 lane 查过、无新发现）

- index.html token 块（:38-127）与 640px 覆盖（:131-134）：spacing/type/radius/control/dot/layer 各域自洽，无未定义引用、无字面量逃逸。
- resident bar / 面板头 / compact 头三行 chrome：AppContextBar.ts:62-70、AppNavigationPanel.ts:457-465 与 :517-522，控件全部落在 --pi-panel-header-control-height / --pi-control-height-touch，45px 行高一致（实机 compact 头四控件均 44px）。
- AppContextSwitcher 芯片行、AppRefreshControl 与齿轮/Actions 的同排兄弟高度、AppPanelEdgeControl 18px sliver（有其自述豁免）、boot 空态（`.empty button` 44px、section-add 44px）、chat-drawer 粗指针下 tab 与 collapse 同为 44px——均无新问题。
- 填充控件的 AA 对比：start-session-button（--pi-on-accent）、section-add、chip 系（muted on surface 5.6:1、on selection-bg 4.83:1）均过线；未发现新的不过线填充控件。
