# Round 21 — Lane A（geometry & contracts）审查报告

范围：`shared.ts` 轨道规则与优先级、pointer-query 顺序、box model、触控地板、间距/字号字面量、级联与规则顺序陷阱、rail 组合态优先级；以及 round-17/18/19/20 文档 vs 代码。
仓库：/Users/hanxiao.du/Desktop/vincent/projects/pi-web，分支 refactor/plugin-architecture。
注意：任务书写的 HEAD 是 `1c2013f7`，但当前树已前进到 `45e7741d`（round 20 已以 `6c32b436` 落地，round-21 启动提交在其上）。本报告以当前工作树为准，并逐项核对了 6c32b436 引入的新面。

---

## F1（P2 · TRUE）磁贴活动点整枚落在文字列内：文字 padding 公式漏了点宽这一项

- 证据：
  - `src/client/src/components/shared.ts:318` — `.list-body.tiles .action-main { padding: var(--pi-space-5) calc(var(--pi-tile-menu-inset) + var(--pi-tile-menu-size) + var(--pi-space-2)) ... }`（右内边距 = inset+size+4px）。
  - `src/client/src/components/shared.ts:358` — `.list-body.tiles .action-activity { ... right: calc(var(--pi-tile-menu-inset) + var(--pi-tile-menu-size) + var(--pi-space-2)); }` —— 点的右偏移**等于**文字边界，8px 点体（`--pi-dot-md`=8，`src/client/index.html:117`）从边界向左伸入文字列。
  - 行变体是正确对照：`shared.ts:379` 行内 `.action-main` 右 padding `--pi-space-9`（24px），`shared.ts:407` 点 right `--pi-space-3`（6px）+ 宽 8 → 文字与点之间净空 10px。磁贴公式唯独没有把点的 8px 加进预留。
  - 活体面：`src/client/src/components/appShell/AppNavigationPanel.ts:294` 以 `tiles: true` 渲染 projects/workspaces 段；`pi-web-plugins/workspaces/browser/ProjectList.ts:92,118` 磁贴里同时渲染两行 clamp 的 `.workspace-primary-label`（`word-break: break-all`，铺满内容盒）与 `renderActionActivityIndicator` 的点。
  - 前案：`docs/design/research/uiux-r3-lane-c.md:53-55` 探针实测"整枚活动标记完全落在内容盒里"；`docs/design/review-triage-uiux-rounds-2-3.md:51` 把"磁贴活动点多进文字列 2px"记为真缺陷，`64045ac4` 的修法是把点偏移从 `space-3` 对齐到 `space-2`（git show 可证）——只消掉了多出的 2px，8px 点体仍在文字列内。
- 最小失败场景：导航面板 projects 磁贴网格，某项目名长到 clamp 两行铺满（`worktree-agent-a0…` 类名字正是该公式注释自己描述的场景），该行带 unread/活动点 → 紫点压在标题首行最右 1–2 个字符上（点 y=18..26 恰在首行行盒内）。这正是 `shared.ts:316-318` 注释宣称已用派生式消灭的缺陷类别，只是从"压在按钮下"变成了"压在点下"。
- 裁定：**TRUE（几何推导 + r3 探针前案）**。修法方向：padding 与点偏移都改为 `inset+size+gap+dot-md(+gap)`（行变体的 24=6+8+10 即此形状）。

## F2（P3 · TRUE · 仅注释/契约层）round-20 新写的 rail 组合态注释与它自己的编辑矛盾，且"session > terminal"优先级方向与 CSS 源序、插件文档三方不一致

- 证据：
  - `src/client/src/components/shared.ts:446-452`（`6c32b436` 新增）："an unread-and-working machine row wears the ring around its work dot, **so both the unread and the work rules match one row**"——但同一次编辑把 `.unread-ring` 从紫色规则（`:453`）中删掉后，ring 行（`.unread-ring > .activity-indicator.session|.terminal`）不再携带任何 `unread` 类选择器可匹配的节点，紫色规则**不**命中，命中的只有工作点那一条。"both ... rules match one row" 描述的是被删除前的旧行为，句子与同一注释块前一句（"the dot the ring wraps decides the rail"）互相否定。
  - `shared.ts:450-451`："Order among the work rules is the composite's precedence (**session > terminal**)"——而源序中 session 规则在 `:455`、terminal 规则在 `:458`，等特异性下后者胜，即源序实际编码的是 **terminal 胜 session**；同时插件的唯一优先级表写的是相反方向：`pi-web-plugins/machines/browser/activityBadge.ts:5-6`（workspaces 副本同）"call sites resolve precedence (**sending > session > terminal**)"。三份"文档"（注释按胜者读 / 注释按源序读 / 插件 docstring）两两不一致。
