# UI/UX 收敛审计 第三轮 — Lane C（13 个界面全量打磨复审）

仓库：`/Users/hanxiao.du/Desktop/vincent/projects/pi-web`，分支 `refactor/plugin-architecture`，HEAD `86173ac2`。

方法：先读源码定位，再用 `@playwright/test` chromium 驱动 8505 实机栈取实测几何（393x850 / hasTouch=true 粗指针，以及 1280x900 细指针两套），所有数字均来自实测或源码逐行核对。截图存于 `/tmp/lane-c-*.png`。

轮次一/轮次二已修项与三条已知故意保留项均已核对，不在本报告内重复。

**TOTAL: 13 findings**

---

## F1 失败的命令回执引用了三个从未定义的 token，红色与底色一起消失
- `src/client/src/components/ChatView.ts:330`
- surface: chat
- finding：`.command-row.failed { color: var(--pi-error); border-color: var(--pi-error-border); background: var(--pi-error-surface); }`。全仓检索（`src` + `pi-web-plugins` + `docs`）里 `--pi-error*` 只出现在这一行；`src/client/index.html:117-141` 定义的是 `--pi-danger`，`src/client/src/theme.ts:29-70` 的 `THEME_TOKENS` 白名单里也没有任何 `--pi-error*`。三处声明在计算期全部失效（invalid at computed-value time）：`color` 是继承属性 → 退回父级正文色；`border-color`/`background` 非继承 → 退回初始值 `currentColor` / `transparent`。结果是失败行既拿不到危险色，还把兄弟状态（`.command-row` 的琥珀底 `--pi-warning-surface`、`.command-row.ok` 的绿底）都丢了，变成一条无底色的行。
- minimal failure scenario：在会话里发一条会失败的斜杠命令；`.command-row` 先以琥珀底渲染，转入 `failed` 后底色变为透明、边框变成正文色，视觉上比 pending 更弱——唯一能读出失败的只剩 `.command-state` 文案。
- confidence：高（token 未定义可全仓 grep 证实；退回值按 CSS 变量替换规范推导）。

---

## F2 add-project 弹窗的两条说明被宿主 listStyles 的 `small` 规则截成一行，信任文档链接被推到画布外
- `src/client/src/components/shared.ts:441`（`small { ... overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }`）
- `pi-web-plugins/workspaces/browser/hostUi.ts:38`（把宿主表挂到 `root.adoptedStyleSheets` 末尾，即排在插件自身 `static styles` 之后）
- `pi-web-plugins/workspaces/browser/ProjectDialog.ts:302`（`<small class="hint">`）、`:242`（`<small class="trust-hint">`）、`:342`、`:345`
- surface: add-project-dialog
- finding：`.trust-hint` / `small.hint` 只覆盖了 `color`、`padding`、`line-height`，没有覆盖 `white-space` 与 `overflow`，于是宿主 `small` 的 `nowrap + hidden + ellipsis` 生效。393px 实测：`small.hint` 盒 367x15.4（恰好一行 11px*1.4），文案被省略号截断；`.trust-hint` 盒 367x24 也是一行，而它内部的 `<a>Learn about project trust</a>` 被量到 **x=430.2，w=140.6**——弹窗自身右边界只有 x=392，链接整体位于盒外且被 `overflow: hidden` 裁掉，屏幕上完全不存在。
- minimal failure scenario：手机上打开 Add project，读到 “Trusting lets pi load this project s .pi settings, extensions, skills, and…” 就断了；用户既看不到信任的完整后果，也点不到官方安全文档链接（截图 `/tmp/lane-c-addproject.png` 可见两条说明均以省略号收尾，链接不可见）。
- confidence：高（实测坐标 + 截图 + 级联顺序可从 `hostUi.ts:38` 直接读出）。

---

## F3 设置详情页的返回控件保留了 `button` 的表面填充，在标题上方留下一块白色矩形
- `src/client/src/components/SettingsDialog.ts:790`（`.settings-back`）对照 `:765`（`button { ... background: var(--pi-surface); ... }`）与 `:766`（`.close-button { ... background: transparent; }`）
- surface: settings-appearance（以及任何 settings 二级页）
- finding：`.settings-back` 显式清了 `border`、`padding`、`font-size`、`color`，唯独没有清 `background`，因此继续吃 `:765` 的 `var(--pi-surface)`，同时也继续吃 `border-radius: var(--pi-radius-md)`。实测（393x850，Appearance 页）：`.settings-back` 盒 74.3x44，`background-color: rgb(255,255,255)`；它所在的 `header.settings-header` 与弹窗 `section` 背景是 `rgb(250,249,245)`。即一个纯文字返回控件在浅色主题下画成了一块 8px 圆角的白色实心块，右侧还与 `h1` 的左边缘错开 8px（按钮 x=4，`h1` x=12）。同一文件里的 `.close-button` 是把 `background` 显式设成 `transparent` 的正确写法。
- minimal failure scenario：Settings → Appearance，标题区左上角出现一块与页面底色不同的白色矩形（截图 `/tmp/lane-c-appearance.png`）；深色主题下 `--pi-surface` 比 `--pi-bg` 亮，同样会显形。
- confidence：高（实测背景色 + 同文件对照写法）。

