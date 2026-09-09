# PI WEB 手机端布局系统结构评审（393×850 · 只读）

- 评审 lane：只读源码批判，未改仓库任何文件。实测数字引自 owner 侧探针（393×850、coarse pointer）；标注〔推导〕的数值由源码规则算出、未实测；标注〔猜测〕的是推断而非事实。
- 证据为本仓库当前工作树实读；grep 计数口径：src/client/src + pi-web-plugins、排除 *.test.*。

## 0. 一句话诊断

这套 token 体系把**算术**命名了（字号刻度、间距步进、控制高度、行高下限），但没有把**角色**命名（阅读边缘、行标题、副行、行语法、内容前预算）。于是每个组件都在合法词表内自选组合：两张被点名很差的屏幕各自内部有 3-7 个"单看都对"的值互相对撞，且两张屏互相矛盾。糟糕感不是某个数值错了，而是"没有任何一处规则说同一角色必须同一值"。

---

## 1. 逐项发现

### F1 阅读边缘不是系统概念：一屏之内最多 7 个左缘共存，token 只命名了其中 1 个

唯一被命名的边缘是 --pi-chrome-inset（index.html:83，值 --pi-space-3 = 6px）。其注释宣称 "Where stacked chrome rows start their text. One value, so the bar, the compact header and the conversation below them share a reading edge."（index.html:81-83）。消费者仅 3 处：AppContextBar.ts:73、AppNavigationPanel.ts:457（桌面 header）与 :467（compact header）。

内容侧没有对应物，每个组件自己挑 stop：

| 左缘（px） | 产生规则 | 出处 |
|---|---|---|
| 6 | chrome 行文字（context bar / compact header / scope chip） | index.html:83 + AppNavigationPanel.ts:485（compact-scope 无水平 padding）〔推导〕 |
| 10 | listStyles section padding = --pi-space-5；h2 标题、搜索框、tile 网格容器都从这起 | shared.ts:274 |
| 12 | ① tile 卡片外缘（10 + tiles padding --pi-space-1=2）② 设置 header 内边距——两个无关生产者恰好同值 | shared.ts:309；SettingsDialog.ts:783 〔推导〕 |
| 15 | compact-header 里 Actions 按钮文字（chrome-inset 6 + border 1 + padding-inline --pi-space-4=8） | AppNavigationPanel.ts:467-468 〔推导〕 |
| 16 | 设置行文字内边距 --pi-space-7 | SettingsDialog.ts:786（实测 16 ✓） |
| ≈21 | 搜索输入内占位文字（section 10 + border 1 + input padding 10） | shared.ts:261,274 〔推导〕 |
| 25 | tile 文字（10 + 2 + 状态 rail 3px + action-main padding 10） | shared.ts:274/309/419/318 〔推导，实测 25 ✓〕 |

实测 boot/settings 同屏边缘 {10,12,15,16,25} 与上表吻合；实测集之外的 6 与 21 说明真实散布比测量到的更宽。结构判断：2px 步进词表只保证每个值"算术合法"，不回答"这一类文字从哪起"。12 与 16 只差 4px，低于可感知为意图的对齐差——读出来不是层级，是没对齐。token 注释承诺的 chrome/conversation 共缘只在 chat 面（--pi-chat-gutter 手机降为 6px，index.html:80,199）成立；boot 面内容体（10px 起）与卡片文字（25px）不在承诺内——这是写进了注释却没接完的不变量。

### F2 字阶有刻度、无角色：同一个"列表行标题"在三张表面是三种字

ramp 本身已 token 化：11/12/13/14/15/17/20（index.html:39-45）。缺的是角色分配：

