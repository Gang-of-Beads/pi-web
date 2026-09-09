# UI/UX 收敛审计 · 第二轮 · Lane C（全 13 面 polish 通道）

审计对象：pi-web，分支 refactor/plugin-architecture，HEAD f2e4e0ea。
方法：读源码 + 在 http://127.0.0.1:8505 上用 @playwright/test 的 chromium 实测。
自建 scratch 项目 `/tmp/fe-r2-lane-c`（API 建的 project id fbc73fff-…），全部探针脚本在 `/tmp/fe-r2-lane-c/probe/`，未触碰用户既有数据（主题只写 localStorage，探针每次全新 profile）。
视口：coarse pointer 320x560 / 393x850（isMobile+hasTouch，实测 `matchMedia(pointer: coarse)` = true）与 fine pointer 1440x900。

第一轮已修项与三条已知故意保留项均未复报。

TOTAL: 16 findings（严重 5 / 中 7 / 轻 4）

---

## F1 PI WEB Dark 主题下每一个 accent 实心主按钮的文字对比度只有 3.74:1，低于 AA
- src/client/src/components/SessionList.ts:697（另有 8 个同模式产出者：AskUserCard.ts:627、ExtensionDialogCard.ts:478、SessionRenameDialog.ts:38、SessionTreeNavigator.ts:606、pi-web-plugins/workspaces/browser/ProjectDialog.ts:375、pi-web-plugins/machines/browser/MachineDialog.ts:147、pi-web-plugins/relays/relaysPanelElement.ts:525、pi-web-plugins/workspace-tasks/tasksPanelElement.ts:298）
- surface: sessions / add-project-dialog / chat（ask 卡与扩展对话卡）
- finding: 实心主按钮统一写 `background: var(--pi-accent); color: var(--pi-bg)`。在 PI WEB Dark 下实测 computed 值为 `color: rgb(7,9,18)` / `background: rgb(124,60,255)`，即 #070912 on #7c3cff，对比度 3.74:1；字号 12px、字重 600，不属于 WCAG 大字号（需 >=18.66px bold），因此适用 4.5:1 门槛，未过。八个主题的同一对实测：Dark 3.74（FAIL）、Light 6.32、Classic 7.49、High Contrast 10.57、Night 8.57、Paper 5.62、Clay 5.90、Clay Paper 4.69。只有默认深色这一支不合格，而它正是最常用的一支。
- 实测命令与输出：`node /tmp/fe-r2-lane-c/probe/s29.mjs` →
  `{"color":"rgb(7, 9, 18)","bg":"rgb(124, 60, 255)","fontSize":"12px","weight":"600","accent":"#7c3cff","pibg":"#070912"}`
  对比度计算见 `/tmp/fe-r2-lane-c/probe`（WCAG 相对亮度公式）。
- 最小复现：设置 → 外观 → 选 PI WEB Dark → 回到 sessions，读 `+ New session` 的标签。
- 最小修法：给填充主按钮一个专用前景 token（例如 `--pi-on-accent`），Dark 主题下取近白（#f7f4ff 对 #7c3cff 为 4.9:1，过线）；或把 Dark 的 `--pi-accent` 压暗一档。不要继续用 `--pi-bg` 当前景色——它是为背景挑的，不承诺任何前景对比度。
- confidence: 高（实测 computed 值 + 公式计算）