---

## F4 主题预览色点是第五种圆点尺寸（10px），并且绕过了 dot 尺度守卫
- `src/client/src/components/settings/SettingsAppearancePanel.ts:147`（`.preview-dot { width: 10px; height: 10px; border-radius: 50%; }`）
- 同类第二处：`src/client/src/components/ConversationMeter.ts:39`（`.marker { width: 10px; height: 10px; border-radius: 50%; }`）
- surface: settings-appearance（另一处在 chat）
- finding：dot 尺度只有 `--pi-dot-xs|sm|md` = 4/6/8。同一张样式表里 `:143` 的 `.preview-line` 用了 `var(--pi-dot-xs)`、`:133` 的 `.theme.active .theme-name::after` 用了 `var(--pi-dot-sm)`，只有 `.preview-dot` 写死 10px——实测四个色点均为 10.0x10.0，间距 6px（`--pi-space-3`），即一行圆点比全 app 任何状态点都大 2px。守卫看不见它：`dotScale.test.ts:33` 的正则是 `/(?:width|height):\\s*(\\d)px/gu`，单个数字捕获组，两位数的 `10px` 天然逃逸。
- minimal failure scenario：把 `--pi-dot-md` 从 8 调到 9，全 app 的状态点跟随，只有主题卡预览点与 ConversationMeter 游标停在 10px；`dotScale.test.ts` 依旧全绿，第六种尺寸不会在 CI 里失败。
- confidence：高（实测尺寸 + 守卫正则可直接读出漏洞）。

---

## F5 磁贴的活动圆点落在文字列内部，而不是它自己预留的槽位里
- `src/client/src/components/shared.ts:351`（`.list-body.tiles .action-activity { right: calc(var(--pi-tile-menu-inset) + var(--pi-tile-menu-size) + var(--pi-space-3)); }`）对照 `:317`（`.action-main { padding: ... calc(var(--pi-tile-menu-inset) + var(--pi-tile-menu-size) + var(--pi-space-2)) ... }`）
- surface: boot（项目磁贴列表）
- finding：文字列预留的右内边距用的是 `--pi-space-2`（4px），而圆点的右偏移用的是 `--pi-space-3`（6px），两者差 2px，方向是把圆点推进文字列。粗指针实测（inset=4、size=36）：`.action-main` x=203.5 w=176.5，`padding: 10px 44px 10px 10px`，内容盒右边界 = 380-44 = **336**；`.action-activity` 盒实测 x=324..334，即整块 10px 宽的活动标记完全落在内容盒里，距文字右边界还有 2px 余量。`.workspace-primary` 实测宽度正是 122.5 = 176.5-44-10，说明两行 clamp 的标题确实会铺满到 336。
- minimal failure scenario：在有活动指示的项目磁贴上放一个能铺满第一行的长名字（例如 `pi-web-8505-wavea-probe`，实测该磁贴标题宽度已达满宽 122.5），标题第一行右端与 6px 的活动圆点重叠；`.action-name` 是 `-webkit-line-clamp` 而非省略号，字形会直接压在圆点上。
- confidence：高（两条 calc 的差值可直接比对，坐标为实测）。

---

