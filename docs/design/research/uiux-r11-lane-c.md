# R11 Lane C — 13 个界面的全量打磨复审（含 8505 实测）

## 测量条件（必读，关系到结论的可信度）

- 仓库：/Users/hanxiao.du/Desktop/vincent/projects/pi-web，分支 refactor/plugin-architecture，HEAD 843e103e。
- 工作区是脏的，并且在本次审计过程中被其他 lane 并发改写。我在测量开始时读到的 QuickSwitcher.ts / SettingsAppearancePanel.ts / ChatView.ts 与我写报告时读到的已经不同（例如 QuickSwitcher 的 pin 标记在测量期间由 Unicode 字形改成了 SVG，主题卡片的 .theme-scheme 由 line-clamp:1 改成了 min-height 两行）。
- 实测手段：@playwright/test chromium 无头，复用 scripts/audit-uiux-full.mjs 的 13 个 DRILLS/OPENERS，两种视口：桌面 1280x900 与手机 393x850（hasTouch + isMobile，已确认 pointer: coarse）。
- 我另写了两支探针：一支遍历所有 shadow root 采集每个元素的 rect/padding/radius/font/contrast；一支用 canvas measureText 的 actualBoundingBox 测量字形墨迹（ink）尺寸，用来比较同一个符号在不同界面上的实际视觉大小。产物：/tmp/r11c/inv-{desk,phone}.json、/tmp/r11c/glyph-{desk,phone}.json、/tmp/r11c/align-phone.json 及各界面截图。
- 未能实测的部分（诚实标注，不当作通过）：
  - context-sheet 桌面 drill 的 opener 找不到触发器（precondition missing），手机 drill 虽然没报错但截图显示打开的是导航面板而非上下文面板 —— 该界面本轮我只做了源码审读，没有实测数字。
  - 复核阶段（约在测量后 25 分钟）8505 栈先是只渲染出 50 个元素，随后 ERR_CONNECTION_REFUSED，应为其他 lane 在重建/重启。因此下面的实测数字来自那一次完整、连贯的运行；每条结论的源码行号我在写报告时逐条对当前工作区重新 grep 校准过，凡是源码已被并发改动的我都单独标注。
- 主题：实测时运行的是浅色主题（Clay Paper）。对比度扫描（叶子文本节点，逐层合成祖先背景与 opacity）在 13 个界面上没有低于 AA 的命中，因此本轮没有对比度类新发现。

---

## F1 消息头的角色标签比正文左出 2px，而事件组标签又对齐正文

- src/client/src/components/ChatView.ts:375（.msg > .msg-header：margin 的横向为 calc(-1 * var(--pi-space-6)) 即 -12px，padding 却是 var(--pi-space-1) var(--pi-space-5) 即 2px 10px）
- src/client/src/components/ChatView.ts:384（.group-msg > .msg-header：padding 横向为 0，因此它的标签落在正文列上）
- 界面：chat / chat-drawer / msg-row-menu
- 发现（几何陈述）：手机 393px 实测，.msg 文章外框 x=6，1px 边框 + 12px padding 得到内容列左边界 x=19；正文 .formatted 实测 x=19；而消息头里的角色标签 B.label 实测 x=17。消息头用 -12px 负 margin 拉到出血，却只补了 10px 的 padding，差值 2px 全部体现在标签位置上。同一条竖直阅读线上，事件组 SUMMARY 的 B.label 实测 x=19。于是转录区里出现三个左边界：user/assistant 标签在 17，events 标签在 19，正文在 19。右侧同理：消息头右缘 x=386，而正文列右缘 19+355=374，头部尾端的 .msg-meta 方框右缘落在 376，比正文列外溢 2px。
- 最小失败场景：393x850 打开任一会话，量 .msg .msg-header .label 与其下 .formatted 的 getBoundingClientRect().left，两者应相等；实测 17 vs 19。把消息头的横向 padding 改成 var(--pi-space-6)（与负 margin 同值）即可同时修好左右两侧。
- 置信度：高（实测，两个视口一致；数据在 /tmp/r11c/align-phone.json）。