- 会话名一行：会话列表 14px（:host 继承 --pi-text-base，shared.ts:251，行内 font:inherit shared.ts:379）；快速切换器 15px（QuickSwitcher.ts:423，--pi-text-md）；设置行 17px/600（SettingsDialog.ts:787，--pi-text-lg）。实测 17px settings title ✓。
- 副行：tile 路径 11px（shared.ts:455 small，--pi-text-2xs，实测 ✓）；设置副题 13px（SettingsDialog.ts:788，实测 ✓）；context chip 值 13px/600（AppContextSwitcher.ts:111）；compact scope chip 也是 13px/600（AppNavigationPanel.ts:485）。实测 13px scope name ✓。
- 控件标签 12px 是全应用按钮基线（shared.ts:223，实测 12px action label ✓），但 "+ Add project" 一个按钮内 12px 标签配 17px 字形（shared.ts:282-283）。
- 16px 是阶外值：字阶没有 16 档；搜索框字号来自 --pi-control-font-size:16px（index.html:135），即 iOS 聚焦放大的规避值（SessionList.ts:781 注释 "16px keeps iOS Safari from zooming the viewport on focus"；shared.ts:261 消费，实测 16px search ✓）。手机上打得最多的字用了字阶外的刻度，而字阶自己的 15 档（--pi-text-md）全仓仅 6 处消费、无一是手机列表行。
- 重量：650 有专门 token，注释说是为"600 与 bold 之间补缝"（index.html:52-53），但两个标题角色分属两档：resident 会话标题 650（AppContextBar.ts:79），设置行标题 600（SettingsDialog.ts:787）——同屏 600/650 并存且无规则。

结构判断：字阶是"尺寸清单"不是"角色表"。没有 list-title / list-meta / chrome-label 这类命名，14/15/17 三个"标题"与 11/13 两个"副行"同时合法。这正对应 minimal-layout-research.md C1 的病根句："上一轮 wave 只改了属性（尺寸、颜色 token），没改元素清单"——token 覆盖属性层，角色层无人管。

### F3 chrome 没有垂直预算：被有意砍掉的第三根 bar 换了个形态长回来

boot 屏（无会话）首块内容之前的栈（实测合计 ≈180px = 850px 的 21%）：

1. app-context-bar：min-height --pi-panel-header-height 44 + 1px border = 45（AppContextBar.ts:73；组合顺序 PiWebApp.ts:3791）。空态显示 "Sessions" 标题按钮（AppContextBar.ts:34-40）。
2. compact-header：同为 44+1 = 45（AppNavigationPanel.ts:467），内含 scope chip（"PI WEB"）+ 刷新 + 齿轮 + "Actions" 胶囊（AppNavigationPanel.ts:174-181,468,485；入口 PiWebApp.ts:3797 → AppNavigationPanel.ts:139,173）。
3. "Projects + Add project" 行：h2 12px muted（shared.ts:275）+ section-add 粗指针 44px（shared.ts:290）〔推导行高 ≈44-48px〕。
4. 搜索输入 44px（shared.ts:270 coarse）+ 12px 上下边（shared.ts:260）。

之后才是第一块 85px tile。

两条在案的自相矛盾：
- AppContextBar 模块注释（AppContextBar.ts:8-13）："this row never scrolls, never truncates into unreadability, and never stacks a second bar."——对 bar 自身成立；壳在它下面又立了第二根。
- AppNavigationPanel.ts:185-193 注释记录了砍除决定："No quick-action bar here. It stacked a third bar above the list - a fifth of a phone screen before any content"——砍掉一根 bar，又用 heading 行 + 搜索行补回大致相同的高度。每次砍除都有记录有理由，但复发机制原封未动。

判据缺口：minimal-layout-research.md C5 只规定"初屏主要选项 ≤7 个"（数控件），没有"内容前垂直 chrome ≤N px"（数像素）；mobile-layout-research.md §2 全表数的是触面。于是每根 bar 都能单独通过评审，四根加起来没人管——这正是 AGENTS.md "同一症状报两次停止打补丁"所防的模式：症状（内容被推下屏）第三次出现的条件一个都没少。

密度对照（回应 lane 问题"设置列表密度对其他一切"）：设置屏 7 行 × 59px = 413px ≈ 850 的 49%；boot 屏同量级内容要 180px chrome + 4 行 tile 轨（85+8 gap）≈ 552px ≈ 65%。两屏行内文字密度其实相近（都是标题+副行两行字），差异大头来自内容之前的 chrome 与首行预留——即 F3，而不是行本身。