## F2 三个选择器的行文字整体回落到浏览器默认按钮字体 Arial 13.333px
- src/client/src/components/ModelPicker.ts:293、src/client/src/components/CommandPicker.ts:110、src/client/src/components/QuickSwitcher.ts:412
- surface: model-picker / thinking-picker / quick-switcher
- finding: 这三处的行按钮规则只写了 display/width/padding/border-bottom/text-align，没有写 `font`。`:host` 上的 `font: 14px system-ui` 与 `font: var(--pi-text-base) var(--pi-font-ui)` 不会被 button 继承（UA 样式表对 button 设了 `font: 400 13.3333px Arial`）。实测：model-picker 选项 `font-family: Arial, font-size: 13.3333px`，其内部 `small` 为 11.1111px；quick-switcher 同一面板内 `h3` 是 `ui-sans-serif`，而 `.row-title` 是 `Arial` —— 同一张卡片上标题字族和分组标题字族不一致，肉眼可辨（Arial 的 a/g 与 ui-sans-serif 明显不同）。注意同文件里 `.machine-tab` 与 `.chip`（QuickSwitcher.ts:439/446）都写了 `font: inherit`，说明这是漏写而非取舍。
- 实测命令与输出：`node /tmp/fe-r2-lane-c/probe/s12.mjs` →
  `first: {font: "13.3333px", fam: "Arial"}`、`hostFont: "system-ui, sans-serif"`；
  `node /tmp/fe-r2-lane-c/probe/s20.mjs` → `h3 ... fam=ui-sans-serif` 与 `span.row-title ... fam=Arial` 同屏。
- 最小复现：打开模型选择器或快速切换器，与其上方的标题/输入框并排看字形。
- 最小修法：三处各加 `font: inherit;`（与同文件 `.chip` 一致）。
- confidence: 高

## F3 thinking-picker 最后一项 max 的行高比兄弟行矮 16px（桌面）/ 8px（手机）
- src/client/src/components/CommandPicker.ts:110 与 121，数据源 src/client/src/components/PiWebApp.ts:3990-3999（`thinkingDescription` 对 "max" 返回 undefined）
- surface: thinking-picker
- finding: 行高由是否有 `small` 描述决定。实测 1440x900 下六行高度依次 52 / 53 / 52 / 52 / 52 / **36**；393x850 下 52 / 53 / 52 / 52 / 52 / **44**（44 是 coarse 的 min-height 兜底）。也就是列表底部突然塌掉一格，最后一个可选项看起来像被截断或属于另一组。
- 实测命令与输出：`node /tmp/fe-r2-lane-c/probe/s15.mjs` →
  `[{"t":"minimal","h":52},{"t":"low ✓ current","h":53},{"t":"medium","h":52},{"t":"high","h":52},{"t":"xhigh","h":52},{"t":"max","h":36}]`
- 最小复现：composer 上点思考档位按钮，看列表最后一行。
- 最小修法：`thinkingDescription` 为 "max" 补一句描述（与 xhigh 同款），或给 `.options button` 加 `min-height: calc(...)` 把描述行的位置预留出来。前者更符合本仓"未知档位不编描述"的原意，只是 max 不是未知档位。
- confidence: 高

## F4 chat 消息头的 ⓘ 按钮：焦点环 1px 且对比度 1.09:1，触控目标 26x24 而兄弟是 44x44
- src/client/src/components/ChatView.ts:397（`.msg-meta:focus { outline: 1px solid var(--pi-border); outline-offset: 3px; }`）、ChatView.ts:401（`width: 26px; height: 24px`）、对照 ChatView.ts:381 `.msg-action { width: 24px; height: 24px }` 与 ChatView.ts:386 `@media (pointer: coarse) { .msg-action::after { inset: -10px } }`
- surface: chat / msg-row-menu
- finding: 两件事。
  (a) 焦点环：`.msg-meta` 是 `role="button" tabindex="0"`（ChatView.ts:1775），但它的 focus 环是 1px 的 `--pi-border`，而全局约定是 `outline: var(--pi-focus-ring-width) solid var(--pi-accent)`（shared.ts listStyles）。实测 focus 后 computed 为 `rgb(213,210,198) solid 1px offset 3px`，画在 user 行头部底色 `#f3e2d9` 上，对比度 **1.09:1** —— 键盘用户实际上看不到焦点落在哪里。offset 3px 也不在 `--pi-focus-ring-offset`(2px) 上。
  (b) 几何：coarse pointer 下 `.msg-action` 靠 `::after { inset: -10px }` 把有效热区撑到 44x44，`.msg-meta` 没有这层扩展，实测盒子 26x24。同一行三个控件，两个 44x44、一个 26x24。命中测试确认 `.msg-meta` 下方 6px 处击中的是 `.msg`，不是它自己。
