# UI/UX 第四轮收敛审计 — Lane C（13 个界面全量 + 真机实测）

审计对象：分支 refactor/plugin-architecture，HEAD 64045ac4（`Fix the receipts, hints and controls lane C measured`）。

## 方法与证据来源

本 lane 以“实测优先”执行：复用 `scripts/audit-uiux-full.mjs` 的 13 个 drill/opener（boot、sessions、chat、chat-drawer、msg-row-menu、model-picker、thinking-picker、settings、settings-appearance、quick-switcher、qs-row-menu、context-sheet、add-project-dialog），替换其度量段，在运行中的 8505 栈（http://127.0.0.1:8505，返回 200）上跑了 7 个度量探针，两种指针档位：

- coarse：393x850、hasTouch、isMobile（`(pointer: coarse)` 已校验）
- fine：1280x900、无 touch

探针脚本与原始数据（均为 /tmp 下的未跟踪草稿，未污染仓库）：

- `/tmp/lane-c-probe.mjs` → `/tmp/lane-c-metrics.json`：每个可交互控件的 rect、padding、border、radius、font-size/weight、min-height、单 svg 图标 rect、文字 ink rect（Range 并集）、逐层合成后的有效背景与对比度；以及“同一父节点下多个按钮兄弟”的分组表（26 个 profile/surface 组合，共 2500+ 控件样本）
- `/tmp/lane-c-probe2.mjs` → `/tmp/lane-c-text.json`：所有承载直接文本节点元素的 computed font-family/size/weight（用于抓 UA 回退）
- `/tmp/lane-c-probe3.mjs` → `/tmp/lane-c-dots.json`：所有 <=24px 且圆形且有涂色的状态点（点阶逃逸检查）
- `/tmp/lane-c-probe4.mjs` → `/tmp/lane-c-contrast.json`：把祖先链 opacity 累乘后再做 alpha 合成的对比度（这是第三轮“用 0.75 图层压暗”缺陷类的检测器）
- `/tmp/lane-c-probe5.mjs` → `/tmp/lane-c-align.json`：所有 `display:flex; flex-direction:row; align-items:center` 容器内子项 ink 中线的散布（图标+文字行对齐）
- `/tmp/lane-c-probe6.mjs`：settings 手机详情页 header 的逐元素精确 rect/ink
- `/tmp/lane-c-probe7.mjs`：quick-switcher 行标题的 scrollHeight vs clientHeight（2 行钳制是否切掉状态文字）
- `/tmp/lane-c-glyph.mjs`：canvas measureText 对比 Arial 与 ui-sans-serif 的同串宽度
- `/tmp/lane-c-theme.mjs`：确认实测时的活动主题与 token 取值

覆盖度如实说明：13 个界面在 coarse 档位全部成功打开并度量；fine 1280x900 档位下 context-sheet 的 opener 报 no context trigger（桌面宽度不渲染该手机上下文表单），因此该界面只有 coarse 一档的数据，其余 12 个界面两档齐全。此外主题卡、行钳制等结论只在当前已安装的主题包/数据集下实测，未跨主题重复。

实测时的活动主题：`themes:clay-paper`（默认 clay 配对在 prefers-light 下的浅色一支），`--pi-muted: #6b6860`、`--pi-accent: #b4542f`、`--pi-dim: #767369`、`--pi-selection-bg: #f3e2d9`、`--pi-surface-card: #ececec`。

先行核验（未列为发现，已确认修好）：

- 单 svg 图标控件的几何居中：0 例偏差 >0.6px（全 26 个 profile/surface 组合）。
- svg 图标 + 文本同行的竖向中线：0 例偏差 >1.0px。
- 单字形控件（×、⋯、↻、+、⟲、☑）在其控件盒内的居中：最大偏差 0.5px（`msg-action`、`refresh` 等的 -0.5px 来自 lh 与字形 ink 的固有差），无实际偏心。
- 可见状态点尺寸：仅出现 8px（`--pi-dot-md`），无第四种尺寸。
- 触控档位下带无障碍名的控件文本/填充控件：无低于 AA 的（opacity 未计入的口径）——真正的问题都出在 opacity 图层与主题 token 取值上，见 F6/F10/F11。