## F2 转录区的“已显示第几条”落在字号刻度之外（10px），与同一格里的兄弟文本不同字号

- src/client/src/components/ChatView.ts:1666（return html`<small>Showing messages …</small>`）
- src/client/src/components/ChatView.ts:320（.history-boundary { font-size: var(--pi-text-xs) } 即 12px）
- src/client/src/components/ChatView.ts:360（.history-boundary small 只声明了颜色，没有声明字号）
- 界面：chat（桌面 sessions drill 与手机 chat drill 都命中）
- 发现（几何陈述）：该 <small> 没有任何 font-size 声明，于是走 UA 的 small 缩放：实测 computed font-size = 10px，而它的兄弟 <span>（Beginning of session / Scroll up to load earlier messages）实测 12px。刻度里最小的一档是 --pi-text-2xs = 11px（src/client/index.html:39），10px 不在刻度上。typeScale.test.ts 读的是声明，未声明的 <small> 从它下面漏过去了。
- 最小失败场景：打开任意有历史的会话，读转录顶部的 history-boundary：同一居中栈里上行 12px、下行 10px，两行大小不等且下行小于刻度下限。
- 置信度：高（实测 computed 值 10px，桌面与手机各一次）。

## F3 设置里同一种次要说明行有两种字号，其中一种（11.67px）不在刻度上

- src/client/src/components/settings/SettingsGeneralPanel.ts:85 与 :143（<small>Existing file</small> 等）
- src/client/src/components/settings/SettingsGeneralPanel.ts:273（.config-path-card small, .field small 只声明颜色）
- 对照：src/client/src/components/settings/SettingsShortcutsPanel.ts:362 与 :383 明确声明了 var(--pi-text-xs) / var(--pi-text-2xs)
- 界面：settings
- 发现（几何陈述）：settings drill 实测 SMALL 元素 computed font-size = 11.6667px（父级 14px 走 UA 的 smaller）。同一个设置对话框里，Keyboard 面板的同类说明行是 12px / 11px，General、Session daemon、Pi packages、PI WEB plugins 面板的说明行是 11.6667px。11.6667 不在 {11,12,13,14,15,17,20} 刻度上，且切换左侧面板时同一位置的说明文字大小会跳动。
- 最小失败场景：打开设置 → General，量任一 <small> 的 computed font-size（11.6667px）；再点 Keyboard，量 .shortcut-status small（11px）。
- 置信度：高（实测）。

## F4 上下文栏的标题有一条死声明，导致手机首屏两条 chrome 行的阅读边不同（10 vs 6）

- src/client/src/components/appShell/AppContextBar.ts:79（.session-title { padding-inline: 0; … padding: var(--pi-space-2) var(--pi-space-2); }：同一条规则里后写的 padding 简写把前面的 padding-inline: 0 整个覆盖掉了，那条声明是死的）
- 对照：src/client/index.html:76-77 定义 --pi-chrome-inset 的注释明确写着，它存在就是为了让 bar、compact header 和下方会话共享一条阅读边
- 界面：boot / sessions（手机；这两屏 panelToggleHidden 为真，见 src/client/src/appShell/panelCollapseController.ts:74）
- 发现（几何陈述）：手机 393px 实测 boot 屏：NAV.context-bar padding 左右 6px（=--pi-chrome-inset），但因为汉堡按钮被隐藏，标题按钮成为首个子元素，它自身还有 4px 的 padding，于是 SPAN.session-title-text 实测 x=10；紧挨着的下一条 chrome 行 SPAN.compact-scope-name 实测 x=6。两条上下相邻的 chrome 行文本左边界相差 4px。sessions 屏同样：10 vs 6。
- 最小失败场景：393x850 冷启动，量 .session-title-text 与 .compact-scope-name 的 left，应相等；实测 10 vs 6。修正方式是把那条死的 padding-inline: 0 写到 padding 简写之后（或直接把简写改成纵向 padding）。
- 置信度：高（实测，两屏一致）。

## F5 快速切换器的关闭键是整个组件里唯一没声明字体的控件，落回 Arial，与其他对话框的同一个叉不同大小