### F4 两套行语法并存且无裁决规则；上一轮调研把偏离者评成了范本

- 卡片语法（1px border + 圆角 + --pi-surface 底）：project/machine tiles（shared.ts:309,318,372）、会话行（shared.ts:372）、快速切换器行（QuickSwitcher.ts:412）、机器选项（MachineSwitcher.ts:319）。
- 全出血语法（无圆角、border-bottom 全宽）：手机设置列表独一份（SettingsDialog.ts:786：border:0、border-radius:0、border-bottom 全宽、padding 10/16）。实测 "full-bleed separators, no card" ✓。
- 没有任何文件写明"什么面用哪种"。同屏混搭：boot 屏两根全出血 bar 直接贴着圆角 tile；设置屏是全屏 modal（radius 0，SettingsDialog.ts:782）内全出血行。
- mobile-layout-research.md §1.7 把设置列表评为"全应用里手机形态最成熟的列表"——偏离被当成范本，语法分裂因此三轮调研无人质疑。

更深一层：卡片"承载分组"的能力在 token 层就没接上。index.html:177-185 声明了语义表面阶梯 "canvas < panel < card < raised"，但 --pi-surface-canvas / --pi-surface-panel 各只有 1 处消费（theme.ts:66-69 的声明本身），--pi-surface-card 仅 ChatView 两处、且 :279 立即把 .msg.assistant 改回 legacy --pi-surface；legacy var(--pi-surface) 有 107 处消费。结果：177px 的项目 tile、44px 的 "+ Add" 按钮、45px 的 "Actions" 胶囊共用同一表面色 + 1px 边 + 圆角语言（shared.ts:372/284、AppNavigationPanel.ts:468）——层级只剩尺寸一个维度。"哪里该用卡"的问题，其前提"卡是什么"在本系统里是空的。

### F5 设置屏的内部矛盾：三左缘 + 标题哲学反转 + token 没统一形状

- 同屏三个左缘：header 12px（SettingsDialog.ts:783，实测 eyebrow 12 ✓）、行文字 16px（:786，实测 ✓）、分隔线 0px 全出血（:786）。12 与 16 的 4px 差是 F1 的实例。
- 标题哲学自相矛盾：设置屏把 "PI WEB" 渲染成 20px h1，表面名 "Settings" 降为 12px eyebrow（SettingsDialog.ts:167,172-173,765-766）；而 AppNavigationPanel.headerName() 的注释（AppNavigationPanel.ts:123-127）写明相反原则："PI WEB is what the reader already knows: the app is on screen. Which machine, project, workspace or session is in focus is what the header can add." 同一代码库两个组件持相反裁决并同时发布。
- 行高 token 是地板不是设计值：--pi-row-min-height:56（index.html:84-86），注释宣称统一 "four lists cannot drift to 52, 56, 58 and 60 for the same shape"；设置行实测 59——由内容决定（17px 标题 + 4 gap + 13px 副题 + 20 padding，〔推导〕≈59-61），token 只是没被触到的下限。同 token 的 tile 是 85px（shared.ts:322 公式 56+24，又被 clamp 预留 10+35+28.6+10+2≈85.6 盖过〔推导〕，实测 85 ✓）。token 统一了数字，没统一形状——注释承诺的 "same shape" 从未存在：tile 是卡、settings 是行。

### F6 lane 问题正面回答：什么进了 token、什么是每组件发明

已 token 化（index.html:33-135 与 listStyles 内 scoped 变量）：间距步进、字阶、字重、圆角、控制高度 32/36/44（index.html:96-98）、行 min-height 56、header 高 44、chrome inset 6、tile 菜单 size/inset（shared.ts:344,351）、点尺寸、elevation、表面阶梯（未接线）、focus ring、checkbox、disabled 透明度。

每组件发明的（恰是 felt quality 的来源）：

