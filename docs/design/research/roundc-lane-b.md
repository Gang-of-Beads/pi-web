# Round C · Lane B — 收敛轮复核报告(桌面 1280 + 断点 393/768/1024/1280)

- 栈:http://localhost:8505/(未重启、未改仓库;探针与截图均在 /tmp/roundc-lane-b/ 与 /tmp/roundc-*.png)
- 方法:Playwright 真浏览器;shadow DOM 全部 pierce;所有间距/对齐均读 computed style 与 boundingRect,不做目测。
- 断点事实(`src/client/src/breakpoints.ts:17-36`):≤430 phone tokens、≤640 chat 收紧、≤760 mobile-nav、≥1181 side-by-side;手机 token 覆盖在 `src/client/index.html:207`(reading-edge 10 / chat-gutter 6),桌面 reading-edge 16(`index.html:87`)。

---

## 一、Round B 修复逐项回访(7 项:3 项通过、4 项未到达读者)

| # | Round B 声称 | 实测 | 判定 |
|---|---|---|---|
| 1 | 新会话空态经 `min-height:100%` 居中 | 见 T1:盒体超高 32px,打开即被滚 32px,文字偏上 39px | **未到达** |
| 2 | 主题卡解除高度钳制;input/select 钉死同高 | 主题卡 1280:**193.1px**、393:**183.1px**;input=select **32/32**(桌面)、**44/44**(touch) | ✅ 到达 |
| 3 | tasks/relays viewer 填满面板、空态真居中 | viewer 填满 ✅(y=86→bottom=850,h=764);relays 空态居中 **341.6/341.6** ✅;**tasks 空态贴顶 12/671.3** ❌(见 T2) | **半到达** |
| 4 | 5 个新增按压态 | context-bar `button:active` ✅、QS `.close:active` ✅、`.drawer-tab:active` ✅ 均为顶层规则可命中;**compact-scope / compact-session / compact-header-action 三选择器死规则,永不匹配**(见 T3) | **未到达(3/5 死)** |
| 5 | 扩展卡按钮边界 | 实开会话中的 `extension-dialog-card` 按钮:`border: 1px solid rgb(58,66,78)` 于 `rgb(27,32,39)` 上,h=44 | ✅ 到达 |
| 6 | actions-row 加入阅读边 | `.compact-actions-row` padding `4px 10px` = compact-header 的 `2px 10px`,首按钮 x=10 = h2 文字 x=10 = compact-scope x=10 | ✅ 到达 |
| 7 | 消息头分隔线改实色 | 源码与 live CSSOM 仍是 `color-mix(... 35%, transparent)`;assistant 头合成对比 **1.02:1**、group 头 **1.09:1**(见 T4) | **未到达** |

截图:`/tmp/roundc-d1280-settings-appearance.png`、`/tmp/roundc-phone393-settings-general.png`、`/tmp/roundc-d1280-extcard.png`、`/tmp/roundc-phone-04-foldopen.png`。

---

## 二、新 TRUE 发现(4 项,全部在 owner-deferred 台账之外)

### T1 · 新会话空态 `min-height:100%` 无 border-box:盒体超出滚动容器 32px,打开即"假滚动"、标题偏离中心 —— TRUE
- **归属**:`src/client/src/components/ChatView.ts:367` — `.empty-session { … margin: auto; min-height: 100%; padding: var(--pi-space-7); … }` **未声明 box-sizing**(computed = `content-box`);父滚动容器 `ChatView.ts:205` `.chat { … padding: 24px 16px 16px; overflow: auto }`。
- **机制**:`min-height:100%` = `.chat` 内容盒高 528.8(568.8−24−16),content-box 下再加自身 padding 32 → 外盒 560.8,流内总高 24+560.8+16 = **601 > 客户区 569,溢出恰为 32px**。`pinnedToBottom` 默认 true(`ChatView.ts:654`),会话打开即 `scrollTop = scrollHeight`(`ChatView.ts:2170-2181`)→ **每个新会话一打开就停在 32px 的"假滚动"深处**。
- **实测(393/768/1024/1280 四宽一致)**:`scrollHeight 601 / clientHeight 569 / scrollTop 32`;空盒相对 `.chat`:top **−8**、bottom **16**;文本中心相对 chat 中心 **−39px**(打开后读者所见)。若 scrollTop=0,组中心又落在中心下方约 +20~25px。两个滚动态都不居中——Round B 的"居中"只验证了机制、未验证读者。
- **对比面**:`.empty-session` vs 其滚动容器 `.chat`(同一表面的容器关系)。
- **截图**:`/tmp/roundc-phone-03-newsession.png`、`/tmp/roundc-d1280-03-newsession.png`、`/tmp/roundc-sweep-{393,768,1024,1280}-newsession.png`。
- **修复方向(一行)**:`.empty-session { box-sizing: border-box; }`(或 `.chat` 改单子 grid)。