- 实测命令与输出：`node /tmp/fe-r2-lane-c/probe/s10.mjs` →
  `"metaBox":[350,128,26,24]`、`"actionBoxes":[[274,128,24,24],[318,128,24,24]]`、`"hitBelowMeta":"msg user"`、`"metaOutline":"rgb(213, 210, 198) solid 1px offset 3px"`
- 最小复现：手机上想点消息时间戳看详情；或桌面上 Tab 到该控件。
- 最小修法：删掉 ChatView.ts:397 这条规则（让 listStyles 的 `[role="button"]:focus-visible` 生效），并给 `.msg-meta` 加同款 `::after { inset: -10px }`（或直接把 26x24 写成 24x24 再套热区扩展）。
- confidence: 高

## F5 session 行的状态点独占一整行，每行白白高出 18px
- src/client/src/components/SessionList.ts:417（`renderSessionRowIndicator(...)` 放在 `<small>` 之后，`.action-main` 是 `display: block`），指示器样式 src/client/src/components/sessionStateBadgeStyles.ts:26（`.session-state` 为 `inline-grid`，8x8）
- surface: sessions / chat-drawer
- finding: `SessionList` 引入了 `sessionStateBadgeStyles` 但没有为 `.session-state` 写任何行内定位规则（在 SessionList.ts 全文 grep `session-state` 为 0 命中）。于是这个 8x8 的点作为第三个块级流内元素落到标题、副标题之下，独占一行：实测行内元素依次为 `.action-name-line` y=175 h=17.5、`small` y=192.5 h=13、`span.session-state.asking` y=210.5 **8x8**，行总高 65.5。去掉这条孤儿行，行高应在 47.5 左右 —— 也就是每行浪费 18px，一屏少显示约 1/4 的会话。同类面板（quick-switcher、tiles）都把这个点绝对定位到角上。
- 实测命令与输出：`node /tmp/fe-r2-lane-c/probe/s19.mjs` →
  `span.session-state.asking x=23 y=210.5 8x8`，`div.action-row.selected ... 373x65.5`
- 最小复现：打开任一有会话的项目，看会话行标题下方那颗孤零零的点。
- 最小修法：在 SessionList 的样式里给它一个位置，例如 `.action-main .session-state { position: absolute; top: 50%; right: var(--pi-space-5); transform: translateY(-50%); }`，或把它塞进 `.action-name-line` 与徽章同列。
- confidence: 高（实测 + 源码 grep 无定位规则）

---

## F6 quick-switcher 的状态点与 ⋯ 按钮中心线在 coarse pointer 下偏 6px（fine 下恰好对齐）
- src/client/src/components/QuickSwitcher.ts:428（`.row-flag, .row-state { position: absolute; bottom: var(--pi-space-4); right: 12px; }`）与 QuickSwitcher.ts:392-393（`--qs-menu-size: 32px`，coarse 下 44px）
- surface: quick-switcher
- finding: 点是 8px 宽、右距 12px，中心线在 `right - 16px`；菜单按钮宽 `--qs-menu-size`、右距 0，中心线在 `right - qs-menu-size/2`。fine pointer 下 32/2 = 16，两者严丝合缝；coarse 下 44/2 = 22，差 **6px**。实测 393x850：`.row-menu-toggle` x=149.5 w=44（中心 171.5），`.session-state` x=172.5 w=8（中心 176.5）。这正是第一轮在 tiles 上修掉的同一条不变量（"活动点与菜单按钮共用中心线"），在 quick-switcher 上没有跟上，而且偏差只在手机上出现。
- 实测命令与输出：`node /tmp/fe-r2-lane-c/probe/s20.mjs` → `button.row-menu-toggle x=149.5 44x44` 与 `span.session-state.asking x=172.5 8x8`
- 最小复现：手机上打开快速切换器，看任一卡片右侧上下两个记号。
- 最小修法：把 `right: 12px` 改成从同一个变量推导：`right: calc((var(--qs-menu-size) - var(--pi-dot-md)) / 2);`（与 tiles 里 `--pi-tile-menu-size` 的推导同构）。
- confidence: 高

