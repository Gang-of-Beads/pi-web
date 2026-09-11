# Round D · Lane A — 手机 393×850 端到端收敛复审(Round C 修复波 dc41e086 核验 + 全表面清扫)

评审对象:http://localhost:8505/(branch refactor/plugin-architecture,HEAD=48c97fd6,含 Round C 修复波 dc41e086)。
方法:Playwright 真机浏览(手机 393×850 hasTouch isMobile dpr2;桌面 768/1280 复核 "New session" 项);全部间距/对齐/对比用 `getBoundingClientRect` + `getComputedStyle` 实测;按压态用真实 mouse-down-hold(350ms)读 computed background + `matches(':active')`;机制裁决用 CSSOM(`adoptedStyleSheets` 规则枚举)+ 页面内 `CSSStyleSheet.replaceSync` 解析实验;插件投递验证用 dev server 实际返回字节与 `dist/` 产物 sha256 对比。未改仓库文件、未重启栈;脚本在 /tmp/roundd-lane-a/,截图在 /tmp/roundd-lane-a-shots/。

**本轮使命**:(1) 逐项核验 dc41e086 七项修复是否"到达读者";(2) 猎 owner 四大投诉 + NEW "New session" 居中清扫;(3) 门槛 = 除 owner 挂账(docs/design/review-triage-goal-round-b.md 末节)外零新增 TRUE。

---

## 结论(先说)

**收敛未达成。** dc41e086 七项修复中 **4 项完整到达读者,1 项半到达,2 项完全没到达**。共 **3 条新 TRUE**:

- **T-D1(P0)**:按压态修复四生产者中 **3 个死在到达前或死于代码**——goals `.refresh`(dist 陈旧,且源码规则又是嵌套死规则)、ActionPalette(源码嵌套 → `button button:active`)、`.drawer-control`(源码嵌套在 `:focus-visible` 内)——与 Round C T3 同一缺陷类第三次上船;
- **T-D2(P0)**:Tasks 空态居中修复(`align-content: stretch`)**没进投递产物**——dist 构建于 09:32:07,源码保存于 09:33:30,live 手机实测空态仍顶锚 12/643.3(Round C T2 原样);
- **T-D3(P1)**:按压态家族第三次宣布"收齐"后,**project/workspace/machine 三类行(导航面板 + context sheet 两个实例化点)至今无 coarse 按压反馈**(共享列表样式 shared.ts 全文件无 `:active`,dc41e086 只补了 SessionList 自己的 shadow)。

另:复审期间(10:32–10:36)工作树出现**未提交的并行修复编辑**(goals/ActionPalette/ChatView 三处嵌套规则正被拆出)——本轮裁决对象是**已提交的 dc41e086**;对未提交编辑只做机制备注(见 §2.1 末)。

---

## 一、dc41e086 修复核验总表

| # | dc41e086 声称 | 复测裁决 | 关键数字(393 手机) |
|---|---|---|---|
| 1 | empty-session 补 box-sizing + 居中 | ✅ **到达** | `scrollHeight 565 = clientHeight 565,scrollTop=0`(假滚动 32px 消失);`box-sizing: border-box` computed 生效;内容块 above/below = 241.9/233.9(偏上 8px = 1.4%,三断点一致,见 §五) |
| 2 | tasks-viewer `align-content: stretch` | ❌ **未到达(dist 陈旧)** | live computed `display:grid, align-content:start`;空态 topGap=12 / bottomGap=643.3(= Round C 缺陷原值);dist/tasksPanelElement.js 仍是 `align-content: start`,serve 字节与 dist sha256 逐字一致(03aafe11…) |
| 3 | 消息头分隔线改实线(六 role 块) | ✅ **到达** | user/assistant 实测 `border-bottom: 1px solid rgb(38,44,53)`(= `--pi-border-muted`,无 alpha);solid on surface-card 对比 **1.066:1**(修复前 35% mix 为 1.023:1);dist/client bundle 内 31 处 solid、0 处 35% mix |
| 3b | AskUserCard `.card-header` 实线 | ✅ **到达(bundle 级)** | serve 字节(index-yBfLJKhR.js)内 `.card-header { …; border-bottom: 1px solid var(--pi-border-muted); }`;本轮无活跃提问卡,live 像素未复现(同管线 ChatView 已像素证实) |
| 4a | compact 三钮按压态(拆出嵌套) | ✅ **到达** | 三钮隔离重测(scope/session/fold)resting→pressed 全部 `rgba(0,0,0,0)→rgb(27,32,39)`,`:active=true`;CSSOM 为顶层 `@media … { .compact-scope:active, … }` |
| 4b | session 行 `.action-main` 按压态 | ✅ **到达** | 325×56 行按下 `rgba(0,0,0,0)→rgb(27,32,39)`;同规则的 bulk-select/cleanup/menu-toggle 抽测 ALIVE |
| 4c | `.drawer-control` 按压态 | ❌ **死规则** | 见 T-D1c;`.drawer-collapse` 44×44 按下 bg 不变(`:active=true`) |
| 4d | goals `.refresh` 按压态 | ❌ **未投递 + 死规则双重** | 见 T-D1b |
| 4e | ActionPalette 按压态 | ❌ **死规则** | 见 T-D1a |
| 5 | context-bar 纵向呼吸 | ✅ **到达** | `.context-bar` 393×49,padding `2px 6px`;`.panel-toggle` 44×44 @(6,2),顶隙 2 / 底隙 3——与 compact-header(49px,2/3)完全同级(Round C 遗留 C1 关账) |
| 6 | contributed-sections inset | ✅ **到达** | `.contributed-sections { padding-inline: 10px }` computed 生效;goals 宿主 x=10 w=373,**状态点 x=10**(Round C 实测 x=0 触屏缘),refresh 右缘 383 = 读边 ✓(Round C 遗留 C2 关账) |