## F6 model-picker 的作用域切换按钮仍是 UA 的 Arial 13.333px，和它下面刚被修好的选项行不同字体
- `src/client/src/components/ModelPicker.ts:275`（`.scope-toggle button { flex: 1; padding: ...; border-radius: ...; color: ...; }` — 无 `font`）
- 对照同文件 `:293`（`.options > button { font: var(--pi-text-sm)/1.25 var(--pi-font-ui); ... }`）与 `:279`（`button { border: 0; background: transparent; color; cursor }` — 也不带 `font`）
- surface: model-picker
- finding：`<button>` 的 UA 样式表不继承外层字体，`:host` 上的 `font: var(--pi-text-base) var(--pi-font-ui)` 对它无效；`interactiveSurfaceStyles`（`shared.ts:17-35`）只设 tap-highlight 与 touch-action，不含任何排版。1280x900 细指针实测两个作用域按钮：`font-size: 13.3333px`、`font-family: "Arial"`、`font-weight: 400`，盒 340x27。紧邻的选项行是 13px / `ui-sans-serif` 栈。也就是同一张面板里并排两种字族、两个相差 0.33px 的字号，且 27px 高度既不在 32/36/44 控件尺度上。
- minimal failure scenario：打开模型选择器，"Enabled / All models" 两枚分段按钮的字形与下方模型名明显不同族（Arial vs 系统 UI 字体），主题切换字体栈时这两枚不跟随。
- confidence：高（实测 fontFamily=Arial、fontSize=13.3333px，是 UA 默认的指纹值）。

---

## F7 两个 picker 的选项描述用裸 `<small>`，字号是 UA 的 10.83px，不在字号尺度上
- `src/client/src/components/ModelPicker.ts:302`（`small { display: block; margin-top: var(--pi-space-2); color: var(--pi-muted); }`）
- `src/client/src/components/CommandPicker.ts:113`（同一行写法；CommandPicker 即 thinking-picker，见 `src/client/src/components/PiWebApp.ts:3802`）
- surface: model-picker、thinking-picker
- finding：两处 `small` 都没有声明 `font-size`，于是走 UA 的 `font-size: 0.8333em`，基准是父级 `.options > button` 的 13px → 实测 **10.8333px**。尺度里最小的一档是 `--pi-text-2xs` = 11px，10.83px 不是任何一档。共享表 `shared.ts:441` 的 `small` 是显式读 `var(--pi-text-2xs)` 的，但这两个 picker 只 adopt 了 `interactiveSurfaceStyles`，拿不到那条规则。守卫看不见：`typeScale.test.ts:19-21` 只匹配源码里出现的 `font-size: <n>px` / `font: <n>px` 字面量，未声明字号而由 UA 供给的情况不在其扫描面内。
- minimal failure scenario：把 `--pi-text-2xs` 从 11px 调成 12px，全 app 的次级说明跟随，只有模型选择器的 provider 行与思考等级选择器的档位描述（轮次二刚补上的 "max 的描述"）停在 10.83px 且随父级字号漂移。
- confidence：高（实测 10.8333px；0.8333 是 UA `small` 的固定倍率）。

---

## F8 细指针下两个 picker 的关闭 × 是 UA 尺寸 23.7x25，低于 32px 控件下限
- `src/client/src/components/ModelPicker.ts:280`（`header button { font-size: var(--pi-text-xl); color: var(--pi-muted); }`）与 `:288`（粗指针分支才给 44x44）
- `src/client/src/components/CommandPicker.ts:107` 与其粗指针分支同形
- surface: model-picker、thinking-picker
- finding：基础规则只给了字号和颜色，没有 `width`/`height`/`padding`，UA 的 `padding: 1px 6px` 生效。1280x900 实测：`w=23.7, h=25.0, padding: 1px 6px`。同一份样式表在 `@media (pointer: coarse)` 里把它抬到 `var(--pi-control-height-touch)` 44x44——也就是说这个控件的尺寸在触屏上被显式管理，在鼠标上完全交给了浏览器，且 25px 低于房子的鼠标下限 `--pi-control-height` = 32px。同一弹窗的搜索框实测 36px、分段按钮 27px、选项行 54.8px：一个面板里四种控件高度，没有一种落在 32/36/44 上（36 的搜索框除外）。
- minimal failure scenario：桌面浏览器打开模型选择器，右上角 × 的可点区只有 24x25，比同页 `input.search` 矮 11px、比选项行矮 30px；调 `--pi-control-height` 不会影响它。
- confidence：高（实测盒尺寸与 padding 与 UA 默认一致）。

---

