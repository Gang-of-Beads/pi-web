# 第九轮 视觉打磨收敛审计 — Lane C（全表面 + 实测）

- 分支/HEAD：`refactor/plugin-architecture` @ `925ae00f`
- 实测环境：运行中的 8505 栈（`http://127.0.0.1:8505`），Playwright/Chromium，两种指针：
  - 桌面 1280x900（`hasTouch:false`，`pointer: fine`）
  - 手机 393x850 `deviceScaleFactor:2`（`hasTouch:true, isMobile:true`，`pointer: coarse`）
- 活动主题为默认 `themes:clay-soft`（浅色）；已确认页面含 `--pi-chrome-inset: 6px`，即栈上跑的确实是第八轮之后的 HEAD，不是旧构建。
- 已覆盖表面：boot / sessions / chat / chat-drawer / msg-row-menu / model-picker / thinking-picker / settings / settings-appearance / quick-switcher / qs-row-menu / context-sheet / add-project-dialog。
- 所有几何数字均为浏览器实测（`getBoundingClientRect()` / `getComputedStyle()`），不是从源码推算；凡未实测的都在 confidence 里标明。

**TOTAL: 14 findings**（其中 F1–F8 为高置信、可直接动手的缺陷）

---

## F1 会话进度条游标的 2px 分隔光环被同一条规则里的第二个 box-shadow 覆盖掉

- `src/client/src/components/ConversationMeter.ts:39`
- surface: chat
- finding（几何陈述）：`.marker` 在同一条规则内先后写了两次 `box-shadow`：
  `box-shadow: 0 0 0 2px var(--pi-bg)` 之后紧跟 `box-shadow: var(--pi-elevation-1)`。
  CSS 后者胜出，前者是死声明。实测（1280x900，chat）该 8x8 游标的
  `getComputedStyle(.marker).boxShadow === "rgba(20, 20, 19, 0.1) 0px 1px 2px 0px"` —— 只有阴影，
  没有那圈 2px 的背景色描边。于是游标与它压在上面的 4px 轨道之间没有任何分隔环：
  游标（8px 圆）直接压在同色系轨道（`.track`，实测 y=45..49）上，二者只靠 10% 不透明度的
  1px 投影区分。轨道 `.progress` 用的是 `color-mix(--pi-accent 42%, --pi-border-muted)`，
  游标用纯 `--pi-accent`，在浅色主题下两者明度接近，光环正是为此写的。
- 最小失败场景：打开任意有历史的会话 → 顶部 conversation meter；在游标恰好落在
  `.progress` 已填充段上时（会话过半即是），游标与进度条糊成一条，没有第二轮设计里
  要的"游标浮在轨道之上"的层次。复现命令：`getComputedStyle($('.marker')).boxShadow`。
- confidence: 高（源码 + computed style 双证）

---

## F2 行菜单条目的 coarse 44px 地板是死规则：同一张样式表里后面的基础规则把它盖掉了，实测手机上只有 36px

- `src/client/src/components/shared.ts:272`（coarse 里 `.action-menu-panel button { min-height: var(--pi-control-height-touch, 44px) }`）
- `src/client/src/components/shared.ts:441`（其后基础层 `.action-menu-panel button { ... min-height: var(--pi-control-height-comfort) ... }`）
- surface: sessions、context-sheet（machine/project/workspace 行菜单）
- finding：两条规则在同一个 `listStyles` css 模板内（218–455 行），选择器完全相同。
  media query 不带额外特异性，源序在后的 441 行胜出，所以 272 行的 44px 触控地板永远不生效。
  实测 393x850 coarse：点开 project 行菜单，`.action-menu-panel button` 量到 **110.0 x 36.0**，
  不是 44。讽刺的是 266–268 行就写着这条事故记录（"Placed after every base declaration it raises -
  a media query carries no extra specificity, so an earlier coarse rule loses to a later base rule"），
  同一文件里被自己违反。
