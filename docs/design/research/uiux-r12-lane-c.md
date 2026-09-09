# UI/UX 第十二轮 视觉收敛审计 — Lane C（全 13 面 + 实测）

仓库：/Users/hanxiao.du/Desktop/vincent/projects/pi-web  分支 refactor/plugin-architecture  HEAD b3ae9c83
实测方式：@playwright/test chromium，393x850，hasTouch + isMobile（已断言 matchMedia("(pointer: coarse)") 为真），驱动 scripts/audit-uiux-full.mjs 的 13 个 drill 打开全部面，逐面遍历所有 shadow root 采集 getBoundingClientRect + getComputedStyle（几何/内外边距/字号/圆角/色值），原始数据落在 /tmp/lane-c-metrics.json。探针脚本用完已删除，工作树未被我修改。

重要背景（影响本报告的判定）：审计过程中工作树被本轮其它 lane 并发修改（git status 显示 10 个文件 M）。8505 上跑的是修改前的构建，所以我的实测数字对应 HEAD，而每条结论都回读了**当前工作树**源码再定级。已被并发修好的项我在文末“已在飞行中修复、不计入”里注明。

TOTAL: 10 findings

---

## F1 组合器工具条五个等高控件的间距读作 4/6/6/6，节奏在第一处断掉
- src/client/src/components/PromptEditor.ts:178（.actions { gap: var(--pi-space-3) }）与 :179（.compact-status { gap: var(--pi-space-2) }）
- surface: chat（chat-drawer / model-picker / thinking-picker 三面同样可见，因为组合器一直在场）
- finding（几何）：在 393px 宽、max-width:760 生效时，底部一排是五个 44x44 的控件加一个模型 chip，实测左起 x/宽为 select-model 6..139、select-thinking 143..187、editor-history 193..237、icon-button 243..287、send-button 293..337、stop-button 343..387。相邻间隙依次是 **4, 6, 6, 6, 6**。第一个 4px 来自 .compact-status 的 gap:var(--pi-space-2)，其余 6px 来自 .actions 的 gap:var(--pi-space-3)。如果 4px 是为了把 chip+thinking 归成一组，那组边界（thinking→history）应该更宽，可它恰好也是 6px——所以这不是分组，是一条一次性的节奏错位。
- 最小失败场景：8505，393x850 coarse，打开任一会话，看底部工具条。模型 chip 与思考档位之间比其余四个缝隙窄 2px；两个 44px 方块之间的缝在同一行里出现两种宽度。
- confidence: 高（源码 + 实测坐标）

## F2 消息卡片的粘性表头内容列比正文列左移 2px（左右各 2px）
- src/client/src/components/ChatView.ts:376（.msg > .msg-header { margin: calc(-1 * var(--pi-space-6)) ... ; padding: var(--pi-space-1) var(--pi-space-5); }）
- surface: chat / chat-drawer / msg-row-menu
- finding（几何）：卡片 .msg 的内边距是 --pi-space-6 = 12px（ChatView.ts:275）。表头用 margin-inline: -12px 顶回卡片内边缘，然后只用 --pi-space-5 = 10px 补回来，于是表头内容列从卡片内缘起 10px，正文列起 12px。实测：ARTICLE.msg x=6，正文 formatted-text.part x=**19**（6+1 边框+12），而表头里的角色标签 B.label x=**17**。右侧同理：表头内容右缘 376，正文右缘 374。补偿值应当是 --pi-space-6，与卡片自身的水槽同一个 token。
- 最小失败场景：8505 打开任一有消息的会话，把 user/assistant 字样和它下面第一行正文的左边缘对齐看——标签整体挂出去 2px；同一张卡片里两条竖直基准线。
- confidence: 高（源码 + 实测 17 vs 19）
- 备注：这与第六轮已修的 “ask-user card header shares its content column” 是同一个缺陷形状，ChatView 这个生产者当时没有一起改。