- 为何只是 P3：插件每行至多渲染一枚点（activityBadge.ts:5 "At most one kind renders at a time"），列表行也不嵌套（SessionList 子行是带 `--depth` 的平铺兄弟行），故"一行同时命中 session+terminal"今天不可达，无用户可见后果；但 round-20 把这条注释当作"states the composite's real precedence"落地（`docs/design/review-triage-uiux-round20.md` 第 6 条），它实际陈述的机制（两规则竞争、session 胜）既非真也不可达。
- 最小失败场景（潜在）：未来任何贡献者按注释在插件行同时渲染 session 点与 terminal 点（或新增嵌套行），rail 将取 terminal 色（源序），而两处文档都说 session 优先——正是本轮 convergence 反复处理的"注释教错读者"类。
- 裁定：**TRUE（注释与代码/插件契约矛盾；今日无行为差异，latent）**。

## F3（P3 · TRUE）rail 设计契约对 idle/selected/archived 三类行不成立，注释未写例外

- 证据：`shared.ts:415-422` "Each row carries a coloured edge ... the rail wears the very colour the row's own dot wears ... so a row never reads as one thing up close and another at scanning distance"。但：
  - idle 会话行：arbiter（`src/client/src/components/sessionRowIndicator.ts:15-21` 优先级表）渲染灰点 `.session-state.idle`（`sessionStateBadgeStyles.ts:27`），而 rail 规则（`shared.ts:453-459`）没有任何 `.session-state.idle` 词条 → 行内有可见灰点、rail 全透明。"近看一种颜色、扫视另一种"恰是该契约要消灭的形态（idle 也许有意无轨，但注释的普遍命题为假）。
  - selected/archived：`.action-row.selected`/`.archived`（`shared.ts:460-461`，(0,2,0)）按注释刻意压过全部 (0,1,0) 点规则 → 选中行的 rail 一律 accent，哪怕行内点是 asking 琥珀或 error 红。这是 r16 修复的既定意图，但同样与 `:421` 的普遍承诺矛盾。
- 最小失败场景：列表里一行选中且正在 asking（琥珀点）→ 近看点是琥珀、扫视轨道是 accent 蓝；一行 idle → 近看有灰点、扫视无轨。读者按注释建立的预期两次落空。
- 裁定：**TRUE（注释层）**；行为本身是否改属 owner 裁决，注释至少应列出例外。

## F4（P2 · TRUE · 文档 vs 代码 / 收敛回路未闭合）round-20 第 10 条"已删 switcher 的引用已指向现存物"未落地：capability map 仍锚定已删除文件，且整表使用抽取前旧路径

- 证据：
  - `docs/capability-map-draft.md:49` — "Switch machine ... C:**components/MachineSwitcher.ts**:63-66,98; C:components/appShell/AppContextBar.ts:218"；`:54` — "Remove machine ... C:components/**MachineSwitcher.ts**:116"。`find src pi-web-plugins -name "MachineSwitcher*"` 为空——文件已删。
  - `6c32b436` 对该表的编辑只改了 `:49` 的 Surface 列（删去 "MachineSwitcher dropdown in nav panel"），file:line 锚原样保留；commit message 与 `docs/design/review-triage-uiux-round20.md` 第 10 条均宣称 "the capability map ... now point at what exists"。
  - 同表 `:49-58` 的其余锚仍是抽取前路径：`C:components/MachineList.ts`、`:72` 的 `C:components/WorkspaceList.ts` —— 现存文件在 `pi-web-plugins/machines|workspaces/browser/`，旧路径均不存在。
  - 讽刺点：`docs/design/research/r20-lane-a.md:115` 记录"全树无 machineswitcher|machine-switcher 残留"——该扫描只覆盖 src/pi-web-plugins 代码，未覆盖 docs 的活引用。
- 最小失败场景：owner 按 capability map 找 "Switch machine" 的实现 → 打开不存在的 `src/client/src/components/MachineSwitcher.ts`。这正是 round-18/20 两次当作头条的"修复宣称已落地但未落地"类（本轮第三次）。
- 裁定：**TRUE**。

## F5（P3 · TRUE · 携带项 + 回路未闭合）r20-lane-a F7/F8 裁定 TRUE 后既未修复也未进 deferred 名单，且两处在当前树仍然活体