### T2 · Tasks 空态贴顶,与 Relays 同款虚线空态一居中一不居中 —— TRUE
- **归属**:`pi-web-plugins/workspace-tasks/tasksPanelElement.ts:287` `.viewer { … display: flex; flex-direction: column; }`(Round B 的修复)被 **下一行** `:288` `.tasks-viewer { display: grid; align-content: start; … }` 同特异性后到覆盖;元素同时挂两个类:`:84` `<section class="viewer tasks-viewer">`;空态自身 `margin: auto`(`:302`)在网格里无自由空间可分。
- **实测(1280,live)**:tasks viewer computed `display: grid`、`align-content: start`;`.empty-state` 子盒 topGap **12** / bottomGap **671.3**;同断点下 **relays** viewer(`align-content: stretch`)同款空态 topGap **341.6** = bottomGap **341.6**,完美居中。
- **对比面**:同一右侧面板、同一虚线空态组件,Tasks vs Relays 两个兄弟 tab 行为相反;切换 tab 时空态从居中跳到贴顶。
- **截图**:`/tmp/roundc-d1280-tasks.png`(贴顶,下方 670px 死白)vs `/tmp/roundc-d1280-tool-relays.png`(居中)。
- **修复方向**:删除 `:288` 的 `display/align-content`(让 `.viewer` 的 flex 生效),或把 flex 规则直接写进 `.tasks-viewer`。

### T3 · compact 头部三生产者的按压态是死 CSS:`&` 嵌套编译成后代选择器,兄弟节点永不匹配 —— TRUE
- **归属**:`src/client/src/components/appShell/AppNavigationPanel.ts:463-464` — `@media (pointer: coarse) { … }` 被嵌进 `.compact-header-action { … }` **声明块内部**。CSS Nesting 将其编译为 `& .compact-scope:active, & .compact-session:active, & .compact-header-action:active` = `.compact-header-action .compact-scope:active …`(后代组合器)。
- **DOM 事实**:`:182` `.compact-scope`、`:186` `.compact-session` 与 `:190` `.compact-header-action`(fold)**互为兄弟**,不存在嵌套。
- **live 证据**:CSSOM selectorText 原文 `& .compact-scope:active, & .compact-session:active, & .compact-header-action:active`;页面内 `querySelector(".compact-header-action .compact-scope")` → **null**(而 `.compact-scope` 存在)。
- **后果**:手机端 scope/session/fold/Settings/Actions 这些 borderless 按钮在 coarse 指针下**完全没有按压反馈**(hover 规则在 `@media (hover: hover)` 下不覆盖触屏);Round B"5 个按压态"中这一整组实际不可触发。
- **对比面**:同轮落地的 context-bar(`button:active`,顶层规则)与 QS close/drawer-tab(顶层规则)都能命中——同族两种写法,一族活一族死。
- **修复方向**:把该 @media 提升为样式表顶层规则(与兄弟文件一致)。

