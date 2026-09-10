# Round 25 · Lane A（几何与契约）审查报告

- 仓库：/Users/hanxiao.du/Desktop/vincent/projects/pi-web，分支 refactor/plugin-architecture，审查基线 a8cc0451（工作树在 bee891a3，仅重命名了 review workflow 脚本，不影响本审查面）。
- 本 lane 焦点：pointer-query 顺序、box model、触控下限（touch floors）、间距/字号/几何字面量、层叠与规则顺序陷阱、rail 优先级。
- 只读审查：未修改任何仓库文件；输出仅写入本文件。
- 守卫验证：pointerQueryOrder / boxModelGuard / controlHeightScale / typeScale / spacingScale / dotScale / radiusScale / tokenReferences / designTokens 九个守卫在当前 HEAD 全部通过（npx vitest run，9 文件全绿）。因此下面的发现全部是“守卫看不见的形状”或“波次没走到的层”，而不是守卫红灯。

---

## 发现清单

### A.【TRUE，中】workspace-tasks 插件面板的按钮完全没有控制高度——手机上低于 32px 鼠标下限、远低于 44px 触控下限

- 证据：pi-web-plugins/workspace-tasks/tasksPanelElement.ts:298-300 —— `button { border: 1px solid var(--pi-accent-border); … padding: var(--pi-space-3) var(--pi-space-5); font: inherit; }`，整个 `<style>` 块（283-316 行）没有任何 `min-height`；唯一的媒体查询（309-312 行）只改网格布局。Refresh / Open Terminal（79-80 行）与每个任务的 Run 按钮（271 行）都吃这条规则。
- 可达性：该面板是 `workspacePanels` 贡献（pi-web-plugins/workspace-tasks/pi-web-plugin.ts:27-43），手机上经 PiWebApp 的工具行（shellToolTabs → visibleWorkspacePanels，PiWebApp.ts:3904）进入 workspace 视图；PiWebApp.ts:168-180 的 `@media (pointer: coarse), (max-width: 760px)` 明确渲染 `.shell.workspace-view > workspace-panel`。
- 最小失败场景：393x850 粗指针打开 workspace → Tasks，Run 按钮 ≈ 6+6px 纵向 padding + ~17px 文本行 + 2px 边框 ≈ 31px，低于同一视图里其他一切主操作的 44px 地板（对比 shared.ts 列表行、settingsControlStyles.ts:18 的 `min-height: var(--pi-control-height)`）。
- 为什么守卫没叫：controlHeightScale.test.ts 只“禁止 28-44px 字面量”，从不“要求存在下限”；该按钮连字面量都没有，守卫无从谈起。machine/workspaces 列表经 host seam（adoptMachinesHostStyles）继承了 shell 的按钮规则，tasks 面板先于该 seam 存在、从未接入。

### B.【TRUE，中】relays 插件面板：刷新按钮在触屏上钉死 32px，文档标签页约 24px 高

- 证据：pi-web-plugins/relays/relaysPanelElement.ts:521 —— `button.icon-button { … width: var(--pi-control-height); height: var(--pi-control-height); padding: 0; }`，整个样式块没有 coarse 提升；:524 `.document-tab { … font-size: var(--pi-text-xs); padding: var(--pi-space-2) var(--pi-space-5); }` ≈ 24px 高；:523 `select` 无任何高度声明。
- 可达性：同为 `workspacePanels` 贡献（pi-web-plugins/relays/pi-web-plugin.ts:29-40），手机经工具行进入；文档标签是该面板在手机上的主导航。
- 对照：应用内所有同类affordance都有记录在案的 coarse 地板——shared.ts:472（`.action-menu-toggle`）、shared.ts:251-256（`.list-search-*`）、QuickSwitcher.ts:509-531、ContextSwitcherSheet.ts:89。此处无任何豁免记录。
- 最小失败场景：手机上打开 Relays，点击右上刷新图标——32px 目标，是全屏唯一低于 44px 的常驻控件；文档标签的目标高度约 24px，连 24px AA 下限都只勉强贴线。

### C.【TRUE，低】`opacity: 0.65` 是禁用态的第四种拼法，且 typeScale 守卫的正则看不见 `0.` 前缀形式

