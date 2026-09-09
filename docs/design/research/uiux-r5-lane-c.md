# 第五轮 UI/UX 收敛审计 — Lane C（全 13 面 + 实测）

审计对象：`refactor/plugin-architecture`，HEAD = `c7fa10da`（审计中途 parent 落了这个 commit，本报告全部结论已在 c7fa10da 上重测过一次）。
实测环境：运行中的 8505 栈，`@playwright/test` 1.62.1 / chromium，两种视口：

- 手机 `393x850`、`hasTouch`、`isMobile`（`matchMedia("(pointer: coarse)")` 为 true，已断言）
- 桌面 `1280x900`（hover/fine 指针分支）

所有几何数字都是 `getBoundingClientRect()` + `getComputedStyle()` 穿透 shadow root 取到的实测值，不是从 CSS 推断的。

先说三条**干净**的结论（不是发现，是排除）：

1. `node scripts/audit-uiux-full.mjs` 在 13 面全部 PASS（触控地板 + 可见性），我没有新增触控尺寸类发现。
2. 填充控件（有自身不透明背景的按钮/链接）上的对比度：13 面逐面遍历，唯一低于 AA 的是 `project-dialog button.primary`（2.58:1），但它当时 `disabled=true`、`opacity=0.55`，属于禁用态豁免；启用态实测 `#fff` on `rgb(180,84,47)` = **4.94:1**，过线。**本轮没有填充控件对比度发现。**
3. `--pi-muted` 低于 AA 一事按要求不复报。

---

## F1 context-sheet：机器分区被 flex 压扁，第二台机器只剩 8.9px 的一条缝

- `src/client/src/components/appShell/ContextSwitcherSheet.ts:82`（`.sheet { max-height: 100%; overflow-y: auto; }`）
- `src/client/src/components/shared.ts:251`（列表组件 `:host { ... overflow: hidden; }`）
- `src/client/src/components/shared.ts:275`（`section { flex: 1 1 auto; min-height: 0; }`）
- 面：context-sheet
- 发现（几何陈述）：实测 393x850 coarse 下，`context-switcher-sheet machine-list` 高 **96.9px**，其内部 `machine-list div.list-body` 高 **80.9px**（`y=93..173.9`）。里面装的两行机器行各高 **60px**：`Local` 在 `y=99..159` 完整可见，`prod-8504` 在 `y=165..225` —— 落在滚动视口 173.9 的下沿，**只有 8.9px（14.8%）可见**。外层 `.sheet` 本身已经是 `overflow-y: auto` 的滚动容器，所以这次收缩没有换来任何东西：它只是把一个能滚的面拆成三个各自被挤扁的嵌套滚动器（`project-list` 592.8px、`workspace-list` 仅 **38.3px**，底部 "No workspaces here yet" 同样被腰斩）。
- 最小失败场景：手机上点顶部 scope chip 打开"Change context"，配置两台及以上机器。第二台机器只呈现为一条 8.9px 的色块加半颗活动圆点 —— 读起来像渲染残留，不像一行可点的机器；用户不会想到它可以在那 80px 的窗口里再滚一次。
- 置信度：高（坐标实测，两次运行一致；HEAD c7fa10da 重测仍复现）

## F2 model-picker：切到 "All models" 后行文字回落到浏览器默认字体（13.333px Arial），行高也从 55 掉到 52

- `src/client/src/components/ModelPicker.ts:279`（`button { border: 0; background: transparent; ... }` —— 没有 `font: inherit`）
- `src/client/src/components/ModelPicker.ts:293`（`.options > button { ... font: var(--pi-text-sm)/1.25 var(--pi-font-ui); ... }`）
- `src/client/src/components/ModelPicker.ts:300`（`.catalog-row .pick { flex: 1; min-width: 0; display: block; padding: ...; text-align: left; }` —— 无 font）
- 面：model-picker
- 发现（几何陈述）：`.catalog-row .pick` 不匹配 `.options > button`（它是 `.catalog-row` 的子级，不是 `.options` 的直接子级），组件内也没有兜底的 `button { font: inherit }`，于是命中 UA 默认 `font: 400 13.3333px Arial`。实测同一个弹层里：
  - "Enabled" 档：`.options > button` 行 **55.0px 高 / 13px / ui-sans-serif**
  - "All models" 档：`.catalog-row` 行 **52.0px 高 / `.pick` 51.0px / 13.3333px / Arial**（padding 两者都是 `10px 12px`）
  同一枚分段控件左右一拨，列表就换了一套字体和 3px 的行高。这正是第二轮记为"picker rows state their own type（no more UA Arial 13.3px）"的那类缺陷，目录分支没被扫到。