- 最小失败场景：手机 393x850 → 项目列表任一行的 `⋯` → 菜单项高 36px（同屏的行菜单
  触发钮本身是 44x46.5）。手指落在两个菜单项交界处时点错相邻项（例如 Remove 紧邻 Rename）。
- confidence: 高（实测 36.0px + 源码顺序可证）

---

## F3 快速切换器"重命名"两个动作钮在触控下仍是 36x36，同一文件里写的 44px coarse 规则同样被后面的基础规则盖掉

- `src/client/src/components/QuickSwitcher.ts:492`（coarse `.rename-actions button { width/min-height: 44 }`）
- `src/client/src/components/QuickSwitcher.ts:506`（其后 `.rename-actions button { width: comfort; min-height: comfort }`）
- surface: quick-switcher / qs-row-menu
- finding：与 F2 同型。484–493 的 coarse 块写在 506 行之前，media query 无附加特异性，
  506 行胜出。实测 393x850 coarse：`.row-menu` 菜单项都是 160x44（合规），但点 Rename 进入
  重命名行后，`.rename-actions button` 实测 **36.0 x 36.0** 两个，`.rename-input` 44
  （输入框是被 490 行的 `input{height:44}` 救回来的，不是被 491 行救的；491 同样被 504 行盖掉）。
  也就是说同一行里输入框 44、它右边的确认/取消 36，且 36 低于本组件自己宣称的
  "every target the quick switcher ships measures 44px on touch"（注释在 479–483 行）。
- 最小失败场景：手机 → Ctrl/Cmd+P → 任一会话卡片右上 `⋯` → Rename → 右侧 ✓/✕ 两个 36px 钮，
  与紧挨着的 44px 输入框不等高，且低于触控地板。
- confidence: 高（实测 36x36）

---

## F4 对话框/选择器的关闭控件在鼠标下分裂成两个尺寸家族：32 与 36，各占一半

- 32px 家族：`src/client/src/components/ModelPicker.ts:287`、`src/client/src/components/CommandPicker.ts:112`、
  `pi-web-plugins/workspaces/browser/ProjectDialog.ts:377`、`pi-web-plugins/machines/browser/MachineDialog.ts:146`、
  `src/client/src/components/AuthDialog.ts:273`、`src/client/src/components/SessionRenameDialog.ts:37`
- 36px 家族：`src/client/src/components/QuickSwitcher.ts:403`、`src/client/src/components/SettingsDialog.ts:766`、
  `src/client/src/components/SessionCleanupDialog.ts:244`、`src/client/src/components/appShell/ContextSwitcherSheet.ts:87`、
  `src/client/src/components/SessionTreeNavigator.ts:537`
- surface: model-picker、thinking-picker、add-project-dialog、quick-switcher、settings、context-sheet
- finding：同一个视觉母题（模态头部右上角的 ✕），在鼠标指针下有两个尺寸。实测 1280x900：
  - model-picker header close = **32.0 x 32.0**
  - thinking-picker（CommandPicker）header close = **32.0 x 32.0**
  - add-project（ProjectDialog）header close = **32.0 x 32.0**
  - quick-switcher `.close` = **36.0 x 36.0**
  - settings `.close-button` = **36.0 x 36.0**
  实测 393x850 coarse：context-sheet `.sheet-close` = 44x44（触控层是统一的，只有鼠标层裂开）。
  第八轮把 quick switcher 从 32 提到 36，理由是"its sibling dialogs are 36 on a mouse"；
  实际只有一半兄弟是 36，另一半仍是 32，于是把原本一致的 32 变成了 32/36 五比五分裂。
- 最小失败场景：桌面上从 settings（36px ✕）打开 model picker（32px ✕），两个叠在一起的模态
  右上角同一位置的 ✕ 大小不同；在 settings → Appearance → 再开 model picker 时尤其明显。
- confidence: 高（两处实测 + 全量源码枚举）

---

## F5 控制高度令牌只被当作 min-height 地板用，实际高度是 padding 的意外产物：Settings General 实测仍是 40/42/35，add-project 是 41/32/33

