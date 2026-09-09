# 第八轮 UI/UX 收敛审计 - Lane C（全 13 面 + 实测）

审计对象：/Users/hanxiao.du/Desktop/vincent/projects/pi-web，分支 refactor/plugin-architecture，HEAD cf5f0ce1。
方法：先读源码定位，再用 @playwright/test（chromium）在运行中的 8505 栈上实测。
两套上下文：桌面 1440x900（细指针）与手机 393x850 / 平板 1024x800（isMobile+hasTouch，已核验 matchMedia("(pointer: coarse)") 为 true）。
所有几何数字都是 getBoundingClientRect / getComputedStyle 的实测值，除非明确标注为“源码推导（未实测）”。

TOTAL: 10 findings（F1-F8 有实测证据，F9-F10 为源码级证据）

---

## F1 模态外壳自己吃到了浏览器默认的蓝色焦点环（app 的焦点环是 accent 色）
- src/client/src/components/ModalSurface.ts:174（section[role="dialog"] 的样式里没有任何 :focus-visible 规则）
- src/client/src/components/ModalSurface.ts:88（initialFocus 不匹配时把焦点交给该 section）
- surface: settings / context-sheet（另：SessionCleanupDialog 同一路径）
- finding（几何/颜色）：当宿主没有传 .initialFocus 时，ModalSurface 把焦点放到 shadow 内的 section[role="dialog"] 上。该 section 是一个带 1px 边框、border-radius: var(--pi-radius-lg) 的整块对话框，UA 于是沿它整圈画自己的默认焦点环。实测（桌面 1440x900，打开设置）：document.activeElement 链末端为 section，:focus-visible = true，outline 计算值为 "rgb(0, 95, 204) auto 1px"；同一时刻 app 自己的控件焦点环是 "rgb(180, 84, 47) solid 2px"（= var(--pi-focus-ring-width) solid var(--pi-accent)）。手机 393x850 打开上下文表单（context sheet）复现同一结果：section 的 outline = "rgb(0, 95, 204) auto 1px"。截图 /tmp/r8c-settings.png、/tmp/r8c-sheet.png 里可以直接看到整张对话框外一圈亮蓝，而这一版主题的强调色是橙色。
- 波及范围：没有传 .initialFocus 的 modal-surface 宿主共三处 —— SettingsDialog.ts、appShell/ContextSwitcherSheet.ts、SessionCleanupDialog.ts（其余宿主 ModelPicker/CommandPicker/QuickSwitcher/AuthDialog/ActionPalette/SessionRenameDialog/PromptHistoryPanel/SessionTreeNavigator 都传了，焦点落在内部控件上，实测为 accent 环，正常）。
- 最小失败场景：键盘或点击打开设置（齿轮）或手机上的“更换机器、项目或工作区”，对话框一出现就整圈套上一条平台蓝边，与全 app 统一的 2px accent 环并列出现（例如设置里再 Tab 到左侧导航按钮，就同时看到蓝框 + 橙框两种焦点语言）。
- confidence: 高（实测 outline 计算值 + 截图）

## F2 model picker 同一个对话框里，两个 scope 的行字号不同（13px vs 14px）
- src/client/src/components/ModelPicker.ts:299（.options > button 声明 font: var(--pi-text-sm)/1.25）
- src/client/src/components/ModelPicker.ts:306（.catalog-row .pick 不声明字体）+ ModelPicker.ts:285（button { font: inherit } 让它继承 :host 的 var(--pi-text-base)）
- surface: model-picker
- finding（几何）：Enabled 模式的行文字是 13px / line-height 16.25px；切到 All models 后，同一列表同一位置的行文字变成 14px / line-height normal。实测（手机 393x850）：Enabled 行 button 高 55px、font-size 13px、line-height 16.25px；All models 行 .pick 高 54px（外层 .catalog-row 55px）、font-size 14px、line-height normal。也就是说一次点“All models”，每一行的标题都放大 1px 并改变行距，行内 <small>（11px）不变，于是主副两行的比例也随之变了。
- 对照：CommandPicker.ts:116 的同款行规则明确写了自己的字号（13px/1.25），说明“选项行自报字号”是这套 picker 的既定做法；catalog 行是唯一漏网的分支。
- 最小失败场景：手机上打开模型选择，在 Enabled 与 All models 之间来回切一次，列表整体字号跳动（截图对比 /tmp/r8c-model-enabled.png 与 /tmp/r8c-model-all.png，同一个 claude-opus-4-7 行的标题明显变大）。
- confidence: 高（两次实测 + 截图对比）

