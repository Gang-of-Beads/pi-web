# UI/UX 打磨审查 - Lane C（对齐/间距/控件几何 全surface走查）

审查对象：PI WEB 客户端（Lit），分支 refactor/plugin-architecture。
方法：逐行读源码 + 在 http://127.0.0.1:8505 上用 @playwright/test 的 chromium 真实渲染测量（393x850 coarse、320x568 coarse、1280x900 fine）。
临时工程：/tmp/lanec-scratch（通过 API 自建，未触碰用户数据）。
探针脚本：/tmp/lanec-*.mjs（在仓库根以 lanec-*.tmp.mjs 运行后已删除），截图 /tmp/lanec-*.png。
每条结论都标注了「源码行号（已打开核对）」或「命令 + 输出」。

---

## F1 键盘聚焦时按钮失去自身圆角（focus 环与填充变成直角）
- src/client/src/components/shared.ts:225；同一写法另见 src/client/src/components/ChatView.ts:46、src/client/src/components/PromptEditor.ts:35
- surface: sessions / boot / context-sheet / chat / chat-drawer（listStyles + ChatView + PromptEditor 覆盖的全部按钮）
- finding: 规则为 `button:focus-visible { outline: 2px solid accent; outline-offset: 2px; border-radius: inherit; }`。`inherit` 让按钮继承**父元素**的 border-radius（通常是 h2 / div，值为 0），而不是保留自己的 8px。实测：会话列表 `.cleanup-entry` 与主按钮 `.start-session-button` 在 blur 时 border-radius = 8px，取得键盘焦点的瞬间变成 0px；焦点环与 hover/focus 底色随之变成直角矩形，紧挨着的未聚焦兄弟按钮仍是 8px 圆角。
  证据（Playwright，393x850 coarse，真实 8505 应用）：
  `{"focusedR":"0px","focusedMatch":true,"blurredR":"8px","startFocusedR":"0px","startFV":true}`
  截图 /tmp/lanec-sessions-phone.png 中「Clean up」被 Tab 聚焦后是一个直角高亮块，右侧同排的「+ New session」是 8px 圆角。
- minimal failure scenario: 在会话列表按 Tab 走到「+ New session」，按钮的圆角当场消失、焦点框是直角；松开焦点又变回圆角。
- confidence: high

## F2 消息行操作按钮的触控区互相重叠，点自己会触发邻居
- src/client/src/components/ChatView.ts:378（`.msg-actions { gap: var(--pi-space-3) }` = 6px）与 src/client/src/components/ChatView.ts:381（`.msg-action::after { inset: -10px }`）
- surface: msg-row-menu（消息行操作）
- finding: 每个 24x24 的操作按钮用 `::after { inset:-10px }` 把命中区外扩到 44x44，但相邻按钮间距只有 6px，于是相邻两个命中区在水平方向重叠 14px。后一个按钮在 DOM 中更晚、同层级，命中测试胜出，因此**前一个按钮自己可见图形的右侧约 4px 属于后一个按钮**。
  证据（1280x900，挂载真实 chat-view）：两个按钮盒 `↻ x=1056..1080`、`⧉ x=1086..1110`；在 `↻` 可见盒内 2px 处取点 `(1078,72)`，`shadowRoot.elementFromPoint` 返回 `hitIndex:1, hitGlyph:"⧉"`。
- minimal failure scenario: 想点「重新发送」，指尖偏右几像素，实际把消息复制到了剪贴板。
- confidence: high

## F3 模型选择框里搜索框比同一对话框内所有控件高 18px
- src/client/src/components/ModelPicker.ts:280（`input.search` 未设 `box-sizing`，`padding: 8px 10px` + 1px 边框）与 src/client/src/components/ModelPicker.ts:288（coarse 下 `min-height: 44px`）
- surface: model-picker
- finding: `min-height` 作用在默认的 content-box 上，实际高度 = 44 + 16(padding) + 2(border) = **62px**；同一对话框里 scope 切换按钮 44px、关闭按钮 44px。搜索框成为整个弹窗里唯一一个超高控件，垂直节奏被打断。
  证据（393x850 coarse）：`search {h:62}`、`scope {h:44}`、`close {h:44}`、`scopeBox {h:52}`。截图 /tmp/lanec-mp-phone.png 中搜索框明显比上方 Enabled/All models 一排更高更胖。