## F7 外观面板的主题卡片行高不齐，最多差 31px
- src/client/src/components/settings/SettingsAppearancePanel.ts:127（`.theme-grid`）与 :137（`.theme-description` 只定字号，未定行数）
- surface: settings-appearance
- finding: 卡高由描述文案长度决定。实测 393x850：四行网格高度 169.8 / 200.6 / 185.2 / 200.6；1440x900：179.8 / 195.2 / 210.6。同一行内因 grid stretch 相等，行与行之间却踩不到同一节奏，八张卡读成三种盒子。仓库自己的规则写着"网格瓦片共享高度"，quick-switcher 的 `.row-title` 已经用"钳两行 + 预留 min-height"解决过同一问题（QuickSwitcher.ts:415）。
- 实测命令与输出：`node /tmp/fe-r2-lane-c/probe/s24.mjs` →
  `VP{"w":393} themes: 169.8,169.8,200.6,200.6,185.2,185.2,200.6,200.6`
  `VP{"w":1440} themes: 179.8 x3, 195.2 x3, 210.6 x2`
- 最小复现：设置 → 外观，横看主题卡片下沿。
- 最小修法：`.theme-description { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; min-height: calc(2 * 1.4em); overflow: hidden; }`
- confidence: 高

## F8 外观面板"Follow the system"的复选框在手机宽度被压成非正方形（15.8x24）
- src/client/src/components/settings/SettingsAppearancePanel.ts:124（`.follow input { width: 24px; height: 24px; ... }`，父级 `.follow` 是 `display: flex`，SettingsAppearancePanel.ts:123）
- surface: settings-appearance
- finding: input 是 flex item，`flex-shrink` 默认 1，宽度被右侧两行文案挤掉。实测宽 x 高：320px 视口 **15.8x24**，393px 视口 **20.2x24**，1440px 视口 24x24。也就是在所有手机宽度上，这个勾选框都是一个立着的长方形，且勾选记号会被原生控件按比例拉伸。
- 实测命令与输出：`node /tmp/fe-r2-lane-c/probe/s24.mjs` →
  `VP{"w":320} "checkbox":[15.8,24]`、`VP{"w":393} "checkbox":[20.2,24]`、`VP{"w":1440} "checkbox":[24,24]`
- 最小复现：320px 宽打开设置 → 外观。
- 最小修法：`.follow input { flex: 0 0 auto; }`
- confidence: 高

## F9 composer 图标行里并存三套字形系统：18px SVG、8.2px 文本箭头、整词标签
- src/client/src/components/PromptEditor.ts:711（历史按钮渲染裸字符 `⟲`）、PromptEditor.ts:774（`${entry.icon ?? entry.title}` 把插件的 title 整词塞进 `.icon-button`）、对照 PromptEditor.ts:80（`.icon-button .prompt-action-icon { width: 18px; height: 18px }`）
- surface: chat
- finding: 同一排 44x44 的 `.icon-button` 里，附件/思考/发送/停止是 18x18 的描边 SVG；历史按钮是 12px 字号的文本字形，实测墨迹范围只有 **8.2x15**（比邻居窄一半以上，笔画也细一档）；语音插件的按钮因为没给 `icon`，落到 title 回退，渲染成整个单词 **Dictate**，实测墨迹 40.6px 宽塞在 44px 无内边距的盒子里，只剩 1.7px 余量。
- 实测命令与输出：`node /tmp/fe-r2-lane-c/probe/s18.mjs` →
  `{"historyInk":[210.9,781,8.2,15],"dictateInk":[244.7,781.5,40.6,15],"historyBox":[44,44]}`
