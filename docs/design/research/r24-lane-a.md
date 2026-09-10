# Round 24 · Lane A(几何与契约:指针查询顺序 / 盒模型 / 触控下限 / 级联与规则顺序 / 状态栏优先级)

HEAD a35c5b7b(工作树 81d37fc0 仅为 round-24 workflow 启动提交)。本 lane 为只读评审,未改动任何仓库文件。

结论:**不清白**。6 项 finding(2×P2、1×P3、2×P4、1×守卫缺口),每项带 file:line、最小失败场景与 TRUE/FALSE 裁决;另有 4 项「怀疑但裁决不成立」的排除记录。

---

## F1(P2, TRUE)round-23 宣称「最后三个」的 width:100%+padding 溢出,还有第四个活体:Settings 侧栏按钮

- 证据:src/client/src/components/SettingsDialog.ts:773 — .settings-nav button 带 width: 100%,无 box-sizing;同 sheet :767 的基规则 button 带 border: 1px solid 与 padding: var(--pi-space-4) var(--pi-space-5),也无 box-sizing;全 app 无全局 border-box 重置(index.html 无 box-sizing 声明,interactiveSurfaceStyles 只有 tap-highlight/touch-action)。.settings-nav 自身 :772 带 overflow: auto。
- 盒模型算术:nav 列宽 220px(:771 grid-template-columns: 220px),nav 内容宽 = 220 − 2(border) − 20(padding) = 198;按钮 content-box 下 border-box = 198 + 20 + 2 = 220,且从内容原点(距 nav 左边缘 11px 处)起算 → 右缘超出 nav 右边缘 11px。
- 最小失败场景:打开 Settings → 选中/悬停某分区按钮(:774 :focus、:775 hover、:776 .selected 都画背景)→ 染色条横跨 nav 的右 padding、盖住 1px 分隔线,同时 nav 出现 11px 横向滚动余量——与 round-23 triage 判 AutocompleteMenu「可见溢出」(20px 滚动余量)同类。
- 为什么历轮扫描漏掉它:round-23 triage(docs/design/review-triage-uiux-round23.md 第 5 条,commit a35c5b7b 自述 the last three width:100%-with-padding overflows)的扫描谓词要求 width:100% 与横向 padding/border 在同一条规则里;本例 width 在 :773,padding/border 在元素基规则 :767,分属两条规则,谓词结构性漏扫。
- 裁决:TRUE(纯 CSS 盒模型推导,置信度高;未做浏览器实测,如实标注为静态推导)。

## F2(P2, TRUE)插件宿主样式采纳顺序把「共享在后」写死:.machine-row 的圆角意图自插件迁移起就是死规则;同一倒置又是布局能活的隐性依赖

- 证据链:
  1. Lit 的 ReactiveElement.createRenderRoot 会**替换** adoptedStyleSheets(node_modules/@lit/reactive-element/development/reactive-element.js:565-568 → css-tag.js:105-108,styles = static styles)。
  2. pi-web-plugins/machines/browser/MachineList.ts:64-68 先 super.createRenderRoot()(装上 static),再 adoptMachinesHostStyles(root);而 pi-web-plugins/machines/browser/hostUi.ts:40 是**追加**:[...root.adoptedStyleSheets, ...sheets]。
  3. 最终顺序 = [MachineList static, interactiveSurfaceStyles, listStyles] → 同为 (0,1,0) 的 shared.ts:354 .action-row { ...; border-radius: var(--pi-radius-md); ... } 排在后面,赢过 MachineList.ts:259 .machine-row { border-radius: var(--pi-radius-lg) }。
