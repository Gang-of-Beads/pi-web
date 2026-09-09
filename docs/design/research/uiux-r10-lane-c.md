# 第十轮 视觉收敛审计 — Lane C（全 13 面 + 现场实测）

审计对象：`/Users/hanxiao.du/Desktop/vincent/projects/pi-web`，分支 `refactor/plugin-architecture`。

## 方法与证据基线（重要）

- 实测栈：`http://127.0.0.1:8505`，Playwright/Chromium，视口 393x850、`hasTouch: true`，实测 `matchMedia("(pointer: coarse)").matches === true`、`(hover: hover) === false`（即所有测量都在粗指针分支下）。
- 审计过程中仓库被并行改动了两次。首轮测量对应构建 `assets/index-DFJcuAHc.js`（HEAD `d167533d`，第九轮 lane C）；期间 `2e5beb47`（第十轮 lane B）落盘，栈在 10:52 重建为 `assets/index-BdJnW7IJ.js`。
- **下面每一条结论都已在最新构建 `index-BdJnW7IJ.js` / HEAD `2e5beb47` 上重新实测确认**，行号引用的是该 HEAD 的工作树文件。凡是 lane B 已修掉的（如 quick switcher 状态点 6px 偏移）我不再作为发现提交，只保留其残留部分并注明。
- 未能现场驱动的面：**chat-drawer**。在可达的三个会话里 `.drawer-tab / .drawer-header / .drawer-collapse` 均未渲染（实测返回空数组），说明该会话没有 drawer section 贡献。我对 `ChatView.ts:131-192` 做了静态复核（`.drawer-control` 32px 基线 + 粗指针块把 `.drawer-header`/`.drawer-tab`/`.drawer-collapse` 全部抬到 44px，`drawer-control` 唯一使用者就是 `drawer-collapse`），**没有发现新问题**。这是一次未完成的检查，不是通过。

共 12 条发现。

## F1 顶栏 Actions 药丸的文字画出了自己的边框：44px 触控下限抹掉了 min-content 下限

- `src/client/src/components/appShell/AppNavigationPanel.ts:467`（`.compact-header-action` 未声明 `flex: 0 0 auto`，`flex-shrink` 取默认 1）
- `src/client/src/components/appShell/AppNavigationPanel.ts:471`（`@media (pointer: coarse) { .compact-header-action { min-width: 44px; ... } }`）
- surface: sessions / boot / chat（compact 顶栏，三个面共用同一行）
- finding（几何陈述）：`.compact-header` 是 flex 行，`.compact-scope` 取 `flex: 1 1 auto; min-width: 0`，两个 `.compact-header-action` 取 `flex: 0 1 auto`。粗指针下第 471 行给按钮写死 `min-width: 44px`，这条声明**覆盖了 flex item 的自动最小尺寸（min-content）**，于是按钮被允许压缩到比自己的文字还窄。实测（当前构建）：作用域名较长时按钮盒宽 **50.95px**（`x=336.05 → right=387.0`），而 Range 量出的 "Actions" 文本宽 **48.27px**（`x=337.39 → right=385.66`）；按钮 `padding: 0 8px` + `border: 1px`，内容盒只有 **32.95px**。文字比内容盒宽 15.3px，左右各溢出 7.66px，直接压过 padding 与 1px 圆角描边。对照：boot 页作用域名短时同一按钮量到 **66.3px**（正常宽度）。
- minimal failure scenario：393px 手机，进入任一 workspace，使得 `compactScopeLabel()` 较长（例：`pi-web-8505-seed-workspace · pi-web-…`）。顶栏右侧 Actions 药丸的 "Actions" 文字横穿药丸左右两条圆角边，并顶到屏幕右缘。
- confidence: 高（源码 + 双次实测，跨两个构建复现）

## F2 quick switcher 状态点与行菜单“共用中心线”仍差 1px：两者用了两个不同的包含块

