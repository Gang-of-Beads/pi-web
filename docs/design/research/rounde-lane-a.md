# Round E · Lane A — 手机 393×850 最终交付核验(Round D 修复波 9fd3f926 核验 + 全表面终清扫)

评审对象:http://localhost:8505/(branch refactor/plugin-architecture,HEAD=32560596,含 Round D 修复波 9fd3f926 + 8c42e2f0)。
方法:Playwright 真机浏览(手机 393×850 hasTouch isMobile dpr2;桌面 768/1280 复核);间距/对齐/居中全部 `getBoundingClientRect` + `getComputedStyle` 实测;按压态用真实 mouse-down-hold(≥350ms)读 computed background + `matches(':active')`,疑似污染(如 scope 点击开 sheet)一律整页隔离重测;插件投递用 dev server 实际返回字节与 `dist/` 产物 sha256 对比;queued 分隔线用「served 字节 + CSSOM 规则 + live DOM 渲染 + 真实排队消息」四重验证。未改仓库文件、未重启栈;脚本在 /tmp/rounde-lane-a/,截图在 /tmp/rounde-lane-a-shots/。

**本轮使命**:Round E 是最终交付验证——门槛 = 除 owner 挂账(docs/design/review-triage-goal-round-b.md 末节)+ 各轮已裁遗留外,**零新增 TRUE**;一条新 TRUE 即循环继续。

---

## 结论(先说)

**五项修复全部到达读者(5/5),含投递级证据。** 但全表面终清扫抓到 **1 条新 TRUE**:

- **T-E1(P1)· 菜单面板条目(action-menu-panel / row-menu 的按钮)在粗指针上仍无按压态**——这正是按压态家族自己两次审计圈定的过滤条件("边框 0 + bg transparent 触控 button"),却在三轮"家族收齐"声明中全部漏网;根因是面板**按需渲染**,静止 DOM 审计看不见它,而 9fd3f926 给 shared.ts 补 `.action-row .action-main:active` 时,同文件 47 行之下就是无人认领的菜单条目规则。**不在 owner 挂账内。** 按本轮门槛,循环继续。

除此之外:owner 四大投诉全部维持闭环/挂账原状,"New session" 居中项在 393/768/1280 全部**精确居中**(本轮实测 0.0–0.1px 偏差),tasks/relays 空态居中、共享行按压、rail 头部呼吸、queued 实线分隔线全部核验通过。

---

## 一、五项修复核验总表

| # | 9fd3f926 声称 | 复测裁决 | 关键数字 |
|---|---|---|---|
| 1 | tasks 空态居中(`align-content: stretch` 进投递) | ✅ **到达** | serve 字节 = dist 产物 sha256 逐字相同(11e87be5…);live computed `display:grid, align-content:stretch`;空态 **topGap 327.6 / bottomGap 327.6**(Round D 缺陷值 12/643.3 消失);同屏对照 Relays **319.5/319.5** 居中 |
| 2 | goals `.refresh` 按压态(dist 重建 + 嵌套拆出) | ✅ **到达,双实例** | 导航面板实例 44×44 @(361,623.5):resting `rgba(0,0,0,0)` → 按下 `rgb(27,32,39)`(`--pi-surface-hover`),`:active=true`;chat 抽屉实例 44×44 @(365,121):同款 ALIVE。serve 字节 = dist sha256 相同(7cc169f1…),`shasum` 双端一致 |
| 3 | 共享列表行按压态(导航面板 + context sheet) | ✅ **到达,六点全绿** | 导航 project 瓦片 179×85 → `rgb(27,32,39)` ALIVE;导航 workspace 瓦片 369×89 ALIVE;sheet machine 行 307×65 ALIVE;sheet project 行 307×56 ALIVE;sheet workspace 行 307×56 ALIVE;session 行 325×56 ALIVE(对照组,未回归)。规则:`src/client/src/components/shared.ts:253` `.action-row .action-main:active`,coarse media 顶层 |
| 4 | rail 头部呼吸与 context bar 对称(桌面) | ✅ **到达** | 1280 桌面:rail header h=**49**,pad `2px 16px`,内控 44px 顶隙 **2**/底隙 **3**;context bar h=**49**,pad `2px 6px`,内控 44px 顶隙 **2**/底隙 **3**——分隔线两侧两条 49px chrome 带垂直呼吸逐像素对称(水平 16↔6 为挂账 chrome-inset 契约,维持)。手机侧 compact-header 49(2/3)= context-bar 49(2/3) 同级 |
| 5 | queued 消息头分隔线实线 | ✅ **到达,真实排队消息像素验证** | ① serve = dist(sha256 df59d6d6…),`.msg.user.queued > .msg-header { border-bottom-color: var(--pi-border-muted); }`;② live CSSOM 顶层同名规则,无嵌套;③ 真实排队消息(流式中发出的第二条)实测 header `border-bottom: 1px solid rgb(38,44,53)`,无 alpha;④ 全 bundle `35%, transparent` 计数 = **0** |