1. 内容阅读边缘（无 token）→ F1；
2. 角色→字号/字重映射（无角色 token）→ F2；
3. 行语法 card vs full-bleed 的裁决（无规则）→ F4；
4. 内容前垂直 chrome 预算（无判据）→ F3；
5. tile 高度公式 56+24（shared.ts:322）——在行 token 上叠的局部发明，最终值还被 clamp 预留盖过（shared.ts:323-324）；
6. 分组容器（无 inset-grouped/group 概念；表面阶梯声明了但未接线）。

---

## 2. 三个单位风险收益最高的结构性改动（各附会破坏什么）

### 改动 1（低风险）：把"阅读边缘"与"文字角色"升为 token，收敛到 2 缘 + 3 角色

做法：新增 --pi-content-inset（内容缘）与角色 token（list-title / list-meta / control-label 的字号+字重组合；具体取值是 owner 的产品裁决，结构动作是"命名 + 单一生产者"）。全部列表面从共享出处取值——关键有利条件是插件列表经 hostUi adopt 链消费同一份 listStyles（machines/browser/hostUi.ts:40-44、workspaces/browser/hostUi.ts:40-44），改一处即达全部。设置 header（SettingsDialog.ts:783）与行（:786）同缘；chrome 行维持 chrome-inset。
- 收益：两张被点名屏幕的 5-7 个左缘收敛为 2 个；"标题"三值（14/15/17）收敛为一个；F5 的 12/16 撞车消失。补上 AGENTS.md "一致性是设计出来的"缺的另一半。
- 会破坏什么：纯几何——metrics.json、research 探针、e2e 几何断言基线全变（mobile-layout-research.md §2 全量口径需重跑）；tile 列宽重算（内容缘取 16 时两列 ≈174px，minmax(150px,1fr)（shared.ts:309）仍保两列）；设置行 59→约 57px。无行为变化。风险点：listStyles 是 20+ 表面的共同依赖，值改错即全局错——属"改一处、验一片"，需探针矩阵复核而非局部抽查。

### 改动 2（中风险）：立行语法契约，并把"行"抽成共享契约（表面档 + 标题/副题角色 + rail 位置）

做法：写一条裁决规则（例如"持久壳内的可选列表=卡；容器限定的面（dialog/sheet/modal）内=全出血"——方向 owner 定，规则本身是缺的那块）；设置列表与卡片行迁往同一契约；同时接通表面阶梯（行卡用 --pi-surface-card，legacy 107 处逐步迁）。
- 收益：设置屏与 boot 屏互相承认；modal 内全出血行的分组信息由容器承担；卡片在真正承载分组的地方（平铺网格）与行在真正需要密度的地方（长列表）各归其位。
- 会破坏什么：状态 rail 现在是卡片行的 border-left（shared.ts:419-430），全出血行需要 rail 的新家或放弃 rail；tile 角菜单几何由 tile-menu 派生（shared.ts:318,344-358）绑定卡形，若 tile 改全出血须重推；桌面设置的 220px 侧栏孪生（SettingsDialog.ts:149-155,375-381）不是同一 DOM，契约须覆盖两形态；ContextSwitcherSheet 与 machine sheet 经 adopt 链自动随动（同改动 1 的通道，是风险低的原因）。触面不受影响（floor 与语法解耦；密度基准是 mobile-layout-research.md §4.3① 的独立裁决）。

### 改动 3（中风险）：给手机壳立"内容前 chrome 预算"，boot 屏身份行与 scope 行并成一根

做法：navigation-view 下合并 app-context-bar 与 compact-header——两者都是 44px、都是"一个主标签 + 一组按钮"的同一形状；"Projects + Add project" 行与搜索归入滚动体（搜索已 sticky，shared.ts:260；heading 折叠机制已存在：shared.ts:294-303 的 --pi-list-word-heading-* 继承变量，ContextSwitcherSheet.ts:98-99 在用）。写成可测不变量：探针断言"首内容 y ≤ 预算"。
- 收益：boot 首屏拿回约 45-90px（21%→约 10-13%）；"Sessions"（空态标题按钮）与 "PI WEB"（scope chip）两行零信息行变一行；F3 的复发条件被不变量锁住。
- 会破坏什么：快速切换器入口现挂 context bar 标题（AppContextBar.ts:34-40、PiWebApp.ts:3723）需新家；panelToggleHiddenState（PiWebApp.ts:3721）与 compact 键盘导航契约（隐藏 machine-switcher 保持 mounted，MachineSwitcher.ts:289-295 注释）要重推；chat 视图保留原 bar，故 AppContextBar 存活但其 boot 空态分支消亡；AppContextBar.ts:8-13 的文档字符串不变量需改写。触及壳组合顺序（PiWebApp.ts:3791/3797），回归面是导航流而非样式——按 AGENTS.md 验证流程需 8505 实机 Playwright 复核。

