# ROUND 13 — Lane C：全 13 面抛光巡检（实测优先）

审计对象：boot / sessions / chat / chat-drawer / msg-row-menu / model-picker / thinking-picker / settings / settings-appearance / quick-switcher / qs-row-menu / context-sheet / add-project-dialog。
方法：实读 HEAD（494d6c31，分支 refactor/plugin-architecture）源码并逐条给出 file:line；同时在 http://127.0.0.1:8505 用 @playwright/test(chromium) 实测——393x850 粗指针手机与 1280x900 / 500x800 细指针桌面，全部数字为 getBoundingClientRect / getComputedStyle 实测值，对比度按 WCAG 公式实算。
基线：round 12 及更早修复、以及本轮 lanes A/B 的修复提交 62c33455（活动 dock 点全强度、行高 token 落到普通行、扩展卡片 box-sizing、清理对话框日字段、rail 齿轮 44、手机 gutter token 化）均已实测确认在 HEAD 生效，不再重复立案。

---

## F1 listStyles 的 small 规则在同一条声明里写了两遍 white-space，本轮修复是空操作，对话框提示句仍被截成一行
- file:line: src/client/src/components/shared.ts:449 —— `small { display: block; white-space: normal; color: var(--pi-muted); font-size: var(--pi-text-2xs); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }`（同一声明块内 `white-space` 出现两次，末尾的 `nowrap` 胜出，行首的 `normal` 是死声明）；受害面：pi-web-plugins/machines/browser/MachineDialog.ts:105、:113、:118（三个 `small.hint` / `small.field-error`）；对照面：pi-web-plugins/workspaces/browser/ProjectDialog.ts:347-348（本地 opt-out 仍然必须存在才换行）
- surface: context-sheet / add-project-dialog 同族的 add-machine 对话框（MachineDialog）；波及所有采用 listStyles 的列表行第二行
- finding: 62c33455 的提交说明写明修复意图是“对话框提示句继承了 list chrome 的 nowrap 加 ellipsis，丢了陈述后果的那句话”，修法是在规则开头补 `white-space: normal`——但同一规则末尾原有的 `white-space: nowrap` 没有删，CSS 同属性取最后一条，计算值仍是 nowrap。实测（1280x900 打开 Add machine 对话框）：`small.hint` computed white-space=`nowrap`、text-overflow=`ellipsis`、行高 13px 单行；导航栏 machine/project 行的 `small` 同样 computed `nowrap`。
- minimal failure scenario: 在较窄桌面窗口（约 500-760px，指针为鼠标，壳未进 compact 以下）打开 Add machine，输入一个非法 URL：`small.field-error` 的校验句按 nowrap+ellipsis 截断，操作者看到的是半句错误说明；token 字段的提示 “Paste only the token value; PI WEB sends it as an Authorization: Bearer header.” 在同宽度下丢掉句尾，而句子尾巴正是后果本身（“会作为 Bearer 头发送”）。ProjectDialog 因为自带 opt-out 换行，两个同族对话框一边换行一边截断。
- confidence: 高（声明逐字核对 + computed style 实测双重证据；这是本轮修复提交自身引入的“修而未修”）

## F2 Add machine 对话框三个输入框实算 12px UI 字体，不是其声明的 16px mono——被宿主 listStyles 追加覆盖；与同族 add-project 对话框同位字段一 37px/12px 一 41px/16px
- file:line: pi-web-plugins/machines/browser/MachineDialog.ts:138（`input { ... font: var(--pi-control-font-size, 16px) var(--pi-control-monospace-font-family, ...) }`，裸 `input` 选择器，特异性 0,0,1）；覆盖源：src/client/src/components/shared.ts:223 与 :250（listStyles 内两条裸 `input` 的 `font: var(--pi-text-xs) var(--pi-font-ui)`）；追加顺序：pi-web-plugins/machines/browser/hostUi.ts:30-33（`root.adoptedStyleSheets = [...root.adoptedStyleSheets, ...sheets]`，宿主表排在组件自身表之后，同特异性后者胜）；幸存对照：pi-web-plugins/workspaces/browser/ProjectDialog.ts:334（`input[type="text"], input:not([type])` 特异性 0,1,1，压回 16px mono）
- surface: add-machine 对话框（machines 插件，settings 之外唯一的加机入口）
- finding: 同一个“单行对话框字段”家族里，Add project 的路径字段实测 41px 高、16px ui-monospace；Add machine 的 URL/名称/token 三个字段实测 37px 高、12px ui-sans-serif（`--pi-control-font-size` 在该元素上解析为 16px，但字体简写整体被覆盖）。12px < 16px 正是 round 12 为 rename 字段修掉的 iOS 聚焦缩放条件；“add-machine 控件用应用字体”的 round 12 修复只落在了按钮上，同一对话框的字段被同一条宿主规则漏掉。
- minimal failure scenario: iPhone 上聚焦 Add machine 的任一字段：Safari 因字段计算字号 12px 而放大整个视口，键盘收起后页面停在放大态；同一部手机上打开 Add project 则不缩放（16px）。桌面并排看，两个“加东西”对话框的同位字段一高一矮、一衬线一非衬线，读作两套表单系统。
- confidence: 高（computed font-size/font-family 实测：12px + ui-sans-serif；`--pi-control-font-size` 在同元素解析为 16px，证明是规则被覆盖而非 token 缺失）