- `src/client/src/components/settings/settingsControlStyles.ts:16`（`min-height: var(--pi-control-height)` —— 只有地板）
- `src/client/src/components/settings/SettingsGeneralPanel.ts:277`（input/select/textarea `padding: var(--pi-space-5) var(--pi-space-5)`，字号 16px）
- `src/client/src/components/settings/SettingsGeneralPanel.ts:261`（button `padding: var(--pi-space-4) var(--pi-space-5)`，字号继承 14px）
- `pi-web-plugins/workspaces/browser/ProjectDialog.ts:337`（`footer button { min-height: var(--pi-control-height) }`）与 `:376`（`button { padding: var(--pi-space-4) var(--pi-space-5) }`）
- surface: settings、add-project-dialog
- finding：`settingsControlStyles` 的 docstring（第 7–9 行）明确说它修掉了
  "one General screen shipped a 40px input above a 42px select above a 35px primary button"。
  实测 1280x900 的 Settings → General，同一屏内：
  - `input` = 692.0 x **40.0**
  - `select` = 692.0 x **42.0**
  - `button.primary` = 199.2 x **35.0**
  三个数字与 docstring 里"已修复"的那三个完全一致。原因是共享样式只给了
  `min-height: 32`，32 < 35/40/42，地板从不触发，真正决定高度的是各面板自己的 padding
  和 UA 的 `<select>` 内在高度。
  同型证据（add-project，1280x900）：`input` = 692 x **41.0**，`.suggestions button` = 692 x **32.0**，
  `footer button` = 60.8 x **33.0**，`header button` = **32.0 x 32.0** —— 一个对话框里四种高度，
  其中 33 和 41 都不在 32/36/44 的标度上，而 `controlHeightScale.test.ts` 只扫字面量，
  这种"由 padding 算出来的越界值"它看不见。
- 最小失败场景：打开 Settings → General，把"配置文件路径"输入框（40）、下面的 `<select>`（42）
  和右下角 Save（35）并排看：三种高度、三种视觉重量。add-project 里 Cancel/Add（33）
  与右上角 ✕（32）差 1px、与上面的路径输入框（41）差 8px。
- confidence: 高（四个表面全部实测）

---

## F6 主题预览框声明 74px 却画出 92px；四个状态点在自己的 24px 带里顶到最上沿

- `src/client/src/components/settings/SettingsAppearancePanel.ts:145`（`.preview { height: 74px; padding: var(--pi-space-4); border: 1px ... }`，无 `box-sizing`）
- `src/client/src/components/settings/SettingsAppearancePanel.ts:150`（`.preview-dots { display: flex; gap: var(--pi-space-3); }`，无 `align-items`）
- `src/client/src/components/settings/SettingsAppearancePanel.ts:158`（窄屏 `.preview { height: 64px }`，同病）
- surface: settings-appearance
- finding：
  (a) `.preview` 同时写了 `height: 74px`、`padding: 8px`、`border: 1px`，但没有 `box-sizing`。
  `boxModelGuard.test.ts` 只在一条规则同时出现 width **和** height 时才开火（见
  `src/client/src/components/boxModelGuard.test.ts:26-27`（`WIDTH` 与 `HEIGHT` 必须同时命中）），这里只有 height，于是漏网。
  实测 1280x900：`.preview` = 210.7 x **92.0**，比声明值高 18px（74 + 8*2 + 1*2）。
  (b) 预览内部：`.preview-surface` 实测 192.7x44 @y=336.3，`.preview-dots` 实测 192.7x**24.0** @y=386.3，
  而四个 `.preview-dot` 是 8x8 @y=**386.3** —— 顶对齐。结果点上方留白 6px（gap），
  下方留白 16px + 8px padding = 24px，1:4 的不对称。flex 默认 `align-items: stretch`
  遇到固定高度 8px 就退化成 flex-start，没人写 `align-items: center`。