- minimal failure scenario: 手机上打开模型选择，搜索框像被拉伸过，和上一行按钮不成比例。
- confidence: high

## F4 手机版设置列表的次要说明文字与标题同色（层级完全消失）
- src/client/src/components/SettingsDialog.ts:786 与 src/client/src/components/SettingsDialog.ts:787，两处使用 `var(--pi-text-muted)`
- surface: settings（phone drill-down 列表）
- finding: 全仓库没有任何地方定义 `--pi-text-muted`（token 名是 `--pi-muted`）。未定义的自定义属性在计算期无效，`color` 回落为继承值，于是「Gateway + selected machine」这类说明行和 `›` 箭头都用 `--pi-text` 渲染，与 16px 粗体标题**完全同色**。桌面侧栏用的是 `.settings-nav small { color: var(--pi-muted) }`，两套布局的层级不一致。
  证据（393x850，真实应用打开设置）：`strong.color = rgb(20,20,19)`、`small.color = rgb(20,20,19)`、`chev.color = rgb(20,20,19)`，而 `--pi-text=#141413`、`--pi-muted=#6b6860`。
  定义缺失：`grep -rn -- "--pi-text-muted" src/ pi-web-plugins/` 只命中 SettingsDialog.ts:786/787 与 ChatView.ts:271 三处使用，零处定义。
  截图 /tmp/lanec-settings-phone.png：七行说明文字全是黑体正文色。
- minimal failure scenario: 手机上打开设置，七行标题+说明糊成一片同色文字，扫不出主次。
- confidence: high

## F5 快速切换器的会话状态圆点被 44x44 的行菜单按钮整个盖住
- src/client/src/components/QuickSwitcher.ts:423（`.row-flag, .row-state { position:absolute; top:50%; right:12px }`）与 src/client/src/components/QuickSwitcher.ts:482（coarse 下 `.row-menu-toggle { width:44px; min-height:44px }`，定位见 :463 `top:0; right:0`）
- surface: quick-switcher
- finding: 卡片实测高 77px，状态徽标中心在 y≈中线（卡内 ~34px），而 `⋯` 按钮从卡片顶部 0 起算占 44x44，右侧占满 44px。两个矩形完全相交：状态点落在菜单按钮的盒子里。
  证据（393x850 coarse，挂载真实 quick-switcher）：`state {x:360,y:731,w:9,h:9}`、`toggle {x:338,y:697,w:44,h:44}`，在状态点中心 `elementFromPoint` 返回 `row-menu-toggle`（`hitIsToggle:true`）。
  截图 /tmp/lanec-qs-phone.png：`⋯` 正下方紧贴着三点状态徽标，两个「三点」图形上下叠在同一个角里。
- minimal failure scenario: 手机上想看会话状态点，点它却弹出行菜单；视觉上还有两个几乎一样的三点图形挤在同一角。
- confidence: high

## F6 卡片网格里活动圆点比 ⋯ 菜单低 10px（角标不在同一条中线上）
- src/client/src/components/shared.ts:343（`.list-body.tiles .action-activity { top: 7px; ... }`）与 src/client/src/components/shared.ts:324 / :340（tile 菜单按钮 32px / coarse 36px，:339-341 的 `--pi-tile-menu-inset` 为 6px / 4px）
- surface: boot（项目网格）、sessions（workspace 卡片）
- finding: 活动点中心固定在卡内 y=12px（top 7 + 半径 5），菜单按钮中心在 y=22px（inset 6 + 半高 16，coarse 为 4+18）。两个角标之间恒定错位 **10.0px**，且这一错位在三个断点上完全一致，说明是派生公式没把两者对齐。
  证据（真实 8505 项目网格）：393x850 `deltaCy:10`；320x568 `deltaCy:10`；1280x900 `deltaCy:10`。
  截图 /tmp/lanec-boot-phone.png：橙色活动点明显浮在 `⋯` 上方，不在一条水平线上。