## F3 会话搜索框 17px，其余同角色搜索框 16px；而且注释写的是 16px
- src/client/src/components/SessionList.ts:781（.session-search-input { font-size: var(--pi-text-lg) }，上一行注释写 “16px keeps iOS Safari from zooming”）
- 对照：src/client/src/components/shared.ts:261（.list-search-input 用 var(--pi-control-font-size, 16px)）、src/client/src/components/ModelPicker.ts:287（同样 16px）、src/client/src/components/QuickSwitcher.ts:400（input 用 var(--pi-text-lg) = 17px）
- surface: sessions / boot / model-picker / quick-switcher
- finding（几何）：--pi-text-lg 是 17px（src/client/index.html:44），--pi-control-font-size 是 16px（index.html:135）。实测同一台手机上四个同角色搜索框：project-list .list-search-input **16px**、model-picker input.search **16px**、quick-switcher input **17px**、session-list .session-search-input **17px**。注释声称的 16px 与声明产出的 17px 不一致——防 iOS 缩放的 16px 门槛基类已经满足了，这条覆盖只是把字号推出了统一。shared.ts:259 的注释原文就是要求第二个搜索框 “not drift from the first”，SessionList 自建了一份并且漂了。
- 最小失败场景：8505 手机宽度，先看项目列表的搜索框，再点进项目看会话列表的搜索框：同一位置、同一角色、同一高度（44），占位文字大一号。
- confidence: 高（源码 + 实测四处字号）

## F4 picker 选中行的说明文字压在选中底色上是 4.42:1（11px 需 4.5:1）
- src/client/src/components/ModelPicker.ts:309（small { color: var(--pi-muted); font-size: var(--pi-text-2xs) }）配合 :301（.options > button.selected { background: var(--pi-selection-bg) }）
- src/client/src/components/CommandPicker.ts:119（同一条 small 规则）配合 :117（.options button.selected { background: var(--pi-selection-bg) }）
- surface: model-picker / thinking-picker
- finding（对比度）：实测运行中的主题（用户主题，--pi-muted #6b6860 / --pi-selection-bg #f3e2d9）下，model-picker 选中行里的 small（文本 “botim-bllm”，11px）对底色 **4.42:1**；thinking-picker 选中行 small（“Deep reasoning (~...”，11px）同样 **4.42:1**。11px 属于正常字号，AA 门槛 4.5:1。内置暗色主题（#8b949e on #0d2847）算得 4.85:1 通过，所以这是随主题触发的，但触发条件与第十轮已修的那三处**完全相同**：第十轮 changeset 原话是 “--pi-muted measured 4.42:1 on the selection tint in three surfaces”，两个 picker 的 small 是当时漏掉的同族生产者。
- 最小失败场景：8505 在浅色/沙色主题下打开模型选择器，用键盘上下移动光标，被选中那一行的 provider 说明比未选中行更难读（未选中行底色是卡面，选中行是更亮的 tint）。
- confidence: 高（实测色值 + 计算；主题相关性已注明）

## F5 设置详情页的返回控件外凸 8px，与它正下方的标题不在同一条左基线上
- src/client/src/components/SettingsDialog.ts:797（.settings-back { margin-left: calc(-1 * var(--pi-space-4)); padding: 0 var(--pi-space-4) 0 0; }）
- surface: settings-appearance（所有 settings 二级面板同）
- finding（几何）：负 margin 是 -8px，但左内边距被显式写成 0，所以外凸没有被任何内边距抵消。实测 .settings-detail-heading x=**12**，其子 H1 “Appearance” x=**12**，而同一个块里的 BUTTON.settings-back x=**4**，chevron 的 svg x=**4**，chevron 真实墨迹 path x=**8**、宽 8px。也就是说返回行的图标墨迹比它下一行的标题左 4px，控件盒左 8px。若要外凸做光学补偿，padding 左侧应当同样是 --pi-space-4。
- 最小失败场景：8505 手机宽度打开设置 → Appearance，把 “< Settings” 与下一行 “Appearance” 的左边缘并排看，两行不齐。
- confidence: 高（源码 + 实测 4 / 8 / 12 三个 x）

