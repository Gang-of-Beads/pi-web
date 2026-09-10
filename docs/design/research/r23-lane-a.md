# Round 23 — Lane A:几何与契约(pointer-query 顺序 / 盒模型 / 触摸地板 / 间距与字号字面量 / 级联与规则顺序 / rail 优先级)

审查基线:仓库实际 HEAD 为 `5bd8e406`(= round-22 修复提交 `fb975a0c` + 两个仅动文档/workflow 的提交),与任务给定的"round-22 HEAD"一致。本 lane 只读未改任何仓库文件。

每条 finding 给出 file:line + 最小失败场景 + TRUE/FALSE 裁决;凡属推测均显式标注。

---

## F1(P2,TRUE)宿主样式表在插件 static styles **之后**追加,同特异性的裸 `button` 规则被静默覆盖 —— 终端软键声明的 36px comfort 高度实际渲染 32px、等宽字体变 UI 字体、`touch-action: pan-x` 变 `manipulation`

**机制(级联事实,非猜测)**:Lit 的 `super.createRenderRoot()` 先把组件 static styles 写入 `adoptedStyleSheets`,随后各插件 hostUi 以 `root.adoptedStyleSheets = [...root.adoptedStyleSheets, ...sheets]` 把宿主 sheet **追加在后**。同一 shadow root 内、同特异性 `(0,0,1)` 的同名选择器,后一 sheet 按源序获胜。

- 采纳点:`pi-web-plugins/terminal/hostUi.ts:43,45`(`[hostUi.surfaceStyles, hostUi.workspacePanelStyles]` 追加);`surfaceStyles` 即 `interactiveSurfaceStyles`、`workspacePanelStyles` 即 shared.ts 同名 sheet(`src/client/src/plugins/pluginHostUi.ts:34-35` 注入,`pi-web-plugins/terminal/hostUi.ts` 只是转发)。
- 被覆盖的声明:`pi-web-plugins/terminal/TerminalSoftKeys.ts:94` `button { … min-height: var(--pi-control-height-comfort); … padding: var(--pi-space-3) var(--pi-space-5); font: var(--pi-text-xs) var(--pi-font-mono, …); touch-action: pan-x; … }`。
- 获胜的后置规则:`shared.ts:33`(`interactiveSurfaceStyles` 内 `touch-action: manipulation`)、`shared.ts:166`(`workspacePanelStyles` 的 `button { box-sizing: border-box; min-height: var(--pi-control-height); font: var(--pi-text-xs) var(--pi-font-ui); … padding: var(--pi-space-3) var(--pi-space-4); … }`)。

**逐属性结局**(token 值来自 `src/client/index.html:103-105,131`:`--pi-control-height:32px`、`--pi-control-height-comfort:36px`):

| 声明(TerminalSoftKeys.ts:94) | 实际渲染(后置 sheet 获胜) |
|---|---|
| `min-height: 36px`(comfort) | `32px`(control-height) |
| `font: … mono`(等宽) | `font: text-xs + UI 字体` |
| `padding: 6px 10px` | `6px 8px` |
| `touch-action: pan-x` | `touch-action: manipulation` |

**最小失败场景**:手机(coarse)打开终端、展开软键(`terminal-soft-keys` 仅在 `TerminalPanel.ts:734,736-740` 的 coarse/max-760 块里显示)→ 每个软键按作者声明应为 36px comfort 高,实际 32px —— 低于本仓库自己写的"32px 是鼠标尺寸、36 才是手指可靠下限"的档位(shared.ts:329-331 的 tile 豁免注释、index.html:101-103 注释);`Esc/Tab/Ctrl` 等键帽以 UI 字体而非声明要用的终端等宽字体渲染。`touch-action` 一项实际影响最小(manipulation 仍允许 pan),如实降权。

**同根因的次要实例(同一条 finding,不另立)**:机器/工作区对话框 static 里的裸 `button { font: inherit; … }`(`pi-web-plugins/machines/browser/MachineDialog.ts:145`、`pi-web-plugins/workspaces/browser/ProjectDialog.ts:376`)被**后采纳**的 `listStyles` 按钮规则(`shared.ts:341`:`font: var(--pi-text-xs) var(--pi-font-ui)`)覆盖 —— 对话框按钮从声明的"继承宿主 14px"变成 12px。

**为什么守卫没接住**:`pointerQueryOrder.test.ts` 只在同一文件文本内比较 media 块前后的**同选择器**(`src/client/src/components/pointerQueryOrder.test.ts:14-71`);跨文件、跨 `adoptedStyleSheets` 的顺序它结构上不可见。machine/workspace 插件自身 static 无 coarse 提升,故无第二处活体;TerminalSoftKeys 是当前唯一有属性冲突的活体。