---

## F1 外观面板主题卡在同一网格里高出 15.4px，卡片高度不再一致

- src/client/src/components/settings/SettingsAppearancePanel.ts:77（`.theme-scheme` 里追加 `themeCardSuffix(...)` 散文）、:137（`.theme-scheme, .theme-description { font-size: var(--pi-text-2xs); }`）、:140（只有 `.theme-description` 被 `-webkit-line-clamp: 2` + `min-height: calc(2 * 1.4em)` 钳制）；src/client/src/themeCardLabel.ts:14-18（`themeCardSuffix` 返回 ` · chosen, but following your system` / ` · in use`）
- surface: settings-appearance
- finding（几何陈述）：同一个 `.theme-grid`（:127，`repeat(auto-fill, minmax(180px, 1fr))`）里 8 张卡实测高度为 6 张 185.19px + 2 张 200.58px（coarse 393x850），fine 1280x900 为 6 张 195.19px + 2 张 210.58px；差值 15.39px 恰等于 `.theme-scheme` 那一行（11px 字号、line-height 1.4 → 15.4px）多折出的一行。多出来的两张正是 Clay（文案 `Dark · chosen, but following your system`）与 Clay Paper（`Light · in use`）。描述行做了 2 行钳制并预留了 min-height，紧邻它上面的 scheme 行既没钳制也没预留高度，于是“被选中/正在使用”这两种状态一出现就把卡片顶高。这正面违反 :138-139 自己写下的注释（`Cards in a grid share a height`）与项目规则“Grid tiles share a height”。
- minimal failure scenario：打开 设置 → 外观（默认 clay 配对 + Follow the system 打开、系统偏好浅色）。第 7、8 张卡（Clay / Clay Paper）比同行前 6 张高 15.4px，网格行内出现台阶；把 Follow the system 关掉，`chosen, but following your system` 消失，台阶随之消失——即卡片高度由状态文案长度决定。
- confidence：高（两个指针档位各 8 张卡的实测高度，差值与行高吻合；源码里钳制只覆盖 description 一行）

---

## F2 quick-switcher 的会话行/页脚/关闭键整块掉回 UA Arial 13.333px，同一个会话名在两个界面是两种字体

- src/client/src/components/QuickSwitcher.ts:412（`.row` 未声明任何 font/font-family）、:418（`.row-title` 只给 `font-size: var(--pi-text-md)`）、:419（`.row-subtitle` 只给 `font-size`）、:404（`.close` 只给 `font-size`）、:465（`.row-menu-toggle` 只给 `font-size`）、:502（`footer button` 完全不给字体）；对照 src/client/src/components/QuickSwitcher.ts:439 与 :445（`.machine-tab`/`.chip` 写了 `font: inherit; font-size: ...`，因此正确继承 `--pi-font-ui`）
- surface: quick-switcher、qs-row-menu
- finding（几何陈述）：`:host` 在 :392 设了 `font: var(--pi-text-base) var(--pi-font-ui)`，但 UA 的 `button { font: 400 13.3333px Arial }` 是作用在按钮元素上的，`.row` 没有 `font: inherit` 就切断了继承链；其子 span 只覆盖 size，family 仍为 Arial。实测 computed：`.row`=13.3333px Arial，`.row-title`=15px Arial，`.row-subtitle`=12px Arial，`footer button`=13.3333px Arial，`.close`=20px Arial，`.row-menu-toggle`=17px Arial；同一时刻 session-list 的 `session-title-text` 与 `action-name` 都是 14px ui-sans-serif。canvas measureText 实测：同串 `Write a 500-word story` 在 15px 下 Arial=150.61px、ui-sans-serif=139.78px，宽 7.7%；20px 下 200.81 vs 186.38。也就是说 quick-switcher 每个标题的可用字符数比列表页少约 7%，且字形与全 app 不同。（注意 typeScale 的机械守卫 src/client/src/components/typeScale.test.ts:19-21 只扫描“已声明的像素字面量”，“完全不声明字体”这条逃逸路径它抓不到。）
- minimal failure scenario：在 chat 里按打开会话选择器（quick switcher），与左侧 session-list 并排截图对比同一个会话名：quick-switcher 里是 Arial（字母 a/g 形态与列表页不同），且 60 个标题里 13 个被 2 行钳制切断（`/tmp/lane-c-probe7.mjs` 实测 scrollHeight 59 > clientHeight 39），（其中有多少条是仅因 7.7% 字宽差而多折一行导致被裁，属推测，未逐条比对两种字体下的折行结果）。
- confidence：高（computed font-family 实测 + 同串宽度实测 + 源码缺声明）