## F3 model picker 的选项行没有 coarse 触摸下限，而同款 picker 的行有
- src/client/src/components/ModelPicker.ts:293-298（coarse 块只抬升 header button、.scope-toggle button、input.search、input[type=checkbox]）
- src/client/src/components/CommandPicker.ts:124-128（coarse 块里包含 .options button { min-height: var(--pi-control-height-touch, 44px); }）
- surface: model-picker（对照 thinking-picker）
- finding（几何）：两个 picker 的行标记法完全一致（同样的 header + input + .options + button/span/small），thinking picker 的行在粗指针下有 44px 下限，model picker 的行没有。当前线上每个模型都带 description（PiWebApp.ts:3381-3388 把 provider 当描述），行因此被内容撑到 55px，缺陷被内容掩盖；一旦 provider 为空字符串，该行高度 = 13px x 1.25 + 上下 var(--pi-space-5) x 2 = 36.25px，低于本项目 44px 的粗指针地板，而同一对话框里的关闭键、scope 分段、搜索框实测都是 44px（手机实测：44 / 44 / 44）。
- 最小失败场景：任一 provider 字段为空的模型（或以后有人去掉描述行），手机上模型列表的行就退回 36px，与它上方 44px 的搜索框、44px 的 scope 分段并排出现高度断层。
- confidence: 中高（规则缺失与对照均为源码实测；36.25px 为算术推导，因当前数据每行都有描述而未能现场触发）

## F4 add-project 的建议行把触摸下限挂在视口宽度上，而不是指针类型 —— 正是本文件已经修过一次的同一个症状
- pi-web-plugins/workspaces/browser/ProjectDialog.ts:340（基础规则 min-height: var(--pi-control-height) = 32px）
- pi-web-plugins/workspaces/browser/ProjectDialog.ts:372（只有 @media (max-width: 760px) 才抬到 44px）
- pi-web-plugins/workspaces/browser/ProjectDialog.ts:361-364（footer 的注释白纸黑字记录了同一事故：“footer 的地板挂在视口宽度上，导致平板级触摸设备只有 ~33px 的 Cancel/Add”，并已改为按指针类型抬升）
- surface: add-project-dialog
- finding（几何）：粗指针 + 1024px 宽（平板横屏）实测：路径输入框 44px、关闭键 44x44、Cancel 44px、Add project 44px，而“建议路径”列表的每一行只有 32px（min-height 计算值 "32px"，padding 8px 10px）。这些行是这个对话框在触摸设备上最主要的导航控件（点它选文件夹），却是全对话框唯一低于地板的目标，且相邻两行之间没有任何间隔，误触概率最高。
- 最小失败场景：iPad 横屏（或任何 >=761px 的触摸设备）打开“Add project”，输入路径后逐条点建议：手指要落在 32px 高的行上，而它上方的输入框和下方的按钮都是 44px。
- confidence: 高（实测 min-height 与同屏兄弟控件对照）

## F5 消息行动作在手机上是 30x44 的目标，粗指针分支里的扩张声明与基础规则逐字相同（等于没写）
- src/client/src/components/ChatView.ts:389（.msg-action::after { inset: -10px -3px; }）
- src/client/src/components/ChatView.ts:393（@media (pointer: coarse) 里把 .msg-header-trailing / .msg-actions 的 gap 从 var(--pi-space-3)=6px 抬到 var(--pi-space-8)=20px，但 .msg-action::after 又原样重写了一遍 inset: -10px -3px）
- surface: chat / msg-row-menu
- finding（几何）：手机 393x850 实测，一行里的动作按钮 x = 264 / 308 / 352，绘制宽度 24px，即步距 44px、相邻净间隙 20px。命中测试（elementFromPoint 沿按钮中心线扫描）显示“Copy message”的可点区间是 306..334（step=2px 的采样；按声明推算为 305..335），也就是 30px 宽 x 44px 高。注释里 -3px 的理由是“6px 的间隙下对称 10px 会让相邻按钮吃掉彼此的边”，那是 6px 间隙时的结论；粗指针分支已经把间隙抬到 20px，此时左右各 10px 恰好铺满步距 44px 且零重叠，可这条分支把同一个 inset 又抄了一遍，14px 的可用间隙被白白留空。结果是聊天里唯一低于 44x44 的常用目标。
- 最小失败场景：手机上想点某条消息的“复制”，拇指落点偏 5px 就落到 .msg-header-trailing 的空白上，什么也不会发生；同一行右侧的时间戳（ⓘ）实测命中同样从 352 才开始。
- confidence: 高（实测按钮坐标 + 现场命中测试）

