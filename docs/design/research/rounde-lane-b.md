# Goal Round E — Lane B（桌面 1280 + 响应式断点 393/768/1024/1280）最终交付复核

配置：live dev stack http://localhost:8505/（未重启、未改仓库文件；探针与截图均在 /tmp）。
方法：Playwright（Chromium headless）穿透 shadow DOM 实测 computed style + boundingRect；
交付检查 = dist 字节 vs 源码 vs live 服务字节；按压态用真实输入管线（mouse down-hold，
`:active` matches + computed background 变化）实测，不靠合成事件。对照账本：
`docs/design/review-triage-goal-round-b.md`（owner-deferred ledger）。

---

## 一、Round D 五项复核 — 全部到达读者（5/5 PASS）

### V1 · Tasks 空态居中（align-content: stretch 已送达）— PASS
- 交付链：`dist/pi-web-plugins/workspace-tasks/tasksPanelElement.js` 含 `align-content: stretch`
  （与源码 `pi-web-plugins/workspace-tasks/tasksPanelElement.ts:288` 一致）；live computed
  `display: grid; align-content: stretch`。
- 实测 1280：`.tasks-viewer` y=86 h=764；`.empty-state` y=427.6 h=80.8；**gapTop=341.6 = gapBottom=341.6**。
- 实测 393：viewer y=114 h=736；empty y=441.6 h=80.8；**gapTop=327.6 = gapBottom=327.6**。
- 兄弟面 Relays（393）：**319.5 = 319.5**。Tasks↔Relays 切换不再跳变。
- 截图：`/tmp/rounde-04-tasks-1280.png`、`/tmp/rounde-31-phone-tasks.png`、`/tmp/rounde-32-phone-relays.png`。

### V2 · Goals refresh 按压态 — PASS（coarse 指针，实压）
- 归属：`pi-web-plugins/goals/goalsSectionElement.ts:23` hoisted 规则（9fd3f926）已在 dist 与 live
  字节中（`@media (pointer: coarse) { .refresh {…} .refresh:active {…} } }`）。
- 实测 393（test · main 会话，抽屉内 goal 行 refresh 44×44 @ x=339,y=602）：按住时 computed
  background `rgba(0,0,0,0) → rgb(27,32,39)`（--pi-surface-hover），`:active` matches=true。
- 截图：`/tmp/rounde-20-goals-refresh-pressed.png`（↻ 按钮可见按压底色）。
- **但该按钮的桌面 hover 被同一提交弄丢 —— 见下文 NEW TRUE。**

### V3 · 共享列表行按压态（nav 面板 + context sheet）— PASS（4/4 生产者）
- 归属：`src/client/src/components/shared.ts:253`（`@media (pointer: coarse)` 内
  `.action-row .action-main:active { background: var(--pi-surface-hover); }`），live CSSOM 确认规则在
  project-list 的 adoptedStyleSheets 中。
- 实测（393，coarse，真实按住）：
  | 生产者 | 元素 | before → during |
  |---|---|---|
  | nav 面板 project 行 | project-list `button.action-main` 179×85 @ (102,206) | transparent → **rgb(27,32,39)** |
  | sheet machine 行 | context-switcher-sheet▸machine-list（"Local"，307×65） | transparent → **rgb(27,32,39)** |
  | sheet project 行 | （"test"，307×56） | transparent → **rgb(27,32,39)** |
  | sheet workspace 行 | （"test · main"，307×56） | transparent → **rgb(27,32,39)** |
- 截图：`/tmp/rounde-14-press-*.png`（4 张）。
- 说明：桌面（pointer: fine）无按压规则属设计（touch-density 分层）；桌面行有 hover 族。

### V4 · Rail header 与 context bar 呼吸对称 — PASS（1280）
- `app-navigation-panel` header（`AppNavigationPanel.ts:441`，9fd3f926 加回 `padding: var(--pi-space-1) …`）：
  computed `padding: 2px 16px`，h=49，控件（gear/Actions）y=2 h=44 → 顶隙 2 / 控件下缘到分隔线隙 2。
- `app-context-bar`（`AppContextBar.ts:72`）：`padding: 2px 6px`（pt=pb=2px），h=49，控件（☰ 44×44、标题 44）
  y=2 → 同样 2/2。
- 两条 49px 头行跨分隔线对称；底边框线在 y=48 连续。截图：`/tmp/rounde-03-headers-1280.png`。

### V5 · 排队消息分隔线实色 — PASS
- 归属：`src/client/src/components/ChatView.ts:289`（`border-bottom-color: var(--pi-border-muted)`）。
- 实测（1280，真实排队流：会话流式期间再发一条消息，出现 "✓ Queued" 卡片）：
  queued `.msg-header` computed `border-bottom-color: rgb(38,44,53)`、width 1px ——
  与普通 user `.msg-header`（rgb(38,44,53)）**逐值相同**；旧 35% alpha（实测 1.03:1）已不存在。
  在暖色排队卡面上对比度 1.23:1（与其它 msg-header 分隔线同族）。