---

## F3 quick-switcher 页脚唯一动作按钮的字号是 UA 的 13.333px，不在类型阶上

- src/client/src/components/QuickSwitcher.ts:502（`footer button { width: 100%; min-height: var(--pi-control-height-touch); ... }`，无 font/font-size）、:129（`<button @click=...>Browse machines and projects</button>`，无 class）
- surface: quick-switcher
- finding（几何陈述）：实测 computed font-size = 13.3333px，既不是 `--pi-text-sm`(13) 也不是 `--pi-text-base`(14)；同一对话框内 `.chip` 是 13px、`.row-title` 15px、`input` 17px。这个按钮是全宽 100%、min-height 44 的页脚主动作，是对话框里视觉权重最高的一条，却是唯一一个字号带 0.3333px 小数、无法随 token 迁移的控件。其 padding 也是 UA 的 1px/1px（实测 pt=1px、pb=1px），即它的内距同样没有走 `--pi-space-*`。
- minimal failure scenario：打开 quick switcher，把 devtools 里 `--pi-text-sm` 改成任意值：`.chip` 跟着变，页脚 `Browse machines and projects` 不变——它不在阶上。
- confidence：高（实测 computed 值 + 源码无声明）

---

## F4 五个模态的关闭键在鼠标档位是四种尺寸，其中两个低于 32px 控件高度且低于 24px AA 触达底线

- src/client/src/components/QuickSwitcher.ts:404 + :483（`.close` 只在 `@media (pointer: coarse)` 分支里拿到 44x44，基础规则没有尺寸）；pi-web-plugins/workspaces/browser/ProjectDialog.ts:374 + :375（`header button` 同样只有 coarse 分支给 44x44）；对照 src/client/src/components/SettingsDialog.ts:766 + :778（`.close-button` 基础 36x36、coarse 44x44）、src/client/src/components/ModelPicker.ts:280 + :288 与 src/client/src/components/CommandPicker.ts:106 + :119（`header button` 基础 32x32、coarse 44x44）
- surface: quick-switcher、add-project-dialog（对照 settings、model-picker、thinking-picker）
- finding（几何陈述）：fine 1280x900 实测同一动作（关闭对话框）的控件盒：settings `close-button` 36x36、model-picker 32x32、command-picker（thinking-picker 界面）32x32、quick-switcher `.close` 27.7x20、project-dialog `header button` 28x23，共 5 个模态、4 种尺寸。后两者的高度 20px 与 23px 同时低于 `--pi-control-height`(32) 与 24px AA 底线，且比同一 app 里的兄弟关闭键（settings 36x36）窄 8.3px、矮 16px。coarse 档位五者都是 44x44，所以这是一个只在鼠标档位存在的分裂——第一轮修的是 “picker close controls sized on both pointer types”（ModelPicker 已修），这两个漏掉了。附带：即使在合规的三个里，settings 用的是 comfort 36 而两个 picker 用的是 32，同一个“关闭模态”的动作在鼠标档位仍有 36/32 两种尺寸——是否要统一属 owner 的产品判断，此处只陈述实测差异。
- minimal failure scenario：桌面 1280 宽下打开 quick switcher，右上角 × 的可点区只有 27.7x20；随后打开 设置，同一位置的 × 是 36x36 —— 相邻两个模态的同一控件差 16px 高度。add-project 对话框（Add project → 打开添加项目对话框）同理为 28x23。
- confidence：高（fine 档位实测 rect + 源码里 coarse-only 的尺寸分支）

---

## F5 add-project 对话框在鼠标档位有 23/32/33/41 四种控件高度，全部不落在 32/36/44 阶上（除建议行）

