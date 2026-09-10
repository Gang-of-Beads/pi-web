# Round 29 — Lane A（几何与契约）审查报告

- 仓库：/Users/hanxiao.du/Desktop/vincent/projects/pi-web，分支 refactor/plugin-architecture，triage 基准 HEAD 2851f3fb（工作区 5d09ff61 仅新增未跟踪脚本/清单，不影响结论）。
- 审查面：round-17 面上加 b0bce2a0 触及的一切；本 lane 焦点：pointer-query 顺序、盒模型、触摸地板、间距/字号字面量、级联与规则顺序陷阱、rail 优先级。
- 结论：**4 项 TRUE 发现（1 项 P3、3 项 low），无 FALSE 悬案**；另附本 lane 实际跑过并核对为干净的检查清单。

---

## F1【TRUE · P3/low】SessionList coarse 预留沟槽（36px）与实际画出的子树开关（44px）相差 8px —— 文本呼吸空隙为 0，违反本表自己写下的推导契约，是 round-24/26 同一修复族的残余

证据（token 值全部代入实算）：

- `src/client/src/components/SessionList.ts:694` — coarse 下 `:host { --pi-row-gutter-size: var(--pi-control-height-comfort) }` = 36px（`--pi-control-height-comfort: 36px`，`src/client/index.html:104`）。
- `src/client/src/components/SessionList.ts:771` — coarse 把 `.subtree-toggle, .subtree-toggle.inert` 画成 `width/height: var(--pi-control-height-touch)` = 44px（`index.html:105`）；这是 round-24 的修复（a8cc0451 把 width 从 `var(--pi-row-gutter-size)` 改成 touch，见 `docs/design/review-triage-uiux-round24.md:34`「stops being 36px wide against 44px-tall neighbours」）。
- `src/client/src/components/SessionList.ts:775` 与 coarse 块内 `:802` — `.action-row.has-subtree-toggle .action-main / .action-row.is-child .action-main { padding-left: calc(var(--pi-row-gutter-start) + var(--pi-row-gutter-size) + var(--pi-space-4) + depth*16) }` = 6 + 36 + 8 = **50px**（`--pi-space-3: 6px`、`--pi-space-4: 8px`，`index.html:32-33`；`--pi-space-7: 16px`，`index.html:36`）。
- 画出的开关盒：left = `--pi-row-gutter-start` = 6（`:755` 的 left 公式 coarse 未改）+ 宽 44 → **右缘 50px**。
- 即 coarse 下文本起点(50)与开关右缘(50)**恰好贴合、呼吸为 0**；而 `:752-754` 的注释契约是「the slot … is --pi-row-gutter-size wide, and the text clears it by one breathing step」，fine 指针下实测 8px（开关 6..30，文本 38）。预留公式消费的 36 与绘制消费的 44 是两个事实来源。
- 同族不一致（同一 coarse 块内两个公式各说各话）：`:750` 的 coarse `.action-main.selecting` 仍按 comfort(36) 居中推算 checkbox（6+(36−24)/2+24+6 = **42**），而 checkbox 实际按 `:799-800` 的 touch(44) 公式居中（left = 6+(44−24)/2 = 16，占 16..40；round-26 `00220101` 只把 `:800` 一侧改成 touch）。该 selecting 公式只统治**无** subtree-toggle 的行（has-subtree-toggle 的 (0,3,0) 规则 `:802` 在 coarse 下仍压过 `.selecting` 的 (0,2,0)），画出的 checkbox 与文本间只剩 2px（设计值 6px）——无重叠，纯漂移。

最小失败场景：393×850 手机，会话列表中任一带子代理的行（`hasSubagents` → `has-subtree-toggle`，`SessionList.ts:392/405`）：名称首字符与 44px 半透明圆角块（`background: color-mix(... 14%, transparent)`，`:755`）右缘 0 间距贴合；批量选择时子树折叠的行同形（inert 占位同 44px，`:472/:771`）。层级 depth 不改变结论（两式 depth 项相同）。