- `src/client/src/components/QuickSwitcher.ts:430`（`.row-flag, .row-state { position: absolute; bottom: ...; right: calc((var(--qs-menu-size) - var(--pi-dot-md)) / 2); }` — 相对 `.row` 的 padding box）
- `src/client/src/components/QuickSwitcher.ts:467`（`.row-menu-toggle { position: absolute; top: 0; right: 0; width: var(--qs-menu-size); }` — 相对 `.row-wrap` 的 border box）
- `src/client/src/components/QuickSwitcher.ts:411`（`.row` 带 `border: 1px`）、`:458`（`.row-wrap { position: relative }` 无边框）
- surface: quick-switcher
- finding（几何陈述）：第十轮 lane B（`2e5beb47`）已经删掉了多余的 `+ var(--pi-space-3)`，6px 偏移消失。但**残留 1px**：`.row-state` 的定位包含块是 `.row` 的 padding box（因 `.row` 有 1px 边框，右边界 = 行右边界 - 1），而 `.row-menu-toggle` 的包含块是无边框的 `.row-wrap`（右边界 = 行右边界）。实测最新构建：`row-state` 中心 x=**170.5**，`row-menu-toggle` 中心 x=**171.5**，差 **1.0px**；第二列同样 `359.0` vs `360.0`。第 428 行注释仍然写着两者读作一对角标。
- minimal failure scenario：手机打开 quick switcher，看任一带状态点的会话卡：8px 圆点与其正上方 44px 的 `⋯` 不在同一条竖直中心线上，恒定偏左 1px。
- confidence: 高（源码推导 + 最新构建实测数值与推导完全一致）

## F3 展开一条消息的时间戳，会把该行的动作图标整体拖到左边 216px，打断整列图标

- `src/client/src/components/ChatView.ts:1785-1787`（`.msg-header-trailing` 内的 DOM 顺序：先 `renderMessageActions()`，后 `.msg-meta`）
- `src/client/src/components/ChatView.ts:384`（`.msg-header-trailing { display: inline-flex; justify-content: flex-end; }`）
- `src/client/src/components/ChatView.ts:405`（`.msg-meta.expanded { flex: 1 1 auto; max-width: 100%; ... }`）
- surface: chat / msg-row-menu
- finding（几何陈述）：折叠态下 `.msg-meta` 是 24x24 的方形标记，`.msg-header-trailing` 靠 `justify-content: flex-end` 把 `[动作按钮…][ⓘ]` 贴右。一旦点开时间戳，`.msg-meta` 变成 `flex: 1 1 auto` 的可增长项，把同一 flex 行里排在它前面的 `.msg-actions` 顶到最左端。最新构建实测：同屏两行消息，未展开行的复制按钮 `x=308`，展开行的复制按钮 `x=92`（重试按钮由 `x=264` 到 `x=92`），横向位移 **216px**；`.msg-meta` 由 `w=24` 变为 `w=240`（`x=352 → 136`）。屏上其余每一行仍然停在 264/308/352 三列。
- minimal failure scenario：手机 chat 里点一次某条消息头部的 ⓘ。该行的 ↻/⧉ 立刻跳到角色标签右侧，与上下相邻消息的图标列错开 216px；再点一次才回位。
- confidence: 高（源码 + 最新构建实测前后对比）

## F4 context sheet：内层列表的粘性搜索条盖住了 sheet 自己的标题和关闭键（层级 3 > 1），并且粘性表头比滚动口低 8px

- `src/client/src/components/appShell/ContextSwitcherSheet.ts:82`（`.sheet { padding: var(--pi-space-4); overflow-y: auto; }`）
- `src/client/src/components/appShell/ContextSwitcherSheet.ts:85`（`.sheet-header { position: sticky; top: 0; z-index: 1; ... }`）
- `src/client/src/components/shared.ts:260`（`.list-search { position: sticky; top: 0; z-index: 3; ... }`，被 sheet 内嵌的 project-list 使用）
- surface: context-sheet
- finding（几何陈述）：sheet 自己是滚动容器且带 8px 内边距，粘性表头 `top: 0` 只能停在内容盒顶端 —— 实测 `.sheet` 边框盒 `y=1`，`.sheet-header` `y=9..53`，即表头上方有一条 **8px 的缝**，滚过去的行（连同它 8px 的活动圆点）在缝里被拦腰切开显示。更严重的是内层 `project-list` 的 `.list-search` 是另一个粘性层且 `z-index: 3`，压过表头的 `z-index: 1`：把 `.sheet` 的 `scrollTop` 设为 **320** 时，搜索条落在 `y=-8..42`，完全覆盖 `y=9..53` 的表头；`document.elementFromPoint()` 深层命中测试在 `.sheet-title` 中心与 `.sheet-close` 中心都返回 `input.list-search-input`。也就是说该滚动位置上 sheet 的关闭按钮点不到。`scrollTop=0` 与 `600` 时命中测试正常，只有中间区间坏掉。
- minimal failure scenario：手机点作用域名打开 Change context，向下滑到项目区大约 320px 处：标题只剩一个 "C"，一整条 "Search projects" 输入框压在表头上；此时点右上角 X，落到搜索框里，弹层关不掉。
- confidence: 高（截图 + 三个滚动位置的命中测试实测；根因是两条粘性规则的 z 值与表头的 8px 内缩）