**裁决:TRUE**(级联机制是规范行为;文件行号均核对过)。修复方向属 owner 裁决:(a) hostUi 改为**先**追加宿主 sheet、后让 static 生效(把宿主当 base 层);(b) 插件把易撞的裸 `button` 提为带类名/更高特异性的选择器。无论选哪边,应给这条跨 sheet 顺序立一条守卫或写进 hostUi 的 docstring 契约。

---

## F2(P2-low,TRUE)round-22 修复"三个 width:100%+padding 不画 border-box"只枚举了三个,同族还剩三处活体 —— 其中两处有**可见的**溢出涂色,一处正藏在同文件、同一次修复的隔壁

round-22 提交信息自述:"three width:100%-with-padding overflows draw border-box"(git-row、AuthDialog `.options button`、ModelPicker `.options > button`,均已加 `box-sizing`)。同族全树扫描(规则含 `width:100%`+横向 padding、无 `box-sizing`、且有**会画的长手 border**)逐条裁决后,仍有三处存活:

1. **`src/client/src/components/AutocompleteMenu.ts:9`** — `button { … width: 100%; border: 0; border-bottom: 1px solid var(--pi-border); … padding: var(--pi-space-4) var(--pi-space-5); … }`,无 box-sizing。父容器 `.menu { … overflow: auto; … }`(`AutocompleteMenu.ts:8`)。content-box 下按钮 border-box = 菜单内容宽 + 20px → **每个补全下拉都带 20px 横向滚动余量**,非末行的底部发丝线画在超宽盒的下缘(向右多出 10px)。
   失败场景:composer 触发补全 → 下拉可横向拖动 20px;触屏上 horizontal pan 生效(manipulation 允许 pan)。
2. **`src/client/src/components/ActionPalette.ts:113`** — `.options button { … width: 100%; padding: var(--pi-space-5) var(--pi-space-6); border-bottom: 1px solid var(--pi-border-muted); … }`,无 box-sizing;容器 `.options { … overflow: auto; }`(`:112`)。溢出 24px;**选中/悬停底色(`.options button.selected`/`:hover` 的 `background: var(--pi-selection-bg)`)画在整个超宽 border-box 上**。
   失败场景:打开动作面板、键盘选中一项 → 该行的高亮条比面板内容边缘向右多出 12px,并使 `.options` 多出 24px 横向滚动余量。
3. **`pi-web-plugins/git/browser/git-panel.ts:1343`** — `.git-commit-row { display: flex; width: 100%; … border: 0; … padding: var(--pi-space-4); … }`,无 box-sizing;容器 `.git-file-list { … overflow: auto; padding: var(--pi-space-3); }`(`:1339`)。**就在同一文件里**,`:1340` 的 `.git-row` 是本轮刚修好的同族样本;`:882` 证明 `.git-commit-row` 是真实 `<button>`。`border: 0` 不画,但 `:1344` 的 `:hover/.is-selected { background: var(--pi-selection-bg) }` 画在整个 100%+20px 的盒上。
   失败场景:History 模式选中一个 commit → 选中底色向右越出列表内容边 20px;列表可横向拖 20px。

**守卫盲区(同一 finding 的契约面)**:`boxModelGuard.test.ts:23-27` 的 `WIDTH` 排除 `100%`,且 `BORDERED` 只认 `border:` **简写** —— `border: 0; border-bottom: 1px solid …` 用长手把画漆加回来,守卫看不见。三处全部因此漏网。

**裁决:TRUE**(三处均为静态可证的现行溢出;严重度按可见性排序:ActionPalette/git-panel 有可见涂色,AutocompleteMenu 仅滚动余量+发丝线)。"同一症状报两次就应枚举全部 producer" 是仓库成文规则(AGENTS.md),round-22 的枚举停在三个。

---

## F3(P3,TRUE)`shared.ts:355` 的 `.action-row:focus-visible` 重申 `border-radius: var(--pi-radius-md)`,以 (0,2,0) 压过 `MachineList.ts:259` 的 `.machine-row { border-radius: var(--pi-radius-lg) }` (0,1,0) —— 键盘导航聚焦时机器行圆角 12px→8px 跳变