裁决：**TRUE**（逐 token 推导可证）。r24-lane-a.md:39 报过 36×44、r26-lane-a 报过 checkbox 偏心与 inert 特异性，均已修；「预留 vs 绘制」这一残余在 r26/r27/r28 三轮 lane 文档中均无记录（grep `row-gutter|subtree` 于 r26/r27/r28-lane-*.md 零命中）。因 0px 属「贴合」非「重叠」，定 P3/low；是否值得修属 owner 判断，修法方向（供 triage，非本 lane 决定）：coarse `:host` 的 `--pi-row-gutter-size` 提为 touch，或预留/选择两公式统一改用绘制宽度。

## F2【TRUE · low】MachineList 的「+ Add machine」标题控件在所有挂载面都不可达 —— `withCreate` 在 machine section 的每个表面都是 false，而宿主明明提供了 `addMachine`

证据：

- `pi-web-plugins/machines/browser/pi-web-plugin.ts:30` — `.onAdd=${display.withCreate && context.addMachine !== undefined ? ... : undefined}`。
- `pi-web-plugins/machines/browser/MachineList.ts:189-198` — renderAdd 实现该控件；其注释（`:192-194`）明确把它当作手机上的「the only non-Settings route to adding a machine」。
- 但 machine section 的**全部**表面都传 `withCreate: false`：`src/client/src/components/appShell/AppNavigationPanel.ts:275`（桌面与手机面板共用的 machine slot）、`src/client/src/components/appShell/ContextSwitcherSheet.ts:59`（手机 context sheet 的 machine 组）、`src/client/src/components/PiWebApp.ts:2943`（宿主基础 context 本身）。全树 grep `withCreate` 证实没有第三种取值路径。
- 宿主确实提供动词：`PiWebApp.ts:2951` 起 context 带 `addMachine`；且 `src/plugin-api.ts:327` 文档写 "Absent where a create control would not belong" —— 宿主认为它属于这里，表面却全部关掉。
- 对照组：projects 在 context sheet 里 `withCreate: true`（`ContextSwitcherSheet.ts:50`），「+ Add project」真实渲染；machines 没有任何表面为 true。
- 现存可用加机路径（以免误判为用户功能缺失）：Settings→Machines（`src/client/src/components/settings/SettingsMachinesPanel.ts:39`）、桌面 context 行的 +（`AppContextSwitcher.ts:112-118`）、ActionPalette 的 add-machine 动作（`pi-web-plugin.ts:52-56`）。

最小失败场景：owner 或后续编辑者按 MachineList 注释在手机面板/context sheet 找「+ Add machine」——永远不出现；或未来某表面把 `withCreate` 打开后才发现这条 onAdd 链路从未被任何活表面走到过。

裁决：**TRUE**（可达性由全树 grep 证明）；low。同一 seam 的另一半（同一发现内呈报）：`src/plugin-api.ts:235` / `src/client/src/plugins/types.ts:226` 的 `display.tiles`（文档："Rows render as a responsive tile grid"）被 machines 唯一 contributor 整体忽略——`pi-web-plugin.ts:41` 无条件 `renderMachinesList(context)`（b0bce2a0 删 MachineSwitcher 时把 `tiles ? renderMachinesSwitcher : renderMachinesList` 分支一并删掉），而 workspaces 插件仍然消费同一 flag（`pi-web-plugins/workspaces/browser/pi-web-plugin.ts:39/63`）；`collapsible/collapsed/toggleCollapsed` 对 machines 同样全表面 `collapsible:false` 休眠（r25-lane-a.md:64-68 的 G 项已报 collapse 链路死亡，此处补充的是 **tiles 与 withCreate 两个未被任何 triage 记录过的 display 成员**）。

## F3【TRUE · low】MachineList.ts:258 `:host { display: block; … }` 是一条永不生效的死声明 —— adopt 顺序使它输给共享表的同特异性 `:host` 规则（pointerQueryOrder 守卫结构性看不见的活体实例）

证据：