- src/client/src/components/QuickSwitcher.ts:403（.close 声明了 width/height/font-size，唯独没有 font 或 font-family）
- 对照同文件：411、443、449、480、508、512 六条按钮规则都写了 font: inherit；469 的 .row-menu-toggle 写了 font: var(--pi-text-xs) var(--pi-font-ui)
- 对照：src/client/src/components/SettingsDialog.ts:766（button { … font: inherit }）让它的 .close-button 拿到应用字体
- 界面：quick-switcher（与 settings / model-picker 的关闭键并排比较）
- 发现（几何陈述）：canvas 墨迹实测，同为 20px 的叉，快速切换器里解析到的 font-family 首选项是 Arial，墨迹 8.52 x 8.52px、advance 11.68px；设置对话框与模型选择器里解析到 ui-sans-serif，墨迹 9.27 x 9.61px、advance 12.03px。也就是同一个动作的同一个符号，在两个对话框之间宽 8.8%、高 12.8% 的差异，且字面本身不是同一款字体。round ten 把关闭键的尺寸统一到了 comfort，字体这一维没有跟上。
- 最小失败场景：分别打开快速切换器和设置，读两个关闭按钮的 getComputedStyle().fontFamily：一个是 Arial 栈，一个是 --pi-font-ui。
- 置信度：高（实测 computed font-family + 墨迹测量；见 /tmp/r11c/glyph-desk.json）。

## F6 目标插件的刷新键同样漏声明字体（Arial），字形来自文本而非图标

- pi-web-plugins/goals/goalsSectionElement.ts:21（.refresh 声明了 font-size: var(--pi-text-md)，没有 font-family）
- 界面：chat-drawer（手机 drill 中的 goal-row）
- 发现（几何陈述）：实测该按钮 44 x 44（coarse 达标），但 computed font-family 首选项是 Arial，15px 的 ↻ 墨迹 7.73 x 7.45px；它上下的其他控件走的是 --pi-font-ui。同一行里出现一个非应用字体的符号。另外这是一个文本字形，而 round ten 之后本项目的房规是画图标（同一屏的 disclosure、panel-toggle、edge-button 都是 SVG）。
- 最小失败场景：手机打开带目标的会话，读 .refresh 的 computed fontFamily（Arial 栈）与相邻 SVG 图标控件对比。
- 置信度：高（实测）。

## F7 三个 picker 的关闭键在鼠标下是 32，而同屏的兄弟控件和其他对话框是 36

- src/client/src/components/ModelPicker.ts:286（header button { width/height: var(--pi-control-height) }）
- src/client/src/components/CommandPicker.ts:112（同一条规则，thinking picker 与命令面板走这里）
- 同屏对照：src/client/src/components/ModelPicker.ts:281（.scope-toggle button 用 --pi-control-height-comfort）
- 其他界面对照：src/client/src/components/SettingsDialog.ts:767 与 src/client/src/components/QuickSwitcher.ts:403 都是 comfort
- 界面：model-picker / thinking-picker
- 发现（几何陈述）：桌面 1280 实测，模型选择器关闭键 32.00 x 32.00（y=143），紧邻其下的两个 scope 按钮 36.00（y=203）；思考等级选择器关闭键同样 32.00 x 32.00；设置对话框关闭键 36 x 36；快速切换器关闭键 36 x 36。也就是说 round ten 声称的“所有对话框关闭键都用 comfort 尺寸”在 picker 这一族上没有落地，且它在自己的 header 里就比正下方的兄弟控件小 4px。
- 最小失败场景：桌面打开模型选择器，量右上角关闭键（32）与其下 Enabled/All models（36）。
- 置信度：高（实测；这是对 round ten 已声明修复项的复核，结论是该修复漏了 picker 这一族，属于新发现而非重报）。

## F8 同一个“更多”动词的 ⋯ 在两类行菜单上差 41% 的墨迹宽度