- 最小失败场景：任何 title 比 "Dictate" 长一两个字母的 composer 插件（例如 "Transcribe"）会直接溢出 44px 的格子并压到发送键上；`entry.icon ?? entry.title` 没有任何截断或 `overflow: hidden` 兜底。
- 最小修法：把 `⟲` 换成与邻居同族的 18x18 SVG（第一轮已对设置齿轮做过同样的替换）；`renderComposerContributions` 在没有 `icon` 时渲染 title 的首字母或一个占位图标，并给 `.icon-button` 加 `overflow: hidden`。
- confidence: 高

## F10 chat 消息头三个等高控件的间距是 20 / 8，不成节奏
- src/client/src/components/ChatView.ts:386（`@media (pointer: coarse) { .msg-actions { gap: var(--pi-space-8) } }` = 20px）与 ChatView.ts:380（`.msg-header-trailing { gap: var(--pi-space-4) }` = 8px）
- surface: chat
- finding: 三个 24px 高的记号排在一行，实测 x 依次 274(24) / 318(24) / 350(26)：↻ 与 ⧉ 之间 20px，⧉ 与 ⓘ 之间 8px。眼睛会把靠得近的 ⧉ 与 ⓘ 读成一组（复制 + 信息），而它们在语义上并不是一组；真正同组的 ↻ 与 ⧉ 反而被拉开。
- 实测命令与输出：`node /tmp/fe-r2-lane-c/probe/s9.mjs` → `button.msg-action x=274 24x24`、`button.msg-action x=318 24x24`、`span.msg-meta x=350 26x24`
- 最小修法：让 `.msg-meta` 也进入 `.msg-actions`（继承同一个 gap），或把 `.msg-header-trailing` 的 gap 与 coarse 下的 `.msg-actions` gap 统一。
- confidence: 高

## F11 非 tiles 列表的行 ⋯ 按钮在 coarse pointer 下只有 32px 宽，同一张 sheet 里的兄弟是 44px
- src/client/src/components/shared.ts:427（`.action-menu-toggle { min-width: var(--pi-control-height) }` = 32px），coarse 覆盖只写给了 tiles 变体（shared.ts:342）与 SessionList（src/client/src/components/SessionList.ts:769）；pi-web-plugins/machines/browser/MachineList.ts:164、pi-web-plugins/workspaces/browser/ProjectList.ts:122、pi-web-plugins/workspaces/browser/WorkspaceList.ts:229 都没有各自的 coarse 兜底
- surface: context-sheet（手机上以 `tiles: false` 渲染 machine/project/workspace 三段，见 src/client/src/components/appShell/ContextSwitcherSheet.ts:48）
- finding: 320x560 实测 context-sheet 内 machine 行的 `.action-menu-toggle` 为 **32x58**，宽度低于本仓自己的 coarse 触控底线 44（SessionList.ts:769 正是这条底线的书面证据）；而同一张 sheet 里的 `.section-add` 实测 102x44，已经吃到 44。也就是同一屏内两类同级控件用了两套触控底线。
- 实测命令与输出：`node /tmp/fe-r2-lane-c/probe/s26.mjs` →
  `button.action-menu-toggle x=258 y=100 32x58` 与 `button.section-add x=199 y=161.2 102x44`
- 最小修法：把 coarse 兜底提升到 shared.ts 的 `.action-menu-toggle`（不限定 `.list-body.tiles`），tiles 变体再用现有的 36px 例外覆盖回去。
- confidence: 高