- 最小失败场景：打开模型选择器，点 "All models"，再点回 "Enabled" —— 同一个模型名（例如 `claude-opus-5`）在两档里字形、字宽和行距都不同，来回切一次就能看见列表整体"抖"一下。
- 置信度：高（实测两档字符串直接对比：`ENABLED row: 55.0px 13px ui-sans-serif` / `CATALOG row: 52.0px pick 51.0px 13.3333px Arial`）

## F3 关闭 "×" 已经统一了字号，但字体族和圆角仍是两套

- `src/client/src/components/ModelPicker.ts:280`（`header button { ... font-size: var(--pi-text-xl); ... }`，无 font-family、无 border-radius）
- `src/client/src/components/CommandPicker.ts:106`（同一条规则，同样缺两项）
- `src/client/src/components/QuickSwitcher.ts:403`（`.close { ... font-size: var(--pi-text-xl); ... }`，无 font-family、无 border-radius、无 hover、无 focus-visible）
- 对照组：`src/client/src/components/SettingsDialog.ts:765`（`button { ...; font: inherit; }`）+ `:766`（`.close-button { ... border-radius 来自 :765 的 --pi-radius-md }`）；`src/client/src/components/appShell/ContextSwitcherSheet.ts:85`（`border-radius: var(--pi-radius-md)`）
- 面：model-picker / thinking-picker / quick-switcher（缺陷侧）；settings / settings-appearance / context-sheet / add-project-dialog（正确侧）
- 发现（几何陈述）：手机上实测同一个 "×" 字形，同一个 44x44 的盒子，四种面里两套排版：
  - `model-picker button "×"` — 44x44，**20px Arial**，`border-radius: 0px`
  - `command-picker button "×"`（thinking-picker 面） — 44x44，**20px Arial**，`border-radius: 0px`
  - `quick-switcher button.close "×"` — 44x44，**20px Arial**，`border-radius: 0px`
  - `settings-dialog button.close-button "×"` — 44x44，20px ui-sans-serif，`border-radius: 8px`
  - `context-switcher-sheet button.sheet-close "×"` — 44x44，20px ui-sans-serif，`border-radius: 8px`
  - `project-dialog button "×"` — 44x44，20px ui-sans-serif，`border-radius: 8px`
  Arial 的 `×` 与 ui-sans-serif 的 `×` 字宽与笔画粗细不同；圆角 0 还意味着这三个控件的 hover/focus 底色（`quick-switcher` 里连 hover 都没写）会画成硬直角，与同屏所有 8px 圆角控件不成一族。
- 最小失败场景：手机上依次打开 设置 → 关闭，再打开 模型选择器 → 关闭。两枚"关闭"在屏幕同一角落、同一尺寸，字形却不同；给 `.close` 加 hover 底色时更明显（一个圆角一个直角）。
- 置信度：高（六个面逐一实测 computed `fontFamily` / `borderRadius`；源码侧可解释：`shared.ts:250` 的 `button, [role=button], input, select, summary { font: var(--pi-text-xs) var(--pi-font-ui); }` 才是本项目的 house pattern，这三个弹层没有等价规则）

## F4 quick-switcher 的行菜单 ⋯ 是 17px Arial，同一枚 ⋯ 在项目/会话列表里是 12px ui-sans-serif

