# Round 17 · Lane A（几何与契约）评审报告

范围：lazySurfaces + PiWebApp 接线、SessionTreeNavigator / SettingsDialog / QuickSwitcher 渲染、AppNavigationPanel 紧凑头部、AppContextBar、tools-section、shared.ts listStyles、PromptEditor 折叠态 footer、sessionController 预取、api/inFlight.ts、chatHistoryCache.ts、pi-web-plugins machines/workspaces activityBadge、四篇文档。
 hunting 面：指针查询顺序、盒模型、触控地板、间距/字号字面量、级联陷阱（[hidden] vs 作者 display、规则顺序）。
方法：逐文件读源 + 对全部 wave 文件跑了一份修正版"coarse-先于-后置基础规则"扫描脚本（scratch 在 /tmp，未入 repo），并实跑了 5 个结构守卫测试。

结论先行：**本 lane 不是干净轮。4 项 TRUE 发现（1 项中等、3 项低），1 项账目疑点需 owner 裁决**；round-15 的九项修复与 round-16 的十项修复在 HEAD 上全部复核成立。

---

## TRUE 发现

### F1（中等 · 级联/规则顺序）self-update 横幅按钮的 coarse 44px 地板是死规则 —— 同选择器基础规则写在 media 块之后，把它压回 32px

- 证据：`src/client/src/components/PiWebApp.ts:205`
  `@media (pointer: coarse) { .self-update-banner button { min-height: var(--pi-control-height-touch); } .error .error-dismiss { … } }`
  紧随其后 `src/client/src/components/PiWebApp.ts:206`
  `.self-update-banner button { box-sizing: border-box; min-height: var(--pi-control-height); … }`
- 两个选择器完全相同（0,1,1），author 层按源序取胜 → :206 的 32px 在**所有**指针下获胜，:205 里给 `.self-update-banner button` 的 44px 从不生效。这正是本仓在 `shared.ts`、`QuickSwitcher.ts`、`ChatView.ts:164-167` 三处白纸黑字记录过的失败模式（"a media query carries no extra specificity…"）。
- 讽刺点：同一条 media 块内的另一半 `.error .error-dismiss` 是对的（其基础规则在 :196，先于 :205），注释（:203-204"…a 32px row here was a second touch floor"）宣称的修复恰好只对横幅按钮本身失效。
- 最小失败场景：手机（coarse pointer）打开带待更新的页面 → self-update 横幅的 "Update now / Skip"（:919-920）与 stale-client 横幅的 "Reload"（:890）实测 32px 高（内容高 ~24px，min-height 32 决定），低于注释声称已达到的 44px transcript 控件列地板。
- 佐证（lane 证词失实）：`docs/design/research/r16-lane-a.md:51` 声称 "PiWebApp.ts:205 在 :196 后 … 无回归" —— 它核对的是 :196（`.error .error-dismiss` 的基础规则），而横幅按钮的基础规则在 :206，恰在 media 块之后，被漏检。
- 裁决：**TRUE**（CSS 级联确定性成立，无需运行时验证）。

### F2（低-中 · 守卫盲区）pointerQueryOrder 守卫永远不检查每个 media 块的第一条规则 —— F1 正是从这个盲区漏进 CI 的

- 证据：`src/client/src/components/pointerQueryOrder.test.ts:20`
  `const SELECTOR = /(?:^|\})\s*(?<selector>[.#][\w-][^{}@]*?)\s*\{/gu;`
  与 :65-67：`inside = source.slice(open, end)`（open 是 media 块自身的 `{` 的下标）后 `inside.matchAll(SELECTOR)`。
- 机制：`inside` 恒以 media 块自己的 `{` 开头；锚 `(?:^|\})` 要求选择器前是字符串起点或 `}`，于是**每块里的第一条 raised 规则永远匹配不到**。用与测试同构的输入做节点仿真：`inside = "{ .self-update-banner button {…} .error .error-dismiss {…} "`，只提出 `RAISED = ".error .error-dismiss"`，第一条被吞。
- 失败场景：任何"coarse 规则写在块首、同选择器基础规则写在其后"的死地板（= F1 原样）都能通过 `npx vitest run src/client/src/components/pointerQueryOrder.test.ts` —— 实测该测试在 HEAD 上**通过**，而 F1 的违规真实存在，二者同时成立即为本发现的证明。
- 定位：这是 round-16 triage 记录的两个守卫盲区（长属性名、>24px 值）之外的**第三个**盲区；r16-lane-a:52 只记录了"元素选择器不在守卫内"，未发现首条规则盲区。
- 裁决：**TRUE**（结构性证明 + 仿真复现 + 与 F1 的共存互证）。

### F3（低-中 · 契约不一致）QuickSwitcher 的行菜单是滚动容器内的 absolute 定位，与全应用其它行菜单的 fixed+视口约束契约相悖 —— 底部行的菜单会被裁切