## F5 composer：全应用唯一一个 composer 贡献把 “Dictate” 这个词塞进了 44x44 的图标按钮

- `src/client/src/components/PromptEditor.ts:757,762`（贡献按钮 `class="icon-button"`，内容 `${entry.icon ?? entry.title}`）
- `src/client/src/components/PromptEditor.ts:79-80`（`.icon-button` 是 44x44 的方格，`padding: 0`，其 `.prompt-action-icon` 一律 18x18）
- `pi-web-plugins/voice/pi-web-plugin.ts:71-82`（贡献对象只有 `title: "Dictate"`，没有 `icon`）；同文件 `:10` 与 `:92` 已经 import 并 re-export 了 `dictationGlyph`，却没接到贡献上
- `src/client/src/plugins/types.ts:488`（`icon?: TemplateResult` 是受支持字段）
- surface: chat（composer 工具行）
- finding（几何陈述）：composer 底行 5 个 44x44 控件的内容尺寸实测为 —— thinking 计量 18x18 SVG、history 文本字形 8.16px、**Dictate 文本 40.63px 宽**、send 18x18 SVG、stop 18x18 SVG。“Dictate” 在 `padding: 0` 的 44px 方格里左右各只剩 1.69px 余量（文本 `x=244.69`，按钮 `x=243`）。同一份 `voiceCaptureLabel()`（`pi-web-plugins/voice/lib/voiceCapture.ts:130-138`）会给出 "Dictate live"、"Listening…"、"Transcribing…"、"Microphone permission denied" 等更长文案，一旦哪天把 `title` 接成动态状态，就会重演 F1 的溢出。
- minimal failure scenario：手机 chat 底部工具行，"Dictate" 一个单词夹在两个 18px 图标之间，读起来像一个没画完的标签而不是控件；把 `title` 换成 `dictationLabel()` 的任何一个更长状态即刻出框。
- confidence: 高（源码 + 实测尺寸）

## F6 composer：提示历史控件是 8.16px 的文本字形，旁边四个同尺寸控件是 18px SVG

- `src/client/src/components/PromptEditor.ts:694-699`（`class="editor-history icon-button"`，内容是字符 `⟲`）
- `src/client/src/components/PromptEditor.ts:80`（`.icon-button .prompt-action-icon { width: 18px; height: 18px; }` 只作用于 SVG 子元素）
- `src/client/src/components/PromptEditor.ts:87`（`.editor-attach .prompt-action-icon { width: 16px; height: 16px; }` — 同一个 composer 里再开一个 16px 例外）
- surface: chat（composer 工具行）
- finding（几何陈述）：一行 44x44 控件里的标记实测宽度为 16（回形针）/ 18（thinking）/ **8.16（⟲ 文本字形，字号 12px）** / 40.63（Dictate 文案）/ 18（send）/ 18（stop）。`⟲` 的墨迹只有相邻 SVG 的 45%，并且它随平台字体变形，无法参与 `stroke-width: 2` 的统一线重。
- minimal failure scenario：手机 chat 工具行从左看到右，第三个控件明显“瘦一圈、细一档”，而它的点击盒与两侧一样大 —— 视觉重量与命中盒对不上。
- confidence: 高（源码 + 实测）

## F7 settings / settings-appearance：层级箭头是 Unicode 文本字形，而应用已经有共享的 SVG 折叠图标

