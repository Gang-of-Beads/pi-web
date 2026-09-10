# Round 20 · Lane A（几何与契约：pointer 查询顺序、盒模型、触控下限、间距/字号字面量、级联与规则顺序、状态栏 rail 优先级）

仓库：`/Users/hanxiao.du/Desktop/vincent/projects/pi-web`，分支 `refactor/plugin-architecture`，HEAD `1c2013f7`（工作树另有未提交的 workflow 脚本，未纳入审查）。
方法：通读 round-17/18/19 surface 的样式与渲染代码、三份 triage 文档与两份 changeset；在 HEAD 实跑全部几何守卫测试（pointerQueryOrder / boxModelGuard / spacingScale / controlHeightScale / typeScale / radiusScale / dotScale / tokenReferences / interactiveSurfaceContract / ChatView.cascadeOrder —— 10 个文件全绿）；对守卫盲区用加宽扫描（元素选择器、border 长名、后代限定选择器、逻辑属性长名）逐项找活体。

---

## F1（P1 · 修复未落地 + 三处文档反诉 + probe 验错了表面）QuickSwitcher 行菜单的 round-19 修复在 HEAD 仍不存在

**裁定：TRUE。**

证据链（全部在 HEAD 逐字节核实）：

- `src/client/src/components/QuickSwitcher.ts:247`：`<div class="action-menu-panel row-menu" role="menu" style=undefined>` —— `od -c` 确认是静态字面属性 `style="undefined"`，不是 Lit 绑定；浏览器把 `undefined` 当非法样式丢弃。
- `src/client/src/components/QuickSwitcher.ts:71,241`：`menuStyle` 在 `openRowMenu` 里用 `actionMenuPanelStyle(target, { constrainTo: "viewport" })` 计算后存进 `@state()`，全文件再无第二处引用——计算结果从未渲染进 DOM。
- `src/client/src/components/QuickSwitcher.ts:499`：`.row-menu { display: grid; gap: …; min-width: 160px; padding: …; border…; box-shadow… }` —— **没有任何 `position` 声明**（既非 fixed 也非 absolute）。
- 该组件不 adopt shared `listStyles`（styles = `interactiveSurfaceStyles + sessionStateBadgeStyles + uiIconStyle + 自有 sheet`，`QuickSwitcher.ts:403`），所以 `shared.ts:489` 的 `.action-menu-panel { position: fixed; … }` 在此 shadow root 不存在。
- 历史：`ed0cd40f`（round 18）把原本可用的 `.row-menu { position: absolute; top: …; right: 0; z-index: 3 }` 删成无定位版本、并写入字面 `style=undefined`；`1c2013f7`（round 19）对 QuickSwitcher 的全部改动只有 longPress 回调、`openRowMenu` 签名和删掉 `.row-flag.unread` 三处 hunk——**没有绑定 style，也没有加回定位**。

对照声称（三处均与代码矛盾）：
- `1c2013f7` 提交信息："it is bound, fixed-positioned in the shadow root that lacks the shared list styles"。
- `docs/design/review-triage-uiux-round19.md:12-15`（item 2）："Bound for real, the fixed positioning added … Live probe on 8505: the menu carries a computed fixed placement."
- `.changeset/round-eighteen-audit.md:19`："The quick switcher's row menu is fixed and viewport-constrained like every other row menu"（round-18 的同一声明，r19-lane-a/c 已判 FALSE，round-19 号称已修，仍未修）。

**Probe 验错了表面**：`scripts/probe-r19-row-menu.mjs` 找的是 aria-label 以 `"Actions for "` 开头的按钮——这个标签只有 `pi-web-plugins/machines/browser/MachineList.ts:135` 的机器行菜单在用（QuickSwitcher 尚未打开、SessionList 的 toggle 没有 aria-label）；probe 从头到尾没有打开 quick switcher，点击的是导航面板里的**机器行菜单**（该菜单确实 `style=${this.menuStyle}` 绑定且经 listStyles `position: fixed`）——于是 probe PASS，"proven on the live stack" 对 quick switcher 是假验证。这正是 AGENTS.md 说的"probe 与产品分歧时先分清谁腐烂"：这次是 probe 腐烂。

最小失败场景：393×850 触摸端 → 打开 quick switcher → 点任一 session 卡片的 ⋯（或长按）→ 菜单（Open/Pin/Rename）作为 `.row-wrap`（`:480`，`position: relative; display: block; height: 100%`）内的**在流块级子元素**渲染在卡片内容之下：卡片被撑高、同行 tiles 一起被拉变形；`actionMenuPanelStyle` 算出的视口约束（top/max-height/right/max-width）全部丢弃；在滚动体 `.body`（`overflow: auto`）末行会被裁掉。测试不红：`QuickSwitcher.test.ts:258` 只查 `.row-menu button`，`:419` 只钉 `.row-menu-toggle` 的 absolute。