- 证据：`src/client/src/components/QuickSwitcher.ts:484`
  `.row-menu { position: absolute; top: calc(100% - var(--pi-space-2)); right: 0; z-index: 3; … }`（渲染点 :245-250，无内联定位），挂在 `QuickSwitcher.ts:405` `.body { … overflow: auto; … }` 这个滚动容器内的 `.row-wrap`（relative）之下。
- 对照组（同一动词的其余全部实现都走 fixed + 视口约束）：`shared.ts:457` `.action-menu-panel { position: fixed; z-index: var(--pi-layer-popover); … }`（SessionList/MachineList/WorkspaceList/ProjectList 共用，配合 `actionMenuPanelStyle(target, { constrainTo: "viewport" })`）；`MachineSwitcher.ts` `.machine-option-actions-panel { position: fixed; … }`。
- 最小失败场景：QuickSwitcher 会话列表铺满 body 视口时，对**最后一行**长按/右键 → 三项菜单（约 150px 高）向下展开，超出 body 可视盒：底部项（"Rename"）被裁切，需滚动列表才能够到——而滚动会移走正在操作的那一行。shared 实现用 fixed 就是为了免此难。
- 裁决：**TRUE**（不一致为源码可证；症状为绝对定位 + overflow 容器的标准行为，非猜测）。

### F4（低 · 触控地板）SessionTreeNavigator 的折叠 disclosure 是 20px 宽的触点且全文件无任何 coarse 块；close 按钮在 coarse 下停留 36px，与两个姊妹对话框的 44 不一致

- 证据：`src/client/src/components/SessionTreeNavigator.ts:559`
  `.disclosure { width: 20px; height: var(--pi-control-height); … }` —— 该元素是真实的折叠控件（:150 有 `@click`、:152-155 有 hover 样式与 title），:539 `.close-button { width/height: var(--pi-control-height-comfort) /* 36px */ }`；grep 全文件 **无任何 `@media (pointer: coarse)`**。
- 仓内自有标准：round-16 triage finding 6（review-triage-uiux-round16.md）刚把同形的 workspace 菜单 copy 按钮从 18px 修到 coarse 24px，理由是"under the AA floor the repo cites"；`shared.ts:467-468` 也已落为 `@media (pointer: coarse) { .detail-copy { width: 24px; height: 24px; } }`。SettingsDialog:780 与 QuickSwitcher:492 的 close 按钮在 coarse 下均为 44。
- 最小失败场景：手机上折叠一个 50 条的大子树：可点区仅 20px 宽 × 32px 高，偏一指即变成"选中该行"而非折叠；关闭对话框的按钮 36px，低于姊妹对话框的 44px 惯例（≥24px AA，故只按惯例不一致计）。
- 裁决：**TRUE**（按 round-16 自立的标准与先例衡量成立；severity 低——行本身 48px+ 的选择不受影响，受影响的是"折叠"这一个动词）。

### F5（账目疑点 · 需 owner 裁决）round-16 triage 的"十二项"无法与页面自身清单对账

- 证据：`docs/design/review-triage-uiux-round16.md` 标题 "twelve findings"；正文 "twelve true findings, ten fixed here, the rest deferred with written reasons" —— 但 Fixed 清单编号 1-10（十项），Deferred 列了 **4 个**条目（section focus 契约、controller 级 unpaired error producers、SessionTreeNavigator 间距字面量+两个守卫盲区、round-15 F2 证据更正）。若把后两条 bullet 视作非 finding 才能凑出 10+2=12，但 bullet ③ 带着与其它 finding 完全相同的 "(lane A, low)" 格式。提交 0e40b77c 的说明写 "ten now and two deferred"。
- 最小失败场景：收敛判定依赖每轮账目；下一轮按此页清点会得到 13-15 个未清项或漏掉 2 个。
- 裁决：**疑点（ambiguity）**——非代码缺陷；需要 owner 定夺是标题错、清单错，还是计数口径（guard 盲区与证据更正是否计入）。

---

## 已核查、裁决为 not-true 的疑点（供判定轮引用）