- minimal failure scenario: 项目网格里两个角标一高一低，像有一个没对齐。
- confidence: high

## F7 添加项目对话框的主按钮没有前景色，实测对比度 3.3:1
- pi-web-plugins/workspaces/browser/ProjectDialog.ts:367（`.primary { border-color: var(--pi-success-border); background: var(--pi-success-border); }`，未设 `color`）
- surface: add-project-dialog
- finding: 主按钮只换了背景，文字仍继承 `var(--pi-text)`。在应用当前使用的浅色主题里，实测 `bg = rgb(85,112,47)`、`color = rgb(20,20,19)`，对比度 = **3.34:1**（12px 文字要求 4.5:1）。同类主按钮 `.start-session-button` 明确写了 `color: var(--pi-accent-contrast, #fff)`（src/client/src/components/SessionList.ts:697），两者做法不一致。
  证据（393x850 真实应用，打开「+Add project」）：`primary {"color":"rgb(20, 20, 19)","bg":"rgb(85, 112, 47)","h":44}`。
  截图 /tmp/lanec-addproject-phone.png：绿底上的深色「Add project」几乎读不出来。
- minimal failure scenario: 浅色主题下，添加项目对话框里最主要的提交按钮文字在绿底上发糊。
- confidence: high

## F8 添加项目的路径输入框使用平台默认蓝色焦点环，与主题强调色冲突
- pi-web-plugins/workspaces/browser/ProjectDialog.ts:334（input 样式，无 `:focus-visible`），对照 src/client/src/components/QuickSwitcher.ts:402（`input:focus-visible { outline: 2px solid var(--pi-accent) }`）与 src/client/src/components/ModelPicker.ts:281（`input.search:focus { border-color: var(--pi-accent) }`）
- surface: add-project-dialog
- finding: 该对话框只从宿主 adopt 了 listStyles，其中仅有 `.list-search-input:focus-visible` 一条，普通 `input` 没有任何焦点样式，于是落到 UA 默认的蓝色 2px 环。对话框打开即自动聚焦这个输入框，所以浏览器蓝直接出现在一个橙色强调色的主题里。
  证据：截图 /tmp/lanec-addproject-phone.png，输入框是明显的浏览器蓝圆角环，而同屏「Create the folder」复选框是主题橙。
- minimal failure scenario: 点「Add project」，弹出的第一眼就是一圈与主题无关的系统蓝。
- confidence: high

## F9 快速切换器重命名行：输入框 44px，旁边的确认/取消按钮 40px
- src/client/src/components/QuickSwitcher.ts:489（coarse 下 `.rename-input { min-height: 44px }`）与 src/client/src/components/QuickSwitcher.ts:498（`.rename-actions button { width: 40px; min-height: 40px }`，coarse 段 :478-490 未把它提上来）
- surface: quick-switcher
- finding: 同一行里输入框 44px、两个图标按钮 40px，`align-items: center` 让它们上下各差 2px；同时该文件顶部注释声称「快速切换器在触屏上的每个目标都是 44px」（:474-477），这两个按钮是唯一的例外，且低于自定的 coarse 下限。
- minimal failure scenario: 手机上重命名会话时，输入框和右侧的 ✓ / × 明显不等高，两个按钮比同屏其他触控目标小一圈。
- confidence: high