## F12 `small` 元素没有字号，落回 UA 的 smaller，产生 11.667px / 11.111px 两个刻度外字号
- src/client/src/components/shared.ts:437（`small { display: block; color: var(--pi-muted); ... }`，无 font-size）；受影响处包括 src/client/src/components/SessionList.ts:417 的会话副标题、pi-web-plugins/workspaces/browser/ProjectDialog.ts 的 `.hint`、ModelPicker/CommandPicker 的选项副标题
- surface: sessions / chat-drawer / add-project-dialog / model-picker / thinking-picker
- finding: `small` 的 UA 默认是 `font-size: smaller`（0.8333em）。父级 14px 时得 **11.6667px**（会话副标题、machine 行副标题、add-project 提示实测均为 11.6667px），父级是 Arial 13.333px 时得 **11.1111px**（picker 副标题实测）。字号刻度里只有 11/12/13（index.html:39-41），这两个值都不在刻度上，而且同一角色（副标题）在两个面板上是两个不同字号。
- 实测命令与输出：`node /tmp/fe-r2-lane-c/probe/s19.mjs` → `small ... f=11.6667px`；`node /tmp/fe-r2-lane-c/probe/s11.mjs` → `small ... f=11.1111px`
- 最小修法：shared.ts:437 补 `font-size: var(--pi-text-2xs);`（顺带随 F2 一起把 picker 的字族拉回来）。
- confidence: 高

---

## F13 model-picker 里当前选中的那一行比兄弟行高 1px，列表节奏在此处断一格
- src/client/src/components/ModelPicker.ts:293（`.options > button` 未声明 `line-height`）
- surface: model-picker / thinking-picker
- finding: 实测所有选项行高 52px，唯独带 ✓ 标记的那一行 53px（model-picker 与 thinking-picker 均如此）。行内 `span` 与 `small` 的盒高两者都是 15 / 12，差值来自行盒：✓（U+2713）落到另一套回退字体，把该行的 line box 顶高 1px。往下的每一行因此整体下移 1px。
- 实测命令与输出：`node /tmp/fe-r2-lane-c/probe/s13.mjs` →
  `{"before":{"first":52,"sel":53},"after":{"first":54.78,"sel":54.78}}`（after 是在该 shadow root 里注入 `.options > button { font: 13px/1.25 system-ui }` 之后的实测，一条显式 line-height 就把 52/53 抹平了）
- 最小修法：与 F2 合并——`.options > button { font: var(--pi-text-sm)/1.25 var(--pi-font-ui); }`，一处同时解决字族回退与 1px 断层。
- confidence: 高（含注入验证）

## F14 quick-switcher 的分组标题比它所标注的卡片左缘内缩 4px
- src/client/src/components/QuickSwitcher.ts:406（`h3 { margin: var(--pi-space-7) var(--pi-space-2) var(--pi-space-3) }`，左右 margin 4px）
- surface: quick-switcher
- finding: 实测 `.body` 内边距 10px，卡片 `.row-wrap` 从 x=11 起，`h3`（Waiting for you / Today / Earlier / Workspaces）从 x=15 起。标题既不与卡片外缘对齐（11），也不与卡片内文字对齐（24），是一条谁都不贴的中间线。
- 实测命令与输出：`node /tmp/fe-r2-lane-c/probe/s20.mjs` → `h3 x=15`，`div.row-wrap x=11`
- 最小修法：`h3 { margin-inline: 0; }`（或改成 `var(--pi-space-6)` 去贴卡片内文字）。
- confidence: 高

## F15 会话选择模式的入口画成一个"已勾选"的复选框字形
- src/client/src/components/SessionList.ts:292 与 :322（`>☑</button>`）、样式 SessionList.ts:684
- surface: sessions / chat-drawer
- finding: 进入多选模式的按钮永远渲染 `☑`（BALLOT BOX WITH CHECK），无论当前是否处于选择模式；状态只写在 `aria-pressed` 上，视觉上没有任何差别。也就是"未开启的开关"长得像"已勾选"。同时它是这一行里唯一的文本字形按钮（旁边 Clean up 是文字、New session 是文字 + 字形，第一轮已把设置齿轮换成 SVG），实测 44x44 的盒子里只有 13px 的字形墨迹。
- 实测：`node /tmp/fe-r2-lane-c/probe/s19.mjs` → `button.bulk-select-entry 44x44 f=13px text=☑`
- 最小修法：未开启时用空框字形/SVG，开启时才用勾选态（并保留 `aria-pressed`）；本仓的既有做法是"状态用记号，不用散文"，这里正好反过来了。
- confidence: 中高（"未开启也显示勾"由源码常量直接可证；是否要换 SVG 属于风格取舍）