- 最小失败场景：Settings → Appearance，任一主题卡片的预览缩略图：色点贴着"纸面"矩形
  下沿 6px 处，离预览框底边 24px；同时整张预览比设计稿高 18px，把下面的主题名/描述整体推低。
- confidence: 高（实测 92.0 与 24.0/8.0 的位置关系）

---

## F7 快速切换器卡片的状态点没有从 `--qs-menu-size` 推导，触控下与角上菜单钮的中线错开 5px

- `src/client/src/components/QuickSwitcher.ts:430`（`.row-flag, .row-state { bottom: var(--pi-space-5); right: var(--pi-space-6); }` —— 写死 12px）
- `src/client/src/components/QuickSwitcher.ts:467` / `:488`（`.row-menu-toggle { width: var(--qs-menu-size) }`，鼠标 32、触控 44）
- surface: quick-switcher
- finding：426–429 行的注释说状态标记"sits under the corner menu button"，即两者应共用一条竖中线。
  但标记的右偏移是常量 `--pi-space-6`(12px)，菜单钮的宽度却是变量。实测：
  - 1280x900 鼠标：`.row-menu-toggle` cx = 621.0，`.row-state` cx = 620.0（差 1px，卡片 1px 边框没算进去）
  - 393x850 coarse：`.row-menu-toggle` cx = **171.5**，`.row-state` cx = **176.5**（差 **5.0px**）
  指针类型一变，"上下一对"的关系就散了。第六轮已经用 `--pi-tile-menu-size/-inset`
  给 tile 版本做过同样的推导（`src/client/src/components/shared.ts:353-354`），quick switcher 版本没跟上。
- 最小失败场景：手机 393x850 → Ctrl/Cmd+P，看任一会话卡片右侧：右上角 44px 的 `⋯`
  和右下角的状态点不在同一条竖线上，视觉上像两枚随手摆的标记。
- confidence: 高（两种指针都实测）

---

## F8 消息头 ⓘ（时间戳）控件在触控下的可点宽度只有 28px，兄弟按钮是 40px —— 与它自己的注释相反

- `src/client/src/components/ChatView.ts:393`（coarse 只改 `.msg-action::after { inset: -10px -8px }`）
- `src/client/src/components/ChatView.ts:412-413`（`@media (hover: none)` 里 `.msg-meta:not(.expanded)::after { inset: calc(-1 * var(--pi-space-5)) calc(-1 * var(--pi-space-1)) }`，横向只有 2px）
- surface: chat、msg-row-menu
- finding：412 行上方的注释写着 "The same reach its siblings get: without it the info control was a
  24px target beside 44px ones"。实测 393x850 coarse，同一条消息头里：
  - `.msg-action`（↻ / ⧉）：盒 24x24，`::after` 计算值 `-10px/-8px/-10px/-8px` → 命中区 **40 x 44**
  - `.msg-meta`（ⓘ）：盒 24x24，`::after` 计算值 `-10px/-2px/-10px/-2px` → 命中区 **28 x 44**
  横向差 12px（30%）。coarse 覆盖只写给了 `.msg-action::after`，`.msg-meta` 的那份
  留在了旧的 `-space-1`。
- 最小失败场景：手机 393x850 打开长会话，用拇指去点某条 assistant 消息右端的 ⓘ：
  它的可点宽度是相邻复制钮的 70%，偏 6px 就落空（落到 `.msg-header-trailing` 的 20px 空隙里，什么也不发生）。
- confidence: 高（`getComputedStyle(el,"::after")` 实测 40px/28px）

---

## F9 工作区行菜单里的原生复选框是 UA 默认的 13x13，`--pi-checkbox-size`(24) 完全没被采用；旁边的信任链接也只有 15px 高