- `src/client/src/components/SettingsDialog.ts:196`（`<span class="settings-list-chevron" aria-hidden="true">›</span>`）
- `src/client/src/components/SettingsDialog.ts:788`（`.settings-list-chevron { font-size: var(--pi-text-xl); color: var(--pi-muted); }`）
- 对照：`src/client/src/components/disclosureIcon.ts:11`（`renderDisclosureIcon()`，第九轮刚用它替换掉文本箭头）；`src/client/src/components/appShell/AppNavigationPanel.ts:459-460`（`.header-icon-action svg` 16x16、`stroke-width: 2`）；`src/client/src/components/ChatView.ts:178`（`.drawer-icon` 16x16 SVG）
- surface: settings（列表项），settings-appearance（返回控件的 `‹`）
- finding（几何陈述）：7 个设置行的层级箭头实测为 `w=8.3, h=23` 的文本 span（字号 20px），右缘 `x=377.0`；同一屏上的齿轮图标是 16x16 SVG、工具磁贴图标是 20x20 SVG。文本箭头的墨迹粗细、光学中心、以及在不同平台字体下的形状都不受控，`stroke-width` 一族的线重规则对它无效。第九轮已经把 “文本箭头 → 共享 chevron” 定为屋内规则，settings 这一处是漏网。
- minimal failure scenario：手机打开设置，7 行的 `›` 与顶栏齿轮 SVG 并排；换一台把 U+203A 渲染得更细/更宽的机器，7 行箭头一起变形，而 SVG 图标不变。
- confidence: 中高（实测尺寸确凿；“该用共享 SVG”属于与第九轮既有决策对齐的判断）

## F8 sessions：批量选择控件是 13px 的 ☑ 文本字形（墨迹 9.5px）撑在 44px 控件里

- `src/client/src/components/SessionList.ts:293` 与 `:323`（按钮正文就是字符 `☑`）
- `src/client/src/components/SessionList.ts:687`（`.bulk-select-entry { ... font-size: var(--pi-text-sm); }`）、`:783`（粗指针下 44x44）
- 对照：`src/client/index.html:101`（`--pi-checkbox-size: 24px`，注释写明“勾选框是手指要瞄的控件，不是一个字形；一个尺寸，处处如此”）
- surface: sessions
- finding（几何陈述）：控件盒实测 44x44（`x=150.4, y=96`），像素分析出 ☑ 的墨迹只有 **9.5px x 9.0px**（设备像素 335..354 x 227..245，中心 y=118.0 与控件中心 118 对齐，居中没问题），是全应用最小的交互标记；同屏的 “Clean up” 大写高 10.5px、齿轮 SVG 16px、工具图标 20px、而应用为勾选框命名的尺寸是 24px。另外这个字形不随状态改变（选中态只靠 `button.selected` 的底色 tint 表达），标记本身恒为 ☑。
- minimal failure scenario：手机 sessions 标题行，44px 的可点区域里只有一个 9.5px 的小方块，与右侧 44px 高的实心 “+ New session” 并排，读作“一个没画完的图标”。
- confidence: 中高（几何为实测；是否必须换成 24px 勾选框属于与既有 token 语义对齐的判断）

## F9 quick switcher：同一个“新建”动作，两个面用了两种加号（全角 U+FF0B vs ASCII +）

- `src/client/src/components/QuickSwitcher.ts:170`（`<span class="row-title">＋ New session</span>` —— 全角加号 U+FF0B 直接写进标题文本）
- 对照：`src/client/src/components/SessionList.ts:303`（`<span class="section-add-glyph">+</span><span class="section-add-label">…</span>`）与 `src/client/src/components/shared.ts:282-283`（注释明写“字形是标记、词是词，两者分开定尺寸，好让应用里每个 `+ 某某` 控件都一致”）
- surface: quick-switcher / sessions
- finding（几何陈述）：sessions 的新建控件把加号放在独立 span 里，按 `--pi-text-lg`(17px) 渲染，标签按 `--pi-text-xs`(12px)，实测 `+` span `w=10.8,h=17`、label `w=74,h=15`。quick switcher 的创建行则把全角加号并进标题字符串，随 `.row-title` 的 `--pi-text-md`(15px) 和 `--pi-weight-strong` 一起渲染（实测该行标题 `h=39`，字号 15px/650）。同一动词在相隔一次点击的两个面上，标记的字符、字号、字重、以及“是否是独立元素”四项全不同，shared.ts 里那条“处处一致”的规则被绕开。
- minimal failure scenario：手机 sessions 页看 “+ New session”，再点顶栏标题打开 quick switcher 看 “＋ New session”：加号一个窄一个宽（全角字形按 1em 前进宽度排版），且第二个无法接受 `.section-add-glyph` 的尺寸规则。
- confidence: 高（源码字符可验证 + 实测两处渲染参数）