- `src/client/src/components/QuickSwitcher.ts:467`（`.row-menu-toggle { ... font-size: var(--pi-text-lg); line-height: 1; ... }`，无 font-family）
- 对照组：`src/client/src/components/shared.ts:250` 给 listStyles 里所有 button 打了 `font: var(--pi-text-xs) var(--pi-font-ui)`
- 面：quick-switcher / qs-row-menu（缺陷侧）；boot / sessions（正确侧）
- 发现（几何陈述）：实测 `quick-switcher button.row-menu-toggle "⋯"` = 44x44 / **17px Arial**（5 个实例全部一致），而 `project-list button.action-menu-toggle "⋯"` = 36x36 / 12px ui-sans-serif、`session-list button.action-menu-toggle "⋯"` = 44x46.5 / 12px ui-sans-serif。同一个"行菜单"语义的省略号，在两处相差 **5px 字号 + 一个字体族**。Arial 的 U+22EF/U+2026 与 ui-sans-serif 的点间距不同，17px 下点会明显更大更散。
- 最小失败场景：手机上先在会话列表看一行的 ⋯，再打开快速切换器看同一个会话卡片的 ⋯ —— 两枚点阵大小与疏密不同；两个面之间来回切换时 ⋯ 会"变胖"。
- 置信度：高（实测；且同文件里 `.row`:411、`.machine-tab`:441、`.chip`:447、`.row-menu button`:478、`footer button`:507 都显式写了 `font: inherit`，只有 `.close`:403 和 `.row-menu-toggle`:467 漏了 —— 是漏项而非设计）

## F5 settings 详情页（coarse 指针）：关闭键中线比返回键低 4px，因为补偿 margin 没有在触控尺寸下撤销

- `src/client/src/components/SettingsDialog.ts:778`（`@media (pointer: coarse) { .close-button { width/height: var(--pi-control-height-touch); } }`）
- `src/client/src/components/SettingsDialog.ts:794`（`.close-button { margin-top: calc((var(--pi-control-height-touch) - var(--pi-control-height-comfort)) / 2); }`）
- `src/client/src/components/SettingsDialog.ts:795`（`.settings-back { min-height: var(--pi-control-height-touch); ... }`）
- 面：settings-appearance（settings 详情页，任一子页同样）
- 发现（几何陈述）：`:794` 的补偿量是 `(44-36)/2 = 4px`，它是为 **36px 的 comfort 尺寸**算的：36 高的关闭键要和 44 高的返回行共享中线，就得下移 4px。但这条规则的媒体条件是 `(pointer: coarse), (max-width: 760px)`，而 `:778` 已经在 coarse 下把关闭键升到 **44x44**。两条规则在手机上同时命中，补偿就成了净偏移。实测 393x850 coarse：`button.settings-back` box=`4,12,74.3,44` → **cy = 34.0**；`button.close-button` box=`337,16,44,44` → **cy = 38.0**。差 **正好 4.0px**。在 fine 指针 + 窄窗（≤760px）下补偿是对的（36 高 → cy 34.0），所以这是一条只在手机上错的修复。
- 最小失败场景：手机开设置 → 点 "Appearance" 进详情 → 顶栏左边是 "‹ Settings"、右边是 "×"，两者不在一条水平线上，差 4px（在 44px 高的行里肉眼可辨）。
- 置信度：高（实测 cy 差值与规则算出的 4px 逐位吻合）

## F6 settings-appearance："Follow the system" 的复选框中线比标题中线低 5.5px

- `src/client/src/components/settings/SettingsAppearancePanel.ts:123`（`.follow { display: flex; align-items: flex-start; ... }`）
- `src/client/src/components/settings/SettingsAppearancePanel.ts:124`（`.follow input { width/height: var(--pi-checkbox-size); margin: var(--pi-space-1) 0 0; }`）
- 面：settings-appearance
- 发现（几何陈述）：`align-items: flex-start` + `margin-top: 2px`。方框现在是 **24px**（`--pi-checkbox-size`），标题行 `.follow-title` 的行盒只有 **17px**。要和第一行文字共享中线，方框应当**上提** `(17-24)/2 = -3.5px`；现在反而**下压 2px**，净误差 **5.5px**。实测：`input` box=`23,232.6,24,24` → cy=**244.6**；`span.follow-title` box=`57,230.6,313,17` → cy=**239.1**。那个 `--pi-space-1`（2px）是 16px 方框时代的补偿，方框换成 24px 后没跟着改。
- 最小失败场景：手机 → 设置 → Appearance。"Follow the system" 这行里方框明显偏低，卡在标题和副标题之间，像是对齐到了两行的中间又没对准（块中线在 256.9，方框在 244.6，两边都不是）。
- 置信度：高（实测；`--pi-checkbox-size` 是第四轮才推广的 token，这条 margin 是它的遗留）