## F6 三个对话框的关闭控件里 padding: 0 是死声明，同一条规则后面又写了 padding: 0 var(--pi-space-4)
- pi-web-plugins/workspaces/browser/ProjectDialog.ts:377
- src/client/src/components/SessionRenameDialog.ts:37
- pi-web-plugins/machines/browser/MachineDialog.ts:146
- surface: add-project-dialog（另两处是同族对话框）
- finding（几何）：三条规则都是 header button { ... width: var(--pi-control-height-comfort); height: var(--pi-control-height-comfort); padding: 0; line-height: 1; ... font-size: var(--pi-text-xl); padding: 0 var(--pi-space-4); }。后一条 padding 覆盖前一条，前一条完全无效。实测 add-project 对话框的关闭键：盒 **44x44**，computed padding **0px / 8px / 0px / 8px**，也就是内容盒只有 **28x44**（鼠标态是 20x36）。当前 × 字符墨迹 8.67px 还塞得下，所以现在肉眼无碍；但声明说的是 0，实际是 8，任何把 × 换成房子标准的 16/18px 绘制图标的改动都会在鼠标态被挤（20px 内容盒装 18px 图标）。同族的 ModelPicker.ts:286、QuickSwitcher.ts:403 的关闭键都是干净的 padding: 0，同一族里两种内容盒。
- 最小失败场景：DevTools 选中 add-project 对话框的 Close 按钮，Computed 面板显示 padding-inline 8px，而 Styles 面板里 padding: 0 被划掉。
- confidence: 高（源码 + 实测 computed padding）
- 备注：第十一轮刚修过完全同形的一处（AppContextBar 的 padding-inline: 0 后面跟 padding 简写），当时没留守卫，这三处就是同一形状的存活样本。整棵树扫过一遍，同规则内重复属性只剩这三处 padding 加下面 F7 的一处 font；overflow: hidden; overflow: clip 是有意的降级写法，判为非缺陷。

## F7 【飞行中回归】本轮新加的 font 声明被同规则后面的 font: inherit 吃掉，16px 门槛没有落地
- src/client/src/components/SessionRenameDialog.ts:33
- surface: 会话重命名对话框（不在 13 面清单内，但属于本轮正在改的客户端代码）
- finding：当前工作树该行是 input { box-sizing: border-box; min-height: var(--pi-control-height-comfort); font: var(--pi-control-font-size, 16px) var(--pi-font-ui); font: inherit; ... }。git diff 显示 box-sizing / min-height / 第一条 font 是本轮新增，而 font: inherit 是原有的、位置在后，所以新增那条 font 是死声明：输入框仍然继承宿主的 14px，而不是 16px 的控件字号。16px 正是 iOS Safari 聚焦不缩放的门槛，这条修复现在是无效的。
- 最小失败场景：改完后在 iPhone Safari（或 393x850 coarse）打开会话重命名，聚焦输入框；页面仍会被缩放，DevTools 里 font-size 读作 14px 而不是 16px。
- confidence: 高（源码逐字读；因为是未提交改动，8505 上的构建还没有它，故未实测）

## F8 工具执行卡的状态标记仍然是排版字符，且 pending 与 interrupted 共用同一个字符
- src/client/src/components/ToolExecutionView.ts:234-240（STATUS_ICON = 圆圈/实心圆/对勾/叉）、:44（渲染处）、:143（.status-icon 只给了 --pi-muted，没有尺寸也没有分状态色）
- surface: chat（工具执行卡在转录里）
- finding：房子的规矩自第十轮、第十一轮起是“标记要画出来，不要打出来”（ChatView 的信息标记、批量选择、口述、历史都改过了）。本轮工作树里 ChatView 又把 tool-line 的 ▶ 和结果行的 ✓/✖ 换成了 renderRunIcon/renderCheckIcon/renderCrossIcon，但 ToolExecutionView 这张真正的工具卡没有跟上。实测同字号 14px 下这些字符的墨迹宽高差很大：○ 12.84x17、● 12.81x17、✓ 11.98x17、✖ 10.67x17，而房子的绘制图标是 16 或 18px 的方形。另外 STATUS_ICON.pending 与 STATUS_ICON.interrupted 都是 ○，两个不同状态的标记通道完全重合（状态还有卡片底色和 .status-label 词两条通道，所以不是不可读，但标记这条通道是空的）。
- 最小失败场景：跑一条会调用工具的会话，看工具卡左上角的状态记号：它的字形宽度随字体回退变化，且与同一屏其它 16/18px 绘制图标不同族；把 pending 与 interrupted 两张卡并排，记号一模一样。
- confidence: 高（源码 + 字符墨迹实测）