## F10 快速切换器卡片：标题与副标题右边界不齐（相差 30px / 触屏 52px）
- src/client/src/components/QuickSwitcher.ts:411（`.row { padding: ... 34px ... }`）、:462（`.row-title { padding-right: 30px }`）、:486（coarse `.row-title { padding-right: 52px }`）、:418（`.row-subtitle` 无额外右内边距）
- surface: quick-switcher
- finding: 标题的可用宽度被扣了 34+30=64px（触屏 34+52=86px），副标题只被扣 34px。同一张卡里上下两行文字的截断/省略号位置差 30px（触屏 52px），右侧留白呈阶梯状。
  证据（1280x900）：`titlePR:"30px"`、`rowPR:"34px"`；393x850 coarse：`titlePR:"52px"`、`rowPR:"34px"`。
  截图 /tmp/lanec-qs-phone.png：长标题的 `…` 停在明显比下方「3 messages」更靠左的位置。
- minimal failure scenario: 会话卡片里标题被切得比副标题早半厘米，右边缘参差。
- confidence: high

## F11 外观面板：正在生效的主题卡片没有任何视觉标记
- src/client/src/components/settings/SettingsAppearancePanel.ts:71（渲染 `active` class）、:131（只有 `.theme.selected` 有样式，无 `.theme.active`）、:133（后缀文字 11px）、src/client/src/themeCardLabel.ts:16
- surface: settings-appearance
- finding: `active`（当前实际渲染的主题）只通过 `.theme-scheme` 里追加的 11px 灰字「· in use」表达，卡片边框、底色、阴影与完全无关的卡片一模一样；而 `selected`（用户挑选的那张）有 accent 边框 + 1px inset 阴影。两个状态一个是重样式一个是零样式。
  证据（393x850 真实应用 → 设置 → Appearance）：`{"t":"Clay Paper ... Light · in use","sel":false,"act":true,"bc":"rgb(213, 210, 198)","sh":"none"}` 与无关卡片 `{"bc":"rgb(213, 210, 198)","sh":"none"}` 完全相同；被选中的 Clay 则是 `bc:"rgb(180, 84, 47)", sh:"rgb(180, 84, 47) 0px 0px 0px 1px inset"`。
- minimal failure scenario: 开着「跟随系统」时，用户看不出屏幕上正在用的是哪张主题卡，只能去读一行 11px 灰字。
- confidence: high

## F12 会话抽屉标签 22px、旁边的折叠按钮 32px，同一条 36px 头部里三种高度
- src/client/src/components/ChatView.ts:152（`.drawer-tab { min-height: 22px; font-size: var(--pi-text-2xs) }`）与 src/client/src/components/ChatView.ts:165（`.drawer-collapse { width:32px; height:32px }`），头部 :134 `min-height: var(--pi-panel-header-height)` = 36px（src/client/index.html:77）
- surface: chat-drawer
- finding: 精细指针下同一行里标签按钮 22px、折叠按钮 32px，差 10px；标签的选中态是一个 22px 高的浅色小块，紧挨着一个 32px 的图标按钮，两者的可视块高度不成体系。coarse 下两者都被提到 44（:168-169），说明只有桌面态漏了统一 token。
- minimal failure scenario: 桌面上展开会话抽屉，标签条的选中块比右侧折叠按钮矮一截，像两套控件拼在一起。
- confidence: medium

## F13 抽屉标签的计数是裸文字「(3)」，而项目里已有一个从未被使用的 badge 组件
- src/client/src/components/ChatView.ts:2344-2347（`sectionBadgeSuffix` 返回 `` ` (${badge})` ``，在 :1093 直接拼进标签文本）；已定义但零使用的 `.tab-badge`：src/client/src/components/shared.ts:181、src/client/src/components/PiWebApp.ts:146
- surface: chat-drawer
- finding: 抽屉标签的数量以纯文本括号追加在标题后，字号、颜色、粗细与标题完全相同，没有任何 badge 形状；仓库里同时存在设计好的 `.tab-badge`（pill 圆角、success 边框/底色、line-height 16px），`grep -rn "tab-badge" src pi-web-plugins | grep -v "\.tab-badge {"` 无任何命中，即从未被应用到元素上。同一个「标签 + 计数」模式在项目内有两种完全不同的呈现意图，落地的是没样式的那种。
- minimal failure scenario: 抽屉标签写着「Activity (3)」，数字和标题一样灰、一样细，扫不出来。
- confidence: high