**Score:5.5 / 7。** 两条完全未到达的都是**插件侧修复**,同一根因:投递产物是 09:32 的旧构建,而两个插件源文件 09:33 才保存(`stat` 佐证:dist/pi-web-plugins/goals/goalsSectionElement.js = 09:32:04,dist/…/workspace-tasks/tasksPanelElement.js = 09:32:07;源文件均 09:33:30;client 包 index-yBfLJKhR.js = 09:07:30 但内容含全部 client 侧修复——修复先进工作树后提交的时序)。**"改了源码、构建早于保存"就是本轮的"修复没到达读者"。**

---

## 二、新 TRUE 发现(均不在 owner 挂账内)

### T-D1 · dc41e086 按压态修复 4 生产者中 3 个死亡:1 个陈旧 dist + 2 个嵌套死规则(与 Round C T3 同类第三次)——TRUE(P0)

commit message 原文:"the pressed-state family's last producers (session rows, drawer control, goals refresh, action palette) join the fold"。逐个按下实测(393,真 mouse-down-hold,每次隔离会话防 scope-click 开 sheet 污染——v1b 首轮曾因 compact-scope 按压的 click 打开 scope sheet、后两次按压打在 sheet 头上,已用 reload 隔离重测):

| 生产者 | 位置 | resting → pressed | :active | 裁决 |
|---|---|---|---|---|
| a. ActionPalette 选项行 + header close | `.options button` 351×72、close 44×44 | 选项行 rgb(13,40,71)→不变;close rgba(0,0,0,0)→不变 | true / true | **DEAD** |
| b. goals `.refresh`(导航面板实例 44×44 @(339,601.5);chat 抽屉实例 @(343,99)) | 同组件双实例 | rgba(0,0,0,0)→不变 | true | **DEAD** |
| c. `.drawer-control`(chat 抽屉 `.drawer-collapse` 44×44 @(343,49)) | 同 | rgba(0,0,0,0)→不变 | true | **DEAD** |
| d. session 行 `.action-main` | 325×56 | →rgb(27,32,39) | true | ALIVE |

机制(CSSOM + 解析实验双证):
- **a** `ActionPalette.ts:109`(dc41e086 版):`button { …; @media (pointer: coarse) { button:active { … } } }` — 嵌套进 `button` 规则内,编译为 **`& button:active` = `button button:active`**(按钮不可能嵌按钮,永不匹配);live CSSOM 原文 `& button:active`。
- **c** `ChatView.ts:177-178`(dc41e086 版):`.drawer-control:focus-visible { …` 无闭合花括号直接跟 `@media (…) { .drawer-control:active { … } }}` — 编译为 **`.drawer-control:focus-visible .drawer-control:active`**(后代),live CSSOM 原文 `& .drawer-control:active`;兄弟结构永不匹配。
- **b** 双重:`dist/pi-web-plugins/goals/goalsSectionElement.js` 内 **0 处 `:active`**(陈旧构建,serve 字节=v9g 实测 0 命中);且源码 `goalsSectionElement.ts:23`(dc41e086 版)把 `.refresh:active` 嵌在 `.refresh { … }` 内,页面内 `replaceSync` 解析实验证明会编译成 `@media > .refresh > & .refresh:active`(后代)——**即使重建 dist 也死**。
- 正控组:同法同轮 compact-scope / panel-toggle / session 行 / bulk-select 全部 ALIVE——方法有效,阴性可信。
- 截图:v7b-02-palette(palette 现场)、v6-01-drawer-goals、v2-00-home-before-fold。