## F9 会话行的复选框与子树折叠钮共用同一个前导槽位，却用两套写法定位，粗指针下两者不同心
- `src/client/src/components/SessionList.ts:727`（`.session-checkbox { top: var(--pi-space-4); left: calc(var(--pi-space-3) + var(--depth,0) * 16px); width: 24px; height: 24px; }`）
- `src/client/src/components/SessionList.ts:728`（`.subtree-toggle, .subtree-toggle.inert { top: 8px; left: calc(6px + var(--depth,0) * 16px); width: 24px; height: 24px; }`）与 `:744`（粗指针：`top: 0; width: var(--pi-control-height-comfort); height: var(--pi-control-height-touch);`）
- 渲染证据：`src/client/src/components/SessionList.ts:455` 选择态下仍然渲染 `<span class="subtree-toggle inert">`（带 `color-mix(muted 14%)` 底色的可见盒），`:399` 同时渲染复选框
- surface: sessions
- finding：两条规则表达的是同一个槽位（相同的 8px/6px/深度步长），但一条读尺度 token、一条写字面量；`spacingScale.test.ts:26` 的属性白名单只有 padding/margin/gap 系列，`top`/`left` 不在其中，所以这对写法差异永远不会在 CI 里被拉平。几何后果在粗指针下显形：折叠钮变成 36x44 且 `top: 0`，复选框仍是 24x24 且 `top: 8px`；以行内边距盒为基准，折叠钮中心 =(6+18, 0+22)=(24, 22)，复选框中心 =(6+12, 8+12)=(18, 20)——两个同时可见的前导标记水平差 6px、垂直差 2px，复选框偏在灰底圆角盒的左上方而不是居中。
- minimal failure scenario：手机上进入会话多选态，带子会话的行会同时出现一个 36x44 的灰色圆角盒和一个 24x24 的复选框，后者明显偏离盒心；退出多选态时该标记再横移 6px 回到折叠钮位置。
- confidence：中高（两套写法与两组尺寸由源码直接确定；中心偏移为几何推导，未在多选态下实测截图）。

---

## F10 控件尺寸经由自定义属性写死，绕过 controlHeightScale 守卫
- `src/client/src/components/QuickSwitcher.ts:392`（`:host { ... --qs-menu-size: 32px; }`）对照下一行 `:393`（`@media (pointer: coarse) { :host { --qs-menu-size: var(--pi-control-height-touch, 44px); } }`）
- `src/client/src/components/shared.ts:337`（`.list-body.tiles { --pi-tile-menu-size: 32px; --pi-tile-menu-inset: 6px; }`）与 `:344`（粗指针 36px / 4px）
- surface: quick-switcher、qs-row-menu、sessions（磁贴）
- finding：32px 就是 `--pi-control-height`、36px 就是 `--pi-control-height-comfort`、6px 就是 `--pi-space-3`、4px 就是 `--pi-space-2`，四个值全都有名字，却以字面量存进自定义属性，再由 `.row-menu-toggle { width: var(--qs-menu-size); min-height: var(--qs-menu-size); }`（`QuickSwitcher.ts:466`）和 `.action-menu-toggle`（`shared.ts:329/345`）消费。`controlHeightScale.test.ts:20` 的正则是 `/(?:min-)?(?:height|width):\\s*(2[89]|3\\d|4[0-4])px/`，只看直接写在 `height`/`width` 上的字面量；`spacingScale.test.ts:26` 同理只看 padding/margin/gap。经自定义属性中转的尺寸和间距全部逃逸。紧邻的粗指针分支恰好用了 token，证明写法是可以做到的。
- minimal failure scenario：把 `--pi-control-height` 从 32 调到 34，全 app 的鼠标态控件跟随，quick-switcher 的行内菜单钮与磁贴菜单钮仍是 32px，并且由于磁贴文字列的预留是 `calc(inset + size + space)`，预留与实际按钮再次脱钩（这正是 `shared.ts:311-316` 注释里记录过的旧事故）。守卫全绿。
- confidence：高（守卫正则与逃逸路径均可逐行核对）。

---

## F11 quick-switcher 状态标记的两个偏移，一个在尺度上、一个是字面量
- `src/client/src/components/QuickSwitcher.ts:428`（`.row-flag, .row-state { position: absolute; bottom: var(--pi-space-4); right: 12px; }`）
- surface: quick-switcher
- finding：同一条声明里 `bottom` 读 `--pi-space-4`（8px），`right` 写死 12px（= `--pi-space-6`）。磁贴的水平内边距是 `padding: ... var(--pi-space-6)`（`:412`），所以 12px 本意就是与文字左右边距对齐，却没有说出这层关系。同 F10，`right` 不在间距守卫的属性白名单内。
- minimal failure scenario：调整 `--pi-space-6`，磁贴的文字边距移动而右下角的未读/中断标记不动，标记与副标题右端错位；两个方向的呼吸也不再来自同一套尺度。
- confidence：高（单行内两种写法，可直接对照）。

---