## F9 附件按钮在同一片组合器里是 44px 控件配 16px 图标，旁边五个 44px 控件都是 18px 图标
- src/client/src/components/PromptEditor.ts:80（.icon-button 的图标 18x18）与 :87（.editor-attach .prompt-action-icon 16x16），:163 在 coarse 下把 .editor-attach 抬到 44x44
- surface: chat / chat-drawer
- finding（几何）：实测 393x850 coarse：editor-attach 按钮 **44x44**、里面 svg **16x16**；同屏的 select-thinking / editor-history / 未命名 icon-button / send-button / stop-button 全是 **44x44** 按钮配 **18x18** svg。16px 那条是给鼠标态 32px 方框（:86 用 --pi-control-height）定的比例，coarse 把外框抬到 44 时没有跟着抬图标，于是同一片区域里同尺寸控件的图标差一号（图标面积差 21%）。居中本身没问题（实测 svg 中心与按钮中心 dx=dy=0）。
- 最小失败场景：8505 手机宽度打开会话，把输入框右下角的回形针与它下面一排的发送/停止图标并排看，回形针明显小一圈。
- confidence: 中高（源码 + 实测；也可能是刻意让框内图标更轻，但没有注释记录这个意图，而房子的规矩是同尺寸控件同图标尺寸）

## F10 quick-switcher 的行菜单键没有清零 UA 默认内边距，与同组件的关闭键两种内容盒
- src/client/src/components/QuickSwitcher.ts:469（.row-menu-toggle 整条规则里没有 padding），对照同文件 :403（.close { ... padding: 0 ... }）
- surface: quick-switcher / qs-row-menu
- finding（几何）：实测 .row-menu-toggle 盒 **44x44**，computed padding **1px / 6px / 1px / 6px**（Chromium 的 button 默认值），内容盒只有 32x42；同组件的 .close 是 44x44 且 padding 全 0。省略号靠 button 的默认居中仍然落在中心（实测无偏移），所以今天不掉字；但这是与 F6 同一类的“声明没有说全”的盒子，一旦把 ⋯ 换成绘制图标或加上第二个字形就会先被内边距吃掉宽度。
- 最小失败场景：DevTools 选中会话磁贴右上角的 ⋯ 按钮，Computed 里 padding 不是 0；同一个 shadow root 里的 Close 按钮是 0。
- confidence: 中高（实测 computed padding；当前无可见后果，属于潜伏项）

---

## 已在飞行中修复，不计入（我测量时 8505 的构建里还有，回读当前工作树已改）

- **批量选择的勾记号铺满整个 44px 控件**：SessionList.ts:39 的 renderSelectionMark 输出的 svg 没有尺寸，在 display:inline-grid + place-items:center 里按 100% 撑满。HEAD 构建实测 SESSION-LIST 的 svg.selection-mark **44.0x44.0**（内部 rect 33x33），同屏 APP-NAVIGATION-PANEL 的头部图标是 16x16——同一块屏上两个图标差 2.75 倍。当前工作树 SessionList.ts:692 已加 .selection-mark { width: 16px; height: 16px; }，判为已修。
- **消息行动作还是排版字符**：HEAD 构建实测 .msg-action 内的字符墨迹 ↻ 11.31x14、⧉ 11.16x14，旁边第十一轮刚画出来的信息标记是 14x14 遮罩；而且复制键在 copied 态从 ⧉ 换成 ✓ 时墨迹从 11.16x19 变 11.98x17，行内会抖。当前工作树 ChatView.ts:1848/1853 已换成 renderResendIcon / renderCheckIcon / renderCopyIcon，StatusBar 的 ↑↓ 也换成了 renderUpIcon/renderDownIcon，判为已修。