- 证据：
  - `docs/design/research/r20-lane-a.md` F7：spacing 守卫 `src/client/src/components/spacingScale.test.ts:18` 的 `SPACING_PROPERTY` 不匹配 `padding-inline-start` 等逻辑长名；活体 `src/client/src/components/SessionTreeNavigator.ts:624` `padding-inline-start: calc(7px + min(var(--tree-indent-mobile), 48px))` —— 7px 不在音阶（2/4/6/8/10/12/16/20/24，`index.html:30-38`）也不在豁免 `OFF_SCALE_TRIMS {3,5}`（spacingScale.test.ts:26）内，同文件桌面行 `:551` 用的是 `var(--pi-space-5)`。已验证当前树仍在。
  - 同文件 F8：boxModelGuard `src/client/src/components/boxModelGuard.test.ts:31` `BORDERED` 只认 `border:` 简写；活体 `pi-web-plugins/git/browser/git-panel.ts:1352` `min-height: 120px; border-bottom: 1px solid ...` 无 `box-sizing`，content-box 下实际占位 121px。已验证当前树仍在。
  - 而 `docs/design/review-triage-uiux-round20.md` 的 "Fixed in this wave"（10 条）与 "Deferred with written reason"（4 条）均未收录这两项 —— 裁定为 TRUE 的发现从收敛账本上消失了。
- 最小失败场景：round-21 之后的 lane 只读 triage 页，会以为无未决几何缺陷；7px/121px 继续在守卫窗外绿灯。
- 裁定：**TRUE（两项活体 + 账本缺口均核实）**。

## F6（P3 · TRUE · 注释 vs 代码）interrupted-runs 撤回机制的注释与 changeset 都说"按 flag 撤回、不按措辞"，代码仍按精确措辞匹配

- 证据：`src/client/src/components/PiWebApp.ts:785-791`：
  ```
  // The retraction tracks the flag, not the banner's wording.
  if (this.interruptedRunsUnknown) {
    this.interruptedRunsUnknown = false;
    if (this.state.error === "Interrupted-run status is unknown: the read failed. Retrying the connection will resolve it.") this.setState(clearErrorPatch());
  }
  ```
  flag 只门控"是否尝试撤回"；是否真的清屏仍取决于横幅文字与该常量逐字相等（这个措辞匹配同时是把读者自己的横幅挡在外面的机制，行为是对的）。`.changeset/round-nineteen-seams.md` 同样写 "retracts on recovery by flag rather than by matching its own wording"。
- 最小失败场景：无行为缺陷；但未来有人改这句文案而不同步改匹配常量，撤回静默失效（"status is unknown"横幅在状态恢复后仍驻留）——注释恰恰否定了这个脆弱耦合的存在。
- 裁定：**TRUE（注释/changeset 层；行为安全）**。

## F7（LATENT · 无今日活体）pointerQueryOrder 守卫的盲区在 round-19 扩展后仍然存在（携带确认，非新发现）

- 证据：`src/client/src/components/pointerQueryOrder.test.ts`：
  - `:31` SELECTOR 只锚定 `.`/`#` 开头 —— 元素选择器逃逸：`SessionList.ts:689-690`（coarse `h2 { gap: space-8 }`）、`AuthDialog.ts:275`（coarse `header button`/`input`）、`SessionRenameDialog.ts:42`、`ActionPalette.ts:111`、`pi-web-plugins/workspaces/browser/ProjectDialog.ts:362-367`（`input[type="text"]`）全都不在守卫窗口内；
  - 只查"同一选择器串在 media 块之后重复"，更高特异性的后置基规则（如磁贴 `.list-body.tiles .action-menu-toggle` (0,2,0) 压过 `:479` 的 coarse (0,1,0)——此处被磁贴自己的 coarse 规则救回）与跨 sheet 组合（`hostUi.ts:38` adopt 顺序）不在检查范围；
  - ROOTS 只扫 `.ts`：`src/client/index.html` 的 light-DOM CSS 完全不扫（今日其中无 pointer/hover 地板，仅潜伏）。
- 本轮核验：round-20 改动的样式文件（QuickSwitcher 509-516、SessionTreeNavigator 563-567、AppNavigationPanel 483、PiWebApp 206、shared.ts 全部 coarse 块）逐一核对，**基规则均先于 coarse 规则，无新活体违规**；`@media (max-width...) and (pointer...)` 形态全树无实例。self-update 横幅的 coarse 地板（PiWebApp.ts:204→206）与 AppNavigationPanel `.compact-header-action`（476→483）顺序正确。
- 裁定：盲区 TRUE（与 r20-lane-a F9 一致，携带）；今日违规 FALSE（无）。

## F8（SPECULATION，不裁定可达性）横幅 dismiss 与新错误同批渲染时，新错误被静吞且永不过期