## F6 行式列表里，活动圆点与行菜单不在同一条中心线上（tile 变体已修，row 变体没有）
- src/client/src/components/shared.ts:397（.action-activity { top: var(--pi-space-3); right: var(--pi-space-3); } —— 相对 .action-main 定位）
- src/client/src/components/shared.ts:350-353（tile 变体的注释与修复：“活动圆点与菜单按钮共享中心线……否则读起来是相隔 10px 的两个记号”）
- surface: context-sheet / sessions（machine-list / project-list / workspace-list 的行模式）
- finding（几何）：手机 393x850 的上下文表单实测，Local 机器行：行盒 y=96..156，.action-main 右边界 329，.action-menu-toggle 占 329..373 且中心 cy=126，而 .action-activity（8x8 圆点）位于 x=315..323、cy=107。即圆点比菜单字形的中心低/高 19px（机器行）；项目行（48px 高）实测 圆点 cy=373 对 菜单 cy=386，相差 13px，水平方向再错开 6px。两个角落记号因此呈对角排布，正是 tile 变体注释里被判定为缺陷、并通过 --pi-tile-menu-inset / --pi-tile-menu-size 推导修掉的那种形态。
- 最小失败场景：手机上打开“更换机器、项目或工作区”，Machines 与 Projects 两段的每一行右上角一个小圆点、右中一个 …，扫读时读作两组记号（见 /tmp/r8c-sheet.png）。
- confidence: 中高（实测坐标；“应当共线”属设计判断，但同仓库的 tile 分支已经把它写成规则）

## F7 quick switcher 行状态标记比它并排的副标题低 5.5px
- src/client/src/components/QuickSwitcher.ts:430（.row-flag, .row-state { bottom: var(--pi-space-4); right: var(--pi-space-6); }）
- src/client/src/components/QuickSwitcher.ts:411（.row 的上下内边距是 var(--pi-space-5) = 10px）
- surface: quick-switcher
- finding（几何）：桌面 1440x900 实测“Write a 500-word story…”这一行：.row 盒 y=414..492，.row-subtitle y=466..481（中心 cy=473.5），状态圆点 y=475..483（中心 cy=479）。标记的底边距行底 9px（8px + 1px 边框），副标题的底边距行底 11px（10px + 1px 边框），两者用了两个不同的刻度（space-4 与 space-5），因此圆点永远压不到最后一行文字的中心线，实测偏低 5.5px。
- 最小失败场景：mod+p 打开快速切换器，看“WAITING FOR YOU”那张卡：副标题“test · 32 messages”与右侧的状态点明显不在一条水平线上（见 /tmp/r8c-qs.png）。
- confidence: 中高（实测坐标；偏移量小但可见，且是两个 token 混用造成的，不是刻意补偿）

## F8 位置偏移（top/right/bottom/padding-right）里的比例逃逸：守卫只看 padding/margin/gap，这些字面量因此没人管
- src/client/src/components/shared.ts:348（.list-body.tiles .action-menu { top: 4px; right: 4px; }，而同一块 shared.ts:346 已经把 --pi-tile-menu-inset 设成 var(--pi-space-2) = 4px，这里等于把同一个值又硬写了一遍，并且绕开了 shared.ts:333-338 注释所说的“两个角落记号都从同一 inset 推导”的约定）
- src/client/src/components/QuickSwitcher.ts:477（.row-menu { top: calc(100% - 4px); } —— 4px 未走 --pi-space-2）
- src/client/src/components/shared.ts:467（.code-copy-button { top: 6px; right: 6px; } —— 6px 未走 --pi-space-3）
- src/client/src/components/shared.ts:464（.code-block-wrapper pre { padding-right: 40px; } —— 该预留没有从按钮尺寸推导：按钮 24px + 6px 内缩 + 间隙，需要的是 30px 出头，40px 是拍脑袋值；这正是第六轮在 tile 上修掉的“硬写 30px 而按钮 32px”同类问题的镜像）
- surface: sessions / quick-switcher / qs-row-menu / chat
- finding（几何）：spacingScale.test.ts:26 的匹配式只覆盖 padding/margin/gap 家族，定位偏移不在其管辖内，所以以上四处像素字面量既不在刻度上、也不会被 CI 挡住。当前它们与 token 数值恰好一致（4=space-2、6=space-3），所以今天不产生可见错位；一旦有人改动 --pi-space-2/-3 或 tile 菜单尺寸，tile 菜单按钮就会与它自己的 --pi-tile-menu-inset 推导出来的活动圆点分家 —— 这就是 shared.ts:333-338 事故记录里写的那次漂移。
- 最小失败场景（潜在，非当前可见）：把 --pi-space-2 从 4px 调成 3px，粗指针下 tile 的 … 按钮仍停在 4px 内缩，而按同一 inset 推导的活动圆点跟着移动，两者重新错开。
- confidence: 中（源码实测行号；当前无可见缺陷，属守卫盲区 + 推导缺口，已标注为潜在）