## 追查过但判为“非缺陷”，记录下来免得下轮重复怀疑

- **overflow: hidden; overflow: clip 同规则重复**（AskUserCard.ts:475、ChatView.ts:275/277、ExtensionDialogCard.ts:341）：这是有意的渐进增强写法，不是死声明。
- **unread-ring 里的活动点实测 4.6px，不在 4/6/8 的点阶上**：shared.ts:432 声明的是 --pi-dot-xs（4px），4.6 是 shared.ts 的 pulse 动画在采样瞬间的缩放帧。非缺陷。
- **机器行的 online/offline 只有一个词**：MachineList.ts:257-260 与 MachineSwitcher.ts:302-305 都有 ::before 的圆点，实测 span 宽 43.5px 里含点+词。符合第十轮的“记号加词”。非缺陷。
- **quick-switcher 磁贴的 ⋯ 键是 44x44、会话列表行的是 44x46.5、项目磁贴的是 36x36**：36 那个由 audit-uiux-full.mjs 的 COMFORT_EXEMPT（action-menu-toggle in tiles）显式豁免，46.5 是行高撑满的命中区，判为既有决定。
- **add-project 的两个 .check 复选框行高 24px**：低于 44 门槛，但 label 宽 367 高 24 落在 audit 脚本 LABEL_TARGET_TAGS 的既定豁免里（label 自身可点），且第七/八轮明确处理过这块，判为既有决定。

## 机械尺度实测复核（全部通过，没有新逃逸）

在 13 个 drill 的全部 shadow root 上做了四项计算复核，均为 0 例外：
- **圆角**：所有可见元素的 computed border-radius 只出现 0/4/6/8/12/16/999px 与 50%，无像素字面量逃逸。
- **字号**：所有带文本元素的 computed font-size 只出现 11/12/13/14/15/16/17/20px（外加 msg-meta 折叠态刻意的 0），全部落在 --pi-text-* 与 --pi-control-font-size 上。
- **内边距**：13 面各自宿主组件内所有可见元素的四向 computed padding，只出现 0/2/4/6/8/10/12/16/20/24px 与结构性的 >24，无 3/5/7/9/14 之类的中间值。
- **图标居中**：所有“只含一个 svg 子元素”的控件，svg 中心与控件中心的 dx/dy 全部 < 0.6px；所有“同一父级里既有 svg 又有文本”的行，svg 与文本的垂直中心差全部 < 1.0px。图标几何居中与图文行对齐这两条 hunt 项，本轮实测干净。
- **同排控件等高**：按“垂直中心相差 <= 4px 归为一排”聚类后，13 面里唯一的不等高同排是 quick-switcher 的 .row session-row(371x78) 与 .row-menu-toggle(44x44)——那是磁贴角上的叠放控件，属于设计。

## 复核过的 hunt 项覆盖度

| hunt 项 | 结果 |
| --- | --- |
| 图标/字形在控件里的几何居中 | 干净（实测全部 dx/dy < 0.6px） |
| 图文行的对齐 | 干净（实测全部 < 1.0px）；但 F2 找到卡片级的列错位 2px |
| 同排控件高度/内边距不等 | 干净；F6/F10 找到内容盒不等（外框相等） |
| 间距节奏断裂 | F1 |
| 尺度逃逸（圆角/控件高/点/间距/字号） | 机械四项干净；F3 是字号尺度上的“同角色两个台阶” |
| 用文字承载状态而房子用记号 | F8（以及已修的两项） |
| 填充控件上低于 AA 的对比度 | F4 |

---

审计脚本：复用 scripts/audit-uiux-full.mjs 的 DRILLS/OPENERS，仅把 contextSheet 的开启器换成 button.compact-scope（原开启器按 “Switch”/“context” 文本匹配到了错误的按钮，静默不开面，那一面的元素数与 boot 完全相同即 132，换掉后为 285）。这一点建议顺手回写到 audit-uiux-full.mjs，否则 context-sheet 这一面在既有审计里一直是空跑。