## 3. 明确不建议本轮动的（有裁决在先或属刻意取舍）

- tile 等高靠预留空行（shared.ts:323-324：名字预留 2.5em、路径预留 2.6em，无论是否需要）：这是格行共享高度（AGENTS.md 一致性规则；shared.ts:320-321 注释记录了 82 对 95 的教训）的价格面。1 行名 + 短路径的 tile 带约 25-30px 空白是等高的成本；要动需连 tile 几何 spec 一起开裁决。
- 触面密度三档（32/36/44）：mobile-layout-research.md §4 前置说明与 CHECKLIST.md:694 记录 owner 已裁决维持密度，本轮不重开（两张截图的问题也不在触面）。
- 16px 搜索字号：平台约束（iOS 聚焦放大），不是风格选择；处置应是命名（如 --pi-input-zoom-floor）与注释，不是改值。

## 4. 尾注：与前几轮调研的闭环缺口

minimal-layout-research.md 的 C1-C7 数元素、数颜色、数框线，唯独没有"内容前像素预算"与"边缘/角色一致性"两个维度——本轮两张截图恰好都栽在未设判据的维度上（C4/C5 单独看都能通过）。mobile-layout-research.md §1.7 "设置最成熟"的判词与 owner 本轮感受相反，说明合规探针与 felt quality 之间的缺口是真实的。若要把本轮结论闭环，最小动作是把 F1/F2/F3 的三个可数维度（每屏左缘数、每角色字号值数、首屏内容前像素）补进 C 系列并要求探针输出这三个数——它们机械可数，不需要审美判断。

---

## 附：主要证据索引

| 主张 | 证据 |
|---|---|
| chrome 缘 6px 且仅 3 消费者 | index.html:81-83,199；AppContextBar.ts:73；AppNavigationPanel.ts:457,467 |
| 内容缘 10px（section padding） | shared.ts:274 |
| 设置 header 12px / 行 16px / 分隔线全出血 | SettingsDialog.ts:783,786 |
| 行标题 14/15/17 三值 | shared.ts:251,379；QuickSwitcher.ts:423；SettingsDialog.ts:787 |
| 副行 11/13 两值 | shared.ts:455；SettingsDialog.ts:788；AppContextSwitcher.ts:111 |
| 16px 阶外（iOS 规避值） | index.html:135；SessionList.ts:781；shared.ts:261 |
| 600/650 并存 | index.html:52-53；AppContextBar.ts:79；SettingsDialog.ts:787 |
| boot 栈 45+45+~46+44 ≈ 180px | AppContextBar.ts:73；AppNavigationPanel.ts:467；shared.ts:275,290,270,260；PiWebApp.ts:3791,3797 |
| 砍除第三根 bar 的在案记录 | AppNavigationPanel.ts:185-193；AppContextBar.ts:8-13 |
| 卡语法 / 全出血语法分治 | shared.ts:309,318,372；QuickSwitcher.ts:412；MachineSwitcher.ts:319；SettingsDialog.ts:786 |
| 表面阶梯未接线 | index.html:177-185；theme.ts:66-69；ChatView.ts:278-279；var(--pi-surface) 107 处 |
| tile 177×85 的成分 | shared.ts:309,318,322-324,419〔推导，与实测吻合〕 |
| 插件列表单一生产者通道 | machines/browser/hostUi.ts:40-44；workspaces/browser/hostUi.ts:40-44 |

（本报告只读；未运行构建、未改文件、未发提问。三个改动均需 owner 裁决方向后立项。）