## F7 chat-drawer：抽屉正文没有左右天沟，goals 的状态圆点贴在 x=0，刷新键右边贴到 x=393

- `src/client/src/components/ChatView.ts:160`（`.drawer-body { flex: 0 1 auto; min-height: 0; display: flex; flex-direction: column; }` —— 无 padding）
- `src/client/src/components/ChatView.ts:1120`（`<div class="drawer-section-panel" ...>` —— 该类在整个组件样式里没有任何规则）
- `src/client/src/components/ChatView.ts:133`（`.drawer-header { ... padding: var(--pi-space-2) var(--pi-space-4); }`）
- `pi-web-plugins/goals/goalsSectionElement.ts:13`（`.goal-row { ... padding: var(--pi-space-3) 0; }` —— 横向 padding 为 0）
- 面：chat-drawer（同一分区在 sessions 面的左栏下方也复现）
- 发现（几何陈述）：抽屉的头和身不共享左边界。实测 393 宽：`header.drawer-header` 里 `div.drawer-tabs-frame` 从 **x=8** 开始、`div.drawer-header-actions` 到 **x=385** 结束（左右各内缩 8px）；而 `div.drawer-body` 下面 `pi-web-goals-section div.goal-row` box=`0,105,393,61`，其 `span.dot` box=**`0,117,8,8`** —— 8px 的状态圆点整个贴死在视口左边缘，`button.refresh` box=**`349,111,44,44`** —— 右边缘正好落在 393。头部内缩 8px、正文内缩 0px，同一个抽屉里两条不同的左边界；而且状态点是圆的，贴边时视觉上像被切了一半。
- 最小失败场景：手机上打开某个带 goal 的会话 → 展开抽屉 "Goals"。橙色状态点紧贴屏幕左沿（在带圆角边框的手机上会被硬件圆角吃掉），刷新键紧贴右沿；上一行的 "Goals" 标签却从 8px 起。
- 置信度：高（实测坐标；`.drawer-section-panel` 无样式、`.goal-row` 横向 padding 为 0，两侧源码都确认了没有任何一层负责这个天沟）

## F8 chat / msg-row-menu：消息头图标行的节奏是 20px / 8px 两段，且 ⧉ 的粗指针热区压住 ⓘ 2px

- `src/client/src/components/ChatView.ts:384`（`.msg-header-trailing { ... gap: var(--pi-space-4); }` = 8px，coarse 下未抬升）
- `src/client/src/components/ChatView.ts:385`（`.msg-actions { ... gap: var(--pi-space-3); }` = 6px）
- `src/client/src/components/ChatView.ts:389`（`.msg-action::after { position: absolute; inset: -10px -3px; }`）
- `src/client/src/components/ChatView.ts:390`（`@media (pointer: coarse) { .msg-actions { gap: var(--pi-space-8); } .msg-action::after { inset: -10px; } }`）
- `src/client/src/components/ChatView.ts:405`（`@media (hover: none) { .msg-meta:not(.expanded) { display: inline-grid; width: 26px; height: 24px; ... } }`）
- 面：chat / chat-drawer / msg-row-menu
- 发现（几何陈述）：coarse 下同一行三枚 24x24 图标控件，间距不等 —— 实测 x 区间 `↻ = 276..300`、`⧉ = 320..344`、`ⓘ(msg-meta) = 352..376`：**动作与动作之间 20px（`--pi-space-8`），最后一个动作到 ⓘ 只有 8px（`--pi-space-4`）**。同一条视觉行里 20 : 8 的两段节奏，ⓘ 会读作"挤在 ⧉ 旁边"。
  更硬的一条：`⧉` 的热区扩展是 `inset: -10px`，即 **310..354**；`ⓘ` 的盒子从 **352** 开始，两者**重叠 2px**，而 `::after` 是定位元素、`msg-meta` 是静态 span，定位元素画在上面 —— ⓘ 左侧 2px 的点击会打开复制而不是展开元数据。第二轮修的是"动作与动作"的热区重叠，这一处是"动作 vs 元数据"的同类漏项。
  另注：`:405` 的 `width: 26px; height: 24px` 是两个字面量，落在 controlHeightScale 守卫区间（28–44）之外，所以守卫看不见；实测因为同规则里的 `max-width: var(--pi-space-9)`（24px）把宽度截成 24，26 这个数从来没生效过 —— 是一条死值。