- `pi-web-plugins/workspaces/browser/WorkspaceList.ts:411`（`.workspace-menu-trust input { cursor: pointer; }` —— 没有任何尺寸）
- `pi-web-plugins/workspaces/browser/WorkspaceList.ts:412`（`.workspace-trust-link { ... }` —— 没有触控地板）
- 对照：`pi-web-plugins/workspaces/browser/ProjectDialog.ts:336`（`.check input { width/height: var(--pi-checkbox-size) }`）
  与 `:362`（coarse `.trust-hint a { min-height: 24px }`）
- surface: sessions / context-sheet（workspace 行菜单）
- finding：实测 393x850 coarse，打开 workspace 行的 `⋯` → 详情面板：
  - 信任复选框 `input` = **13.0 x 13.0**（UA 默认），而 app 的复选框令牌是 24px，
    第六轮的"native inputs take the checkbox token"这一条漏了这个组件；
  - `a.workspace-trust-link` = 140.6 x **15.0**，而同项目的 add-project 对话框在 coarse 下
    专门给同名链接加了 `min-height: 24px`（ProjectDialog.ts:362），这里没有。
  同一个"项目信任"语义，在对话框里是 24px 方块 + 24px 链接，在行菜单里是 13px 方块 + 15px 链接。
- 最小失败场景：手机 → 侧栏 workspace 行 `⋯` → "Trusted" 复选框只有 13px；手指点它
  基本靠 label 的 69x19 命中区兜底，而"Learn about project trust"链接高 15px，
  与它上方 36px 的菜单项、44px 的行触发钮完全不在一个触控标度上。
- confidence: 高（实测 13.0x13.0 与 15.0）

---

## F10 行菜单里的"复制"图标钮声明 18x18 方形，实际画成 18x36 的竖矩形，且宽度 18px 低于任何目标地板

- `src/client/src/components/shared.ts:392`（`.action-menu-panel .detail-copy { width: 18px; height: 18px; ... }`）
- `src/client/src/components/shared.ts:441`（同表后面的 `.action-menu-panel button { min-height: var(--pi-control-height-comfort) }`）
- surface: sessions / context-sheet（workspace 行菜单详情）
- finding：`.detail-copy` 是 `.action-menu-panel` 的后代 `button`，因此 441 行的
  `min-height: 36` 与 392 行的 `height: 18px` 同时生效，`min-height` 胜出高度。
  实测 393x850 coarse：`button.detail-copy` = **18.0 x 36.0**，里面的 `⧉` 字形 8.8x11 被
  `place-items: center` 居中在 36px 高的盒里。也就是说：
  (a) 一个本该是 18px 正方的图标钮实际是 1:2 竖矩形，边框（`border: 1px solid`）画出来就是竖条；
  (b) 宽度 18px 既低于 24px 的 AA 目标下限，也低于 coarse 的 44px 地板，且没有任何
      `::after` 命中区扩展（对比 `.msg-action` 有）。
- 最小失败场景：手机 → workspace 行 `⋯` → "Workspace"/"Path" 两行右侧的 ⧉ 复制钮：
  一个 18px 宽的竖条，紧贴在 297px 宽的路径文本右侧；拇指点它有很大概率落到 `dd` 文本上。
- confidence: 高（实测 18.0x36.0）

---

## F11 同一张 context sheet 里三种行高：machine 行 60px、project/workspace 行 48px，tiles 变体 56px —— 三个未命名字面量

- `pi-web-plugins/machines/browser/MachineList.ts:255`（`.machine-row .action-main { min-height: 58px; }`）
- `src/client/src/components/shared.ts:319`（`.list-body.tiles .action-main { ... min-height: 56px; }`）
- `src/client/src/components/shared.ts:374`（普通行 `.action-main`：没有 min-height，高度由 padding 决定）
- surface: context-sheet、sessions
- finding：三个数字（58 / 56 / 无）描述的是同一个母题——"一行标题 + 一行副标题"。
  58 与 56 相差 2px，没有任何理由，两者都是字面量，都在 `controlHeightScale.test.ts`
  的 28–44 窗口之外，因此守卫看不见。实测 393x850 coarse 的 context sheet（三张列表竖叠）：
  - machine 行 `.action-row` = 355.0 x **60.0**（`.action-main` 58 + 上下 1px 边框）
  - project 行 `.action-row` = 355.0 x **48.0**（`.action-main` 46）
  两段列表上下相邻，行高差 12px（25%），读起来像两个不同密度的产品拼在一起。