## F3 工具卡片头部状态记号仍是打字字符（○ ● ✓ ✖），同一张 transcript 里相邻记号全是 14px SVG
- file:line: src/client/src/components/ToolExecutionView.ts:234-240（`STATUS_ICON: pending "○" / running "●" / success "✓" / error "✖" / interrupted "○"`）、:44（`<span class="status-icon">${STATUS_ICON[...]}</span>` 渲染）、:153（`.status-icon { color: var(--pi-muted) }`，无字号声明，随字体走）；同屏对照：src/client/src/components/ChatView.ts:1856（复制按钮 SVG）、:1949（tool result 摘要 `renderCrossIcon()/renderCheckIcon()`）、:1957（toolCall 行 `renderRunIcon()`）；round 12 的收口声明：src/client/src/components/uiIcons.ts:1-8（“这些曾是打字字符 ⧉ ↻ ↩ ✓ ✖ ▶ ↑ ↓……从一个地方画出来让尺寸成为决定”）
- surface: chat（transcript 内的 tool-execution 卡片）
- finding: round 12 把 transcript 与状态栏记号收进 uiIcons 的 14px SVG，但工具执行卡片——transcript 里最密集的状态表面——仍用字体字符画五种状态。实测（393x850 展开一个 events 组）：`.status-icon` 的 textContent 为 "✓"，computed 14px ui-sans-serif，与三像素外同栏的 14px SVG 勾并排，两套墨量。`●`/`○`/`✖` 在缺字形的备选字体上还会换形。
- minimal failure scenario: 一条带工具调用的回复里：toolCall 行画 SVG 播放三角，紧随其后的工具卡片头部画字体 "●"，卡片收起后在 events 摘要里又是 SVG 勾/叉——同一列扫描下来三种记号语言；在 Linux/旧 Android 的回退字体上 "✖" 的墨量再变一次。
- confidence: 高（源码 + 实测渲染双重证据）

## F4 气泡投递记号仍是打字字符（◌ ! ✓ ✓✓），双勾靠 letter-spacing: -1px 硬压
- file:line: src/client/src/components/ChatView.ts:495-509（chatDeliveryPresentation：`glyph: "◌"/"!"/"✓"/"✓✓"`）、:351（`.delivery-mark .delivery-glyph { font-size: var(--pi-text-xs); letter-spacing: -1px; ... }`）；同文件已迁 SVG 的记号：ChatView.ts:2（import renderCheck/Copy/Cross/Recall/Resend/Run）
- surface: chat（msg-row-menu 同栏的气泡右下投递状态）
- finding: uiIcons 收口时漏网的最后一处状态记号：Sending/Sent/Queued/Read/Not sent 的角标仍走字体字符，其中双勾需要 -1px 字距补丁才不散架——补丁本身就是“字符画记号”模式已死的证据（uiIcons.ts:1-8 的成立理由逐字适用）。负字距是全仓唯一一处（grep `letter-spacing: -` 仅此一条）。
- minimal failure scenario: 发一条消息：角标先出现虚线圆加 Sending（◌ 随平台字体渲染），落 Read 时两勾挤在一起；在没有该字形首选字体的平台上 -1px 不够用，双勾间距回弹，同一状态两种画法。
- confidence: 中高（事实确定；是否被有意保留为文字型记号无记录可查。注：与 lane A F5 指认的是同一处，HEAD 上仍未修，此处为独立核实）