- 截图：`/tmp/rounde-06-queued3-1280.png`（"Reply with exactly: ok again ✓ Queued" 可见）。

### 交付管线检查（Round D 教训的复查）— PASS
- `dist/pi-web-plugins/*/` 全部为 10:44 同一次构建（8 个 pi-web-plugin.js mtime 一致）；
  goals hoisted 规则、tasks stretch、relays stretch 均在 dist 字节中；live curl 字节一致。
- 客户端 bundle `dist/client/assets/index-BTp4y-4X.js`（10:44，工作树=HEAD 内容）含：
  queued 实色规则、`action-main:active`、`padding: var(--pi-space-1) var(--pi-reading-edge)`×2、
  ActionPalette hoisted 规则（8c42e2f0，CSSOM 实证于 live palette）。
- 注意：dist 构建时间（10:44）早于两个提交的时间戳（10:49/10:51），但构建自工作树，
  字节与 HEAD 一致 —— 本轮无 stale 产物。

---

## 二、NEW TRUE（1 项）— 按收敛标准循环应继续

### E-TRUE-1 · goalsSectionElement.ts:23 多余的收尾花括号令 `:hover` 规则被解析器丢弃（9fd3f926 引入的回归）— TRUE
- **归属**：`pi-web-plugins/goals/goalsSectionElement.ts:23` ——
  `@media (pointer: coarse) { .refresh { …44px); height: …44px); } .refresh:active { background: …; } } }`
  该行 3 开 4 闭（全仓单行 `@media` 扫描仅此一处失衡；ChatView/ActionPalette/shared 的同类 hoist 均平衡）。
- **机制（隔离复现）**：把这两行喂给 `new CSSStyleSheet().replaceSync()`：
  - 带多余 `}`：解析结果只有 coarse media + 其子规则 + **`@media (hover: hover) { .refresh:hover {…} }` 整条消失**，其后的 `:focus-visible` 正常；
  - 去掉多余 `}`：hover media 正常出现。
  即多余闭括号吞噬紧随其后的下一条规则（`:24` 的 hover 规则）。
- **读者层后果（1280 实测）**：桌面 hover goals refresh（ghost 按钮，border 0、bg transparent），
  computed background `rgba(0,0,0,0) → rgba(0,0,0,0)`，color 亦不变 —— 桌面上该按钮**没有任何
  hover/按压反馈**（`:active` 规则在 coarse media 内，桌面不适用；仅剩键盘 focus-visible）。
  goals 区在 rail、chat 顶部抽屉、手机抽屉三处渲染，同一样式表同损。
- **回归窗口**：dc41e086 前的旧行是嵌套写法（3 开 3 闭，平衡），hover 规则当时可达；
  9fd3f926 hoist 时引入多余 `}`。Round C/D 复核只测了 coarse 按压（手机），未测桌面 hover，故漏网。
- **修复**：删掉 `:23` 行尾多余的一个 `}`（一行 diff）。
- 证据：live CSSOM dump（无 hover 规则）、隔离 repro、hover 实测；
  截图 `/tmp/rounde-23-goals-hover.png`。

---

## 三、Owner-deferred 账本复核（数字未变，均维持 DEFERRED，不计新 TRUE）

1. **手机标题行节奏 25.9 均匀 vs 桌面 9.6 均匀**：393 实测 [Sessions|☑|Clean up|+New session]
   间隙 **25.9 / 25.9 / 25.9**（h2 y=55 h=44，touch 行高）；768/1024/1280 均为 **9.6 / 9.5 / 9.6**
   （h=32）。均匀性与账本完全一致（touch-density 决策权在 owner）。
2. **"Expand panel" 顶条贴顶**：1280 实测 `workspace-fullscreen-toggle` y=0 h=32（strip 33px）——
   与 roundd-lane-b.md:87 记录一致（deferred：roundb-lane-b.md:77 "workspace panel four left edges"）。
   其引发的第二条分隔线处水平规则台阶（chat 侧线在 y=48、wsp 侧线在 y=33）同属该未收敛的
   workspace 面板头部系统 —— 计入同一 deferred 项，不计新 TRUE。
3. **Settings 缩进 13px / 对话框标题边 / Save 折叠下 / pill 徽标**：截图复核原样
   （`/tmp/rounde-34-settings-1280.png`：General 导航内缩、Appearance 通栏、"environment override" pill 仍在），
   与 roundd-lane-b.md:87 "未动，deferred 仍准确" 一致。
4. **跨列 chrome-inset 契约**：桌面 context bar 文字起点 6px（--pi-chrome-inset=space-3）vs 会话正文 16px
   （--pi-chat-gutter=space-7）vs rail 16px（reading-edge）；手机两者均为 6px 一致。桌面 6↔16 之差即
   deferred 的跨列问题本身（`src/client/index.html:82-87,207`），非新发现。