- 证据 1（漂移）：pi-web-plugins/workspace-tasks/tasksPanelElement.ts:300 —— `button:disabled { cursor: wait; opacity: 0.65; }`；而 src/client/index.html:102 前后定义 `--pi-disabled-opacity: .55`，注释明言 “One meaning, one value … It had been spelled .5, .52 and .55 - twice inside one shadow root”。
- 证据 2（守卫盲区）：typeScale.test.ts:33 —— `DISABLED_OPACITY_LITERAL = /:disabled[^{]*\{[^}]*opacity:\s*\.\d+/gu`，要求小数点紧跟 `opacity:`；`opacity: 0.65`（零前缀）不匹配。已验证该守卫在 HEAD 为绿，即这条新拼法确实穿过了它。
- 最小失败场景：owner 把 `--pi-disabled-opacity` 调成 .5；shell 全部禁用控件跟着变，tasks 面板里禁用的 Run 按钮停在 0.65——同一屏幕两种“不可用”灰度。

### D.【TRUE，低】rail 宽度字面量在两处回归——正是 `--pi-rail-width` 注释里警告过的那件事

- 证据 1（意图）：src/client/index.html:90 —— `--pi-rail-width: 3px`，注释：“named because two vocabularies of rows wear it and the fallback literal had drifted out of the declared set.”
- 证据 2（回归）：SessionTreeNavigator.ts:554 —— `.tree-row.selected { … box-shadow: inset 3px 0 var(--pi-accent); }`；同一文件 557 行 `.tree-row.active-leaf { box-shadow: inset var(--pi-rail-width) 0 var(--pi-accent); }`——同一张样式表、同一个视觉动机，一处 token 一处字面量。
- 证据 3：pi-web-plugins/git/browser/git-panel.ts:1353 —— `.git-panel .git-review-section.is-focused { box-shadow: inset 3px 0 0 var(--pi-accent); }`。
- 为什么守卫没叫：spacingScale 只看 padding/margin/gap/top/right/bottom/left/inset；dotScale 只看圆点；tokenReferences 只查 var() 引用不查字面量；没有任何守卫看 box-shadow inset。
- 最小失败场景：owner 把 `--pi-rail-width` 调成 4px（按设计应是一行改动）：列表 rail 与树 active-leaf 跟随，树的选中行和 git 审查聚焦条停在 3px——token 注释里记载的“同一动机多种宽度”在收敛修复过的对话框里复发。

### E.【TRUE（守卫形状），低】boxModelGuard：border 长手写与逻辑尺寸属性在规则之外，且有一处现成实例

- 证据（守卫）：boxModelGuard.test.ts:29 —— `BORDERED = /(?:^|;|\s)border:\s*(?!0\b|none)[^;]+/u` 只匹配 `border:` 简写；`border-bottom:`/`border-left:` 等长手写全部逃逸。WIDTH/HEIGHT（26-27 行）同样不认 `inline-size`/`min-block-size`。
- 现成实例：pi-web-plugins/git/browser/git-panel.ts:1352 —— `.git-panel .git-review-section { min-width: 0; min-height: 120px; border-bottom: 1px solid var(--pi-border); … }`，该规则无 box-sizing，该 shadow root 也没有 `* { box-sizing }` 兜底（grep 证实），content-box 下盒子比声明高 1px。这正是守卫文档字符串追捕的形状（“states a size and a border … does not measure what its token says”），只是换了长手写外衣。
- 裁定：作为守卫形状缺口为 TRUE；今日用户可见伤害约 1px（诚实标注：视觉上接近无害，但它是该守卫存在的理由本身）。

### F.【TRUE（守卫形状，暂无违规实例），低】pointerQueryOrder 守卫仍然看不见三种形状——round-19 的“多条件扩展”只覆盖 pointer 在前的写法

