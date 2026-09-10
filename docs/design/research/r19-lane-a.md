# 收敛第 19 轮 · Lane A：几何与契约（pointer-query 顺序 / 盒模型 / 触控下限 / 间距字号字面量 / 级联与规则顺序陷阱 / rail 优先级）

HEAD ed0cd40f（branch refactor/plugin-architecture）。只读审查：读源码 + git show/-L + 三个只读 node 扫描脚本（不落仓库文件）。以下每条发现给出 file:line、最小失败场景与 TRUE/FALSE 裁决。

## F1（P1 · 级联/规则顺序）SessionTreeNavigator 样式表括号失衡：@media (pointer: coarse) 块（:565）永不闭合、:540 有一颗孤立右括号——从 :566 到表尾的全部规则在桌面（pointer: fine）整体失效

- 证据：
  - `src/client/src/components/SessionTreeNavigator.ts:539` 是完整的 .close-button 规则；:540 是单独一行 } （顶层孤立）；:565 的 @media (pointer: coarse) { 打开后直到模板结束（:635）没有闭合——:621 的 @media (max-width: 760px) 在 :633 闭合后，coarse 块只能在样式表 EOF 被隐式闭合。
  - 插值感知括号扫描（剔除注释、跳过插值）：HEAD 该表 UNDERFLOW 一次且终态深度 1；父提交 ed0cd40f~1 同一表终态深度 0（平衡）。postcss.parse 对同一文本直接抛 Unexpected }（sheet 第 15 行 = 文件 :540）。
  - git log -L 536,545 显示孤立 } 与其后空行是 ed0cd40f 新增；同一提交把 coarse 块插在 :565 却未给它闭合括号——本意为闭合 coarse 块的 } 被放到了约 25 行之外的顶层。
- 浏览器语义（高置信推断，标注：结构失衡为实证，「孤立 } 被丢弃、EOF 隐式闭合」依 CSS Syntax 错误恢复规则推断）：净效果是 :566–:632 每条规则只活在 (pointer: coarse) 内。
- 最小失败场景：桌面（fine pointer）打开会话树导航确认框（lazySurfaces.ts:16 注册为 session-tree）→ 以下全部失效：:570 .metadata display:contents 与 :571-:574 四条 grid 放置（kind 徽章/entry/badges 塌进一格）；:575-:590 整套 .kind/.badge 药丸词汇；:591-:616 .confirmation-step/.confirmation-card/.selected-entry/fieldset/.choice-option/textarea/.custom-focus/.validation-error；:612-:617 全部 button 规则（UA 默认灰按钮）；:621-:633 嵌套 ≤760px 移动块（窄桌面窗口同失）；:568 嵌套 hover 块变 coarse-only（桌面 disclosure hover 失效）。coarse（手机）不受影响——8505 栈 393×850 coarse probe 恰好探不到，这是它溜过第 18 轮活体验证的路径。
  - ed0cd40f 提交信息宣称 session tree 的 disclosure/close 拿到 coarse 地板：地板本身在（:566-:567），代价是整张表的桌面半边。
- 裁决：TRUE（括号失衡为结构实证；桌面失效为 CSS 语义 + postcss 拒析佐证；未跑浏览器 probe，如需 I 类证据可在 8505 栈以 fine pointer 复核）。

## F2（P1 · 修复未生效 + changeset/文档反诉代码）QuickSwitcher 行菜单「fixed and viewport-constrained」在 HEAD 不成立：定位样式计算了但从未绑定，定位规则又被删掉

- 证据：
  - `src/client/src/components/QuickSwitcher.ts:243`：div 标签上写的是 style=undefined——静态字面属性（Lit 只把插值当绑定），渲染为 style="undefined" 被浏览器丢弃。
  - :237 this.menuStyle = actionMenuPanelStyle(target, { constrainTo: "viewport" }) 计算了固定定位样式，但 menuStyle（:71 声明）全文件只写不读。
  - ed0cd40f 同时删除旧定位规则：.row-menu 由 position: absolute; top: …; right: 0; z-index: 3 变为现 :496 的无 position 版本。
  - QuickSwitcher 的 styles（:403）= interactiveSurfaceStyles + sessionStateBadgeStyles + 自有 sheet，未 adopt shared 的 listStyles——shared.ts:472 .action-menu-panel { position: fixed; … } 在此 shadow root 不存在。对照组 SessionList.ts:433 是正确写法（style 绑定 menuStyle）。