- 回归证明:git show ebfb2de2^:src/client/src/components/MachineList.ts 显示旧核心组件的 styles = [interactiveSurfaceStyles, listStyles, css…],组件 css 在 listStyles **之后**,lg 当时生效;ebfb2de2 把它搬进插件并引入 per-instance 采纳,顺序倒转,lg(12px)静默退化为 md(8px),:259-260 两条 lg 规则(含 .machine-row.no-actions .action-main)双双死亡。
- 最小失败场景:导航面板机器分区任意一行 → 渲染 radius-md,与代码写明的 lg 意图不符;no-actions 行的 main 画 lg 又被 md 行的 overflow: hidden(shared.ts:354)裁掉,规则与结果自相矛盾。
- 同一倒置的另一半(加重其严重性的背景):MachineList.ts:258 的 :host { display: block; min-width: 0 } 同样被 adopted 在后的 shared.ts:233 :host { display: flex; flex-direction: column; min-height: 0; overflow: hidden; … } 覆盖——而**正是这个覆盖在养活布局**:host 为 block 时,section(listStyles 下的 flex: 1 1 auto)拿不到高度,.list-body 的内部滚动链断裂、整段被裁。即:插件自己的 :host 规则是死的,布局全靠「顺序恰好倒了」的共享表;谁把采纳顺序「修正」为 static 在后,机器列表滚动即坏;维持现状,lg 意图永远死着。两个方向都被同一处未成文的顺序锁死。
- pointerQueryOrder 守卫按文件扫描,跨采纳边界的顺序冲突它结构上看不见(见 F6 盲区 3)。
- 裁决:TRUE(git 前后对照 + Lit 源码 + adoptedStyleSheets 级联顺序三方印证;12px→8px 的视觉差异未实测,标注为静态推导)。

## F3(P3, TRUE)终端 copy 工具栏按钮触屏只有 36px,低于 app 自己的 44px 地板;同文件同区块给别的按钮升到了 44

- 证据:pi-web-plugins/terminal/TerminalPanel.ts:766 — .terminal-copy-toolbar button { min-height: var(--pi-control-height-comfort) }(36px);全文件唯一 coarse 块 :736-739 只升了 .terminal-tabs > button,未覆盖 copy 工具栏;全仓 grep 无其他 .terminal-copy-toolbar 规则。
- copy 工具栏恰是触屏优先表面:进入 copy 模式的 .copy-mode-toggle 基础 display: none、只在 coarse/窄屏块(:737-738)显示;工具栏按钮是 Refresh / Copy all(:602-610),软键被替换时(copyToolbarReplacesSoftKeys)是屏上主操作。
- 最小失败场景:手机(coarse)开终端 copy 模式 → Refresh / Copy all 命中区 36px 高,与同文件 :737 刚做过的 44 升级、shared.ts:471-472 对 row menu 的同款修复语言相悖。
- 附带::763 .terminal-copy-toolbar { min-height: 47px } 是无注释的 47px 裸字面量;spacingScale 守卫只看 padding/margin/gap/top/right/bottom/left/inset,min-height 不在辖区。
- 裁决:TRUE。

## F4(P4, TRUE)会话行 subtree 折叠钮触屏 36×44,同一行其他控件全 44 宽——「最宽触控地板分裂」复发

- 证据:src/client/src/components/SessionList.ts:694 coarse 下 :host { --pi-row-gutter-size: var(--pi-control-height-comfort) }(36px);:771 coarse .subtree-toggle { top: 0; width: var(--pi-row-gutter-size); height: var(--pi-control-height-touch); } → 36×44。同一行:菜单钮 :804 44×44、搜索行 :799-800 44、bulk/start/cleanup :801-803 44。
- 最小失败场景:手机上有子代理的会话行 → 想点折叠钮,手指落在 36px 宽之外约 8px → 命中其下的 .action-main → **打开会话**而不是折叠子树。shared.ts:327-331 给 tile 菜单的 36px 写了豁免理由(tile cell 自带点击区),此处无任何豁免记录。
- 裁决:TRUE(与仓库自己的 touch-floor split 判例同构)。

## F5(P4, TRUE)共享表几何注释三处与代码漂移,其一正是 round-18/23 声称「已修诚实」的注释

- (a) src/client/src/components/shared.ts:423-425 状态栏注释把 row-class 规则列为 (unread/archived/selected)——但 .action-row.unread 的 rail 规则 round-18 已删(round-18 triage 第 4 条:the dot rules are the only unread painters),紧接着的下一句也在讲「若有 row-class unread 规则会怎样」的假设;括号里的 unread 是幽灵成员。而 round-23 triage 第 11 条声称该注释的 stale 引用已被修正。
- (b) src/client/src/components/sessionStateBadgeStyles.ts:6-8 宣称 One style block for every surface(list rows, chat dock, quick switcher, context bar)——context bar 实际自带漂移副本:AppContextBar.ts:91-94 .working-dot(1.2s / -3px / .2s 步进),手机 compact 头还有第三份 AppNavigationPanel.ts .compact-working-dot(1.2s/-3px);共享 .state-dot 是 1.1s / -2px / .14s 步进。同一「工作中」状态在三个表面以三种节奏跳动。
- (c) sessionStateBadgeStyles.ts:22 「the dots are sized for a 9px track」——轨道实际是 .session-state 的 var(--pi-dot-md) = 8px(index.html:117),三点内容实测 3×dot-xs(4px)+2×space-1(2px)=16px,注释两个数字都对不上现值(「行高不跳」靠绝对定位成立,故仅为注释漂移)。
- 裁决:TRUE(逐条 file:line 印证)。