### T4 · 消息头分隔线"改实色"未落盘:仍是 35% alpha,assistant 头 1.02:1 不可见 —— TRUE
- **归属**:`src/client/src/components/ChatView.ts:379`(默认)、`:380`(user)、`:385`(tool)、`:386`(bash)、`:387`(skill)、`:388`(group-msg)——源码与 live CSSOM 均仍为 `border-bottom: 1px solid color-mix(in srgb, var(--pi-border-muted) 35%, transparent)` 及各角色 35% 变体。
- **对账**:提交 `1dde944d` 的提交信息与 `docs/design/review-triage-goal-round-b.md:43-44` 均声称 "solid muted border instead";但该提交对 ChatView.ts 只改了 2 个 hunk(min-height 与 drawer-tab),`1dde944d..HEAD` 无任何相关改动。**修复从未写入代码。**
- **实测(1280,开有消息的会话)**:assistant 头 `border-bottom-color: color(srgb 0.149 0.173 0.208 / 0.35)` 于 `bg color(srgb 0.141 0.152 0.171)` → 合成 (36.7, 40.8, 47.1) 对 (36, 39, 44) = **1.02:1**;group-msg 于 `--pi-bg` 上合成 **1.09:1**——与 Round B N2 测得的 1.03:1/1.09:1 零变化。user 角色(在蓝色 accent 底上)1.61:1 唯一可见。
- **对比面**:`.msg-header` 分隔线 vs 其自身卡片底(`.msg > .msg-header` 自带 `background: var(--pi-surface-card)`)。
- **截图**:`/tmp/roundc-d1280-04-chat.png`。
- **修复方向**:按 Round B 已决方案逐角色块去 alpha(实色 `var(--pi-border-muted)`)。

---

## 三、猎点清单中干净项(附证明数字)

1. **折叠按钮(fold)呼吸感**(owner 抱怨 #4):`.compact-fold` y=2、h=44,header 内容区 2..46,下缘距 1px 分隔线还有 2px padding——与 Round A 已决的 2/3px 一致;radius 2px(方)、图标 8×8。**不是新发现**(标准已达成;再缩 2px 属重开已决项)。
2. **标题行节奏**(owner 抱怨 #2):手机 h2 行 [Sessions|勾选|Clean up|+New session] 三段间距 **25.9/25.9/25.9 完全均匀**;桌面 768/1024/1280 三宽均为 **[9.6, 9.5, 9.6]**,右缘 383/324 对齐。松紧差异即台账 deferred 的 touch-density 决定,均匀性修复仍在位。
3. **按钮边界**(owner 抱怨 #3):对 nav+chat+tasks+settings(双平台)全量扫描 border-vs-底色 <1.2 的按钮:仅命中 (a) `+New session` 主 CTA——border=自身 accent 填充、对父底 **7.7:1**,故意的高亮;(b) 设置 nav 行——1px 透明 border + 透明底的列表式导航(选中态有 accent 填充),属既有设计。**无新增不可见边界**;工具栏(Refresh/Open Terminal/Upload)、tool-row、action-row 均在 `--pi-border` 实色上。
4. **断点行为**:≥1181 side-by-side(1280:面板右柱 409.6 + chat 528.4);1180 及以下工具面板接管主区(全宽 839@1180、683@1024、427@768)——为 `breakpoints.ts:24` 的设计线,非漂移;768 落桌面壳(aside 固定 340)。同表面跨四宽无未声明的尺寸/位置跳变(空态溢出 32px 是宽度无关的同一缺陷,见 T1)。
5. **QS/表头对齐**:快速切换器 input x=11、close 右缘 382(393−11)对称;header padding `space-5` 上下一致。
6. **活着的按压态**(`p2/p10` CSSOM):`session-list` 三件套、`app-context-bar button:active`、QS `.close:active`、chat `.drawer-tab:active` — 顶层 @media、选择器可命中。

## 四、观测(低于新 TRUE 门槛,记录不立案)

- `.compact-actions-row` 垂直 inset 4px vs 相邻 `.compact-header` 2px(同 44px 控制行,带高 53 vs 49)——Round B 只对齐了水平阅读边;两行各自内部对称,视觉可接受。
- 手机设置详情返回钮盒 x=4(`SettingsDialog.ts:799` 的 −8px 光学外拉)vs 详情内容 x=12 vs 列表文字 x=16——归台账"settings dialog title edges"家族。
- 工具面板 "Expand panel" 行贴顶(x=870.4, y=0)——Round B lane-b 已记录于 deferred 的"workspace panel four left edges"(`docs/design/research/roundb-lane-b.md:77`)。

## 五、结论

**4 项新 TRUE(T1–T4),超出零发现门槛 → 按本轮标准需要再一轮。** 其中 T3/T4 为"Round B 声称已修、实际未落盘";T1 为 Round B 修复自身引入的回归(content-box 超高 + 自动滚底);T2 为修复被同文件后一条规则覆盖(半失效)。四项的修复都是一至三行的定点改动,收敛在望。