## F10 chat：扩展对话卡片一张卡两种底色 —— 卡身 rgb(217,217,217)，页脚 rgb(255,255,255)，中间没有分隔线

- `src/client/src/components/ExtensionDialogCard.ts:346`（`.card { background: var(--pi-surface-raised); }`）
- `src/client/src/components/ExtensionDialogCard.ts:458`（`.dialog-footer { background: var(--pi-surface); }`）
- `src/client/src/components/ExtensionDialogCard.ts:461`（`.dialog-message + .dialog-footer, .dialog-options + .dialog-footer { border-top: 0; }` —— 恰好在有选项时去掉了这条边界线）
- `src/client/src/components/ExtensionDialogCard.ts:462-468`（注释写明“按钮在**着色的卡片**上走幽灵样式”，页脚破坏的正是这个前提）
- surface: chat
- finding（几何陈述）：最新构建实测同一张卡：`.card` 与 `.card-header` 底色 `rgb(217,217,217)`，`.dialog-options` 透明（继承灰），`.dialog-footer` 底色 `rgb(255,255,255)`，且因第 461 行去掉了 `border-top`，两块底色在 `y=543` 处直接对接、没有任何分隔。卡片总高 308.5px，其中底部 68px 是白的。结果：同为幽灵按钮，“Update now / Skip”（`rgb(240,238,230)`）落在灰底上读作凸起，而 “Cancel”（同样 `rgb(240,238,230)`）落在白底上几乎平掉 —— 同一张卡里两种按钮对比关系。
- minimal failure scenario：手机 chat 中出现扩展更新卡片，卡片下半截白、上半截灰，肉眼读成“上下两张卡贴在一起”，Cancel 像贴在另一张卡上。
- confidence: 高（源码 + 实测 6 个区域的计算底色）

## F11 qs-row-menu 与 sessions 行菜单：同一个动词的浮层，两种底色 + 两个圆角档位

- `src/client/src/components/QuickSwitcher.ts:477`（`.row-menu { border-radius: var(--pi-radius-lg); background: var(--pi-surface-raised); box-shadow: var(--pi-elevation-2); }`）
- `src/client/src/components/shared.ts:441`（`.action-menu-panel { border-radius: var(--pi-radius-md); background: var(--pi-surface); box-shadow: var(--pi-elevation-2); }`）
- surface: qs-row-menu / msg-row-menu 邻接面（sessions 行菜单）
- finding（几何陈述）：实测同一台机、同一主题下 —— sessions 行 `⋯` 展开的面板：底色 `rgb(255,255,255)`、1px 边框、圆角 **8px**（`--pi-radius-md`）、内边距 4px、项高 44；quick switcher 行 `⋯` 展开的面板：底色 `rgb(217,217,217)`、圆角 **12px**（`--pi-radius-lg`）、内边距 6px、项高 44。两个面板在手机上相隔一次点击，动词相同（行溢出菜单），却分属两套“浮层长什么样”的定义。
- 补充观察（标注为推测）：`--pi-surface-raised` 在 `src/client/index.html:182` 定义为 `color-mix(in srgb, var(--pi-surface) 84%, var(--pi-text))`，即“向文字色靠拢”。在深色主题下这会让浮层变亮（符合 raised 语义），在当前浅色主题下会让浮层**变暗**（217 < 255），于是“抬起”的浮层看起来是凹下去的。`src/client/src/components/designTokens.test.ts:290-299` 把“向文字色、单向推导”写成了契约测试，所以这属于既定设计而非疏漏 —— 我把它标为推测性观察，是否要在浅色主题里反向推导应由 owner 定。
- minimal failure scenario：手机上先点 sessions 行的 `⋯`（白色 8px 圆角浮层），再点顶栏标题进 quick switcher 点会话卡的 `⋯`（灰色 12px 圆角浮层）。
- confidence: 高（两处底色/圆角均为实测）；其中 raised 语义反转部分为**推测**，已注明。

## F12 三个面上同一个配对低于 AA：`--pi-muted` 落在 `--pi-selection-bg` 上是 4.42:1