- src/client/src/components/shared.ts:353（列表样式里的 button { font: var(--pi-text-xs) … }，.action-menu-toggle 走这一档，见 shared.ts:330 与 :435 的尺寸规则）
- src/client/src/components/QuickSwitcher.ts:469（.row-menu-toggle { … font-size: var(--pi-text-lg) }）
- 触发点：src/client/src/components/SessionList.ts:426、pi-web-plugins/workspaces/browser/ProjectList.ts:122、pi-web-plugins/workspaces/browser/WorkspaceList.ts:235、pi-web-plugins/machines/browser/MachineList.ts:170、src/client/src/components/QuickSwitcher.ts:221 都渲染同一个 ⋯
- 界面：sessions / qs-row-menu（以及 boot 的项目磁贴）
- 发现（几何陈述）：canvas 墨迹实测，列表行/磁贴的 ⋯ 在 12px 下墨迹 9.24 x 1.50px；快速切换器磁贴角上的 ⋯ 在 17px 下墨迹 13.08 x 2.12px。两者是同一个动词、同一种位置（行右上角的溢出菜单），墨迹宽度相差 41.6%、高度相差 41.3%。round ten 统一了这些菜单的底色和圆角，字号这一维没统一。
- 最小失败场景：同一屏无法并列，但连续打开会话列表行菜单与快速切换器磁贴菜单，两个 ⋯ 的视觉重量明显不同；读各自的 computed font-size：12px vs 17px。
- 置信度：高（实测墨迹 + computed 字号）。

## F9 工作区面板的按钮画出 29px，低于 --pi-control-height 的 32

- src/client/src/components/shared.ts:175（workspacePanelStyles 的 button：font var(--pi-text-xs) + padding var(--pi-space-3) var(--pi-space-4) + 1px 边框，没有任何 min-height）
- 界面：chat（桌面 >=1180px 时右侧工作区面板；实测取自 model-picker/thinking-picker drill 的同屏背景）
- 发现（几何陈述）：桌面 1280 实测 BUTTON.workspace-fullscreen-toggle 93.98 x 29.00，文件面板工具条的 Upload 58.30 x 29.00、Refresh 61.45 x 29.00。29 = 15px 行高 + 6+6 padding + 2px 边框，比控件刻度的鼠标档 32 少 3px，也不在 {32,36,44} 任一档上。round nine 的 boxModelGuard 抓的是同时写了 min-height 与 padding 的规则，这里因为压根没写 min-height 而漏过。
- 最小失败场景：桌面 1280 打开任一会话，量右上角 Expand panel 按钮高度（29），与左栏 .action-menu-toggle（32）并置。
- 置信度：高（实测）。

## F10 文件树里目录行 29px、文件行 23px，前导槽一个是画出来的图标、一个是文本点

- src/client/src/components/shared.ts:207（.row 用 grid-template-columns: 18px minmax(0,1fr)，行高完全由前导格内容决定，没有 min-height/控件下限）
- pi-web-plugins/files/filesPanelElement.ts:148（目录取 renderHostDisclosureIcon(...)，文件直接写字符串 ·）
- 界面：chat（桌面工作区面板中的 Files）
- 发现（几何陈述）：桌面实测同一棵树里 BUTTON.row 目录行 397.59 x 29.00，文件行 397.59 x 23.00，相差 6px；前导 SPAN 目录 18 x 21（内含 18x18 SVG），文件 18 x 15（一个 12px 的 · 文本行盒）。行高随内容类型跳动，扫读时列表节奏断裂；同时房规在 round ten 已经把 disclosure 统一成画出来的图标，文件行仍然用文本字形当标记。
- 最小失败场景：桌面打开 Files 面板，量任一目录行与其下文件行的 height：29 vs 23。给 .row 一个统一的行高（或给前导槽固定 18x18 的盒子并把 · 换成绘制的标记）即可。
- 置信度：高（实测）。

## F11 消息元信息在手机上用文本字形 ⓘ 当图标，墨迹比同排两个动作大约 30%