## F5 同一个对象的行溢出菜单画了两套：shared 面板 4px 内衬/12px 菜单项 vs quick switcher 面板 6px 内衬/14px 菜单项
- file:line: src/client/src/components/shared.ts:443（`.action-menu-panel { ... padding: var(--pi-space-2); ... }` = 4px）与 shared.ts:223（裸 `button` 的 `font: var(--pi-text-xs)`，`.action-menu-panel button`(:442) 未再声明字号 → 菜单项 12px）；src/client/src/components/QuickSwitcher.ts:479（`.row-menu { ... padding: var(--pi-space-3); min-width: 160px; ... }` = 6px）与 :480（`.row-menu button { ... font: inherit; ... }` → 14px）
- surface: qs-row-menu 对 sessions 的 msg-row-menu/session-row-menu（两个菜单服务同一对象：一个会话行）
- finding: round 10 宣告“row overflow menus share ground and corner”——实测底色（surface）与圆角（8px）确实一致，触屏项高也一致（44px），但同一部手机上：会话列表的行菜单项文字 12px、面板内衬 4px、min-width 120；quick switcher 的行菜单项文字 14px、面板内衬 6px、min-width 160。同一动词、同一对象、同屏两套度量。
- minimal failure scenario: 在 quick switcher 里长按会话行打开菜单（14px 项），关掉后到会话列表点同一行的 ⋯（12px 项）：菜单整体矮一截、文字小一号、边距收紧，读作两个不同等级的控件，而它们是同一个“会话操作”。
- confidence: 高（两面板同屏实测：12px/4px vs 14px/6px；round 10 的收口只对齐了底色与圆角）

## F6 composer 触发符提示实算约 2.6:1（12px），折叠草稿预览落在 --pi-dim 上也低于 AA 文本下限
- file:line: src/client/src/components/PromptEditor.ts:132（`.composer-placeholder-hints { color: color-mix(in srgb, var(--pi-dim) 70%, transparent); font-size: var(--pi-text-xs); }`）、:69（`.expand-composer-draft { color: var(--pi-dim); font-size: var(--pi-text-xs); }`）；先例：round 6 以 4.12:1 为由把“informational text”迁离 --pi-dim
- surface: chat（composer 空态与折叠态）
- finding: “/ @ #” 触发符提示按 dim 70% 透明度混入底色：暗色主题实算 ≈2.60:1（dim #6e7681 与 bg #0d1117 按 70/30 混合后 L≈0.096 对 0.006）；亮色主题实测 color(srgb .463 .451 .412 / .7)，混合后对 composer 底 ≈2.60:1。12px 文本 AA 要求 4.5:1，连非文本 3:1 都不到。折叠态草稿预览用未稀释的 --pi-dim：暗色 4.06:1、亮色 4.40:1，均低于 4.5:1。代码注释自述“quiet enough to read as a hint”——安静是分组意图，不是对比度豁免；round 6 的 4.12:1 判例比这还高 1.5 个点。
- minimal failure scenario: 手机上空 composer：“/ @ #” 在阳光/低亮度屏上接近消失，而这三个字符是唯一的触发符教学；键盘上有草稿时折叠条的预览句同样贴着下限。
- confidence: 中（数值实算+实测；是否有意保留为“装饰性提示”无记录，标注为疑似 round 6 迁移的漏网）

## F7 StatusBar 的活动/圆点规则是死规则：模板从未渲染 .activity 或 .dot
- file:line: src/client/src/components/StatusBar.ts:11-14（`.activity`、`.activity.active`、`.dot`（含 opacity: .45）、`.activity.active .dot`）、:16（`@keyframes pulse` 仅被该死规则引用）；模板：StatusBar.ts:35-40（四个裸 `<span>`，无任何 activity/dot 类；实测其 shadow root 内 .dot/.activity 元素数为 0）
- surface: chat（底部状态栏）
- finding: 状态栏的整套“活动点”样式（含 round 13 lane A 刚在 activity dock 修掉的那类 opacity: .45 半强度状态点）样式着不存在的元素；pulse 关键帧只被死规则引用。与 round 12 “dead shell chrome rules removed” 同类，但发生在 round 12 刚碰过的文件里。
- minimal failure scenario: 无用户可见故障——这正是问题：下一次有人想调状态栏的活动点时会先改这组规则，改完发现屏幕没有任何变化（或者在另一个组件里复制这套“看起来是它”的样式）。
- confidence: 高（模板与 shadow root 双重核对；`.muted`(:15) 与 `:25` 的空态在用，不属死规则）