- 证据：`src/client/src/components/PiWebApp.ts:3794-3800`：首分支 `if (error === "" || this.bannerDismissedByReader)` 在 `bannerDismissedByReader=true` 且 `error` 非空时同样走"banner goes now"并复位 flag——该次渲染把新错误吞掉，且 `scheduleTransientErrorDismissal`（`:3812-3816` 只在 show 路径调用）未被调用。若新错误的 setState 与 dismiss 的 clearErrorPatch 落进同一次批量更新，读者将永远看不到该失败（reader-retired 的失败也不显示）。
- 我未能在代码里构造确定的同批生产者（fetch 回调是宏任务、Lit 渲染在微任务之前完成 flag 复位），故**仅记为 speculation，可达性未证实**；次要观察：首分支不清 `bannerHoldTimer`（事后空触发一次 requestUpdate，无害）。

## F9（P3 nit · TRUE）两处规则顺序/字面量小陷阱

- `src/client/src/components/shared.ts:318` 与 `:322`：`.list-body.tiles .action-main` 声明两次，第一条的 `min-height: var(--pi-row-min-height)` 被 (0,2,0) 同特异性、更靠后的第二条（`calc(... + var(--pi-space-9))`）**永远**覆盖——是死声明；改第一条的 min-height 无任何效果（`align-content: center` 仍由第一条生效，更易误判"这条规则活着"）。配对意图有注释，但死值本身是本 convergence 一直清理的 rule-order 陷阱形状。
- `src/client/src/components/SessionTreeNavigator.ts:561` `.tree-row.selected { box-shadow: inset 3px 0 var(--pi-accent); }`：选中标记的 3px 竖轨写死，而共享轨宽是 `--pi-rail-width: 3px`（`index.html:90`）——同一"轨"记号两处来源，token 变更即漂移。
- 裁定：两条均 **TRUE**（LOW）。

## 信息项（防止按旧简报"修"回归）

- 任务书对模型的转述写 ""local" for unscoped claims is disproved by any success"。当前代码（`6c32b436` 之后）是：无 scope 声明打 **`page`** 标（`src/client/src/errorNotice.ts:28,33`），且**只有** `page` 声明被任意响应 disproved（`PiWebApp.ts:1046-1048`）；`local` 是机器 scope，只被该机器自身的响应 disproved。b0bce2a0 时代确实用 `local`（git show b0bce2a0:src/client/src/errorNotice.ts 可证 `machineId ?? "local"`）。round-21 triage 请以 round-20 triage 第 1 条为准，勿按本任务书的 "local" 转述回改。
- 随手核对无误的声明（lane clean 子项，仅供 triage 记账）：`TRANSIENT_ERROR_TIMEOUT_MS=6000` 按 `errorRetiredBy` 判过期（errorBanner.ts:45-47 + PiWebApp.ts:1073-1075）✓；`noticeFromTransport`/`noticePatch` 携带 machineId（notice.ts:36-40、errorNotice.ts:32-34）✓；machineController 重连声明 reply+machine-scoped（machineController.ts:151-155）✓；`loadInterruptedRuns` 失败返回 undefined（sessionController.ts:1010-1017）✓；`.code-copy-button` 24×24 达 AA 地板、无违规 ✓；formattedTextStyles 的 code-copy 预留公式虽用 `--pi-control-height-touch/2` 的怪形状但净空 12px 无碰撞 ✓；`:host([hidden])` 伴生规则与 `?hidden=` 生产者对齐（r19-lane-a:65 复核仍成立）✓。

## 汇总

| # | 位置 | 一句话 | 裁定 |
|---|---|---|---|
| F1 | shared.ts:318/358 vs 379/407 | 磁贴文字 padding 漏加点宽，活动点压字 | TRUE, P2 |
| F2 | shared.ts:446-452 | 组合态注释自相矛盾；session/terminal 优先级三处文档不一致 | TRUE, P3, latent |
| F3 | shared.ts:415-422 | rail"永远同色"契约对 idle/selected/archived 不成立 | TRUE, P3 |
| F4 | docs/capability-map-draft.md:49,54,72 | round-20"引用已指向现存物"未落地；死文件/死路径锚 | TRUE, P2 |
| F5 | spacingScale.test.ts:18 / SessionTreeNavigator.ts:624 / git-panel.ts:1352 | r20 F7/F8 未修未缓、账本缺项、活体仍在 | TRUE, P3 |
| F6 | PiWebApp.ts:785-791 | "按 flag 撤回"注释/changeset 与逐字措辞匹配矛盾 | TRUE, P3 |
| F7 | pointerQueryOrder.test.ts | 守卫盲区仍在（元素/属性/:host、跨 sheet、index.html）；今日无活体 | latent |
| F8 | PiWebApp.ts:3794-3800 | dismiss 与新错误同批渲染可静吞新错误 | speculation |
| F9 | shared.ts:318/322, SessionTreeNavigator.ts:561 | 死 min-height 声明；3px 内嵌轨未 token 化 | TRUE, P3 |