- 最小失败场景：手机上打开任一会话，在助手消息头部靠右缘点 ⓘ 的最左边 2px：拿到的是复制动作。或者纯看排版：`↻ ⧉` 之间空 20px，`⧉ ⓘ` 之间空 8px。
- 置信度：高（三个 x 区间实测，重叠区可算；HEAD c7fa10da 上复测坐标不变）

## F9 boot / sessions（桌面）：分隔线两侧的两条顶栏高 45px 与 53px，控件中线 22.0 与 26.0

- `src/client/src/components/appShell/AppNavigationPanel.ts:457`（`header { min-height: var(--pi-panel-header-height); ... border-bottom: 1px ...; }`）
- `src/client/src/components/appShell/AppNavigationPanel.ts:458`（`header button { height: var(--pi-panel-header-control-height); ... }`）
- `src/client/src/components/appShell/AppContextBar.ts:70`（`.context-bar { ... padding: var(--pi-space-2) var(--pi-space-3); border-bottom: 1px ...; }`）
- `src/client/src/components/appShell/AppContextBar.ts:72`（`.panel-toggle { width/height: var(--pi-control-height-touch); border-radius: var(--pi-radius-lg); }`）
- 面：boot / sessions / chat（桌面 1280 宽，两栏并排时）
- 发现（几何陈述）：第三轮把 `--pi-panel-header-height` 与它容纳的控件高度对齐了（"rail and drawer share one rule"），但右侧的 context bar 不在这条规则里 —— 它用的是 `padding 4px + 44px 控件 + 1px 下边框 = 53px`。实测 1280x900：
  - `app-navigation-panel header` box=`0,0,340,45`；里面 `strong "PI WEB"` cy=**22.0**、`button.header-icon-action`（齿轮）box=`228.6,0,34,44` cy=**22.0**、`button "Actions"` box=`270.6,0,57.4,44` cy=**22.0**
  - `app-context-bar nav.context-bar` box=`341,0,938,53`；里面 `button.panel-toggle` box=`347,4,44,44` cy=**26.0**、`button.session-title "Sessions"` cy=**26.0**
  两条顶栏在同一条分隔线两侧，高度差 **8px**，内容中线差 **4px**：应用标题和会话标题并排，一个坐 22 一个坐 26。
  同一行上还有两处不成族：图标尺寸 **16x16**（齿轮 `AppNavigationPanel.ts:460`）对 **20x20**（汉堡 `AppContextBar.ts:75 .toggle-icon`）；圆角 **8px**（齿轮，来自 `AppNavigationPanel.ts:501` 的 `button` 基线）对 **12px**（`panel-toggle`，`--pi-radius-lg`）。齿轮盒还是 **34x44**（非正方），因为它靠 `padding: 0 8px` + 16px 图标算宽度，而汉堡是显式 44x44。
- 最小失败场景：桌面打开应用，视线沿顶栏从左扫到右：过了面板分隔线，标题和按钮整体下沉 4px，右侧那条栏还比左侧高 8px；两枚图标按钮一个 16px 图标一个 20px 图标。
- 置信度：高（全部实测；`--pi-panel-header-height` = 44 与 `.context-bar` 的 4+44+4+1 = 53 可逐项对上）

## F10 boot：上下文切换器的 "+" 与面板头的 "Actions" 落回浏览器默认字体

- `src/client/src/components/appShell/AppContextSwitcher.ts:107`（`.chip { ... font: inherit; ... }` —— 正确侧）
- `src/client/src/components/appShell/AppContextSwitcher.ts:115`（`.add { ... font-size: var(--pi-text-lg); line-height: 1; ... }` —— 只写了字号）
- `src/client/src/components/appShell/AppNavigationPanel.ts:458`（`header button { ... font-size: var(--pi-text-xs); }` —— 只写了字号）
- 面：boot / sessions / settings / quick-switcher / context-sheet / add-project-dialog（桌面下这条栏一直在）
- 发现（几何陈述）：实测 1280x900：`app-context-switcher button.chip` = 14px **ui-sans-serif**，紧贴它、共用同一个 `.seg` 边框的 `app-context-switcher button.add "+"` = 17px **Arial**。两枚控件在同一个 12px 圆角的分段盒里（`div.seg` box=`10,53,102.7,44`，chip `11,54,64.7,42`，add `75.7,54,36,42`），只隔一条 1px 竖线，却是两种字体。同一栏上方 `app-navigation-panel button "Actions"` = 12px **Arial**，而它左边的 `strong "PI WEB"` = 14px ui-sans-serif。
  `shared.ts:250` 已经为列表类组件建立了 `button, [role=button], input, select, summary { font: var(--pi-text-xs) var(--pi-font-ui); }` 这条 house pattern；这两个 appShell 组件没有等价规则。