- `pi-web-plugins/machines/browser/MachineList.ts:258` — `:host { display: block; min-width: 0; }`。
- 共享表 listStyles 的 `:host`（`src/client/src/components/shared.ts:233`）— `display: flex; flex-direction: column; min-height: 0; overflow: hidden; …`，同为 `:host`，特异性相等。
- 顺序：Lit 3.3.3 的 `createRenderRoot` 先 `adoptStyles(shadowRoot, staticStyles)`（node_modules/@lit/reactive-element/reactive-element.js：`createRenderRoot(){…return s(t,this.constructor.elementStyles),t}`，`s`=adoptStyles 直接**替换** adoptedStyleSheets 数组）；MachineList 的 override 在 `super.createRenderRoot()` 之后追加宿主表：`pi-web-plugins/machines/browser/hostUi.ts:40` — `root.adoptedStyleSheets = [...root.adoptedStyleSheets, ...sheets]`。数组序 = [MachineList 自有, interactiveSurface, listStyles] → 同特异性下**后者胜** → machine-list 实际永远渲染 flex column，`display: block` 死亡（`min-width: 0` 共享表没有，存活）。
- 旁证（同一机制的两份在案记录）：r25-lane-a.md:25（`.machine-primary { display:flex }` 同型死亡，round-27 已删该规则——`docs/design/review-triage-uiux-round27.md` 第 7 条 "the dead flex declaration that never survived the adopt order is gone"）；round-28 提交 2851f3fb 的 message 记录 updates 面板 coarse 地板 "lost the specificity tie against the adopted host sheet"，是此形状造成真实故障的实测实例（其修复 shape：`.updates-panel button` 升一档特异性）。
- 对照组：ProjectList/WorkspaceList 无自有 `:host` display 声明（grep 证实），机器列表是三个列表中唯一带着这条必输声明的。
- 守卫盲区（hunt list 问"guard 还漏什么"的活体答案）：`src/client/src/components/pointerQueryOrder.test.ts` 的规则域是"**单个 styles 模板内部**、选择器文本完全相同"的先后关系——跨表 adopt tie（不同文件、同特异性、数组顺序定胜负）结构性不可见。

最小失败场景：下一位编辑者在 MachineList.ts:258 读到 `display: block` 并依赖块级行为（例如给 section 外边距参与块级排布、或删掉共享表的 `:host` display 以为自有规则兜底）——所读与所跑不符。

裁决：**TRUE**（机制有两份在案实测与本仓内 Lit 源码核对）；low（今日的胜者 flex column 恰是 listStyles 内层 section/list-body flex 链所需要的形状，与两个姊妹列表一致——损害是死声明+误导+守卫盲区，不是当下错位）。随 triage 决定：删 `display: block` 或升一档特异性并把 adopt 顺序写进注释（round-24 A-F2/round-27 已把"host stylesheet order"列为系统性 pending，本条是第三个活体实例）。

## F4【TRUE · low（文档）】docs/capability-map-draft.md 仍以 file:line 引用已删除的 MachineSwitcher —— round-27 的"已修"只落了一行，同一发现第三次复发

证据：

- `docs/capability-map-draft.md:231` — 「Machine list options … | C:components/MachineSwitcher.ts:303,309」；`:242` — 「delete the QuickSwitcher 240/140 pair and the MachineSwitcher 140/6px pair」；`:247` — 「Exact violations to fix … `MachineSwitcher.ts:303,309` (third grid) …」。MachineSwitcher.ts 已于 b0bce2a0 整文件删除（全树仅剩 prose）。
- round-27 修复提交 a5d3f390 对该文件的全部改动是 **1 行**（`:54` "Remove machine" 行删去 MachineSwitcher 引用；`git show a5d3f390 -- docs/capability-map-draft.md` 为 −1/+1）。
- 但 `docs/design/review-triage-uiux-round27.md` 第 8 条宣称修的是 "the capability map's and machines-axis design's surviving MachineSwitcher citations" —— 与 diff 不符（machines-axis-plugin-design.md:16 的括注确已修，capability map 的三处没有）。
- 复发史：r25-lane-b.md:76-81（B-7）立案 → 未清；r27-lane-c.md:305-316（C12）再立案 → 只清 `:54`。同一文件同一发现三轮三报，正是 round-18 头条「宣称已修、实未落」的类。