建议（供 triage）：绑定 `style=${this.menuStyle}` 并给 `.row-menu` 加 `position: fixed`；修 probe 让它先打开 quick switcher 再断言。

---

## F2（P2 · 死状态 + 声称的机制未实现）`interruptedRunsUnknown` 从未被读写，未知 banner 的撤回仍在做 wording 匹配

**裁定：TRUE。**

- `src/client/src/components/PiWebApp.ts:307-308`：字段注释写着 "Whether the last interrupted-runs read failed; **a flag, not a wording match**"，但 `grep -rn interruptedRunsUnknown src/` 只有这一行——从不置 true，从不读取。`git log -L308,308` 证明它由 `1c2013f7` 加入后即成死代码。
- 撤回路径 `src/client/src/components/PiWebApp.ts:786`：`if (this.state.error === "Interrupted-run status is unknown: the read failed. Retrying the connection will resolve it.") this.setState(clearErrorPatch())` —— 仍是**逐字匹配自己 7 行前（:779）种下的文案**。
- 文档反诉两处：`1c2013f7` 提交信息 "the unknown banner retracts **by flag, not by matching its own wording**"；`docs/design/review-triage-uiux-round19.md:33-35`（item 8）"the unknown banner's retraction **tracks a flag, not a wording match**"。

最小失败场景：把 :779 的文案做任何一次文案修订（或经替换机制换词）而漏改 :786 → 读取恢复后未知 banner 不再自动撤回，只能等读者手点 ×，或等另一条消息替换——正是 flag 机制要消除的双拷贝锁步耦合。当前两串恰好相同所以行为侥幸正确，但提交与 triage 声称的机制不存在。

---

## F3（P2 · 模型缝隙在主生产路径上失效）`errorNoticePatch` 丢弃 `notice.machineId`、硬编码 `"local"`，round-19 item 5 的"timeout 带机器 scope"被缝隙吞掉

**裁定：TRUE。**（属 banner-model lane 交界；本 lane 顺藤核实，证据完整）

- `src/client/src/errorNotice.ts:23-29`：`errorNoticePatch` 先算 `noticeFromError(error, link)`，返回时却写死 `errorMachineId: "local"` —— `notice.machineId` 被读出后丢弃。
- `src/client/src/notice.ts:97`：`RequestTimeoutError` → `noticeFromTransport(text, machineIdFromUrl(error.url))` —— Notice 层带上了机器 scope（round-19 item 5 的修复本体）。
- 但最大的生产者缝隙全是 `errorNoticePatch`：`sessionController.ts` 约 20 处（:413、:439、:587、:639、:680、:703、:726、:752、:756、:778、:811、:842、:859、:971、:1118、:1132、:1144…）与 `machineController.ts` :32、:75、:88、:113、:124、:138。只有 `machineController.ts:154`（健康检查 reconnect 声明）走 `noticePatch(noticeFromTransport(…, id))` 保住了 scope。
- 消费端链条完备：`api/http.ts:50` 每个成功请求 `reportTransportReachable(url)` → `transportHealth.ts:31-40` 按URL 推机器 → `PiWebApp.ts:990` `observeTransportRecovery((machineId) => this.clearTransientError(machineId))` → `PiWebApp.ts:1035-1040`：scope 为 `"local"` 的声明**被任何机器的成功**清除。

最小失败场景：选中远程机器 B → B 的会话列表/健康轮询在 30s 截止处抛 `RequestTimeoutError`（URL 为 `/api/machines/B/…`）→ `errorNoticePatch` 把它落成 `errorMachineId: "local"` → 本地机器的例行健康轮询成功（`machineController.loadMachines` 对**全部**机器 `refreshMachineHealthFor`，:33-34）→ `clearTransientError("local")` 命中 → **机器 A（本地）的成功擦掉了机器 B 的超时声明**——这正是 round-17 owner 决策 1 明令禁止的擦除（"a success from machine A no longer erases machine B's complaint"，`review-triage-uiux-round17.md:47-49`），在 round-19 修复后的 HEAD 上依旧可复现。反向也坏：正确的 `clearTransientError("B")` 反而清不掉它。

---

## F4（LOW · 死代码 + 陷阱）notice.ts 里第二 个 `RequestTimeoutError` 分支不可达，且是旧的无 scope 形态