- 最小失败场景：桌面 boot 面，看 "Local | + | Project | + | Workspace" 这条分段栏：两枚 "+" 的字形和字重与相邻 chip 文字不是同一族（Arial 的 + 横竖更细、更窄）。
- 置信度：高（computed fontFamily 实测；与 F2/F3/F4 同源，都是"缺 `font: inherit` 兜底"这一类）

## F11 嵌套圆角不同心：卡内卡的内弧比"外弧减内边距"大 6–8px

- `src/client/src/components/settings/SettingsAppearancePanel.ts:128`（`.theme { padding: var(--pi-space-5); border-radius: var(--pi-radius-lg); }` = padding 10 / r 12）
- `src/client/src/components/settings/SettingsAppearancePanel.ts:144`（`.preview { padding: var(--pi-space-4); border-radius: var(--pi-radius-md); }` = padding 8 / r 8）
- `src/client/src/components/settings/SettingsAppearancePanel.ts:145`（`.preview-surface { ... border-radius: var(--pi-radius-sm); }` = r 6）
- `src/client/src/components/QuickSwitcher.ts:477`（`.row-menu { padding: var(--pi-space-3); border-radius: var(--pi-radius-lg); }` = padding 6 / r 12）
- `src/client/src/components/QuickSwitcher.ts:478`（`.row-menu button { border-radius: var(--pi-radius-md); }` = r 8）
- 正确的反例：`src/client/src/components/ModelPicker.ts:274`（`.scope-toggle { padding: var(--pi-space-2); border-radius: var(--pi-radius-md); }` = padding 4 / r 8）+ `:275`（`.scope-toggle button { border-radius: var(--pi-radius-xs); }` = r 4）—— 8 − 4 = 4，同心
- 面：settings-appearance / qs-row-menu（缺陷侧）；model-picker（正确侧）
- 发现（几何陈述）：同心嵌套圆角的条件是 `内半径 = 外半径 − 间距`。实测：
  - 主题卡：`button.theme` box=`12,326.2,180.5,185.2` r=**12px**，内边距 10px，内层 `span.preview` box=`23,337.2,158.5,82` r=**8px**。应为 12−10=**2px**，多了 6px。
  - 预览盒：`.preview` r=8、内边距 8px，内层 `span.preview-surface` box=`32,346.2,140.5,39` r=**6px**。应为 8−8=**0px**，多了 6px。
  - 行菜单：`div.row-menu` box=`208,478,174,150` r=**12px**，内边距 6px，条目 button box=`215,485,160,44` r=**8px**。应为 12−6=**6px**，多了 2px。
  这个项目在圆角上有过"五次同一投诉"的记录（`ChatView.ts:272` 的注释），并且已经在 `.scope-toggle` 上写对了一次 —— 所以这里有房规，只是没有被贯彻。
- 最小失败场景：手机 → 设置 → Appearance，看任意一张主题卡：卡片外弧接近直角感（12px 大弧），里面的预览缩略图在离外弧 10px 处却也画着 8px 的大弧，两条弧线不平行，四角看起来"多了一层"。行菜单打开时同样。
- 置信度：中高（几何关系与实测数值确凿；"是否达到需要修的可见程度"属于产品判断，2px 那条尤其边缘 —— 主张是把三处都推到与 `.scope-toggle` 一致的推导式，而不是继续手挑数字）

## F12 chat（hover 指针）：msg-meta 静止态实测 1.37:1 —— 第四轮的可读性修复只落在 `hover: none` 分支

