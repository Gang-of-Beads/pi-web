# UI 协调性诊断问题清单（goal mty82jcc-0zf38k task-1）

判据：docs/design/uiux-journey-guidelines.md + ui-ux-pro-max skill 查询结果
（overlay 对齐、badge 语义、密度、compact label semantics）。
截图：/tmp/journeys/diag-phone-panel.png、diag-phone-drawer.png、
goal-drawer-open.png（机主截图：第五次横幅会话）。

## P1 机主点名项

### 1. 「Goals 1」徽章语义不明
- 位置：会话抽屉顶部的 Goals chip，蓝色数字徽章（diag-phone-drawer.png 顶部）。
- 来源：pi-web-plugins/goals/goalsSectionElement.ts — chip 渲染 active goal 计数。
- 违反：skill "Compact Label Semantics"（High）— 徽章必须表达状态含义，
  裸数字无上下文；机主无法知道 1 = 1 个进行中的 goal。
- 修复方向：徽章加 aria-label/title（"1 active goal"），或改为
  「Goals · 1 active」文本；颜色语义与状态对齐。

### 2. 悬浮层与列表边界脱节 + 缝隙
- 位置：会话抽屉的 Goals 条与聊天内容之间有一条蓝色缝线
  （diag-phone-drawer.png y≈100；机主第五次截图 y≈340 紫色断片同源）。
- 来源：goalsSectionElement 的 section 边界样式与聊天滚动容器的衔接
  （ChatView.ts .top-drawer border-bottom color-mix 紫线 + 聊天第一行内容
  从其下露出）。
- 违反：E2（死状态/边界可见但不误导）+ skill "Fixed Positioning"
  （overlay 必须与相邻固定元素对齐，不得随意叠放）。
- 修复方向：抽屉底边与聊天内容之间要么完整分隔（边线 + 无内容透出），
  要么完全融合（无边界线）——不能半开半合。

### 3. 面板宽窄不一
- 位置：桌面三栏（左导航 324px / 中聊天 / 右文件 425px，diag-phone-panel.png）；
  各 panel 行内边距不一致。
- 违反：J2/一致性规则（同层表面同一节奏）；skill "Container Width"。
- 修复方向：以 spacing token 为基统一 panel gutter 与行 padding 档位。

### 4. "Change context" 语义不清
- 位置：ContextSwitcherSheet.ts:34 sheet-title "Change context"。
- 违反：E3（文案说清这是什么、能干什么）；"Change context" 是实现词汇
  （machine/project/workspace 三元组），不是用户任务词汇。
- 修复方向：改为「Switch machine · project · workspace」类任务描述，或
  「Where am I working?」式的定位语义。

### 5. 页面定位不可懂
- 位置：聊天/面板/工具面切换后无「当前在哪、这里能干什么」的提示；
  抽屉、工具面板、聊天三种主面切换全靠记忆。
- 违反：skill "Navigation Patterns"（predictable location）。
- 修复方向：主面顶部已有 context bar（会话名 + 机器），增加当前面
  （Files/Terminal/…）的标题与一句话说明；空态已部分做到，工具面补齐。

### 6. margin 普遍过大（机主：越改越差）
- 位置：全表面 —— panel 行 padding --pi-space-5（10px）+ 卡片 padding
  --pi-space-6（24px）+ 区块间距 space-7；手机 393px 宽下一屏只见 2-3 行。
- 违反：机主判定 + 密度优先（核心内容占更多）。
- 修复方向：task-2 定义紧凑档（space-1/2 级别的行内距、space-4 级别的卡片
  padding），以 spacing token 机械收紧，不逐处拍脑袋。

## 已修复（本 goal 期间顺手落地）
- 第五次横幅家族：会话级/工作区级 cwdMissing 全路径封死 + 死行静置 +
  菜单无 History + cleanup 归档死会话 + 死工作区禁用 start 按钮。
- 会话顶部半透明 meter 导致的滚动浮字（695e5c1e）。