**裁定：TRUE。**
`src/client/src/notice.ts:97` 已捕获全部 `RequestTimeoutError`（:80 只截走 `link.live` 子集），`:103` 的 `if (error instanceof RequestTimeoutError) return noticeFromTransport(text);` 永不可达；它是 `1c2013f7` 加 :97 时该被替换的**旧无 scope 返回**。若未来有人调整 ：97 或重排分支，无 scope 形态即复活（重新引入 F3 的同族问题）。建议删除 ：103。

---

## F5（LOW · 注释漂移 + 同段自相矛盾）shared.ts rail 注释引用了已删除的 row-class unread 规则

**裁定：TRUE。**
`src/client/src/components/shared.ts:437-443`：先说 "the row-class rules below **(unread/archived/selected)** are (0,2,0), so they win on specificity"——但 HEAD 上 row-class 规则只剩 `.archived`（:451）与 `.selected`（:452）；`.action-row.unread` 的 rail 规则在 ed0cd40f/1c2013f7 之间已被删除（b0bce2a0 时还在，见该提交 diff）。同段随后又说 "the dot rules above are **the only unread painters**"——同一段落前句列举了不存在的 unread 规则、后句否认它。行为无错（紫 rail 确实只来自 ：445 的 dot 规则），但注释在教读者一个不存在的特异性事实；`SessionList.ts:398` 行上仍拼 `unread` class（仅供 ：719 的文字加粗使用），更易误导。

---

## F6（LOW · 死选择器分支）紫色 rail 规则里的 `.unread-ring` 永不生效

**裁定：TRUE（代码层死分支；视觉结果恰好无害）。**
`shared.ts:445` 把 `.unread-ring` 列进紫色规则；但 ring 的唯一生产者是插件 `renderActionActivityIndicator`（`pi-web-plugins/machines|workspaces/browser/activityBadge.ts`，两份相同）：`ringClass` 只在 `kind !== undefined && unreadLabel !== undefined` 时出现，即 ring 内点必为 `.activity-indicator.session` 或 `.terminal`——它们命中**更靠后**的 ：446/:449，同特异性后者胜，rail 被重涂为 success/accent；`sending` 在插件行的 `statusActivityKind` 里永远不会返回（machines/Workspaces 两份实现一致，仅 session/terminal/兜底 session）。所以 `.unread-ring` 的紫色分支在一切可达状态下被覆盖。若 ring 行按注释"rail wears the very colour the row's own dot wears"检验：ring 是 accent、内点是 success，rail=success 恰好等于内点色——视觉自洽，但 ：445 的 `.unread-ring` 词条是死的，且"arbiter renders exactly one state dot per row, so these rules never compete on one row"（:435-436）的前提对插件复合行（ring+work dot 同行）不成立，实际靠规则顺序裁决。

---

## F7（LOW · 守卫盲区 + 活体）spacing 守卫不覆盖逻辑属性长名，`7px` 字面量在逃

**裁定：TRUE。**
`src/client/src/components/spacingScale.test.ts:17-19` 的 `SPACING_PROPERTY` 枚举了 `padding-(?:top|right|bottom|left|inline|block)`，但 `padding-inline-start` / `margin-inline-start` 等带 `-start/-end` 后缀的长名不匹配（`padding-inline` 后必须紧跟 `:`）。活体：`src/client/src/components/SessionTreeNavigator.ts:624`：`.tree-row { … padding-inline-start: calc(7px + min(var(--tree-indent-mobile), 48px)); }` —— `7px` 既不在音阶（2/4/6/8/10/12/16/20/24）也不在豁免的 OFF_SCALE_TRIMS {3,5} 里，按该守卫自己的教义（"a new one has to be argued for rather than typed"）是缺陷，只因写在守卫窗口外而绿灯。对照桌面行 ：551 用的是 `calc(var(--pi-space-5) + var(--tree-indent))`。round-19 item 9 宣称"tree dialog 的 30px 字面量已变 token"——30px 确实清了，但同一属性上留下 7px。全树扫描（逻辑属性长名）仅此一处活体。

---

## F8（LOW · 守卫盲区 + 活体）boxModelGuard 只认 `border:` 简写，`border-bottom` 长名带尺寸逃逸

**裁定：TRUE。**
`src/client/src/components/boxModelGuard.test.ts:30` 的 `BORDERED = /border:\s*(?!0\b|none)/` 不匹配 `border-bottom/-left/-top/…` 长名。活体：`pi-web-plugins/git/browser/git-panel.ts:1352`：`.git-panel .git-review-section { min-width: 0; min-height: 120px; border-bottom: 1px solid var(--pi-border); … }` —— 同规则有宽、有高、有可见边、无 `box-sizing`（全文件该选择器仅此一条几何规则），content-box 下实际占位 121px。影响 1px 级、非控件，属守卫文档自述形状的活体逃逸；加宽扫描（border 长名 × 尺寸 × 无 box-sizing）全树仅此一处。