- 证据:`src/client/src/components/shared.ts:355`(`.action-row:focus-visible { outline: …; outline-offset: …; border-radius: var(--pi-radius-md); }`,特异性 (0,2,0),位于**后采纳**的 listStyles 中)vs `pi-web-plugins/machines/browser/MachineList.ts:259`(`.machine-row { border-radius: var(--pi-radius-lg); }`,(0,1,0),static sheet,先采纳)。焦点伪类计入特异性,故 focus 规则恒胜,与 sheet 顺序无关。
- 最小失败场景:机器面板里用方向键/`focusSelectedOrFirst()` 走行(MachineList 实现了 `handleSelectableRowKeyboard`)→ 被聚焦行左缘圆角从 12px 收成 8px,与相邻行并排时轮廓 visibly 不一致;失焦即弹回。项目/工作区行未覆盖行圆角,无此症状 —— 同一键盘动作两类列表两种表现。
- 裁决:TRUE(机制为规范行为;危害仅为键盘导航时的瞬时形变,P3)。修法:焦点规则去掉 `border-radius` 重申,或机器行用同特异性以上的选择器;属小改,无需 owner 语义裁决,但按本仓库惯例先记录再动。

---

## F4(P4,TRUE)同名状态 `unread` 的光环在两套词汇表里颜色不同:机器列表 accent 20%,会话列表 purple 22%

- 证据:`shared.ts:448` `.activity-indicator.unread { … background: var(--pi-purple); … box-shadow: 0 0 0 2px color-mix(in srgb, var(--pi-accent) 20%, transparent); }` vs `src/client/src/components/sessionStateBadgeStyles.ts:36` `.session-state.unread { background: var(--pi-purple); box-shadow: 0 0 0 2px color-mix(in srgb, var(--pi-purple) 22%, transparent); }`。两点本体色一致(紫),但 2px 光环一个掺 accent、一个掺 purple,透明度 20% vs 22%。
- 最小失败场景:同一屏左侧会话列表、右侧机器列表各有一个未读行 → 两枚紫点的光环色调略有差异;b0bce2a0 决策 2 的目标正是"同一状态在任何距离读作同一种东西",本体已一致,光环未跟上。
- 裁决:TRUE(逐字面可证);P4 —— 视觉差在 2px×20% 量级,是否值得对齐属 owner 判断。注意 `.unread-ring`(`shared.ts:450`,1.5px accent 边)是文档化的有意选择("a static accent ring wraps the still-pulsing work dot"),不在本条范围内。

---

## F5(P4,TRUE)删除 MachineSwitcher 后残留的注释漂移仍在源码里,且 round-19 lane 已报、triage 从未记录处置 —— 未闭合的循环

- 证据:`pi-web-plugins/machines/browser/MachineList.ts:261-262` 注释 "The same mark-plus-word **the switcher** uses: …" —— 该 switcher(`MachineSwitcher.ts`,374 行)已在 b0bce2a0 整文件删除,全树仅剩 `scripts/review-*.workflow.js` 与 docs 的提法;`docs/design/research/r19-lane-a.md:66` 第 7 条当时已点名 "MachineList.ts:261 仍以已删 switcher 为对照",但 `review-triage-uiux-round19.md` 的 fixed/deferred 两个清单都没收它。
- 次要(标注为推测):`pi-web-plugins/workspaces/browser/pi-web-plugin.ts:13` "Both **switcher surfaces** — the desktop navigation panel and the phone context sheet" —— 若 "switcher surfaces" 指已删的 MachineSwitcher 则是同一漂移;若宽指"上下文切换的两处表面"则勉强可读。裁决归为 drift 待 owner 认定,不单独立案。
- 失败场景:后来者按 MachineList 注释去找 "the switcher" 的实现,找不到 —— 注释指向不存在的对照物。
- 裁决:TRUE(注释与代码事实不符,且上轮已报未闭环)。

---

## 已核对为洁的声明(claim,逐条附依据)

