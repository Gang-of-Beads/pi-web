# Round 28 · Lane A — 几何与契约（pointer-query 顺序 / box model / 触控地板 / 间距与字号字面量 / 级联与规则顺序 / rail 优先级）

分支 refactor/plugin-architecture，HEAD a5d3f390。方法：通读 shared.ts / sessionStateBadgeStyles.ts / sessionRowIndicator.ts / SessionList / AppNavigationPanel / PiWebApp(appStyles) / errorBanner / 各 scale 守卫测试与三个插件列表；对全部守卫做加宽扫描（元素选择器、border 长名、width:100%+padding 跨规则、@media 嵌套、68 个 lit css`` 模板括号平衡）；关键级联结论用 headless Chromium（Playwright，iPhone 13 coarse 仿真，取仓库原字符串）实测。基线：pointerQueryOrder / boxModelGuard / spacingScale / dotScale / typeScale / radiusScale 六个守卫在 HEAD 实跑全绿。未跑 8505 实机栈（只读轮次，机制级结论均以最小复现页实测代替，下文逐条标注验证方式）。

---

## F1 — TRUE（P1→P2，回归+账目）round-25 给 relays 面板补的 coarse 44px 地板从未生效：`@media` 块被意外嵌进 `.document-tab.active` 规则内

**证据**
- `pi-web-plugins/relays/relaysPanelElement.ts:525-530`：
  ```
  .document-tab.active { border-color: …; background: …; color: var(--pi-on-accent, var(--pi-bg));
  @media (pointer: coarse) {
    button.icon-button { width: var(--pi-control-height-touch); height: var(--pi-control-height-touch); }
    button, select { box-sizing: border-box; min-height: var(--pi-control-height-touch); }
    .document-tab { box-sizing: border-box; min-height: var(--pi-control-height-touch); }
  } }
  ```
  `.document-tab.active` 的收口 `}` 丢了，`@media` 成为它的嵌套规则，末行 `} }` 补上了括号——整体括号平衡，但语义变了。`git show 3ec25d8d`（Round 25 提交）显示：插入 media 块时把原来 `.document-tab.active { …; }` 的收口 `}` 吞掉了。
- CSS Nesting 语义下，这三条地板的实际选择器是 `:is(.document-tab.active) button.icon-button` 等后代形式；工具栏的 icon 按钮、`select`、兄弟 document tab 都不是 active tab 的后代 → **面板内没有任何元素命中**。实测（Playwright，iPhone 13 coarse 仿真，逐字采用该文件字符串 + 仓库 token 默认值）：`button.icon-button` computed height = **32px**，`button`/`select` min-height = **0px**，`.document-tab` ≈ 24px 高；同时 `.document-tab.active` 自身的三个声明照常生效（背景为 accent），证明解析走的是嵌套分支而非整块丢弃。

**最小失败场景**：手机（coarse 指针）→ 工具行进入 Relays 面板：刷新 icon 按钮 32px、文档标签 ~24px、下拉 32px——全部低于 44px，而 `.changeset/round-twentyfive-recovery-delivers.md:16-17` 与 round-25 提交信息均宣称 "the workspace-tasks and relays panels take the 44px touch floor"；`docs/design/research/r27-lane-a.md:40` 也把 relays 记为"已补 coarse 44"。这是 triage 自己命名的 "claims outrun edits" 类的又一次发生（round-18 头条、round-19 第 1 条同型：**coarse-floor 插入脚本两次以不同形状破坏样式结构**，round-19 是未闭合 media，round-25 是意外嵌套）。

**为什么所有守卫都没接住**：括号平衡检查通过（尾部多出的 `}` 抵消）；pointerQueryOrder 只查"media 之后同选择器 base 重复"，此处无重复；spacing/type/radius 用的都是 token。round-19 对 SessionTreeNavigator 用 "CSS parse" 证明过修复，但 round-25 的同族插入没有再跑 parse。**建议（不需要裁决，属机械修复）**：把 525 行的收口 `}` 补回（media 块移出该规则），并给四个模板 `<style>`（relays/tasks/updates/info）加一个与 round-19 同型的 parse 测试。

---

## F2 — TRUE（P2）round-27 给 updates 面板补的 coarse 44px 地板"落地即死"：裸模板 `<style>` 输给宿主 adopted sheet 的同选择器 base 规则