## F14 输入区一行里三种控件高度：40 / 36 / 32
- src/client/src/components/PromptEditor.ts:75（`.select-model { min-height: 40px }`）、:79（`.icon-button { 36x36 }`）、:86（`.editor-attach { 32x32 }`）；:189 在窄屏才把 icon-button 提到 40
- surface: chat（composer）
- finding: 桌面实测同一底部工具条里，模型按钮 40px，思考等级/听写/发送/停止四个图标按钮 36px，输入框内的回形针 32px。三档高度没有 token 统一，只有在 `@media` 断点内才偶然对齐。
  证据（1280x900 真实会话）：`select-model {h:40}`、`Thinking level {h:36}`、`Dictate {h:36}`、`Send message {h:36}`、`Stop current work {h:36}`、`Attach files {h:32}`。
- minimal failure scenario: 桌面输入区，模型胶囊比右边四个图标按钮高一圈，回形针又更小。
- confidence: high

## F15 各对话框的关闭按钮尺寸/字号/圆角互不相同
- src/client/src/components/SettingsDialog.ts:766（44x44，字号 24，无圆角）
- src/client/src/components/appShell/ContextSwitcherSheet.ts:85（44x44，字号 `--pi-text-xl`=20，圆角 `--pi-radius-md`）
- pi-web-plugins/workspaces/browser/ProjectDialog.ts:365-366（字号 22，精细指针下无尺寸，coarse 才 44x44）
- src/client/src/components/ModelPicker.ts:279/286（字号 20，精细指针下无尺寸；实测 24x25）
- src/client/src/components/QuickSwitcher.ts:403/479（`--pi-text-xl`，精细指针下实测 28x20）
- surface: settings / context-sheet / add-project-dialog / model-picker / quick-switcher
- finding: 五个对话框的同一个 `×` 控件有 20/22/24 三种字号、0 与 8px 两种圆角、以及 44x44 / 28x20 / 24x25 三种盒子。桌面上有三个对话框的关闭键低于 24x24 的最小可点尺寸。
  证据：`mp-desktop close {h:25,w:24,r:"0px",fs:"20px"}`；`qs-desktop close {w:28,h:20}`；`settings close {h:44,w:44,fs:"24px"}`；`addproject close {w:44,h:44,fs:"22px",r:"8px"}`。
- minimal failure scenario: 同一次会话里连开三个对话框，右上角的 × 每次都换一个大小。
- confidence: high

## F16 模型选择框 scope 切换：外框 8px 圆角，内嵌 4px 的按钮却是 6px 圆角
- src/client/src/components/ModelPicker.ts:274（外框 `padding: 3px; border: 1px; border-radius: 8px`）与 :275（内按钮 `border-radius: 6px`）
- surface: model-picker
- finding: 内层相对外层内缩 4px（3px padding + 1px border），要做同心圆角内半径应为 8-4=4px，实际给了 6px，选中态色块的圆角比外框更「圆」，两条弧不平行。
  证据（393x850）：`scopeBox {h:52, r:"8px"}`、`scope {h:44, r:"6px"}`。截图 /tmp/lanec-mp-phone.png 中蓝色 Enabled 块的角比外框的角更圆。
- minimal failure scenario: 分段控件的选中块看起来「胀」出外框的弧线。
- confidence: medium

## F17 快速切换器的机器标签画成了「贴合式 tab」，但下方没有任何可贴合的线
- src/client/src/components/QuickSwitcher.ts:432（`.machine-tabs`，无 border-bottom）与 :434（`.machine-tab { border-bottom: 0; border-radius: md md 0 0 }`），下一行 `.filters` 在 :439 才有 border-bottom
- surface: quick-switcher
- finding: 标签刻意去掉了底边并只圆上面两角（典型的贴合式 tab 语义），但容器没有底部横线可贴，于是每个标签渲染成一个**底边敞开的方框**浮在筛选 chip 之上；选中的标签是三边 accent 描边、底边缺口。同时桌面下标签 36px、下一行 chip 32px（:434 vs :440），两条紧邻的横向条带高度不一致。
  证据：截图 /tmp/lanec-qs-phone.png 中「Local」是一个底边缺口的蓝框；`qs-desktop tab {h:36}`、`chip {h:32}`。