## F16 若干刻度逃逸：焦点环宽度、间距 3px/5px、10px 圆点绕过 dotScale 守卫
- src/client/src/components/shared.ts:470（`.table-scroll:focus-visible { outline: 1px solid var(--pi-accent); outline-offset: 2px }` —— 全仓唯一的 1px 焦点环，别处都是 `var(--pi-focus-ring-width)`；`formattedTextStyles` 不在 designTokens.test.ts 的 SHARED_SHEETS 名单里，所以守卫看不到它）
- src/client/src/components/CommandPicker.ts:104（`outline: 2px solid` 字面量，而同构的 ModelPicker.ts:278 写的是 token）
- src/client/src/components/shared.ts:377（`.workspace-secondary { margin-top: 3px }`）、shared.ts:452（`li + li { margin-top: 3px }`）、shared.ts:392（`.action-activity { top: 5px; right: 6px; width: 10px; height: 10px }`）—— 3px 与 5px 都不在 `--pi-space-*`(2/4/6/8/10/12/16/20/24) 上；designTokens.test.ts 的 off-scale 正则只查 5/7/9/11/13/15，3px 直接漏过
- src/client/src/components/settings/SettingsAppearancePanel.ts:144（`.preview-dot { width: 10px; height: 10px; border-radius: 50% }`）—— dotScale.test.ts 的 `marksInLine` 正则是 `(?:width|height):\s*(\d)px`，只匹配单个数字，所以 10px 的圆点正好从守卫下面钻过去；这条规则本身完全落在守卫的意图范围内（同一行既有 `border-radius: 50%` 又有像素尺寸）
- surface: chat（表格滚动区焦点）/ settings-appearance / sessions
- finding: 上述值都应当读 token 而没有读；其中两处还暴露了守卫的洞（SHARED_SHEETS 名单缺 formattedTextStyles；dot 正则只吃一位数）。
- 最小修法：1px→`var(--pi-focus-ring-width)`；2px 字面量→token；3px/5px→最近的 `--pi-space-*`；`.preview-dot` 用 `--pi-dot-md` 或显式登记为例外；并把 dotScale 的正则改成 `(\d+)px`、把 formattedTextStyles 加进 SHARED_SHEETS。
- confidence: 高（全部为源码直读，行号已核对）

---

## 附：核对过但判定不成立 / 不报的项
- tiles 的 `⋯` 在 coarse 下 36px：shared.ts:335-343 有成文的例外说明，且 24px AA 底线满足 —— 不报。
- model/thinking picker 的 scope-toggle 内外圆角 4 vs 8：外 8 − 内边距 3 − 边框 1 = 4，几何正确 —— 不报。
- `.section-add` 的 `+` 与标签中心线差 0.5px（实测 134.5 vs 134）：低于半像素级别，不构成可见问题 —— 不报。
- msg-action 的 `::after` 扩展与 `.msg-meta` 是否重叠：实测 `elementFromPoint(meta.x+1)` 命中 `.msg-meta`，未重叠 —— 判定为不成立。
- 模型按钮截断成 `ant…claude-opus-5`（provider span 实测 32.95px / scrollWidth 57px，分隔符 "/" 被省略号吃掉）：属于文案与截断策略，不在本通道的猎捕清单内，仅此记录，未计入 16 条。

## 未能验证的部分（据实声明）
- 键盘弹起时的短高度形态：Playwright 无法真实唤起软键盘，我用 393x420 的短视口近似过，但那不等于 `visualViewport` 收缩后的真实行为，故本报告不就该场景下任何结论作断言。
- 深色主题下 F1 之外的其他前景/背景组合未逐一枚举，只测了实心主按钮这一对。