- 最小失败场景：触摸端打开 quick switcher，点最后一行可见行的 ⋯（:217-:224）→ 菜单 div 是 .row-wrap（:477 position: relative; display: block; height: 100%）内的在流块级子元素：从行底边向下溢出绘制、盖住下一行，或被滚动容器裁掉——正是 r17-lane-a F3 裁 TRUE、round-18 自称已修的同一缺陷，失败形态从「绝对定位被裁」变成「根本没有定位」。
- 文档反诉：.changeset/round-eighteen-audit.md 与 docs/design/review-triage-uiux-round18.md 第 10 条均写「The quick switcher row menu is fixed and viewport-constrained like every other row menu」——同一提交里代码与账目互相矛盾。
- 裁决：TRUE（源码确定性成立；建议补 8505 probe 复核渲染）。

## F3（中低 · 守卫盲区，潜伏）pointerQueryOrder 对多条件 media 块整体失明：(pointer: coarse), (max-width: 760px) 一块都查不到

- 证据：
  - `src/client/src/components/pointerQueryOrder.test.ts:19` MEDIA_BLOCK 要求 { 紧跟第一个条件，逗号第二条件使整块不匹配。全树实测 4 块被跳过：PiWebApp.ts:175、appShell/AppPanelEdgeControl.ts:233、SettingsDialog.ts:781、pi-web-plugins/terminal/TerminalPanel.ts:736。
  - 其中两块确实抬触控地板：SettingsDialog.ts:792 .settings-list button min-height（移动行地板）、:800 .settings-back min-height: touch；TerminalPanel.ts:737 .terminal-tabs > button height: touch。
  - 今日无活体违规（核到各文件尾：SettingsDialog 该块即表尾；TerminalPanel 后置 button 规则不设 height 且特异性更低）——纯潜伏。
  - r18-lane-a.md:33 自记的两条同类盲区（仅查首个后置重复；[.#] 选择器漏元素选择器，如 AuthDialog.ts:275 抬 input）HEAD 仍未修；本轮再补这一条：多条件块失明。
- 最小失败场景：日后任何人在 SettingsDialog/TerminalPanel 尾部加同选择器 base 规则，触控地板无声回退到 32/36px，守卫绿、CI 绿——正是该守卫要拦的事故形状。
- 裁决：TRUE（盲区实证；「无活体违规」亦经扫描确认，定为潜伏缺陷而非现行缺陷）。

## F4（低 · 死 CSS + 词汇表漂移）QuickSwitcher .row-flag.unread 无生产者，且保留 round-18 宣布退役的 accent-unread 配色

- 证据：`src/client/src/components/QuickSwitcher.ts:448` .row-flag.unread { background: var(--pi-accent); }；全树 row-flag 唯一渲染点 :215，类名恒为 row-flag interrupted；unread 走仲裁器渲染 .session-state.unread（紫，sessionStateBadgeStyles.ts:31）。
- 最小失败场景：无渲染差异（死规则）；危害是账目性的——ed0cd40f 提交信息称 unread 点已并入同一 purple 词汇，这条 accent 残留会诱导后来者把蓝色未读点带回来。
- 裁决：TRUE（作为死规则/漂移；非现行渲染缺陷）。

## F5（低 · 守卫逃逸 + 越标字面量）逻辑属性长名逃出 spacingScale 守卫：SessionTreeNavigator 两处 30px、一处 7px

- 证据：
  - `src/client/src/components/SessionTreeNavigator.ts:607` .validation-error { margin-inline-start: 30px; … }——spacingScale 的属性枚举含 margin-(top|right|bottom|left|inline|block) 但不含 margin-inline-start/-end、margin-block-* 等（spacingScale.test.ts:17），整条逃逸。
  - :603 .custom-focus { margin: … 30px } 走 margin 简名被扫到，但 30 大于 RHYTHM_TOP(24) 落入 structural 豁免（该豁免自述为「为覆盖控件预留尺寸」，此处是纯文本缩进）。
  - :625 padding-inline-start: calc(7px + …)——7px 越标（OFF_SCALE_TRIMS 只有 3、5）且属性名同样逃逸。两处 30px 在 ≤760 由 :632 重置为 0，影响仅限桌面。
- 最小失败场景：下一个贡献者照 margin-inline-start: 30px 先例写逻辑属性间距，守卫不放炮——节奏表外多出私有步长。
- 裁决：TRUE（守卫逃逸与字面量存在为实证；视觉影响小，定级低）。

## F6（低 · 盒模型守卫盲区，潜伏）boxModelGuard 只认 border 简名，长名边框逃逸；全树一例活体

- 证据：`src/client/src/components/boxModelGuard.test.ts:31` BORDERED 只匹配 border: 简名。全树扫描得一例：`pi-web-plugins/git/browser/git-panel.ts:1352` .git-review-section { min-width: 0; min-height: 120px; border-bottom: 1px solid …; } 无 box-sizing → content-box 下实渲染不低于 121px。
- 最小失败场景：该块是 scroll-margin 锚点区，无测量契约依赖，今日无可见危害；若日后有人以同形给固定高度卡片加长名边框，「token 说 56 实画 58」的旧事故重现而守卫不响。
- 裁决：TRUE（盲区 TRUE；活体无现行危害，定级低）。

## 复核为干净的项目（同样是 claim，逐条附依据）

1. rail 优先级 vs 点调色板：仲裁器（sessionRowIndicator.ts:46-59）保证会话行一次只渲染一个 .session-state；shared.ts:443-448 与点色逐态一致（unread/background 紫、running accent、asking warning、terminal accent、error danger、machine/workspace activity-indicator.session success）。:444 的 .session-state.running 分支被 :445 恒覆盖——死分支，判 not-true（无渲染差异），仅冗余。:449-:450 archived/selected 以 (0,2,0) 压过点规则，与注释声明一致。r18 F4/F5/F6 修复均在 HEAD 在场（.action-row.unread rail 规则已删、background 入紫规则、idle-unread 绿规则已删）。
2. .unread-ring 词汇：仅插件侧生产（machines/workspaces 两份 activityBadge 一致），core 叉份已删；rail 上其紫规则按源序被工作色覆盖，符合 unread 小于 running 的优先级声明。
3. PiWebApp self-update banner coarse 地板顺序：base :203 在 coarse :206 之前——修复在 HEAD 在场。
4. 单条件 pointer/hover media 顺序：以测试同款逻辑加两个修正版（全部后置重复、逗号组选择器）全树扫描，零活体违规；ChatView drawer 级联契约在位（:171-175 coarse 块后无同属性 base）。
5. 宽度类 media（≤760/≤1180/≤430）后置 base 覆盖扫描：命中均为互斥条件或有意层叠（PromptEditor 430→coarse 注释即此意），无违规。
6. [hidden] 伴生规则：shared.ts:255-256（:host([hidden])）、ChatView.ts:163（.drawer-body）、shared.ts:409-410（.action-activity）在位；全树 ?hidden= 生产者仅这三类目标。
7. AppNavigationPanel 切换器移除：挂载点、helper、专用 CSS 行均已删；文件内仅剩 AppContextSwitcher（另一活组件）；MachineSwitcher 全树无引用。残留两处注释级漂移：MachineList.ts:261 仍以已删 switcher 为对照；workspaces/pi-web-plugin.ts:13 「Both switcher surfaces」措辞过时（low，文档性）。
8. remote-route-restore 自吞横幅：PiWebApp.ts:1525-1527 detail 取 health 的 error 而非 state.error——round-17 第 3 条修复在位。
9. audit-uiux-full contextSheet 触发：scripts/audit-uiux-full.mjs:50 确为有界轮询（20×250ms）匹配真实 context 行——与声明一致。
10. 其余触控下限抽查：.attachment-remove（PromptEditor.ts:163/206 coarse 44）、.msg-action（ChatView :399 ::after 扩展）、.command-dismiss/.image-zoom-close（:343-347）、.code-copy-button 与 .detail-copy（24px，达 AA 下限）均合规。

## 一句话总结

本 lane 抓到两个 P1：round-18 修复提交（ed0cd40f）在 SessionTreeNavigator 留下括号失衡，把整张表后半张变成 coarse-only（手机 probe 探不到、桌面全坏）；同一提交对 QuickSwitcher 行菜单的修复是死代码（style=undefined 字面量、定位规则被删、不 adopt listStyles），changeset 与 triage 对应声明为假。另有三个守卫盲区（多条件 media 块、逻辑属性长名、border 长名）均潜伏、今日无活体违规；两处死 CSS/字面量漂移定级低。