---

## F9（LATENT · 无活体）pointerQueryOrder 守卫的三个盲区（已扫描验证今日无违规）

**裁定：TRUE（盲区存在）；今日无活体违规（加宽扫描证实）。**
`src/client/src/components/pointerQueryOrder.test.ts`：
- :31 `SELECTOR` 只匹配 `.`/`#` 开头——元素/属性/`:host` 选择器（如 QuickSwitcher 的 `input { height: touch }`、SessionList 的 `:host { --pi-row-gutter-size }`）逃逸检查；
- :47 只搜"同一选择器串在 media 块之后重复"——更高特异性的 later 规则（`.x .foo` 覆盖 media 里的 `.foo`）与跨 sheet 组合（adoptedStyleSheets 顺序）不在检查范围；
- :30 的 MEDIA_BLOCK 要求 pointer/hover 出现在**第一个**括号——`(max-width: 760px) and (pointer: coarse)` 形态逃逸（现库内只有 pointer-在前的写法，故仅潜伏）。
我用加宽版扫描（元素选择器、后代限定、全部形态）跑全树：唯一命中（ChatView `@media (hover: none)` 内的 `.msg-meta`）本身在另一 media 内、且与 hover 规则同向（opacity: 1），非违规。三项盲区均无今日活体——列为潜伏，供收敛机制记录。

---

## F10（观察 · 需 owner 裁决，不算确定缺陷）`updateMachine`/`addMachine` 开头的无条件 `clearErrorPatch()` 会擦掉无关的 reader-retired banner

**裁定：行为 TRUE（代码可证）；是否缺陷取决于 owner 对"owning action clears it"的边界解释。**
`machineController.ts:69`（updateMachine）与 ：81（addMachine）在动作开始时无条件清屏：模型字面（`notice.ts:25-26`，"Only the reader retires it"）说 reader-retired 的 banner 只能被读者或"替换消息"退场，而这里是**第三种擦除者**——一个不相干的动作。例：屏幕上停着"Archive failed …"（reader-retired），读者去添加机器 → 旧 banner 在结果到来前就被抹掉。若 owner 意图是"发起新操作即视为翻页"，请在模型文档里写明这第三条退场路径，否则应改成带 ownership 校验的清除。列出供 triage 定夺，不单方判死。

---

## 明确的干净项（均为实证，非默认清白）

- **Self-update banner 的 coarse 楼层顺序正确**：base `PiWebApp.ts:205` 在前，coarse `:206` 在后（round-17 item 1 的历史雷已真修）。`.error .error-dismiss` 同型（:197 base / :206 coarse）正确。
- **rail 优先级与仲裁器一致**：session 行由 `sessionRowIndicator`（sessionRowIndicator.ts:44-59）保证每行至多一个 dot；rail 源顺序（shared.ts:445-452）实现 unread < running(success→accent) < asking < terminal < error，与仲裁器 asking > running > unread 的可 rail 部分一致；选中/归档以 (0,2,0) row-class 覆盖属设计内。机器/工作区行在所有可达状态（session/terminal/unread/组合/offline 门控）下 rail 色与 dot 色一致（含 offline+unread 的紫）。
- **MachineSwitcher 移除干净**：全树无 `machineswitcher|machine-switcher` 残留；AppNavigationPanel 无孤儿 CSS；`@query("machine-list")` 指向插件贡献的真实元素；插件经 `hostUi` adopt `listStyles`（`pluginHostUi.ts:34-35`），rail/dot 词汇同源。
- **banner 生命周期主干自洽**：6s 过期只对 reply-retired（PiWebApp.ts:1060-1067 检查 `errorRetiredBy`）；读者点 × 决定性（:3797-3805）；替换消息重置 hold 与 expiry（:3799-3803）；`bannerHoldDecision` 1.5s 只作用于空替换窗口（bannerHold.ts）。
- **十个几何守卫在 HEAD 全绿**（本 lane 实跑，见头部"方法"）。

## 收敛建议（一句话）

round-17 item 1/2 曾出现"声称已修、实际未落"，round-19 的 item 2 与 item 8 以同一形态复发且各有一处 probe/测试验错表面——建议在每轮 triage 的"Fixed"准入里加一条硬性核对：**fix diff 中必须能指出声称的机制本体**（绑定/规则/flag 的实际落点），probe 必须先打开被测表面再断言。