## F8 --pi-chat-gutter 基线值在手写 16px，而三行之下手机覆盖刚被本轮改成读 token
- file:line: src/client/index.html:80（`--pi-chat-gutter: 16px;`）对照 :36（`--pi-space-7: 16px`）与 :199（`@media (max-width: 640px) { :root { --pi-chat-gutter: var(--pi-space-3); ... } }`，62c33455 刚修）；spacingScale/token 守卫 ROOTS 仅扫 src/client/src 与 pi-web-plugins（typeScale.test.ts:18 等五处同值），index.html 的 token 块在守卫窗外
- surface: 外壳 chrome 几何（chat / chat-drawer / context bar 共用的列沟槽）
- finding: 桌面沟槽与手机沟槽现在一个读 token、一个手写数字：把 --pi-space-7 调一步，手机内缩跟随、桌面沟槽不动，同一 token 两种值且无测试拦截。当前数值恰好相等，属机械逃逸而非可见缺陷。
- minimal failure scenario: 主题或未来调整把 --pi-space-7 改为 18px：手机沟槽变 6px 不变、桌面沟槽变 18px，composer 与 transcript 的读边跨断点错位，五处 scale 守卫全绿。
- confidence: 高（声明核对；与 lane A F6 的第二条引证相同，HEAD 上仍未修，此处为独立核实并补上守卫窗外这一结构性原因）

---

## 已核对、未立案（clean notes）
- **machine-switcher 是永久隐藏的表面**：pi-web-plugins/machines/browser/pi-web-plugin.ts:47 硬编码 `<machine-switcher hidden ...>`，`:host([hidden]) { display: none }`（MachineSwitcher.ts:74-76）使其永不渲染（实测 hostDisplay=none、rect 0x0）。因此其中的打字箭头 `▾`（MachineSwitcher.ts:85，font-size 2xs）不构成可见的“双记号语言”缺陷——立案为死表面/死 chrome 备注，而非视觉缺陷。它的兄弟 MachineList 行菜单正常。
- **tile 角落几何同心**（round 8/9 修复确认）：393x850 实测 project tile 的 `action-menu-toggle` 中心 cy=227 与 `action-activity` 点中心 cy=227 完全同线（派生式 `top: inset + size/2 - dot/2` 生效）。
- **context sheet 行高**（lane A F2 修复确认）：手机 sheet 内 machine 行 64px（三行内容：名/状态/地址），project、workspace 行 56px（token 下限托住两行内容）——残差 8px 来自内容行数而非 token 漂移，token 契约（“不能漂到 52/56/58/60”）成立。
- **model-picker / thinking-picker（手机实测）**：close 44、scope 切换钮 44、搜索 44@16px、选项行 ≥44、`.scope-toggle` 嵌套圆角算术（容器 md 8 − padding space-2 4 = xs 4）自洽。
- **quick switcher（手机实测）**：搜索 44@17px、close/tabs/chips 44、rename 输入 44@17px、确认钮 44；`.row-tag`（main 徽章）与 drawer-tab-badge、section-unread-count 三处徽章同配方（min-width 14 / line-height 16 / 2xs）。
- **settings / settings-appearance（桌面实测）**：settings-nav 项 52px 一致；Appearance 主题卡网格同高、预览 74px 居中、同心圆角算术（lg12−space5 10=2、md8−space4 8→xs4）如注释所述；follow-system 复选框 24px token。
- **add-project-dialog（手机实测）**：路径字段 44@16px mono、建议行 44、trust 提示换行（本地 opt-out 生效，见 F1 的对照面）、footer 主钮 accent 填充。
- **SessionList 粗指针地板**：行菜单项、bulk 行、search 全部 44；`.session-search-input` 宽屏 16px 防 iOS 缩放的注释与实现一致。
- **composer 工具行（手机实测）**：attach/select-model/select-thinking/history/send/stop 全 44，单行一个高度。
- **StatusBar 本体**：up/down 图标为 14px SVG（uiIcons），与 round 12 收口一致；死规则见 F7。

## 与 lanes A/B 的重叠说明
- F4 = lane A F5（同一处，独立复核后仍开放）；F8 包含 lane A F6 的第二条引证（index.html:80，该条当时未被 62c33455 修复）。其余六条为本 lanes 独立发现；其中 F1 是对 62c33455 所含 lane B B2 修复本身的证伪。