5. **Appearance 主题卡高度**（Round B P0 回归修复）复核：卡片 h=193 未被钳制（`/tmp/rounde-36-appearance-cards.png`）——修复保持。

---

## 四、Full clean sweep — 逐项测量结果

### 按钮边界可见性（complaint #3）— CLEAN（除上述 E-TRUE-1 的 hover 缺失）
1280 全量按钮族 computed 边界/对比度（WCAG 对比率）：

| 族（代表元素） | bg | border | vs 自身 bg | vs 页面 #0b0d10 |
|---|---|---|---|---|
| rail gear / Actions、rail 网格（Files/Terminal/Tasks…）、Goals chip、Expand panel、Upload/Refresh、对话框 Update now/Skip/Cancel | rgb(19,22,27)/rgb(27,32,39) | 1px rgb(58,66,78) | **1.79** | **1.92** |
| context switcher 分段（.seg 包裹 chip + "+"，h=44 radius 3px） | rgb(19,22,27) | 1px rgb(58,66,78) | 1.79 | 1.92 |
| +New session（强调 CTA） | rgb(88,166,255) | 同色 1px | 填充式 | 7.7 |
| ghost 文字钮（Clean up、⋯、bulk-select、msg icon、composer icon 36px） | transparent | 0px（设计即无框，配 hover/按压态） | — | — |
| 分隔线 edge-button（把手 14×44） | #0b0d10 | 1px rgb(38,44,53) | — | **1.38** |

- 全部"应读作按钮"的 boxed 族统一坐在 1.79/1.92 的 Round-B 基线上，无一低于基线（唯一例外
  edge-button 1.38 见下）。
- **edge-button 1.38:1（FALSE，观察项）**：其角色是分隔线凹槽把手（复制 header 折叠钮的可达性，
  视觉承载是全对比度的 ‹/› 字形而非框），与 boxed 按钮不同族；无任何 round 记录过它低于基线。
  若 owner 认为它也应达到 1.79，可升入账本 —— 归 owner，非本轮 TRUE。

### 断点扫描（393/768/1024/1280，同面横比）— CLEAN
- 导航：393 = 全宽 compact 抽屉（compact-shell，三钮 y=2 h=44 对齐）；768/1024/1280 = 340px 固定。
  768→1024→1280 无任何几何跳变（heading 行、行高、tiles 一致）。
- 右侧 workspace 面板：768/1024 默认隐藏（0×0），768 下点 Tasks 时以 427px 取代 chat（master-detail
  互换，context bar 49px 保持）；1280 侧并列 409.6px。行为连贯，无尺寸/位置跳变。
- 会话空态/标题居中：boot 主区 "Select a project and workspace to start a session." 框心
  (810, 448.5) vs 主区中心 (810, 447) —— 居中 ✓。
- New-session 空态：1280 与 393 均 `.empty-session`（`ChatView.ts:368`，min-height:100% 生效）
  gaps top 24 / bottom 16 —— 来自 `.chat` 容器自身的 24/16 padding，两档宽度完全一致，
  内容光学居中（≤4px 偏差在容器 padding 内），非缺陷（FALSE）。
- 手机 sheet 单列行 vs 手机 nav 双列 tiles：`ContextSwitcherSheet.ts:50,59` 显式 `tiles: false`
  的按面密度契约（sheet 行承载完整路径/状态元数据），非意外不一致（FALSE）。

### 其余对齐抽查 — CLEAN
- nav 列左缘：section padding 16（heading/search x=16）；行卡 x=18 起为 `--pi-rail-width` 3px 中
  2px 透明轨道边（`shared.ts:414`）—— 选中态轨道_indicator_的载体，Round B "nav 一条边" 结论复测成立。
- chat 列：正文 x=357（=341+16 chat-gutter），composer 框同缘；消息 padding 12px 两档一致。
- queued/normal 消息卡几何一致（h=85.3 vs 89.6 属内容行数差）。

---

## 五、结论

- Round D 五项复核 **5/5 到达读者**；交付管线（dist vs 源码 vs live 字节）本轮干净。
- **1 项新 TRUE（E-TRUE-1）**：`pi-web-plugins/goals/goalsSectionElement.ts:23` 多余 `}` 令 `:24`
  的 `@media (hover: hover)` refresh 规则被丢弃 —— 9fd3f926 引入的回归，桌面 goals refresh
  无 hover 反馈。按"出现一个新 TRUE 循环继续"的标准，需一个一行修复波 + 复核。
- 账本 deferred 各项数字未变；两项边界观察（edge-button 1.38:1、workspace 面板头部台阶）
  已给出测量与归属，供 owner 决定是否升入账本。