- pi-web-plugins/workspaces/browser/ProjectDialog.ts:374（header 关闭键无尺寸）、:334（`input[type=text]` 只给 `padding: var(--pi-space-5)`，无 height/min-height）、:373（`button { padding: var(--pi-space-4) var(--pi-space-5) }`，无 min-height）、:355-368（`@media (pointer: coarse)` 与 `@media (max-width: 760px)` 里才有 `footer button { min-height: var(--pi-control-height-touch) }`）
- surface: add-project-dialog
- finding（几何陈述）：fine 1280x900 实测：关闭键 28x23、路径输入框 694x41（10+10 内距 + 19 行盒 + 2 边框）、建议行 692x32、页脚 `Cancel` 60.8x33 与 `Add project` 87.7x33。也就是一个对话框里出现 23 / 32 / 33 / 41 四种高度，只有建议行落在 `--pi-control-height`(32)；33px 是“比鼠标控件高度多 1px”的派生值，41px 与任何 token 都不对应。项目自己在 src/client/index.html:82-88 记录过这条教训（“leaving it unnamed is how 30, 34, 36, 38 and 40 all shipped as the same intention”）；:358-361 的注释说明 coarse 档位的 ~33px 已经被抬到 44，但 fine 档位的 33px 原样留下了。
- minimal failure scenario：桌面浏览器点 Add project，在同一屏里量：输入框 41px 高、下面建议行 32px、页脚两个按钮 33px、右上关闭键 23px——四个高度肉眼可见地互不对齐（页脚按钮比建议行高 1px 是典型的“差一点”观感）。
- confidence：高（fine 实测四组 rect + 源码只在 coarse/窄屏分支设底线）

---

## F6 触控档位的消息元信息 ⓘ 用 0.75 opacity 图层压暗，实测 2.55:1，低于 3:1 的非文本底线（第三轮已修缺陷类的复发）

- src/client/src/components/ChatView.ts:395（`.msg-meta { opacity: .28; color: var(--pi-dim); ... }`）、:402（`@media (pointer: coarse)` 下 `.msg-meta { opacity: .75; max-width: 26px; }`）、:403（`font-size: 0` 折叠原文）、:404（`::before { content: "ⓘ"; font-size: var(--pi-text-sm); }`）、:1777（`role="button"` + aria-label，即它是一个控件）
- surface: chat、msg-row-menu
- finding（几何陈述）：coarse 393x850 实测，用户消息头里的 ⓘ 控件：color `rgb(118,115,105)`（`--pi-dim` #767369）× 链路 opacity 0.75，合成后落在 `--pi-selection-bg` #f3e2d9 上 = 2.55:1；在 assistant 卡片（#ececec）上 = 2.66:1。它是 26x24 的可点控件里唯一的可视图形，按 WCAG 1.4.11 需要 3:1，按 13px 文本需要 4.5:1，两条都不过。fine 档位同一元素 opacity .28 → 1.37:1（鼠标可 hover 恢复到 1，触控没有 hover，所以 coarse 那一支是真实失效面）。这与第三轮已修的“idle activity dock 用 0.75 opacity 图层压暗（3.96:1）”是同一缺陷类，同一文件里换了个位置继续存在。
- minimal failure scenario：手机（或 393x850 coarse 模拟）打开任意会话，看用户消息右上角的 ⓘ：在浅色 clay-paper 主题下几乎与卡片同色；点开它才知道那里有个控件。把 :402 的 `opacity: .75` 换成一个更暗的颜色 token（如 `--pi-text-secondary`）即可通过。
- confidence：高（把祖先 opacity 累乘后合成的实测比值，两个 profile 各自复现；源码行号明确）

---

## F7 手机版设置详情页的关闭键卡在两行标题之间，与任何一行都不共中线