## F9 add-project 的复选框行：标签间距是一个被渲染出来的空格，粗指针分支的复选框规则是逐字重复的空操作
- pi-web-plugins/workspaces/browser/ProjectDialog.ts:338（.check { display: flex; align-items: center; } —— 没有 gap）
- pi-web-plugins/workspaces/browser/ProjectDialog.ts:336 与 :358（coarse 块里的 .check input 与基础规则一字不差，等于没有抬升任何东西，而 :353-356 的注释声称“粗指针在整张表单上都拿到舒适地板……信任复选框是触摸目标”）
- surface: add-project-dialog
- finding（几何）：桌面实测两行 .check 高度均为 24px（即复选框本身的高度，行没有自己的内边距）；复选框右边界 397，标签文字左边界 403 —— 6px 的间距完全来自模板里那个被折叠的空白文本节点，不是任何 token。对照 src/client/src/components/settings/SettingsAppearancePanel.ts:124-127 的同类“复选框 + 标题 + 说明”行：那一行有 gap: var(--pi-space-5)（10px）和 padding: var(--pi-space-5)。同一产品里的两个复选框行，一个 10px token 间距、一个 6px 空格间距；触摸设备上前者的可点行高 >= 44px，后者 24px。
- 最小失败场景：手机上打开 Add project，“Trust this project”这一行只有 24px 高可点，且如果有人删掉模板里 <input> 与 <span> 之间的换行，复选框和文字会直接贴在一起。
- confidence: 中高（间距与行高为实测；“应当用 token”依据是同仓库的姊妹实现）

## F10 SettingsAppearancePanel 里 .follow 的第一条 align-items 立刻被下一行覆盖（死声明）
- src/client/src/components/settings/SettingsAppearancePanel.ts:124（.follow { ... align-items: flex-start; ... }）
- src/client/src/components/settings/SettingsAppearancePanel.ts:125（.follow { align-items: center; }）
- surface: settings-appearance
- finding：两条选择器完全相同、只隔一行的规则，后者只为改写前者的 align-items。读者要读两行才知道这行到底怎么对齐，且第一条里的 flex-start 是永远不生效的噪音（实测该 label 的计算值为 align-items: center）。这与第六轮清掉 composer 里“一整块死列表规则”是同一类清理。
- 最小失败场景：无可见渲染缺陷；改动时容易误以为 flex-start 生效而在错误的一行调对齐。
- confidence: 高（源码逐行可核；影响为可维护性而非渲染）

---

## 已实测但判定为“干净”的项（供交叉核对，不计入 findings）

- 填充控件上的对比度：在浅色主题下遍历三种状态（chat / model picker 打开 / context sheet 打开）的全部叶子节点，凡背景不透明且含文字者计算 WCAG 对比度，低于 4.5 的结果为空集（桌面与手机各跑一次）。第七轮之后没有新的填充控件掉到 AA 以下。
- composer 工具条：桌面全部 36x36（svg 18x18，中心线全部 cy=839 一致）；手机全部 44x44。附件键在输入框内为 32x32/16x16，cm-content 的 padding-right 44px 与之匹配。
- thinking picker：手机上关闭键 44x44、行 55px、行内 small 11px，与 header 12px 内边距一致，无断层。
- tile 网格（项目列表，手机与桌面）：同一行 tile 等高，标题两行钳位，活动圆点与 … 按钮共中心线（第六轮的推导仍然成立）。
- 抽屉头部：collapsed 45px（header 44 + 1px 边框），.drawer-collapse 44x44 = var(--pi-panel-header-control-height)，与侧栏头一致。
- quick switcher 行菜单按钮：桌面 32x32、圆角与卡片同为 radius-lg，贴在卡片右上角，未压住标题列（标题右边界 = 卡片右边界 - 36px 预留）。

## 未能覆盖 / 诚实记录

- 期间 8505 栈被另一进程重启过两次（观察到 npm run build + scripts/stack-8505.sh up 在跑），有两次探针以 ERR_CONNECTION_REFUSED 失败；已加重试并全部重跑，报告中的每个数字都来自成功的那次运行。
- F3 的 36.25px 是算术推导：当前 catalog 每行都带 provider 描述，行被内容撑高，现场无法直接测到缺失地板的行高，已如实标注。
- 深色主题未逐面复测（本轮实测均在当前生效的浅色主题下）；F1 的颜色对比在深色主题下只会更刺眼，不影响结论。