**证据**
- `pi-web-plugins/updates/pi-web-plugin.ts:113-114`（模板 `<style>`，始于 :95）：`button { box-sizing: border-box; min-height: var(--pi-control-height); }` + `@media (pointer: coarse) { button { min-height: var(--pi-control-height-touch); } }`——裸元素选择器，特异性 (0,0,1)，无类名提升。
- 该面板是 bare-template workspacePanels 贡献（:193 `render: (context) => renderUpdatesPanel(...)`），由 `src/client/src/components/WorkspacePanel.ts:41` 直接渲染进 `<workspace-panel>` 的 shadow root；而 WorkspacePanel 的 static styles = workspacePanelStyles（`WorkspacePanel.ts:86`），其 adopted 的 base 规则 `button { … min-height: var(--pi-control-height); … }` 在 `src/client/src/components/shared.ts:166`。
- 同一 shadow root 内，adoptedStyleSheets 排在 `<style>` 元素之后、同特异性后者胜——实测（Playwright，coarse 仿真，采用两处仓库原字符串）：computed `min-height: 32px`，模板里 coarse 的 44px 落空。

**最小失败场景**：手机 → WorkspacePanel → Updates：Copy/Run（面板仅有的两个触点）保持 32px，低于仓库 44px 触控地板，也低于 `docs/design/review-triage-uiux-round27.md:44-46`（"The floors and the twins: the updates panel's Copy/Run buttons … take the coarse 44px floor"）的宣称。

**边界说明**：这是宿主表顺序问题族的**镜像侧**——r23/r24 记录并搁置的 "Host stylesheet order"（`review-triage-uiux-round24.md:58-60`、`review-triage-uiux-round27.md:62-63`）讲的是插件 Lit 元素 own-static 与宿主 adopted 的顺序，其两个修复方向（prepend 宿主表 / 类名提升）对 updates 这种"模板 `<style>` vs 宿主 adopted"同样适用第二方向（ProjectDialog 在 r27 就是这么局部修的，`review-triage-uiux-round27.md:46-48`），但 updates 的修复只加了地板没做提升。系统级裁决仍归 owner；本条只指出 r27 的这一处修复未生效。

---

## F3 — TRUE（LOW，守卫契约）boxModelGuard 的 `border: 0`/`none` 豁免实现失效（`\s*` 回溯击穿负向断言），方向是误报

**证据**：`src/client/src/components/boxModelGuard.test.ts:28` `BORDERED = /(?:^|;|\s)border:\s*(?!0\b|none)[^;]+/u`，docstring :22 承诺 "a border declared as `border: 0`/`none` paints nothing"（豁免）。实测该正则：`"; border: 0;"`、`"; border: none;"`、`"; border: 0 solid var(--pi-border);"` **全部命中**——`\s*` 先吞空格、断言见 `0` 失败后回溯为空，负向断言改测空格并通过，`[^;]+` 随即吃掉 " 0"。豁免形同虚设。

**影响方向**：只产生**误报**——未来任何 `{ width: 44px; height: 44px; border: 0; }` 无 box-sizing 的新规则会被守卫冤枉拦下（今天无活体，六个守卫实跑全绿）。注意与已记录的 r20-F8/r25 搁置项（长手 border **漏报**逃逸）是两个相反方向的独立缺陷，此前记录未覆盖本条。

---

## F4 — TRUE 但属已记录搁置项（连续性核对，非新立案）宿主表顺序的活体清单在 r27 之后仍有第四处：TerminalPanel 基础 `button` 的 padding

- `pi-web-plugins/terminal/TerminalPanel.ts:741`：own `button { … padding: var(--pi-space-3) var(--pi-space-4); … }` (0,0,1)；宿主 listStyles adopted 在后（`terminal/hostUi.ts:45` 追加），`shared.ts:341` `button { … padding: var(--pi-space-4) var(--pi-space-5); … }` 同特异性后到 → **终端标签页按钮实际 8px/10px，代码写的 6px/8px 是死声明**（tab 按钮有 `.terminal-tabs > button` 限高，影响是水平内边距+2px 的漂移，非布局破坏）。这是 r23 立项、r24 复证、r27 记为"第三处活体（ProjectDialog 已局部修）"的同一搁置裁决下的又一处未修活体。
- 同族仍活的还有：`MachineList.ts:259-260` 的 `.machine-row` lg 圆角（r24 自己的 finding，仍搁置）；`TerminalSoftKeys.ts:94` 的 mono 字体、`touch-action: pan-x`、padding 纵向 6px 均被 listStyles 的 UI 字体/manipulation/8px 同特异性后到覆盖（r23 原报告；其"36px comfort 变 32px"的表述按现码已不成立——own `min-height: comfort` 无后到冲突，现活冲突是字体/内边距/touch-action 三项）。
- 本条不重复立案，仅确认：搁置裁决继续有效、清单比 r27 记录的多一条。