- src/client/src/components/SettingsDialog.ts:762（`.settings-header { display:flex; align-items:center; }`）、:204-210（详情 header = 两行的 `.settings-detail-heading` + 单个 `.close-button`）、:789（coarse 下 `.settings-detail-heading` 变成 `flex-direction: column`）、:790（`.settings-back { min-height: var(--pi-control-height-touch) }`）、:766/:778（`.close-button` 36 → coarse 44）
- surface: settings-appearance（settings 详情页；settings 列表页 header 只有一行标题，不受影响）
- finding（几何陈述）：coarse 393x850 精确实测（`/tmp/lane-c-probe6.mjs`）：header 高 93px、上下内距各 12px；`.settings-back` 控件盒 y=12..56，其文字 ink 中线 y=34；`h1`（Appearance）盒 y=56..80，ink 中线 y=67.5；`.close-button` 盒 y=24..68、字形 ink 中线 y=46。也就是 × 的中线比返回行低 12px、比标题行高 21.5px，正好压在两行的分界线（y=56）上——它跨在两行之间，与两者都不对齐。房规是“panel-header token 等于它所含控件的高度（rail 与 drawer 共用一条规则）”，这里 `align-items: center` 把单行控件对齐到了两行栈的几何中心。
- minimal failure scenario：手机档位打开 设置 → 外观。头部左侧是两行（‹ Settings / Appearance），右侧 × 悬在两行之间；用手指按“和 ‹ Settings 同一行的 ×”会落在 × 控件盒的上边缘 12px 处（仍在 44px 盒内，但视觉上它并不属于任何一行）。列表页的 header 里 × 与标题共中线，两屏之间来回切换时 × 的 y 位置会跳动。
- confidence：高（逐元素 rect/ink 实测，数值可复算：34 vs 46 vs 67.5）

---

## F8 “禁用/压暗”这一个产品含义散落成 .5/.52/.55 三种 opacity 字面量，且同一个 shadow root 内部就有两种

- src/client/src/components/QuickSwitcher.ts:414（`.row:disabled { opacity: .55 }`）与 src/client/src/components/QuickSwitcher.ts:494（`.row-menu button:disabled { opacity: .5 }`）——同一组件内两种；src/client/src/components/SessionTreeNavigator.ts:605（`.52`）；src/client/src/components/SessionCleanupDialog.ts:223（`.55`）与 :241（`.5`）；src/client/src/components/settings/SettingsGeneralPanel.ts:261/:279（`.55`）；src/client/src/components/SessionRenameDialog.ts:39（`.5`）；pi-web-plugins/workspaces/browser/ProjectDialog.ts:380（`.5`）；相邻的“非禁用压暗”还有 ChatView.ts:395（`.28`）、:402（`.75`）、SessionList.ts（`.65`）、AppPanelEdgeControl.ts（`.72`/`.75`）、ConversationMeter.ts（`.92`）等，共计 14 个不同取值
- surface: quick-switcher、qs-row-menu、sessions、settings、add-project-dialog、chat
- finding（几何陈述）：一个“不可用”的语义在多个 surface 上以 .5、.52、.55 三个亮度呈现，差值 5%~10%，落在同屏相邻控件上就是“两种灰”。最直接的例子是 quick-switcher：禁用的创建行是 55% 不透明度，而它右上角菜单里禁用的菜单项是 50%，两者可同屏出现。项目已经为控件高度（32/36/44）、点尺寸（4/6/8）、字重（400/500/600/650）、阴影层级命名了 ramp，并在 src/client/index.html:82-88（控件高度）与 :89-97（点阶） 记录了“不命名就会有 5 种同义值”的教训，而 opacity 这一支既无 token 也无机械守卫（typeScale/spacingScale/radiusScale/controlHeightScale/dotScale 都不覆盖它）。
- minimal failure scenario：在没有选中 workspace 的状态下打开 quick switcher（创建行禁用，opacity .55），再打开任意会话行的 ⋯ 菜单（其中禁用项 opacity .5）：同屏两个“禁用”亮度不同。改动 `.5` 一处不会带动其余 9 处以上的同义声明。
- confidence：高（源码逐行枚举，取值可直接读出；同组件内两值可同屏复现）

---

## F9 quick-switcher 用散文 “· main” 表达 workspace 状态，而它被 2 行钳制切掉（同组件其他状态都用标记）