**Score:5 / 5。** Round D 的根因(投递产物早于修复提交)已被重建 + 提交时序修复,两个插件文件 serve/dist sha256 双端一致——投递管线本轮无新案。

---

## 二、新 TRUE 发现

### T-E1 · 菜单面板条目缺 coarse 按压态:家族过滤条件的直系成员,三轮"家族收齐"声明后仍然 DEAD——TRUE(P1)

**现象(393 手机,真实 mouse-down-hold,隔离会话):**

| 实例 | 几何 | resting → pressed | :active | 裁决 |
|---|---|---|---|---|
| session 行菜单条目(如 "Archive") | 165×44 @(212.5,285) | `rgba(0,0,0,0)` → 不变 | true | **DEAD** |
| QuickSwitcher 行菜单条目("Open") | 150×44 @(227,454) | `rgba(0,0,0,0)` → 不变 | true | **DEAD** |

正控组(同法同轮):compact-scope / compact-session / compact-fold / sheet-close / goals refresh / action-main 全部 ALIVE——方法有效,阴性可信。

**归属(样式源两处,生产者三代以上):**
- `src/client/src/components/shared.ts:489`:`.action-menu-panel button { …; border: 0; background: transparent; … }` —— 边框 0 + 透明底,**精确命中** Round C T4 审计的家族过滤条件("全 app 边框 0 + bg transparent 触控 button",见 roundd-lane-a.md §T-D3 对照引文);`:490` 仅有 `(hover: hover)` 反馈——手机上 `hover: none` **永不触发**;`:493` coarse 只给了 min-height 44。
- `src/client/src/components/QuickSwitcher.ts:507`:`.row-menu button { …; border: 0; background: transparent; … }` + `:522` 同款 hover-only —— 第二个独立样式源,同缺陷。
- 生产者:SessionList 行菜单(`SessionList.ts:440`)、瓦片菜单(`shared.ts:312/340` 的 `.list-body.tiles .action-menu`)、WorkspaceList/ProjectList/MachineList 菜单(`WorkspaceList.ts:237` 的 `.action-menu-panel.workspace-menu-panel` 同规则)、QS 行菜单(`QuickSwitcher.ts:247`)。

**为何三轮漏网:** 面板是**打开时才渲染**的动态节点——静止 DOM 的按压态审计(Round C T4)看不见它;Round B 的 stylesheet 扫描与 Round D 的共享行修复都只认领了 `.action-main`(shared.ts:253)与 toggle(`SessionList.ts:818` 的 `.action-menu-toggle:active`),面板**内部条目**在所有枚举中从未出现(Round A lane A:71 的"⋯"指的是 toggle,不是条目)。"家族收齐"声明(roundb:5、dc41e086、9fd3f926)第三次为不完整。