- 最小失败场景：手机 → 顶部 scope 芯片 → context sheet：Machines 两行明显比下面 Projects 的行"胖"一圈。
- confidence: 高（实测 60.0 / 48.0）

---

## F12 机器在线状态是裸文本，与全 app 的"状态用标记"约定相反；离线/错误与在线同色

- `pi-web-plugins/machines/browser/MachineList.ts:141`（`<small>… · ${statusLabel}</small>`，statusLabel 来自 `:119`）
- `pi-web-plugins/machines/browser/MachineList.ts:284-286`（`machineStatusLabel` 返回 `"online"|"offline"|"error"|"unknown"` 纯字符串）
- `pi-web-plugins/machines/browser/MachineList.ts:251-261`（`static override styles` 整块里没有任何 status 相关规则）
- surface: sessions（侧栏机器列表）、context-sheet
- finding：房子里的既定做法是"状态由标记承担"：`sessionRowIndicator.ts:1-33` 明确把状态
  收敛成一枚点、`shared.ts:399` 的 `.action-activity` 是那枚点的槽位、`.badge`/`.stale`
  是徽标版本。机器行却把状态当作副标题的一段散文接在路径后面，且没有任何颜色区分：
  实测（1280x900）该 `<small>` 的 `color` 为 `rgb(107, 104, 96)`（`--pi-muted`），
  "Local Pi Web · online" 与一台离线机器的 "http://… · offline" 用完全相同的字号（11px）
  和完全相同的颜色渲染。旁边的 `.action-activity` 槽位只表达 unread/工作中，不表达在线性。
- 最小失败场景：侧栏里两台机器，一台 online 一台 offline，扫一眼分不出来——唯一的区别是
  一行灰字里的一个单词，且它排在会被 ellipsis 截断的 URL 后面（`small` 在 tiles 下 nowrap）。
- confidence: 中高（渲染与颜色实测；"应当用标记"是与本仓既定 house pattern 的对照判断）

---

## F13 Settings 的 General 与 Shortcuts 面板把焦点环换成了 1px 阴影，与全 app 的 2px accent 环不一致

- `src/client/src/components/settings/SettingsGeneralPanel.ts:277`（`outline: none`）与 `:278`（`input:focus { box-shadow: 0 0 0 1px var(--pi-accent-border) }`）
- `src/client/src/components/settings/SettingsShortcutsPanel.ts:391`（`outline: none`）与 `:392`（同样 1px 阴影）
- 对照：`--pi-focus-ring-width: 2px`（`src/client/index.html:109`）、`ModelPicker.ts:288`、`ProjectDialog.ts:335` 都用 2px accent outline
- surface: settings
- finding：这两个面板是全仓仅有的两处"`outline: none` 且不补 `:focus-visible`"的表单控件
  （见对 `src/client/src/components/settings/*.ts` 的 `focus-visible` 计数：两者均为 0）。
  它们用 `:focus`（而非 `:focus-visible`）加 1px `box-shadow` 顶替。三个后果：
  (a) 焦点指示宽度 1px vs 全 app 的 2px；(b) 用 `:focus` 意味着鼠标点击也画环，
  与 app 其它地方的 `:focus-visible` 语义不同；(c) `outline: none` 把键盘用户的
  平台兜底环也一并删了。第八轮刚为 ModalSurface 做过"用我们自己的环"这件事，这两处没跟上。
- 最小失败场景：Settings → General，用 Tab 依次走过路径输入框 / select / textarea：
  焦点提示是 1px 细描边；退回 Settings → Appearance 或任意 picker，同样操作是 2px accent 环。