- src/client/src/components/QuickSwitcher.ts:121（`<span class="row-title">${workspace.label}${workspace.isMain ? " · main" : ""}</span>`）、:418（`.row-title` `-webkit-line-clamp: 2; min-height: calc(2 * 1.3em)`）；对照同文件 :209（置顶用 `.pin-mark` 字形标记）、:428-434（`.row-flag`/`.row-state` 用 8px 圆点表达 unread/interrupted）
- surface: quick-switcher
- finding（几何陈述）：coarse 393x850、`.rows` 两列（`minmax(140px, 1fr)`）下行标题宽度实测 121px、可视高度 39px（2 行 × 1.3em × 15px）。实测 60 个标题中 13 个 scrollHeight > clientHeight；其中 workspace 行 `definitely-not-here-mt8psy31 · main` 的 scrollHeight = 59px（3 行）→ 第 3 行被裁掉，`· main` 整段不可见。于是“这是主 workspace”这个状态在长名字下静默消失，读者只能得到“不是主 workspace”的错误结论——恰好撞上项目规则“Absence is not negation”。同一组件里 unread 和 interrupted 用的是 8px 圆点标记（不占标题空间），pinned 用的是前置字形标记，只有 main-ness 是挤在被钳制文本里的散文。
- minimal failure scenario：在一个 workspace 名较长的项目里（实测被裁样本为 28 字符的 definitely-not-here-mt8psy31；具体阈值随字符宽度变化，此处为估算）打开 quick switcher（393 宽两列），主 workspace 的行标题被钳到 2 行，`· main` 落在第 3 行被裁；同一列表里另一个短名主 workspace 显示 `· main`。用户据此认为长名那个不是主分支工作区。
- confidence：高（scrollHeight/clientHeight 实测，含具体被裁样本；对照标记模式在同文件内）

---

## F10 --pi-muted 在默认浅色主题下对卡面是 4.42:1，全 app 的 11~12px 次要文本与图标字形集体低于 AA 0.08

- 消费点（本仓库）：src/client/src/components/SessionList.ts:276/:286 的 section-count / section-unread-count（样式见 src/client/src/components/shared.ts:302 `small { color: var(--pi-muted); font-size: var(--pi-text-2xs) }`，实测 11px、4.42:1）、src/client/src/components/shared.ts:430 与 :329 的 `.action-menu-toggle`（12px ⋯ 字形，color 为 --pi-muted，实测 4.42:1）、src/client/src/components/ModelPicker.ts:302 与 src/client/src/components/CommandPicker.ts:113 的 `small`（11px）、src/client/src/components/SettingsDialog.ts:787 `.settings-list-label small`（实测 11.67px）、src/client/src/components/appShell/AppContextSwitcher.ts:115（`.add` 的 +，17px，4.42:1）、src/client/src/components/settings/SettingsAppearancePanel.ts:122（`.muted`）
- surface: sessions、boot、model-picker、thinking-picker、settings、settings-appearance、chat、quick-switcher
- finding（几何陈述）：活动主题 `themes:clay-paper` 下 `--pi-muted = #6b6860`，对 `--pi-bg #faf9f5` 与 `--pi-surface-*` 系列实测一律 4.42:1，而这些消费点的字号是 11px / 11.67px / 12px（非粗体），AA 要求 4.5:1 —— 差 0.08，属于“系统性擦边不过”，去重后 7 类消费点（session-list 的 small 与 action-menu-toggle、model-picker/command-picker 的 small、settings-dialog 的 small、app-context-switcher 的 .add、chat-view 的 ↻/⧉ 字形），在 13 个被审界面中均有出现。注意 token 取值本身在外部主题包 `@gang-of-beads/pi-web-themes`（本仓库 .changeset/theme-pack-ships-separately.md 说明主题已外置），所以仓库内可选的收敛方式是：这些 11~12px 次要文本改读 `--pi-text-secondary`（实测 #4a4842 → 7.74:1），或为主题包补一条“muted 对 bg 必须 >= 4.5:1”的守卫。
- minimal failure scenario：默认安装（clay 配对 + 跟随系统 + 系统浅色）下打开 sessions，量任一行的 `32 messages`（11px，#6b6860 on #faf9f5）= 4.42:1；把窗口切到 model-picker 的选项描述、settings 列表项副标题，同一比值重复出现。
- confidence：中高（比值为实测，消费点为实测去重；判定为“发现”依赖当前默认主题包取值，修复归属可能落在主题包而非本仓库——此处按事实陈述，不代替 owner 决定归属）