1. **状态栏（rail）优先级与圆点仲裁器相反**：`shared.ts:433-439` 的规则序使 unread(accent) 盖过 running(success)，而 `sessionRowIndicator.ts:20-31` 的仲裁器写明 asking > running > unread。**not-true**：round-16 triage finding 2 明文 "selected, archived and unread now win over the work states" —— rail 有意采取另一优先级；圆点与 rail 对同一会话给出不同侧重是已记录的设计。
2. **QuickSwitcher 选中 machine-tab 的 `margin-bottom: -1px` 在 `overflow-x: auto` 条内会被裁剪**（标签"融入下方横线"的惯技法在滚动容器里失效）。**not-true（推测性标注）**：裁剪只削掉标签自身无下边的 1px 背景，视觉与横线的衔接在两种结果下不可区分；无用户可见差异。
3. **tile 角标几何推导**：`shared.ts:409` `top: calc(inset + size/2 − dot-md/2)`、`right: calc(inset + size + space-2)` 与 `.action-main` 的右内边距预留（同公式）在默认与 coarse 两组变量下均自洽；activity 点与文本零重叠、与菜单按钮同一中心线。**not-true（几何正确）**。
4. **tile 高度锁定**：标题 `min-height: 2.5em @ line-height 1.25`、`small` 2.6em @ 1.3、`min-height: calc(56px + 24px)` —— 各自内部一致（1.25/1.3 两种行高并存是风格噪音，非缺陷）。**not-true**。
5. **状态点溢出压字**：SessionList `.action-main .session-state`（:725）落在 24px 右内边距内；QuickSwitcher 三连点（16px 宽溢出 8px 徽章盒）落在 44px 菜单按钮下方（tile 实际高 ≥78px，两行标题保留 39px 所致）。**not-true**。
6. **`.drawer-control` 32px 基础高度**：唯一使用者同时携带 `.drawer-collapse`（coarse 44，ChatView.ts:174），高度由显式 44 决定。**not-true**。
7. **QuickSwitcher 行级状态与 rail**：`.row` 非 `.action-row`，rail 不适用；`row-state/row-flag` 定位避开了 44px 菜单盒。**not-true**。

---

## 修复复核（round-15 九项 + round-16 十项，均在 HEAD 验证）

- 空闲标记诚实性：插件侧 `markKind = kind ?? (present ? "unread" : "idle")`（pi-web-plugins/{machines,workspaces}/browser/activityBadge.ts:40-42，两文件 diff 确认同源）；三处持久包 hidden 伴生规则在位（shared.ts:411、AppContextBar.ts:89、AppNavigationPanel.ts:493）。测试实跑：idleMarkHonesty + activityBadge + designTokens 共 63 用例通过。
- 折叠按钮：`AppNavigationPanel.ts:499/507/511` —— 宽 44、高阶特异性 padding:0、coarse min 44，44×44 成立（F3 修复有效）。
- tile 路径行行高已钉死（shared.ts `.list-body.tiles small { … line-height: 1.3; min/max-height: 2.6em }`）；折叠 composer 已对齐对话列（PromptEditor `footer.collapsed { padding: var(--pi-space-3) var(--pi-chat-gutter); }`，且类特异性稳定压过 ≤760px 的元素选择器 footer 规则）。
- 预取：以请求时的 machineId 入键、失败遗忘（sessionController.ts:1908-1922），与打开路径同页大小（MESSAGE_PAGE_SIZE=100，:38/:343/:434/:1487/:1917）——无漂移；hover/focus 触发点在 SessionList.ts:413-414（touch 下 pointerenter 亦触发，但 `prefetched` 集合保证每会话每页至多一次，有界）。
- banner 生命周期：懒加载失败文案配对 retired-by 标记（PiWebApp.ts:1737-1755），成功路径按全文匹配退休（:1744）；willUpdate 树/设置触发有单次闸门（:658-678），无环（round-15 B1 修复成立）。
- `--pi-rail-width` 已声明（index.html:96-97）；死 sending-rail 规则已删；`.detail-copy` coarse 24 在位（shared.ts:466-468）；machines 列表隐藏时退休搜索词（MachineList.ts:73）。
- 结构守卫实跑：boxModelGuard 2/2 通过、pointerQueryOrder 1/1 通过（但见 F2：通过本身被盲区稀释）。

## 附注（非缺陷的观察）

- `ChatView` 与 `SessionList` 各自维护一份搜索行样式（`.list-search` vs `.session-search`），目前数值逐项同步（含 coarse 地板与 z-index:3）；shared.ts:259 的"防漂移"注释与第二个实现并存，属已知重复而非违例。
- 文档-代码对账：phone-quality.md 的 45px chrome、+53px 瞬时行（44+8+1）、`--pi-reading-edge` 10px(≤640)/16px 桌面、tile 14/11 字号，均与 index.html token 及组件规则一致；breakpoints.ts 命名的 430/640/760/1181 四条线与组件内 media 查询数值一致。

## 裁决汇总

| # | 发现 | 裁决 | 严重度 |
|---|---|---|---|
| F1 | self-update 横幅按钮 coarse 地板死规则 | TRUE | 中 |
| F2 | pointerQueryOrder 首条规则盲区 | TRUE | 低-中 |
| F3 | QuickSwitcher 行菜单 absolute vs 全局 fixed 契约 | TRUE | 低-中 |
| F4 | 会话树 disclosure 20px 触点、无 coarse 块 | TRUE | 低 |
| F5 | round-16 账目 12/10+4 对不上 | 疑点，需 owner 裁决 | 文档 |