- confidence: 高（源码可证；`--pi-focus-ring-width` 已发布为 2px）

---

## F14 一屏之内两条筛选行不等高：quick switcher 的机器标签 36px、下面的过滤芯片 32px；会话行状态点的右内缩也是两套（8px vs 6px）

- `src/client/src/components/QuickSwitcher.ts:441`（`.machine-tab { min-height: var(--pi-control-height-comfort) }`）
- `src/client/src/components/QuickSwitcher.ts:447`（`.chip { min-height: var(--pi-control-height) }`）
- `src/client/src/components/SessionList.ts:714`（`.action-main .session-state { right: var(--pi-space-4) }` = 8px）
- `src/client/src/components/shared.ts:399`（`.action-activity { right: var(--pi-space-3) }` = 6px）
- surface: quick-switcher、sessions、context-sheet
- finding：
  (a) 实测 1280x900 quick switcher：`.machine-tab` = **36.0** 高（两枚），紧挨着的下一行
  `.chip` = **32.0** 高（15 枚）。两条水平滚动的筛选带上下相邻、语义同级（都在"缩小列表范围"），
  却是两个高度；coarse 下两者都被抬到 44，所以这个不齐只在鼠标下出现。
  (b) 同一枚"行活动点"母题，session 列表用 `right: 8px`（实测点右缘 330，`.action-main` 右缘 338），
  plugin 行列表用 `right: 6px`（实测点右缘 323，`.action-main` 右缘 329）。两套内缩没有理由，
  第八轮把"点与行菜单同中线"统一到了纵向，横向内缩仍是两个数。
- 最小失败场景：桌面 Ctrl/Cmd+P：机器标签行（36）与过滤芯片行（32）上下相邻，两条带子不等高；
  再把侧栏的会话行与项目行并排看，两枚状态点距各自行右缘差 2px。
- confidence: 中（(a) 实测；(b) 实测 + 源码，属低危一致性问题）

---

## 附：本轮实测过但判定为"非缺陷/不报"的项

- `.msg-header` 内 `b.label` 中心 y 与 `.msg-header-trailing` 中心 y 差 0.5px（实测 -9143.7+7 vs -9148.7+12）——
  亚像素，不构成缺陷。
- `.editor-attach` 32/16px 与工具条 `.icon-button` 36/18px 不同尺寸：前者是浮在输入框内部的
  贴边控件，coarse 下升到 44（`PromptEditor.ts:163`），判定为刻意。
- `conversation-meter` 宿主盒 12px 而内容画在 y+4..y+16（实测宿主 41..53、`.meter` 45..57，
  `.track { margin-top: 4px }` 外溢折叠）：视觉位置恰好正确，属潜伏性盒模型问题，不单列。
- `--pi-muted` 在默认 clay-soft 浅色主题下对页面底色实测 **4.42:1**（fg `rgb(107,104,96)`，
  eff-bg `rgb(243,226,217)`，11–12px 正文，需 4.5）。因"muted 低于 AA"已在
  JUDGED NOT TRUE 清单上（那次测得 5.56:1 / 4.71:1，是别的色停），此处仅作为**不同色停下的新读数**
  记录，不作为本轮 finding；且该主题定义在本仓之外。confidence: 低（需 owner 确认色停归属）
- quick switcher `.row { min-height: 52px }`（`QuickSwitcher.ts:411`）、`.row-tag { line-height: 16px }`
  （`:500`）、`shared.ts` 的 `.tab-badge { line-height: 16px }`：都是标度外字面量，但都在
  现有守卫窗口之外且视觉无损，仅作记录。
- `QuickSwitcher.ts:433` 的 `.row-flag.unread` 已是死规则（`:212` 只在 interrupted 分支渲染
  `.row-flag`，unread 走 `sessionRowIndicator`）——死 CSS，非视觉缺陷。
- boot（393x850）：context bar 45 + compact header 45，`--pi-chrome-inset` 三行都是 6px，
  控件全部 44 —— 实测干净。
