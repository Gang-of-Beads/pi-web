# 两个 Bar 的极简分析与方案（多代理记录）

子代理产物：`subagent-artifacts/611293a4（信息架构）/ 1cd6b1b4（响应式对应）/ 69799440（状态栏归属）`。
owner 原话：上边栏东西太多、不够极简、展示展示不全；两个 bar；桌面端和手机端要功能一致、页面不同但有对应。

## 病根（三线一致）

1. **两 bar 现载 14 项功能，高频必现只有 4 项**：会话名、working 态、context%、切会话。tokens 入/出、cost 是周级阅读的诊断数据，却占常驻整行。
2. **"展示不全"是结构性的**：手机 393px 顶栏物理满员（面包屑 22% + 会话名 + 重命名 + 动作），chips 靠 `overflow-x:auto` 横向滚动（AppContextBar.ts:424），触屏无 hover、`.context-value` 不省略（:421）→ 截断后读不到全名。
3. **双端不对称是规则造成的**：`showsWhereAmIBar` 三条件（whereAmIBar.ts:16-19）让桌面面板全开时顶栏整体消失（PiWebApp.ts:3410 return null），身份只在导航面板；手机永远显示但挤爆。
4. **没有"功能清单"这个东西**：桌面 `renderNavigationPanel`、手机 `renderCompact` + `mobileMainTabs` 三处各写各的，同一功能有没有入口取决于当时谁被顺手加上。

## bug 级裂缝（先修，与方案无关）

| # | 裂缝 | 证据 |
|---|---|---|
| B1 | 桌面 ≥1181px 面板展开时**快速切换没有任何鼠标入口**（`AppNavigationPanel.onQuickSwitch` 声明+赋值但 render 从未使用；只剩 mod+P）；手机永远有 | AppNavigationPanel.ts:60、PiWebApp.ts:2017 |
| B2 | 手机 Settings 只有 Actions→"Open settings" 一条路；工具 sheet 没有它 | core/actions.ts:84-88、PiWebApp.ts:3461-3479 |
| B3 | Expand panel 按钮 <1181px 是假控件（渲染、写 URL 参数、无视觉变化） | WorkspacePanel.ts:88-101 vs PiWebApp.ts:150-158 |
| B4 | 工作区工具 761-1180px 三重出现（顶栏按钮 + tab 条 + 工具 sheet），`hideToolTabs` 是死属性——"两个 bar"感受的直接来源 | PiWebApp.ts:3444-3453 |
| B5 | 顶栏动作 36px / 重命名 34px，低于项目自身 44px 触达底线 | AppContextBar.ts:441,:411 |

## 契约化（两案共用的地基）

新增 `src/client/src/appShell/appSurface.ts`：`AppFeatureSpec` 表 = feature → 每个布局的 slot（`nav.header` / `context.leading` / `context.trailing` / `toolSheet.row` / `palette.only` / `hidden`）。渲染器查表渲染，契约测试枚举全部 feature × 两布局——"对应"从约定变成可枚举测试。T1-T4（桌面不显身份行等）作为 `rationale` 写进表里，取舍显式化。

## 方案 A（激进）

- 顶栏一行 ≤3 元素：会话名 + working + context% 小缀；**一个**"去哪＋做什么"按钮（Go to sheet 扩容：导航/Actions/Settings/本会话 stats）。
- 底栏整行退役：tokens/cost/context% 进 sheet 的 stats 区（桌面导航面板 session 区 + 手机工具 sheet 顶部状态行）；重命名进会话行菜单；刷新归 PWA 下拉。
- 双端同组件常显（废 `showsWhereAmIBar` 三条件）。
- 收益：双端同构、真正极简、B1-B5 顺带全修。代价：tokens/cost 深一层；桌面多占一行；`whereAmIBar.test.ts` 4 用例、`AppContextBar.sessionLed.test.ts`、`StatusBar.test.ts` 重写。

## 方案 B（保守）

- 显示规则不动；顶栏 4 按钮→2（Actions 并入 Go to sheet）；context% 提为顶栏小缀（点击开 stats sheet，tokens/cost 在内）；手机导航视图补状态占位（修 T3 缺席）。
- 收益：信息零丢失、改动集中、测试增量。代价：393px 仍挤（省的是按钮不是面包屑）；双端仍不对称。

## 底栏裁决材料（独立于 A/B）

- 合并进顶栏：**否**——393px 已物理满员，再塞必挤会话名，重演"发错会话"事故（AppContextBar.ts:492-497 注释记录）。
- 降级 on-demand：**可行**，诚实性两条底线：(a) 每个壳状态保留可达入口（桌面全开=导航面板 sessionStatuses 数据流已在；手机/折叠=工具 sheet）；(b) 入口内缺度诚实（"No session status yet"/"context unknown" 文案语义保留）。撒谎的情形=入口显示别的会话读数（scope 违反）。
- 现状不动的代价：手机键盘弹出时底栏吃掉 composer 可视高度，而读者一天读它 0-2 次；手机非 chat 视图完全看不到 context%（无替代面）。
- 最小改动：退役 `<status-bar>`（PiWebApp.ts:3377-3381,:3505 + CSS :174/:182/:190），三读数迁两处已存在的面，严格绑定 `selectedSession.id + status`（scope 规则），同步改 StatusBar.test.ts，patch-level changeset。