- 证据（守卫）：pointerQueryOrder.test.ts:25-27 —— `MEDIA_BLOCK = /@media\s*\([^)]*(?:pointer|hover)[^)]*\)…/gu`、`SELECTOR = /(?:^|\})\s*(?<selector>[.#][\w-][^{}@]*?)\s*\{/gu`。
1. 选择器不以 `.`/`#` 开头的完全不可见。今天库里就有这种形状的 coarse 提升规则：AuthDialog.ts:275（`header button`、`input`）、SessionRenameDialog.ts:42（`footer button, header button, input`）、settings/settingsControlStyles.ts:19-21（`button, input:not(…), select`）——当前顺序都正确（基规则在前），所以没有活违规；但这三处任何一处未来把基规则挪到 media 块之后，守卫不会叫。
2. 逗号列表被当作一整条字面量锚定：后面基规则只重复其中一个成员（如 `input { min-height }` 跟在 `.actions button, .inline-options button, input { min-height }` 之后）不会被检出。
3. MEDIA_BLOCK 要求 pointer/hover 出现在第一个括号条件里：`@media (max-width: 760px) and (pointer: coarse)` 整块被跳过（当前树里无此写法，盲区未被触发——诚实标注：预防性发现）。
- 对照文档：.changeset/round-nineteen-seams.md 与 round19 triage 第 9 条称 “Guards extend to multi-condition media blocks”——只对 pointer 在前的多条件块为真。

### G.【TRUE，低】分节折叠的尸体：`[collapsed]` 规则永不匹配，toggle 链路无发射者

- 证据 1（死 CSS）：AppNavigationPanel.ts:509-512 —— `machine-list[collapsed], project-list[collapsed], workspace-list[collapsed], session-list[collapsed] { flex: 0 0 auto; … }`。
- 证据 2（永不匹配）：所有 section 上下文都传 `collapsed: false`——AppNavigationPanel.ts:278,293；ContextSwitcherSheet.ts:50,59；PiWebApp.ts:2865,2933。session-list 仅有的两个挂载点都传 `collapsible=false`（AppNavigationPanel.ts:175,242；签名在 361；`.collapsed=${collapsible ? … : false}` 在 375），`<session-list>` 全库只有这一个挂载（grep 证实）。
- 证据 3（死链路）：SessionList 只在 `collapsible` 为真时才渲染可折叠标题（SessionList.ts:273 分支），故 `onToggleSessions/onToggleProjects/onToggleWorkspaces/onToggleMachines`（PiWebApp.ts:2249,2276-2278；AppNavigationPanel.ts:376-377）永远不触发，`NavigationSectionsController.toggle()`（src/client/src/appShell/navigationState.ts:85-87）无 UI 发射者。
- 边界澄清（避免误报）：`isCollapsed()` 本身是活的——由 expand/open/advanceAfterSelection 驱动，compact 面板的“一次只显示一节”仍工作；死的是用户折叠这个动作和 `[collapsed]` 属性形状。
- 归类：正是 round-19 verdict 自己命名的一类——“leftovers of the removals”。MachineSwitcher 删除波次清了 header 重复挂载与孤立 CSS，但旧模型的分节折叠 affordance 没有跟着走。
- 最小失败场景：下一位编辑者读到 509-512 会以为存在“折叠的列表”这种形态并围绕它设计；或恢复一个折叠开关接到 onToggleSessions——点下去什么也不会折叠，因为属性从未被置真。

### H.【TRUE（文档漂移），低】operation-model.md 的 notice.ts 行号锚再次腐烂

- 证据：docs/design/operation-model.md:24 引用 “notice layer (`notice.ts:70`)”；当前 `noticeFromError` 在 src/client/src/notice.ts:79，70 行落在其上方的文档字符串里。round-18 triage 第 11 条修的正是 “the operation-model anchor” 这一类——修完后又漂了。
- 最小失败场景：读者按锚跳到 70 行读到的是注释而非函数，对“谁拥有 page banner”的判断多花一次定位。

---

## 裁定为不成立 / 主动放弃的怀疑（记录在案）