**修复方向**:三处各一行,把 `:active` 规则提到样式表顶层(@media 直接包裹选择器,不再嵌进元素规则);goals/tasks 两个插件**必须重建 dist**(或改 dev 投递为源码 transform)。

**备注(未提交的并行编辑,不属本轮裁决)**:10:32–10:36 工作树已把上述三处嵌套拆出(`git diff HEAD` 可见,ActionPalette/ChatView 拆法正确;goalsSectionElement.ts 的新行尾多出一个 `}`——顶层孤立右花括号,浏览器按错误吞掉、后继规则不受影响,但建议收掉)。tasks 的 dist 陈旧与重建这两个工作树编辑都未解决。

### T-D2 · Tasks 空态居中修复未投递:dist 09:32:07 早于源码 09:33:30——TRUE(P0)

- 归属:`pi-web-plugins/workspace-tasks/tasksPanelElement.ts:288`(dc41e086 把 `align-content: start`→`stretch`)。
- 投递证据:`dist/pi-web-plugins/workspace-tasks/tasksPanelElement.js` 内仍是 `.tasks-viewer { display: grid; align-content: start; … }`;serve 字节与该文件 sha256 一致(03aafe11d1a443de 双端相同)。
- live(393,工具网格 → Tasks):viewer y=114 h=736,`align-content: start` computed,**空态 topGap=12 / bottomGap=643.3**——与 Round C 缺陷数字逐字相同;同屏兄弟 **Relays 319.5/319.5 居中**(其 stretch 修复在 Round B 波、赶上了 09:32 构建)。
- 截图:v17c-tasks.png / v10-01-tasks.png(顶锚虚线框 + 643px 空黑现场)、v12-01-relays.png(居中对照)。
- **裁决:TRUE**。修法:重建插件 dist(源码本身正确;无需再改代码)。

### T-D3 · 按压态家族第三次宣布完整后,project/workspace/machine 三类行仍无按压反馈——TRUE(P1)

- 位置:project-list / workspace-list / machine-list(SessionList 的三个兄弟列表,导航面板与 context sheet 两处实例化),行结构 = `div.action-row`(边框容器)+ `button.action-main`(无边框、透明底,shared.ts:365 经 host.surfaceStyles/listStyles 注入)。
- 机制:SessionList.ts:818 的家族规则只存在于 **SessionList 自己的 shadow**;`src/client/src/components/shared.ts` 全文件 **0 处 `:active`**;`pi-web-plugins/workspaces/browser/ProjectList.ts`/`WorkspaceList.ts`/`hostUi.ts` 0 处 `:active`。
- live(393):导航项目瓦片按下 `rgba(0,0,0,0)→rgba(0,0,0,0)`(v14);sheet 内 machine 行(`Local`,307×65)按下不变、`:active=true`(v16b);project 行同组件同样式(同类推定,行样式同源)。
- 对照:Round C T4 审计"全 app 边框 0 + bg transparent 触控 button"只列了 4 个生产者——本轮证明该枚举漏了 project/workspace/machine 行(它们在两轮审计的可见窗口内、也同样匹配过滤条件)。
- 缓解事实:这些行自带 1px 边框容器(边界可读,owner 投诉 3 在此不成立),缺的是"按压回应";但家族完整性声明(commit:"last producers join the fold")第三次为假。
- 截图:v14-01-projects(导航瓦片)、v16b-01-sheet(sheet machine 行现场)。
- **裁决:TRUE**。修法:把 `.action-main:active` 补进 shared.ts 注入的共享列表样式(一处覆盖三代列表),或各自 shadow 一行——与 SessionList.ts:818 同款。

---

## 三、Round C 遗留 TRUE 复测(本波未修,数字刷新;非新增)

- **C3 · Settings drill-in 双标题**:General 面板 h1 "General"(20px @12,56)+ 帧内 h2 "General configuration"(17px @12,105)同屏双题,v19-01-general.png 现场.rd Appearance 同构(h1 "Appearance" + 帧内再次 "Appearance",v18b-01-appearance.png)。状态:未修(与前轮一致;Round C 已裁 TRUE-遗留)。
- **C4 · 工具面板工具栏三节奏(手机)**:Files h=**61**(pad 8,题 x=8)/ Tasks、Relays h=**65**(pad `10px 12px`,题 x=12)/ Updates、Info h=**33.3**(pad 8,题 x=8)——三档带高、两档题缘原样(数据:v17b/v17e)。状态:未修(Round A 挂账半覆盖,Updates/Info 33.3 超出挂账部分维持 Round C 裁决)。
- **actions-row 垂直 inset 4px vs compact-header 2px**(带高 53 vs 49):Round C lane B 观察项,数字不变(v1b:`pad "4px 10px"`)。维持"观察、不立案"。