**不在挂账内**核对:owner 挂账末节(标题节奏 / 节 padding 体系 / Settings 缩进与标题缘 / Save 折叠 / workspace 四左缘 / 三种创建形态 / 徽章 pill)无菜单条目项。

**修法(一处 + 一处,各一行):** 在 shared.ts:493 的 coarse 块内补 `@media (pointer: coarse) { .action-menu-panel button:active { background: var(--pi-selection-bg); } }`(与其 hover 色一致;用 surface-hover 亦可,色值归 owner);QuickSwitcher.ts:522 旁同款。截图:v23-01-menuitem-pressed、v27d-01-qsmenu-pressed。

---

## 三、Owner 四大投诉裁决(393 手机)

1. **对齐——FALSE(列内单缘,数字维持)**:导航列单左缘 **x=10**:compact-header pad-x 10、Projects/Sessions h2 x=10、搜索 x=10、瓦片格 x=10、tool 行格 x=10、goals 宿主 x=10;右缘统一 **383**(+Add project / +New session / fold / 搜索 / 行 / tool 格第二列)。sheet 内单左缘 **x=19**:标题 x=19 = 三组 h2 x=19 = 行 x=19,close 右缘 **374 = 行右缘 374**。聊天列单左缘 **x=6**:消息卡 6..387(381 宽,两侧各 6)、drawer-tabs x=6、goals 抽屉宿主 x=6、composer 内容 x=6。跨列 10↔6(桌面 +16)= 挂账 chrome-inset 契约,维持。残留微值(观察,不立案):瓦片/行内按钮光学内缩 3px(格 x=10,钮 x=13,右 1px)——Round A "tile edge" 已验。
2. **疏密节奏——FALSE(挂账数字不变)**:Sessions 标题行三段间距 **25.9 / 25.9 / 25.9 完全均匀**(v6 实测,kids:Sessions 10..67.8 / ☑ 93.7..137.7 / Clean up 163.6..241.4 / +New session 267.3..383);桌面 9.6 系——挂账 "25.9 vs 9.6 touch-density" 原样,owner 裁量。列表行距 6px 全uniform(margin `6px 0`),瓦片格行距/列距 8px 全uniform,sheet 节间 16px——无新断点。
3. **按钮边界——FALSE(维持闭环)**:描边控件全部 `1px solid rgb(58,66,78)`(#3a424e)于表面色上:+Add project(115.7×44, radius 2)、tool 六卡、Files 工具栏 Upload/Refresh(44px floor 保持)、Updates Copy/Run、extension 卡按钮、fold 钮。无边框例维持 Round A/C 裁决:+New session 为 accent 实底 CTA(有意);composer 图标钮 ghost-by-design(代码注释明示"hover、focus、按压态仍示意可交互"——实测按压 ALIVE,见 §四.3);设置列表行为全出血导航行(Round A 裁决维持)。本轮无新增"不可见边界"。
4. **折叠按钮——FALSE(闭环保持)**:`.compact-fold` 44×44 @(339,2),49px header 内顶隙 **2**/底隙 **3**(含 1px 线),radius **2px**(方),边框 1px #3a424e,按压 ALIVE(19,22,27 → 27,32,39)。与 Round A/B/C/D 闭环数字一致。截图:v19b-01-fold。

---

## 四、NEW 猎项:"New session" 标题/空态居中 · 全表面(本轮全绿)

| 表面 | 结果 |
|---|---|
| 393 chat 空会话(真点 +New session) | **精确居中**:假滚动消失(`.chat` scrollTop=0, scrollHeight 600 = clientHeight 600);`min-height:100%` + `box-sizing:border-box` 生效(卡 381×525 = 565 滚箱 − 24/16 padding);内容块上方 **217.9** / 下方 **217.9**(Round D 241.9/233.9 的 8px 斜移已归零)✅ |
| 768 chat 空会话 | scrollTop=0,565=565,内容 **217.9/217.9** ✅(与 393 逐字一致) |
| 1280 chat 空会话 | scrollTop=0,565=565,内容 **226.6/226.7**(0.1px)✅(Round D 的 7.9px 斜移也已归零) |
| Tasks 工具空态 | **327.6/327.6 居中**(修复 #1)✅ |
| Relays 工具空态 | **319.5/319.5 居中** ✅ |
| 768 main `.empty`("Select a project…") | margin 352px 0 = (801−97)/2 **精确居中于 context bar 之下的内容区**;文本左右 17/18、上下 31/30 ✅ |
| 1280 main `.empty` | margin 360.75 = (801−80)/2 居中;文本居中(Round C 数字维持)✅ |
| QS create tile | 居中(Round B/C 验证,createRow 内 button 中心 196.5 = 行中心 196.5,本轮复测)✅ |
| 导航列表空态 | 顶左锚 = Round A 干净账明录的列表约定,与工具查看器居中约定并存(跨约定归 owner,不立案) |
| Appearance 主题卡(393) | 全排 **180.5×183.1** 等高,名字在卡内(Round B P0 修复保持)✅ |

---

## 五、遗留账复测(非新增;数字刷新确认原样)

- **C3 · Settings drill-in 双标题**:General:h1 "General" 20px @x12 + 帧内 "General configuration";Appearance 同构(h1 "Appearance" + 帧内 "Appearance",v13 截图)——未修,维持 Round C/D 裁决。
- **C4 · 工具面板工具栏三节奏(手机)**:Files h=**61**(pad 8,题 x=8)/ Tasks、Relays h=**65**(pad `10px 12px`,题 x=12)/ Updates、Info h=**33.3**(pad 8,题 x=8)——逐字等于 Round D 数字,维持。
- **actions-row 垂直 inset 4px vs compact-header 2px**(53 vs 49):Round C lane B 观察项,数字不变(v28),维持"观察、不立案"。

## 六、挂账确认(owner 账面,数字不变)

- 标题行 25.9 vs 9.6(均匀)✓;节 padding 体系(导航 10/聊天 6/桌面 16)✓;Settings 面板缩进(General 帧内 x=25 vs Appearance 边缘 x=12)与设置对话框标题缘(h1 x=12 vs 列表 x=16,close 右 381 vs chevron 右 377)✓;Save 折叠线下 ✓;三种创建形态(实心 +New session / 描边 +Add project / QS create-row)✓;徽章 pill ✓。

## 七、干净账(本轮实测证明干净,后来者不必再猎)

1. 五项修复(§一)。2. New session 三断点精确居中(§四)。3. 按压态全绿名单:compact 三钮、context-bar 按钮(panel-toggle/session-title)、sheet-close、session 行、共享三代行(nav+sheet 六点)、goals refresh 双实例、palette 选项行与 header close、drawer-collapse、drawer-tab、composer 全部 footer 钮(attach/model/history/send;dictate 在 headless 中 disabled 属合法)、行菜单 ⋯ toggle、bulk-select/cleanup。4. 分隔线实线:全 bundle 0 处 35% mix;queued/user/assistant 实测 rgb(38,44,53)。5. 投递管线:goals/tasks/client 三个产物 serve=dist sha256 双端一致。6. 瓦片格 14 可见瓦片等高 87、双列缘 10/200.5、右缘 383。7. tool 六卡格 8px 等距、右缘 383。8. QS:input/close/createRow 对称 11/11/11,create-row 内容中心=行中心。9. context sheet 内部对齐(19/374)。10. composer 行高 44 全体、footer pad 8/6、卡/排 x=6 共线;status bar 33px pad 8/6。11. 主题卡 180.5×183.1 等高、名字在卡内。

## 八、过程披露(副作用)

- 为核验 queued 分隔线与 New session 居中,在 **test 项目**创建了临时会话 **"Reply With rounde-queue-probe"**(项目 test 下,含 4 条探测消息:q1/q2 排队对 + 两条 "Reply with exactly…" 探测),agent 真实运行(消费 ~$0.4 网关额度);未删除任何既有会话/数据,未回答 "Slow Lighthouse Keeper Story" 的待答问题。composer 遗留草稿 "ReReply…"(未发送)留在该会话。
- 编辑器为 CodeMirror(contenteditable),Playwright `fill` 不可用,改用 click+`insertText`+Send 按钮;首轮两次排队尝试因网关回包 <1.2s 落空,第三次以 60–120ms 间隔双发成功捕获 `.msg.user.queued`。
- 桌面 768/1280 与手机 393 均为独立 context,未污染 8505 栈;仓库零写入。

## 九、优先级建议

1. **P1 T-E1**:两处各一行 coarse `:active`(shared.ts:493 块 + QuickSwitcher.ts:522 旁),色值与其 hover 对齐,归 owner 定;补一行"菜单条目"进按压态家族清单,下次扫描把"动态渲染面板"列入枚举方法。
2. 观察项(不立案,供 owner 收账):`.section-add`/`.start-session-button`/Updates Copy/Run/terminal +Shell/设置列表行均有可见边界但无 coarse `:active` 底——边界投诉不成立,按压反馈归"家族范围"裁量;若 owner 决定"全部触控钮都要按压底",这批与 T-E1 一并收。

## 十、证据索引

- 截图(/tmp/rounde-lane-a-shots/):v1-tasks-empty / v1-relays-empty(修复 #1)、v2-01-goals-refresh-pressed、v3-01-nav-project-pressed、v3b-02/03/04-sheet-{machine,project,workspace}-pressed、v3d-01-wstile-pressed、v4-01-desktop-rail / v4-02-phone-compactheader(修复 #4)、v5-01-chat、v6-01-sessions(25.9×3)、v7-01-chat、v8-*/v8d(Files 61/Tasks-Relays 65/Updates-Info 33.3)、v9-01-sheet、v10-01-qs、v11b/c-settings、v12-01-general(C3)、v13-01-appearance(C3+主题卡)、v14-01-palette、v14c-01-palette-pressed、v15-01-rowmenu、v16-01-newsession-393、v20-768-newsession / v20-{768,1280}-desktop、v21d-01-queued-live、v21g-01-queued(真实排队)、v22-01-files、v22d-01-updates、v23-01-menuitem-pressed(T-E1)、v24-01-1280-newsession、v26-01-settingsrow-pressed(观察)、v27d-01-qsmenu-pressed(T-E1)、v29-01-goals-drawer-pressed。
- 脚本(/tmp/rounde-lane-a/):helpers、nav2(openFirstSession/openNavDrawer/openTool/measureToolEmpty)、deepwalk(slot 穿透 walker)、v0* 树探、v1f(tasks/relays)、v2(家族首测)、v3/v3b/v3c/v3d(共享行六点)、v4(rail 头部)、v5/v5b(queued CSSOM+live clone)、v6/v6b/v6c(sessions 标题/行高)、v7/v7b(chat 列/divider/purple 线归属)、v8* 六工具栏、v9*/sheet、v10/QS、v11*–v13b(settings/Appearance)、v14*–v15b(palette/行菜单/行距)、v16/v16b/v20d/v24(newsession 三断点)、v19*/隔离按压、v21*–v21g(真实排队四重验证)、v22*–v23b(files/updates)、v26(设置行)、v27*–v29(QS 菜单/goals 抽屉实例)。
- 关键源码位:shared.ts:253(共享行 :active)、:489-493(菜单条目,T-E1)、QuickSwitcher.ts:507/521-522(QS 菜单,T-E1)、SessionList.ts:440/818、ChatView.ts:177/289/409、AppNavigationPanel.ts:440(header pad)/466(compact 三钮)、AppContextBar.ts:74、ActionPalette.ts:110、goalsSectionElement.ts:23、tasksPanelElement.ts(dist:251)、PromptEditor.ts:180、ContextSwitcherSheet.ts:86、SettingsDialog.ts:787。