1. MachineList 的 `.machine-primary { display: flex }`（pi-web-plugins/machines/browser/MachineList.ts:262）与共享 `.action-name { display: -webkit-box }`（shared.ts:441 附近）同特异性冲突，而 host 样式表追加在元素自有样式之后（hostUi.ts:38），display 一项永远输给共享表——规则实际死亡。视觉结果两者等价（单子元素、同样两行截断），故不作为缺陷呈报；作为“host 表在后、自有同名规则失效”的方向性事实记录，避免下一位在 `.machine-primary` 里改 display 却看不到效果。
2. QuickSwitcher 角标与 44px 角菜单在最小高度 tile 上的重叠计算：只对从不携带状态标记的 create-row 有 ~1px 重叠，会话 tile 实际 ~91px 高（标题两行钳制 + 副标题），无重叠。裁定：不成立。
3. WorkspaceList 的 `var(--pi-danger, #c0392b)` 回退字面量（WorkspaceList.ts:415 附近）：token 契约明确祝福回退写法（tokenReferences.test.ts 文档字符串），`--pi-danger` 为核心必有 token，回退死代码但合规。不呈报。
4. `.tree-row { min-height: 48px }`（SessionTreeNavigator.ts:556）相对 `--pi-row-min-height: 56px`：树行是对话框里的单行密排形态，48 无 token 也无豁免记录——【推测，标注为推测】可能是刻意的密度选择，也可能是第三次“行高漂移”；证据不足以裁定为缺陷，仅记录。

## 核对为干净的主张（lane 的“干净”也要有内容）

- rail/点色板一致性：sessionRowIndicator.ts 的仲裁优先级（asking > running > unread > error > background > idle）与 shared.ts:438-451 的 rail 规则一一对应——unread/background 紫、running 强调、asking 警告、error 危险、machine 词汇 `.activity-indicator.session` 成功、`.terminal` 强调、`.sending`/idle 无 rail（注释声明挂载行无 rail，规则侧无匹配，一致）。round-18 移除的 (0,2,0) unread rail 规则确无残留（grep `action-row.unread` 在 shared.ts 无命中；SessionList.ts:726 的 `.unread` 只改文字）。
- 复合状态：unread+工作 的机器行经 unread-ring 包裹工作点（machines/browser/activityBadge.ts:31-47），无 unread 类节点、rail 随工作点——与 shared.ts:443-446 注释声称的语义逐字一致；离线机器保留 unread 紫点紫 rail（MachineList.renderActivity，188-201 行），与注释“Unread survives offline”一致。
- (0,2,0) 行类覆盖组：archived/selected（shared.ts:450-451）与 SessionList 的 `.bulk-selected`（SessionList.ts:744，border-color 简写含左边）按注释所述共同拥有覆盖集，特异性正确压过全部 :has() 规则。
- `:has()` 与 [hidden] 陷阱：activityBadge 对“空转行”渲染 idle 标记类而非 unread（activityBadge.ts:31-47），配合 `.action-activity[hidden] { display: none }`（shared.ts:436），空闲行 rail 不会被隐藏包装点亮。
- AppNavigationPanel 无 switcher 残留：样式表中声明的每个类（compact-session/compact-scope/compact-working/compact-header-action/compact-fold/tools-*/tool-*）都有模板使用点（157,184-200,306-330 行逐一核对）。
- PiWebApp 的 coarse 地板顺序：`.self-update-banner button`（198 基）→ 199 coarse；`.error .error-dismiss`（189 基）→ 199 coarse——round-17/18 争议的那处修复真实落位。
- MachineSwitcher 全库无引用；SessionTreeNavigator 无未闭合 media 块、无 30px 字面量（round-19 第 1、9 条主张与代码相符）。

## 汇总

- 8 项 TRUE 发现：2 项中（A、B——两个插件面板的触控下限缺口），5 项低（C、D、E、F、G），1 项文档（H）。无 P1。
- 共同根因有二：其一，round-17-19 的触控/几何收敛只走到了 machine/workspaces 两个经 host seam 的插件，tasks/relays/goals/terminal 等自带 shadow root 的插件面板仍是盲区（goals 经 adoptGoalsHostStyles 只接了 surfaceStyles，按钮高度同样无人管，本次未深挖、如实说明）；其二，几何守卫族普遍“按字面量与简写形状匹配”，长手写 border、`0.` 前缀 opacity、元素选择器、box-shadow inset 都在词法盲区里。
- 建议方向（供 owner 决策，非本 lane 擅自）：把“按钮必须有 min-height 下限”从注释变成守卫（如要求含 `button`/`[role=button]` 规则的样式块声明控制高度），并把上述四种词法盲区补进对应守卫。