最小失败场景：owner 按 capability map 找 "Machine list options" 的证据 → 打开不存在的 `src/client/src/components/MachineSwitcher.ts:303`。

裁决：**TRUE**；low（纯文档），但属三报未清，建议本轮直接修 231/242/247 三行（指向 `pi-web-plugins/machines/browser/MachineList.ts` 现状或删除该行的证据链）。

---

## 核对为干净的区域（本 lane 实际跑过的检查，"干净"也要有内容）

1. **pointer 顺序机械扫描**：全树（src/client/src + pi-web-plugins，非测试 ts）逐个 `@media (pointer: coarse)` 块与 `@media (max-width)` 块，双向查「同选择器文本+属性交集、后面的 base/width 规则覆盖前面的 coarse 规则」——0 命中（与仓内 pointerQueryOrder.test.ts 互补：它只查 media-after-base 单向、同文件、精确选择器）。`PromptEditor.ts:204-213`「coarse 块置于 max-width 块之后」的注释与实际顺序相符。
2. **`?hidden` 伴生规则**：全树 6 处 `?hidden=` 站点（AppNavigationPanel.ts:188→:450；AppContextBar.ts:61→:91；ChatView.ts:1154→:163；两份 activityBadge.ts:42→shared.ts:393；AppNavigationPanel.ts:361→listStyles `:host([hidden])` shared.ts:238）全部有伴生，无新裸站点。
3. **rail 优先级组合矩阵**：仲裁器单点保证（`sessionRowIndicator.ts:46-56`）与 `shared.ts:439-451` 源序在单点行上两两不可组合；可组合态逐一核对——环复合（unread-ring 内点决定 rail，`shared.ts:429-436` 注释与 `renderActionActivityIndicator` 实现一致）、offline/error+unread（danger 后到而胜，`shared.ts:455-458` 注释与 `MachineList.ts:160-167` 的 gate 互证）、idle/sending 无 rail 规则与注释一致——与 r28-lane-a 的裁定一致，本轮无新缺口。
4. **盒模型抽算**：tile padding-right 推导 fine=54/coarse=56、`.action-activity` 右缘 fine=42..50/coarse=44..52，两支各留 4px；`.msg` 负 margin(−12) 与 `.msg` padding(12)（ChatView.ts:278/379）配对；PromptEditor textarea padding-right 与 `.editor-attach` 占位（fine 36 vs 图标实际左缘留 5px、coarse 52=8+44 精确）——均自洽。
5. **触摸地板抽查**（round-17 面 + b0bce2a0 面）：`.error .error-dismiss` 与 `.self-update-banner button`（PiWebApp.ts:194/197/200，coarse 在 base 后，round-18 修复在位）、drawer-control（ChatView.ts:168-176）、QuickSwitcher 全套（:509-516）、SessionList 末位 coarse 块（:798-807 后无 base）、MachineDialog.ts:151-156 / ProjectDialog.ts:357-367+378 / SessionRenameDialog.ts:42 / SessionCleanupDialog.ts:233+251 / SettingsDialog.ts:780、WorkspaceList.ts:413、ProjectList.ts:264 —— coarse 块均在各自 base 之后；`.detail-copy` fine 18 / coarse 24（shared.ts:379-380）为 r16/r17 记录在案的对齐裁决，非新缺陷。
6. **改动声明核对**：b0bce2a0 的 rail diff 与当前 HEAD 一致（`.unread-ring` 已退出紫色规则、(0,2,0) `.action-row.unread` rail 规则已删、machine-status danger 规则在位且位置与注释一致）；`.changeset/banner-retirement-model.md` 与 `docs/design/review-triage-uiux-round17.md` 五项决定的描述与代码相符（本 lane 可见的几何/rail 部分）。

## 标注为推测的观察（不立案）

- `.machine-status` 角点（dot-sm 6px）与 session 行 `.session-state`（dot-md 8px）跨表 2px 尺寸/偏移差——round-27 triage 已把它列为 pending owner 决策（"Corner-dot size (session 8px vs machine/workspace 6px)"），非新发现。
- F1 的 0px 间隙若 owner 认为「贴合可接受」，则降级为推导卫生问题；是否立案修复由 owner 裁定。