- src/client/src/components/ChatView.ts:412（.msg-meta:not(.expanded) 设为 24x24 inline-grid，font-size: 0）
- src/client/src/components/ChatView.ts:416（.msg-meta::before { content: ⓘ; font-size: var(--pi-text-sm) }）
- 界面：chat / chat-drawer（手机）
- 发现（几何陈述）：手机实测三个并排控件的外框都是 24 x 24（x=264 / 308 / 352，间距一致），但墨迹尺寸分别为：↻ 9.54 x 11.57、⧉ 9.39 x 9.35、ⓘ 12.34 x 12.34。信息标记比左边两个动作宽 29.5%、高 32%，因为它用的是 13px 的实心圆圈字形而两个动作是 14px 的线性字形。三者是同一排、同一尺寸盒子里的兄弟控件，视觉重量不齐；而且这三个都是文本字形而非绘制图标（房规在 round ten 已把听写、提示历史、批量选择、设置下钻改成画图标）。
- 最小失败场景：393x850 打开会话，逐个量三个 24x24 控件的字形墨迹或直接看截图 /tmp/r11c/phone-chat.png：ⓘ 明显比 ↻ 与 ⧉ 大一圈。
- 置信度：高（实测墨迹；文本字形替代图标这一点是房规一致性判断，标注为设计取向问题）。

## F12 主题卡片的“已选但被系统覆盖”这句话被自己的一行夹断（测量后已被并发改动，需复验）

- src/client/src/themeCardLabel.ts:15（autoOverriding 时返回 · chosen, but following your system）
- src/client/src/components/settings/SettingsAppearancePanel.ts:73（把这句话拼在 .theme-scheme 行尾）
- src/client/src/components/settings/SettingsAppearancePanel.ts:137（测量时该规则为 -webkit-line-clamp: 1 且 min-height: calc(1 * 1.4em)；我写报告时重读，该行已变成 .theme-scheme { min-height: calc(2 * 1.4em); }）
- 界面：settings-appearance
- 发现（几何陈述）：测量时实测 Clay 卡片的 .theme-scheme scrollHeight = 31、clientHeight = 15，可用宽度 211px，即这句话需要两行而容器只给一行，被 line-clamp 截成 Dark · chosen, but following…。这条句子的存在理由（模块注释写得很清楚：让被系统覆盖这件事不再沉默）恰恰落在被裁掉的那半句上。其余七张卡片 scrollHeight = clientHeight = 15，只有这一张溢出，所以是这句话的长度与一行夹断的冲突，不是普遍问题。
- 最小失败场景：开启 follow the system，再选一张与系统方案相反的主题，打开设置 → Appearance，读该卡片第二行。
- 置信度：中（缺陷本身是实测；但源码在我测量之后已被其他 lane 改动，当前工作区的规则已给两行高度。请以当前源码复验，不要重复修复）。

---

## 复核过、判定为真但不重复报告的既有修复

- 磁贴活动点与行菜单共中线：实测项目磁贴 .action-activity 中心 y=214、.action-menu-toggle 中心 y=214，一致。
- --pi-row-min-height：快速切换器磁贴 min-height 实测生效（内容更高时按内容撑开，78px 是两行标题 + 副标题的结果，不是刻度逃逸）。
- 圆角刻度：两种视口 13 个界面共采集数千个元素，computed border-radius 全部落在 {0,4,6,8,12,16,999px,50%}，零逃逸。
- 对比度：叶子文本节点逐层合成背景后扫描，AA（4.5 / 大字 3.0）无命中。
- .action-row 的 3px 左侧状态轨是 shared.ts:412 明文设计（state rail），不是不对称 padding 的 bug。
- 磁贴 .action-main 的 12px 圆角在 8px 圆角的 .action-row 内：父级 overflow: hidden 且父子同底色，实际不可见，判定不成立。

## 本轮未覆盖 / 需要下一轮补的

- context-sheet：opener 在两种视口下都没能真正打开该面板，本轮无实测数据；建议下一轮给 audit-uiux-full.mjs 的 contextSheet opener 换一个确定的选择器（它现在靠 aria-label 里含 Switch 或 context 的模糊匹配，会误点到别的按钮）。
- add-project-dialog 的实测只做到了打开态的静态几何，没有覆盖输入校验后的错误行与足部按钮在软键盘弹出时的位置。

TOTAL: 12 findings（F1-F11 为当前有效新发现，F12 已被并发改动，需复验）。