- 产生点（组件侧，均为实测命中）：
  - `src/client/src/components/shared.ts:449`（`small { color: var(--pi-muted); }`）落在 `src/client/src/components/shared.ts:368`（`.action-row.selected { background: var(--pi-selection-bg); }`）上 —— sessions 选中行的 “400 messages”，11px
  - `src/client/src/components/shared.ts:435`（`.action-menu-toggle { color: var(--pi-muted); }`）在同一选中行上 —— `⋯`，12px
  - `src/client/src/components/ChatView.ts:385`（`.msg-action { color: var(--pi-muted); }`）与 `:402`（`.msg-meta { color: var(--pi-muted); }`）落在 user 角色行的 selection tint 上 —— ↻ / ⧉ / 时间戳
  - `src/client/src/components/QuickSwitcher.ts:421`（`.row-subtitle { color: var(--pi-muted); }`）落在 `:422`（`.create-row { background: var(--pi-selection-bg); }`）与 `:424`（`.session-row.selected`）上 —— “In pi-web-8505-seed-workspace”，12px
- surface: sessions / chat / quick-switcher（三个面，一个根因）
- finding（几何/数值陈述）：实测取计算色，逐层合成祖先背景（并排除任何 `opacity < 0.99` 的元素，因此**不存在把祖先透明度乘进来的问题**）：前景 `rgb(107,104,96)` 相对亮度 0.1388，背景 `rgb(243,226,217)` 相对亮度 0.7845，对比度 = (0.7845+0.05)/(0.1388+0.05) = **4.42:1**，低于普通文本 4.5 的门槛（差 1.8%）。扫描口径：sessions 面 23 个文本节点中 2 个低于 AA、chat 面 468 个中 150 个低于 AA、quick switcher 面 664 个中 152 个低于 AA，去重后**全部是同一个配对**，没有第二个根因。
- 与既有裁定的区别（重要）：既有 “JUDGED NOT TRUE” 记录的是 `--pi-muted` 实测 5.56:1、对 card 停靠点 4.71:1。本条是**第三个停靠点**（selection tint），数值 4.42:1，与那两个数字不冲突，也不是同一个断言。
- 范围提示：当前浅色主题的调色板不在本仓库内，由 themes 插件包提供（实测活动值来自 `~/.pi-web-8505/plugins/themes/pi-web-plugin.js:279` `--pi-muted: #6b6860` 与 `:284` `--pi-selection-bg: #f3e2d9`）。因此修法有两条路：改主题包里的这一对值，或在组件侧规定“落在 selection tint 上的次要文本改用 `--pi-text-secondary`”。**这属于产品/设计取舍，应由 owner 决定**，我不代选。
- minimal failure scenario：手机 sessions 页，选中行下方的 “400 messages” 与未选中行的同一行文案并排，选中行那条更难读；chat 里每一条 user 消息的时间戳与两个动作图标同理。
- confidence: 中（数值与产生点为实测确凿；因调色板在仓库外、且既有裁定否过一个相邻断言，故按“需 owner 裁定”提交）

---

## 已验证为“未复发/无新问题”的部分（不作为发现）

- boot / sessions 磁贴：`.list-body.tiles` 的 36px 行菜单在粗指针下属 `shared.ts:338-347` 明确记录的豁免；磁贴右内边距实测 `10px 44px 10px 10px` 与 `inset(4)+size(36)+gap(4)` 的推导吻合；活动圆点与磁贴菜单中心线实测同线。
- settings-appearance：主题预览实测 64px 高，上下留白各 9px、内容 30+6+10=46px 完全对称；4 个 8px 圆点等距 6px 且在 10px 轨道内居中；同一行两张主题卡实测同高 167.2px，一行文案与两行文案的卡片同高（两行位已预留）。
- model-picker / thinking-picker：scope 分段控件两段实测同为 44px 高、156.5px 宽；搜索框与分段控件左右边缘同为 `x=33..360`；选项行 55px 等高。
- add-project-dialog：Cancel 与 Add project 实测同高 44px；两行勾选框实测 24x24（等于 `--pi-checkbox-size`），行距 12px；建议行 44px 等高。
- chat-drawer：**未能现场驱动**（该会话无 drawer section 贡献，`.drawer-tab` 实测为空）。静态复核 `ChatView.ts:131-192` 未见新问题，但这是一次未执行的检查，不应记作通过。

TOTAL: 12 findings