- `src/client/src/components/ChatView.ts:397`（`.msg-meta { ... opacity: .28; color: var(--pi-dim); ... }`）
- `src/client/src/components/ChatView.ts:398`/`:399`（focus-within / hover 时才 `opacity: 1`）
- `src/client/src/components/ChatView.ts:404`（`@media (hover: none) { .msg-meta { opacity: 1; color: var(--pi-muted); ... } }` —— 第四轮的修复只在这个分支）
- 面：chat / chat-drawer / msg-row-menu（桌面 / 任何 hover 指针）
- 发现（几何陈述）：桌面 1280x900 实测两条 `span.msg-meta`：
  - `"Sep 9, 2026, 2:06:26 AM"` — fg `rgb(118,115,105)`、有效背景 `rgb(243,226,217)`、祖先 opacity 链 **0.28**，合成后 **1.37:1**
  - `"Sep 9, 2026, 2:06:49 AM · …"` — 背景 `rgb(236,236,236)`，**1.39:1**
  第四轮记为"msg-meta 已可读（原 2.55:1）"，但那次改动（`git show 509bfcf0` 里 `.msg-meta { opacity: .75 → 1; color: --pi-muted }`）在 `@media (hover: none)` 块内，`:397` 的桌面基线仍是 `.28`。也就是说桌面上这行时间戳一直是可见但读不出来的状态 —— 与旁边 `opacity: 0`（完全不画）的 `.msg-actions` 不是同一种"待揭示"语义。
- 最小失败场景：桌面打开任一会话，不要把鼠标放到消息上：每条消息右上角都有一行灰得看不清的时间戳。鼠标一悬停它才变清楚。要么它是隐藏态（应当像 `.msg-actions` 一样 opacity 0），要么它是常驻信息（应当过 AA），当前两者都不是。
- 置信度：中（数值实测确凿；"揭示式弱化算不算对比度缺陷"是产品语义，需 owner 裁定。我把它列出来是因为第四轮的结论是"已修"，而实测显示修复只覆盖了一半分支 —— 至少这句结论要更正）

## F13 goals 插件的 `.refresh:hover` 没有包在 `@media (hover: hover)` 里

- `pi-web-plugins/goals/goalsSectionElement.ts:23`（`.refresh:hover { color: var(--pi-text); background: var(--pi-surface-hover); }`）
- 对照组：同文件 `:22` 已经写了 `@media (pointer: coarse)`；`ChatView.ts:175`、`QuickSwitcher.ts:412/469`、`shared.ts:287` 等全项目一致地把 hover 规则包进 `@media (hover: hover)`
- 面：chat-drawer / sessions（goals 分区出现的两处）
- 发现（几何陈述）：这是同族里唯一一条裸 `:hover`。触屏上点一次刷新后，`:hover` 会粘住 —— 44x44 的按钮会一直带着 `--pi-surface-hover` 底色，读起来像"这个按钮被选中了/仍在忙"。同一抽屉里的 `.drawer-control`（`ChatView.ts:175`）行为正确，两者相距 40px。
- 最小失败场景：手机上展开 Goals 抽屉，点一次右边的 ↻，然后手指移开：按钮保持高亮底色直到点了别处。
- 置信度：中高（源码事实确凿且与全项目模式冲突；粘滞 hover 的实际观感我没有在真机触屏上录到，Playwright 的 `isMobile` 仿真不复现指针粘滞，标注为源码级发现）

## F14（次要，打包）尺度逃逸与死规则