---

## 四、Owner 四大投诉裁决(393 手机)

1. **对齐——FALSE(clean,列内)**:导航列单左缘:scope x=10 = 各列表 h2 x=10 = 搜索 x=10 = 瓦片/行**格** x=10 = 工具行 x=10 = goals 行 x=10(本轮修复后)= fold/CTA 右缘 383(393−10)。聊天列:卡片/composer/抽屉 tab/context-bar 内容全在 x=6(chat-gutter)。跨列 10↔6 之差 = 挂账 chrome-inset 契约(维持)。残留微值:瓦片/行的**按钮**在格内左缩 3px(格 x=10,钮 x=13;右侧 1px)——按压面不贴边的光学内缩, Round A "tile edge" 已验,记观察不立案。
2. **疏密节奏——FALSE(挂账不变)+ 遗留两项(§三)**:Sessions 标题行三段间距 **25.9/25.9/25.9 完全均匀**(v14-03),桌面 768/1280 为 9.6 系——挂账"25.9 vs 9.6 touch-density"原样;标题行控高 44 全表面一致;无新节奏断点。
3. **按钮边界——FALSE(clean)**:描边控件全部 `1px solid rgb(58,66,78)`(#3a424e)于表面色上(设置卡、工具行、工具栏 Upload/Refresh/Open Terminal、+Add project、sheet 行容器);`+ New session` 为 accent 实底 CTA(高对比、有意);上次全量边界扫描的仅有的两个"无边框"例(+New session 强调、设置列表导航)维持 Round C 裁决。边界问题上**不可见的边界没有新增**;无边界控件的反馈缺口归入 T-D1/T-D3(按压态家族),不重复计。
4. **折叠按钮——FALSE(已关闭,保持)**:`.compact-fold` 44×44 @(339,2),49px header 内顶隙 2 / 底隙 3(含 1px 线),radius **2px**(方,v22 实测)——投诉 4 的闭环数字与 Round A/B/C 一致,保持。

## 五、NEW 猎项:"New session" 标题/空态居中 · 全表面

| 表面 | 结果 |
|---|---|
| 手机 393 chat 空会话 | 假滚动消失(scrollTop=0),内容 241.9/233.9(偏上 8px = 1.4%,光学惯例内)✅ |
| 768 chat 空会话 | 241.9/233.9,scrollTop=0 ✅(与 393 完全一致) |
| 1280 chat 空会话 | 250.6/242.7(偏上 7.9px,同一惯例)✅ |
| Relays 工具空态 | 319.5/319.5 居中 ✅ |
| Tasks 工具空态 | 12/643.3 顶锚 ❌ = T-D2 |
| 导航列表空态("No sessions yet. Start one to begin working here.") | 顶左锚,虚线上方 12px——**Round A 干净账明录的列表约定**(`.list-empty` 左对齐,rounda-lane-a.md:39),与工具查看器的居中约定并存;跨约定之差属 owner 裁量,不立案 |
| Quick switcher 空态 | 驱动成功(Round C 未验证项补上):输入无匹配词后 `.empty`"No sessions match…"渲染于 create-row 之下列表流内(740.5 in 636.5..784)——列表流约定,与上方 create-row 块内 11/11 居中共存;FALSE(约定内) |
| Settings Appearance 主题卡 | 180.5×183.1,名字 INSIDE(底隙 108–124),边界 1px ✅(Round B 修复保持) |
| 桌面 main `.empty`("Select a project…") | 本波未触及该规则,Round C 实测 362.75/362.75 居中,不重复测量 |

## 六、干净账(本轮实测证明干净,后来者不必再猎)

1. 折叠按钮 2/3/radius2(§四.4)。
2. compact 三钮、context-bar 按钮、session 行、bulk-select、行菜单 ⋯、palette 之外的所有既有按压态——隔离重测全 ALIVE。
3. 分隔线实线:user+assistant 实测 rgb(38,44,53)/1px;dist client 包 0 处 35% mix。
4. context-bar 49px(2/3)与 compact-header 49px 同级——两条 chrome 带高一致(Round C 的 45 vs 49 并存消失)。
5. goals 贡献节 inset:宿主/行/点全在 x=10,refresh 右缘 383。
6. QS:input x=11 / close 右缘 382 对称(393−11),create-row 内 11/11 居中,machine-tabs 全宽 391;close 按压 ALIVE(Round B 规则未回归)。
7. 行菜单:面板 174.5×186 @(207.5,216),⋯ 按压 ALIVE。
8. 主题卡(手机):卡高 183.1 全排一致,名字在卡内。
9. Composer/卡片 x=6 共线(v4:extension-card [6,327 381×283.6],composer 同缘)。
10. 空态扫描中的 h=24 INPUT = checkbox token(`--pi-checkbox-size`),非表单输入,无误。

## 七、挂账确认(owner 账面,数字不变)

- 标题行 25.9 vs 9.6(均匀)✓;节 padding 体系(导航 10/聊天 6/桌面 16)✓;Settings 面板缩进/标题 edges 家族(h1 x=12 vs 列表 x=16 的 4px 在账)✓;Save 折叠线下 ✓;三种创建形态 ✓;徽章 pill ✓。

## 八、优先级建议

1. **P0 T-D2**:重建插件 dist(goals + workspace-tasks)——tasks 空态居中与 goals 按压态一行构建即达。
2. **P0 T-D1**:三处 `:active` 提顶层(工作树编辑已在途,收掉 goals 新行的多余 `}`)+ 重建。
3. **P1 T-D3**:`.action-main:active` 入 shared 列表样式(一处覆盖 project/workspace/machine 三代)。
4. P2:§三 遗留(C3 双标题、C4 工具栏节奏)——维持 Round C 建议。

## 九、证据索引

- 截图(/tmp/roundd-lane-a-shots/):v2-00-home-before-fold、v7b-01-navpanel-session、v7b-02-palette(T-D1a/b)、v6-01-drawer-goals(T-D1b/c)、v17c-tasks 与 v10-01-tasks(T-D2 现场对照 v12-01-relays)、v14-01-projects 与 v16b-01-sheet(T-D3)、v15-01-workspaces-piweb、v14-03-sessions(25.9×3)、v18b-01-appearance 与 v19-01-general(C3)、v17b/17e(C4 数字)、v11-newsession-{393,768,1280}(修复#1 三断点)、v22-01-qs-empty、v20-03-rowmenu、v12b-01-chatbottom(实线分隔线现场)。
- 脚本(/tmp/roundd-lane-a/):helpers.mjs、q.js/qall.js(walker)、v1-pressed、v1b-press、v1c-diag、v1d-hit(sheet 污染诊断)、v2-press-family(隔离重测)、v3-sessions、v4-rowmenu、v5-chat、v6-goals-drawer、v7/v7b-contrib-palette、v8b-cssom、v9b/v9c/v9d/v9e-goals-cssom、v9f-parse-experiment(嵌套编译实验)、v9g-plugin-src(serve 字节)、v10-tasks-relays、v11/v11b-newsession、v12/v12b-relays-askuser、v13-dividers-all、v14-sweep1、v15/v15b-workspace-press、v16/v16b-sheet-press、v17b/c/d/e-tools、v18/v18b/v18c-settings、v19-general、v20-qs-rowmenu、v21-empty-sweep、v22-final。
- 关键源码位:ActionPalette.ts:109、ChatView.ts:177-178、goalsSectionElement.ts:23、tasksPanelElement.ts:288、SessionList.ts:818、shared.ts:365(注入样式无 :active)、AppNavigationPanel.ts:440/462、AppContextBar.ts:72、AskUserCard.ts:496、piWebPluginService.ts:110-152(dist 产物投递路径)。

## 十、过程披露

- 为测空态/居中在 test·main 工作区点开 3 次 "+ New session"(393/768/1280 各一)——留下 3 个 0 消息临时会话(与 Round A/B/C 同类副作用);未做删除等破坏性操作。v22 的 bulk-select 按压以 click 收尾,选中态为组件态,刷新即清。
- 探针期间 QuickSwitcher 空态首次驱动成功(点击 input 后输入);AskUserCard 无活跃实例,其修复以投递字节验证(bundle 内规则文本),live 像素未复现——如实标注。
- 复审期间(10:32–10:36)工作树出现未提交并行编辑(三处嵌套规则 + AGENTS.md/package.json 无关改动);本轮全部裁决基于已提交 dc41e086 与测量时刻的 live 投递字节。8505 栈未重启;仓库零写入。