1. **rail 优先级与点色逐态一致**(本轮重扫,非沿用上轮):`shared.ts:434-441` 六条 `:has(:where(...))` 全部 (0,1,0);会话行经仲裁器每行恰一点(`sessionRowIndicator.ts:46-56`),机器/工作区行每行恰一枚 activity mark(三个列表各只调一次 `renderActionActivityIndicator`,`MachineList.ts:161`、`WorkspaceList.ts:205`、`ProjectList.ts:236`)。逐态对表:unread/background→紫(434)、`activity-indicator.session`→success(435)、`session-state.running`→accent(435→436 复合优先,后行胜,与点色 `sessionStateBadgeStyles.ts:38` 的 accent 一致)、asking→warning(437)、terminal→accent(438)、error→danger(439);unread+working 复合:内点为 `.activity-indicator.session`(machines `activityBadge.ts:31` 的 `markKind = kind ?? …` 不给内点挂 unread 类),紫规则不命中、435 绿胜出 —— 与 `shared.ts:428-431` 注释"环所包的点决定 rail"一致;`.archived/.selected` (0,2,0) 压过全部点规则,与 421-427 注释声明一致。idle/sending 无 rail:均可证(sending 点只出现在非 `.action-row` 的 pending 行,`SessionList.ts:323-326`;round-21 删除其死 rail 规则正确)。
2. **机器行健康状态点(online 绿/offline 红,`MachineList.ts:263-265`)不点亮 rail** —— 不判缺陷:b0bce2a0 决策文本与 changeset 只枚举 running/asking/unread,健康色属第三词汇;仅在此记为边界事实,防后人误报。
3. **pointer/hover media 顺序**:守卫 + 四个扩展扫描(元素选择器 `button/input/…` 在 media 内提升后又被后置 base 重申;pointer/hover 不在首条件的 media;media 内逗号组选择器单体被重申;max-width 类 media 后置 base 覆盖)全树零活体。唯一接近的 `TerminalPanel.ts:736-741`(media 后置裸 `button` base)逐属性核对无冲突值(media 提的是 height 44,base 不声明 height;display 同值)。Task 面上点名的四处(self-update `PiWebApp.ts:198-199`、`.error .error-dismiss` 189→199、QuickSwitcher、Machine/ProjectDialog)顺序全部正确。
4. **令牌闭合**:全树 3956 处 `var(--pi-*)` 引用,未定义者 7 个全部带运行时 setProperty 或字面 fallback(逐个目验:`--pi-chat-scrollbar/-dock-room` ChatView.ts:914/955、`--pi-app-visible-height` PiWebApp.ts:979、`--pi-accent-ring/--pi-danger-bg` PromptEditor.ts:143/152、`--pi-border-strong` SessionList.ts:769 与 SettingsAppearancePanel.ts:131)。
5. **孤儿 CSS 清点**(b0bce2a0/fb975a0c 删除的 26 条):`workspace-panel-edge/context-kind/context-value/workspace-header-scroll-frame/workspace-header-strip/icon-tab/tab-icon/machines-heading` 全树 0 活引用;`tab-badge/tab-label` 仅剩 `.drawer-tab-badge/.drawer-tab-label`(ChatView.ts:160,1138,2392)是另一活组件;`.subtree-chevron` 0 引用(SessionList 的树形开关走 `disclosureIcon.ts`)。WorkspacePanel 头部现仅渲染 fullscreen toggle(WorkspacePanel.ts:54-76),删掉的 tabs 族确无消费者。
6. **tile 盒模型推导在 fine/coarse 两支下自洽**:padding-right = inset+size+gap+dot+gap,点右缘 = inset+size+gap(340 行),两支各留 dot+gap 富余(fine:6+32+4+8+4=54,coarse:4+36+4+8+4=56);`.unread-ring` 盒与 `--pi-dot-md` 同宽,不破推导;round-22 把 tile `min-height` 从 `:300` 挪进既有 `:304`(row-min-height+space-9)不改变值域。
7. **触摸地板抽检**(本 surface 新近触及):`.error .error-dismiss` base 32 → coarse 44(PiWebApp.ts:189,199)、self-update 按钮同款、`header button` 44(MachineDialog.ts:150-153,ProjectDialog.ts:378)、goals `.refresh`(goalsSectionElement.ts:22-23)、SessionList coarse 块位于文件末尾其后无 base(SessionList.ts:798-807)。`.action-menu-panel .detail-copy` fine 18px 是 r16 记录过的裁决(coarse 24px AA 达标,shared.ts:379-380)。
8. **间距/字号守卫在 HEAD 通过推定成立**:全树 spacing 位置(2..24px)与 font-size/outline 字面量按守卫同款正则复扫,零新增违规;round-22 把 tree-row 7px→`--pi-space-3`(`SessionTreeNavigator.ts:624`)只改 1px 且移动端基线本与桌面(10px,`:551`)不同,无对齐契约被破坏。
9. **文档 vs 代码(几何相关)**:round-18 triage 第 1/2 条(自更新横幅地板顺序、守卫首规则盲区)在 HEAD 在场(`PiWebApp.ts:198-199`;`pointerQueryOrder.test.ts` 的 blockEnd/切片逻辑);banner-retirement-model.md 的 "running blue/asking amber/unread purple" 是主题相对的散文描述(默认主题 clay-soft 的 accent 并非字面蓝),不构成漂移;round-17 五决策中 2(rail)/3(switcher 删除)已逐条在代码核实在场。

---

## 结论

本 lane 共 5 条 TRUE(0 条 FALSE——发现的疑点均已裁决为真或归入洁声明),无一依赖未标注的猜测。最重的两条(F1、F2)同属一个元问题:**round-22 的两次"枚举全部 producer"式清扫各差一步**——一次差在 sheet 采纳顺序对插件自带 base 的静默覆盖,一次差在同族盒模型样本仍藏在被修文件隔壁。是否再开一轮清扫由 owner 定夺;两处的最小修法都已在 finding 内写明。