- minimal failure scenario: 手机上打开快速切换器，最上面两个机器标签像两个没画完的框。
- confidence: medium

## F18 「✓ current」当前值标记是拼进标签字符串的裸文字
- src/client/src/components/PiWebApp.ts:3366（模型列表）、:3500（思考等级）、:3390（主题 auto）以及 src/client/src/components/ModelPicker.ts:175（All models 行）
- surface: model-picker / thinking-picker
- finding: 「当前值」这一状态被拼接成标签文本 `${id} ✓ current`，与模型名同字号同颜色，没有 badge、没有独立色。行本身已经有 `.selected` 底色与 `aria-current`，但那表示的是键盘游标位置，两种含义共用一处又只有其中一种有样式；`✓`(U+2713) 的字身高于小写字母，插在名字中间读起来像名字的一部分。
  证据：截图 /tmp/lanec-mp-phone.png 的「claude-opus-5 ✓ current」、/tmp/lanec-tp-phone.png 的「medium ✓ current」。
- minimal failure scenario: 用户在列表里找「我现在用的是哪个」，只能逐行读文字，找不到可扫的标记。
- confidence: high

## F19 思考等级弹窗的列表容器焦点环是矩形，被对话框 12px 圆角切角
- src/client/src/components/CommandPicker.ts:104（`.options:focus-visible { outline: 2px solid accent; outline-offset: -2px }`），对话框圆角与裁剪见 src/client/src/components/ModalSurface.ts:174（`border-radius: var(--modal-surface-radius, 12px); overflow: hidden`）
- surface: thinking-picker
- finding: 打开时初始焦点落在 `.options` 容器（:26 `initialFocus=".options"`），于是出现一个包住整张列表的矩形焦点框：上两角是直角（贴着 header 分隔线），下两角被对话框的 12px 圆角裁掉，一条焦点环出现三种角形。
  证据：截图 /tmp/lanec-tp-phone.png。
- minimal failure scenario: 用键盘打开思考等级，整张列表被一个直角蓝框套住，底部两角被削平。
- confidence: medium

## F20 添加项目对话框的页脚按钮只在窄屏拿到 44px，粗指针下未提升
- pi-web-plugins/workspaces/browser/ProjectDialog.ts:362（`@media (max-width: 760px)` 里 `footer button { min-height: 44px }`）与 :350-354（`@media (pointer: coarse)` 段只提升了输入框、复选框和链接）
- surface: add-project-dialog
- finding: 该文件的注释（:346-349）声明「粗指针下整表都拿到舒适下限」，但页脚的 Cancel / Add project 走的是宽度断点。宽度 ≥761px 的触屏（平板横屏）下输入框 44px、页脚按钮仍是 `padding: 7px 9px` 约 31px，同一对话框内触控目标两套标准。
- minimal failure scenario: 平板横屏添加项目，输入框很好按，底部两个按钮明显更细更难点。
- confidence: medium

---

## 已核查但判定为非问题（避免下游重复排查）
- 消息操作图标 `↻` 与 `⧉` 的光学中心：实测 `gcy=71.5` vs 按钮中心 `cy=72`，偏移 0.5px，字形宽度 11.2 / 11.3，不构成基线漂移。
- 主题卡片高度 170/185/201px：同一网格行内的卡片实测等高（stretch 生效），跨行差异来自描述文字长度，属预期。
- 320px 宽度下项目网格降为单列（实测 tile w=296）、快速切换器页脚/输入均为 44px，未见塌陷。

TOTAL: 20 findings.