## F12 扩展对话卡的页脚比它所在的卡片更亮一层，且相邻时连分隔线都被移除
- `src/client/src/components/ExtensionDialogCard.ts:346`（`.card { background: var(--pi-surface-raised); }`）
- `src/client/src/components/ExtensionDialogCard.ts:458`（`.dialog-footer { background: var(--pi-surface); }`）
- `src/client/src/components/ExtensionDialogCard.ts:461`（`.dialog-message + .dialog-footer, .dialog-options + .dialog-footer { border-top: 0; }`）
- surface: chat
- finding：`src/client/index.html:150-156` 定义的语义表面阶梯是 canvas < panel < card < raised。卡片本体站在最高一层 `raised`，它自己的页脚却退回 `panel`（低两层）。393px 实测：`article.card` 背景 `rgb(217,217,217)`，`footer.dialog-footer` 背景 `rgb(255,255,255)`，页脚盒 379x68 铺满卡宽；而 `:461` 在选项列表后把 `border-top` 去掉，于是这两块面之间没有任何分隔线，只剩一道 38 级亮度的硬跳变。视觉上页脚读起来像浮在卡片之上的另一张纸，而不是卡片的最后一行。
- minimal failure scenario：会话里出现带选项的扩展对话（实测样本："Extension updates available…" + Update now / Skip + Cancel），灰色卡片下缘直接接一块通宽白块，Cancel 按钮所在的一行看起来不属于上面的卡（截图 `/tmp/lane-c-chat.png`）。
- confidence：高（实测两个背景色 + 阶梯定义 + 去线规则三处互证）。

---

## F13 全局错误横幅的关闭按钮没有任何尺寸规则，实高约 17px，两种指针都低于下限
- `src/client/src/components/PiWebApp.ts:199`（`.error .error-dismiss { flex: 0 0 auto; padding: 0 var(--pi-space-3); border: 0; background: none; color: inherit; line-height: 1.4; }`）
- 上下文：`src/client/src/components/PiWebApp.ts:196`（`.error` 行），`src/client/src/components/errorBanner.ts:18`（渲染该按钮）
- surface: boot / chat（应用外壳顶部横幅，任何 surface 都会出现）
- finding：该按钮既没有 `min-height`/`height`，也没有任何 `@media (pointer: coarse)` 分支（全文件搜索 `error-dismiss` 只有这一条规则）。它继承 `PiWebApp.ts:194` 的 `button { font: var(--pi-text-xs) ... }` = 12px，配 `line-height: 1.4` → 内容高 16.8px，左右各 6px 内边距，字形宽约 9px → 命中盒约 21x17。房子的下限是鼠标 32px（`--pi-control-height`）、手指 44px（`--pi-control-height-touch`）；同一横幅所在的外壳里，`.empty button`（`:196` 上方）已经显式写了 `min-height: var(--pi-control-height-touch)`。此外 `.error` 用 `align-items: flex-start`，所以这枚 17px 高的按钮被钉在多行错误文本的第一行顶部，而不是与文本块或首行居中对齐。
- minimal failure scenario：手机上出现一条两行以上的错误横幅，右上角的 ✕ 只有约 21x17 的可点区（远低于 44 触摸下限），且贴在文本盒顶端；用户多次点空后只能等横幅自行退场——而非瞬态错误是不会自行退场的（`errorBanner.ts:14` 的契约）。
- confidence：中高（尺寸由字号与行高推导，规则缺失可全文件 grep 证实；本轮实机会话未触发错误横幅，故未取实测坐标，此处如实标注为源码推导）。

---

## 已核对为干净的项（不计入 findings）

- **轮次二修复复验通过**：磁贴活动点与菜单钮共享中心线（实测 y 中心均为 243.0）；`.section-add` 的 `+` 字形与标签垂直中心均为 134.0；composer 工具条 6 枚控件实测统一 44x44、间距统一 6px；会话行状态点 8x8 实测正好落在 `--pi-space-9` 的右内边距里（内容盒右界 314，点位于 322..330，无重叠）；`activity-dock` 的 8px 点与文案中心线均为 669.0；`msg-action` 24x24 内的字形水平垂直双向居中（中心 330.0 / 47.3）。
- **`AppNavigationPanel.ts:470` 的通宽 Info 行不是缺陷**：`.tool-row:last-child:nth-child(odd) { grid-column: 1 / -1; }` 是显式设计，实测 6 个 184.5 宽 + 末行 377 宽与该规则一致。
- **未能覆盖的检查（如实记录）**：thinking-picker（`command-picker`）在实机探针里点击 `.select-thinking` 后没有挂载出可查询节点（`PALETTE []`），因此 F7/F8 中关于该组件的结论来自源码与 `ModelPicker` 的同形实测，未在 `command-picker` 自身上取到坐标；chat-drawer 的展开态、msg-row-menu 与 context-sheet 三个界面本轮只做了源码走查，未取实测几何。