---

## 已核清的项（clean 是主张，以下是核对记录）

1. **pointer-query 顺序守卫盲区：无新活体。** 用加宽选择器语法（元素选择器、`[attr]`、`:host`）重跑守卫逻辑：0 命中；`@media (max-width…) and (pointer:…)` 这类 pointer 不在首括号的写法全树不存在（PiWebApp.ts:129 是纯 display-mode 组）。宽度类 media 的四处"后到重复"（PiWebApp 两处、PromptEditor 两处）均为互斥宽度段或刻意的窄屏级联，非 trap。守卫的两个结构盲区（跨文件 adopted 顺序、元素选择器文法）r24/r27 已记录为搁置，维持。
2. **box model：无新活体。** 同规则形状守卫全绿；跨规则 `width:100%+padding` 无 box-sizing 的形状按"元素级 union box-sizing"复扫，仅剩 `.section-toggle`（border:0 不画）、`.workspace-menu-panel`（元素同时挂 `.action-menu-panel`，listStyles 给了 border-box）、`.activity-dock.*`（基类 `ChatView.ts:224` 有 border-box）、`.kind`/`.git-diff-grid`（fit-content/max-content + 纵向 padding，无溢出）——均为扫描假阳性，非缺陷。
3. **rail 优先级与点色板：一致，无缺陷。** 仲裁器单点保证（`sessionRowIndicator.ts:33-47` 优先级 asking>running>unread>error>background>idle）与 shared.ts rail 规则源序（unread<session<running<asking<terminal<error<machine-status，全部 (0,1,0) + :where）在单点行上不可组合；可组合的只有插件行的环复合（unread-ring 内点决定 rail，注释与 `renderActionActivityIndicator` 的 markKind 实现相符）与 `machine-status.offline/error`（`MachineList.ts:160-167` 把工作点在 offline/error 下 gate 成 undefined，故 health 规则只会与 unread 同现，源序"health 后到"正是注释宣称的裁定）；archived 行不可能 unread（`SessionList.ts:888-891`），selected/bulk-selected 的 (0,2,0) 压制是 r24 已记录的 owner 裁决事项，未变。共享注释自称的"co-owned override 表"（`.action-row.bulk-selected`，`SessionList.ts:744`）存在且生效。
4. **68 个 lit css`` 模板括号全部平衡**；唯一结构破损就是 F1（模板 `<style>`，不在该扫描族内——这也解释了为何历轮的 css`` 平衡检查接不住它）。
5. **PiWebApp self-update banner 的 coarse 顺序正确**（base `:175` 行在前、coarse `:178` 行在后），r18 的修复在位；`.error .error-dismiss` 同序正确。AppNavigationPanel 无 switcher 残留（r23/r25 的注释清理已落），`audit-uiux-full.mjs` contextSheet 触发有界（20×250ms）且指向 compact-scope 的 aria-label，与 r18-lane-c 记录一致。
6. **AppNavigationPanel / QuickSwitcher / ContextSwitcherSheet / SessionList 的 coarse 块全部"base 在前、raise 在后"**，未发现新的顺序 trap。

---

## 裁决汇总

| # | 一句话 | 裁决 | 级别 | 验证方式 |
|---|---|---|---|---|
| F1 | relays coarse 地板被意外嵌套，round-25 修复未生效且被 r27 记为已修 | TRUE | P2（触控地板回归 + 账目） | 源码 + git + Chromium 实测 |
| F2 | updates coarse 地板被宿主 adopted base 规则压制，round-27 修复未生效 | TRUE | P2 | 源码 + Chromium 实测 |
| F3 | boxModelGuard 的 border:0/none 豁免失效（误报方向） | TRUE | LOW（潜伏，无现役误伤） | 正则实测 + 守卫实跑 |
| F4 | 宿主表顺序活体 +1（TerminalPanel padding）；已记录搁置项延续 | TRUE（known） | LOW | 静态级联裁定（Chromium 机制已另测） |

F1、F2 是本轮 Lane A 的实质新发现；F3 是守卫契约缺口；F4 是连续性确认。其余 hunt 清单项（rail 合并态、pointer 守卫盲区、box model、间距/字号字面量、dot 色板对齐）核对为 clean。