---

## F11 用户消息的角色标签用 --pi-accent 画在 --pi-selection-bg 上，12px 实测 3.93:1（且 <b> 的粗体被 font: 简写抹掉）

- src/client/src/components/ChatView.ts:377（`.msg.user > .msg-header .label { color: var(--pi-accent); }`）、:375（该 header 背景 `var(--pi-selection-bg)`）、:393（`.label { color: var(--pi-muted); font: var(--pi-text-xs) var(--pi-font-mono); }`）
- surface: chat、msg-row-menu
- finding（几何陈述）：coarse/fine 实测同值：`user` 标签 color `rgb(180,84,47)`（#b4542f）on `rgb(243,226,217)`（#f3e2d9）= 3.93:1，字号 12px、字重实测 400 → AA 要求 4.5:1，不过；同屏的 `assistant` 标签 7.74:1、`events` 5.28:1，即三种角色标签的对比度分别是 3.93 / 5.28 / 7.74，最需要被认出的“我说的话”是最弱的一档。附带事实：模板里角色名是 `<b>`，但 :393 的 `font:` 简写把 font-weight 重置为 400（实测 computed font-weight = 400），所以这个 `<b>` 的语义强调在视觉上不存在——如果不需要粗体，元素应换成 span；如果需要，简写要带上 `--pi-weight-*`。
- minimal failure scenario：默认浅色主题下打开任意会话，把 `user` 与 `assistant` 两个标签并排看：前者 3.93:1（橙色贴在浅橙底上），后者 7.74:1。放大到 200% 也不会改变比值。
- confidence：中高（比值与 computed weight 为实测；与 F10 同样存在“token 取值属外部主题包”的归属问题，但这里的配对选择（accent 文本压在 selection-bg 上）是本仓库 ChatView.ts:375/:377 决定的）

---

## F12 quick-switcher 里“为什么这一行不可用”的唯一解释文字实测 2.14:1

- src/client/src/components/QuickSwitcher.ts:414（`.row:disabled { opacity: .55 }`）、:419（`.row-subtitle { color: var(--pi-muted); font-size: var(--pi-text-xs) }`）、:169-170（创建行的 .row-title / .row-subtitle；禁用条件见 :165，禁用时副标题为 Select a workspace first）
- surface: quick-switcher
- finding（几何陈述）：创建行禁用时，`.row-subtitle` = `--pi-muted #6b6860` × 0.55 链路 opacity，合成后落在 `#f6ece6` 上实测 2.14:1（12px），同行标题 3.91:1。禁用态在 WCAG 里可豁免对比度，但这条副标题不是装饰，它是唯一告诉用户“先选一个 workspace”的信息；把它压到 2.14:1 等于把补救指引一起关掉了（项目规则：unknown/refused 状态必须诚实可读）。这也是 F8 的具体代价：如果禁用压暗只作用在“可点起来的部分”，或副标题不参与压暗，解释就能读到。
- minimal failure scenario：在未选择 workspace 的项目下打开 quick switcher：`＋ New session` 行不可点，下面一行 12px 的 `Select a workspace first` 在浅色主题下几乎读不出，用户不知道下一步该做什么。
- confidence：中高（opacity 累乘后的合成比值为实测；“禁用豁免 vs 指引必须可读”的取舍属产品语义，交由 owner 判定）

---

## 统计

TOTAL: 12 findings（F1、F4、F5、F7、F9 为纯几何/尺寸类；F2、F3、F8 为阶逃逸类；F6、F10、F11、F12 为对比度类；其中 F10/F11/F12 涉及外部主题包取值，已在各条内标注归属边界）

未发现问题的猎场（已实测排除，非“未查”）：单图标控件居中、图标+文字同行中线、状态点尺寸阶、coarse 档位控件触达底线（audit-uiux-full 的口径）、radius 在 13 个 surface 上的可见取值（除 F5 里 `.suggestions button { border-radius: 0 }` 属刻意压平列表行）。