## F6(P4, TRUE,守卫缺口;除 F2 外无第二活体)pointerQueryOrder 守卫的三个结构性盲区

- 证据:src/client/src/components/pointerQueryOrder.test.ts:12-13 — MEDIA_BLOCK 要求 pointer|hover 出现在**第一个**条件组;SELECTOR 要求选择器以 . 或 # 开头。
- 盲区 1:元素/:host 选择器完全不被检查。现存 coarse 元素级提升——SessionList.ts:694(:host gutter)、:696(h2 gap)、SettingsDialog coarse 输入——目前都「基规则在前」无活体违规,缺口是潜伏的。
- 盲区 2:@media (max-width: 760px), (pointer: coarse) 这类 pointer 不在首组的查询整块跳过(全仓扫描确认当前无此写法)。
- 盲区 3:守卫按文件扫描;F2 的跨文件采纳倒置(共享表覆盖插件基规则)在视野外——正是活体所在的那类。
- 裁决:TRUE(缺口为真;除 F2 外未发现第二个现存违规,如实说明)。

---

## 怀疑过但裁决不成立(排除记录)

1. 怀疑:.action-row.bulk-selected { border-color: var(--pi-accent) }(SessionList.ts,(0,2,0))会盖掉状态栏 rail 颜色。裁决:FALSE(有意设计)——shared.ts:429-431 明文记录这是 co-owned override(.bulk-selected 归 SessionList 所有,本表故意不表尽)。
2. 怀疑:机器行 unread+working 组合态会让紫色 rail 压过工作色。裁决:FALSE——badge 组合只在外层 wrapper 挂 unread-ring 类,内点类是 activity-indicator session,不带 unread(pi-web-plugins/machines/browser/activityBadge.ts 的 markKind/ringClass 逻辑),紫色 :has 无节点可匹配,success 规则独占(shared.ts:432-435 注释与实现一致)。
3. 怀疑:shared.ts:335 coarse 块里 .list-body.tiles .action-menu { top/right } 与基规则 :307 完全重复。裁决:真重复但无害——自定义属性 --pi-tile-menu-inset 已由 :333 的 coarse 覆盖传导,两处解析值相同,不构成缺陷。
4. 怀疑:terminal 面板采纳 workspacePanelStyles 后,其 :host(display:flex column、font、background、container-type)覆盖 TerminalPanel static :host(:729)会改变布局。裁决:保守排除——单子元素(.terminal-shell)在 row/column 下几何等价,font/background 被面板自身表面覆盖;列为「标注为推测的观察」,不计 finding。

## 验证为清白的高危面(防「没查」误读)

- 状态栏优先级算术:shared.ts:424-426 的 (0,1,0)/(0,2,0) 论断经 CSS Selectors 4 复核为真(:has 取最具体实参的 specificity,:where() 实参为 0);round-23 修复后的词表拆分(.session-state.running 只属 accent 规则)在 :444-448 确认。
- 守卫「首规则」修复(round-18 声称)真实生效:inside 切片以块内首规则开头,^ 锚点成立(pointerQueryOrder.test.ts:41-43);全树复扫(含元素/:host 选择器、简写展开、跨文件三种扩展)无新增活体。
- 盒模型专项:round-22/23 的六处 border-box 修复均在位;AskUserCard、QuickSwitcher、PromptEditor、SessionTreeNavigator、两插件 Dialog 的 input/textarea width:100% 全部带 box-sizing;仅 F1 一处存活。
- 触控地板专项:SettingsDialog coarse(:780-781)、AppNavigationPanel compact(:482)、QuickSwitcher coarse 块(:508-517)、PiWebApp self-update/error-dismiss(:197-199,round-18 修复确实落地)、SessionTreeNavigator disclosure/close(:560-566,含诚实豁免注释)全部顺序正确。
- MachineSwitcher 删除无残留:全仓无引用;AppNavigationPanel compact 头(:164-186)无第二列表;machine-list[hidden] 由 listStyles 的 :host([hidden]) 兜住。