- `src/client/src/components/settings/SettingsAppearancePanel.ts:144` / `:157`：`.preview { height: 74px }` / `@media … { .preview { height: 64px } }` —— 两个裸像素高度。它们大于 44，落在 `controlHeightScale.test.ts` 的 28–44 区间之外，所以守卫看不见；但这是一个组件里唯一两处不读 token 的尺寸。
- `src/client/src/components/ChatView.ts:405`：`.msg-meta:not(.expanded) { width: 26px; height: 24px; }` —— 26 被同规则的 `max-width: var(--pi-space-9)`（24px）截掉，实测宽度恒为 24；即字面量本身是死值（见 F8）。
- `src/client/src/components/QuickSwitcher.ts:488`：`@media (pointer: coarse) { .row-menu-toggle { width: var(--qs-menu-size); min-height: var(--qs-menu-size); } }` —— 与 `:467` 的基线声明逐字相同，`--qs-menu-size` 已在 `:392` 按指针类型换过值，这条 coarse 覆盖是空操作。
- `pi-web-plugins/workspaces/browser/ProjectDialog.ts:336`：`.check { display: flex; grid-template-columns: auto 1fr; align-items: center; }` —— flex 容器上留着 grid 时代的 `grid-template-columns`，是一条永远不生效的残留声明（该行的 6px 间距实际来自 `:333` 的 `label { gap: var(--pi-space-3) }`）。
- `src/client/src/components/QuickSwitcher.ts:430`：`.row-flag, .row-state { bottom: var(--pi-space-4); right: var(--pi-space-6); }` 上方注释写着状态标记"sits under the corner menu button"，但实测状态点中心 cx=**365.0**、行菜单按钮中心 cx=**360.0**，差 **5px**；第二轮已经为 tile 建立过"活动点与菜单按钮共享中线"的规则，这里没有跟上。
- 面：settings-appearance / chat / quick-switcher / add-project-dialog
- 最小失败场景：都属于"下一次改动会踩到"的类型，单独看不构成可见缺陷；`.row-state` 那条在两列卡片布局下最明显（点比 ⋯ 靠右 5px，右边界不成一列）。
- 置信度：中高（全部源码可验，`.row-state` 的 5px 为实测）

---

## 总结

TOTAL: 14 findings（F1–F13 为独立发现，F14 为 5 条次要项的打包）。

按类别归位（对照本轮的猎取清单）：

- **图标/字形在控件中的几何居中**：F6（复选框低 5.5px）、F5（关闭键低 4px）、F9（齿轮 34x44 非正方、图标 16 vs 20）
- **图标+文字行的对齐**：F7（抽屉头身两条左边界 8 vs 0）、F9（两条顶栏中线 22 vs 26）、F14（状态点 vs 菜单中线差 5px）
- **同级控件高度/内边距不等**：F2（同一弹层两档行高 55 vs 52）、F3（关闭键圆角 0 vs 8）、F1（同一列表两行 60 vs 8.9 可见）
- **节奏断裂**：F8（20px / 8px 两段）、F1（三层嵌套滚动器）
- **尺度逃逸**：F11（圆角不同心）、F14（74/64px、26px 死值、空 coarse 规则）
- **UI 状态用裸文本而非标记**：本轮未发现新的（第四轮的 badge/mark 收口在 13 面上都成立）
- **填充控件对比度低于 AA**：**0 处**（逐面实测，唯一命中项为禁用态豁免）

一条结构性建议：F2/F3/F4/F10 是同一个缺陷的四个实例 —— **一个 shadow root 里的 `button` 没有兜底的 `font: inherit`（或 `shared.ts:250` 那条基线规则），就会静默回落到 UA 的 `400 13.333px Arial`**。本轮新加的 `typeScale.test.ts` 守卫盯的是 `font-weight` 字面量和 `:disabled` 的 opacity，看不见"缺字体族"。建议加一条与既有守卫同形的规则：**任一 `static styles` 里出现了 `font-size:` 而该组件没有为 `button`（或该选择器）声明 `font-family` / `font:` / `font: inherit`，就在 CI 失败**。第二轮已经因为同一原因修过 picker 行（"no more UA Arial 13.3px"），第五轮又在 6 个控件上复发；这正是项目规则里"同一症状报告两次就停止打补丁、改为枚举全部生产者"的场景。

## 复现方式

所有数字可由下列方式复现（均在 HEAD `c7fa10da` 上跑过）：

- 触控地板/可见性基线：`node scripts/audit-uiux-full.mjs`（当前 PASS）
- 逐面几何：以 `scripts/audit-uiux-full.mjs` 中的 `OPENERS` 驱动 13 个 drill，在 393x850 `hasTouch/isMobile` 与 1280x900 两种视口下穿透 shadow root 采集 `getBoundingClientRect()` + `getComputedStyle()`
- context-sheet 需要额外一步：13 个 drill 里的 `contextSheet` opener 用的是文本启发式，实际点中的是手机项目列表而非切换面；正确的入口是点 `app-navigation-panel .compact-scope`（本报告 F1 用的是后者）
- 对比度：自写的合成器（沿 parent + shadow host 链累乘 opacity、逐层 alpha 合成背景），AA 阈值按字号/字重区分 4.5 与 3.0
