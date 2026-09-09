# 收敛第 16 轮 — Lane A（几何与契约）审查报告

- 仓库: /Users/hanxiao.du/Desktop/vincent/projects/pi-web, 分支 refactor/plugin-architecture
- HEAD: 74aa2895（round-16 启动提交, 仅新增 workflow 脚本）。任务指定审查面为 d5e0de1e, 与 74aa2895 在代码上等价。此前审查过程中 HEAD 从 d5e0de1e 前进到 74aa2895, 已核实该提交不触及任何被审文件。
- 只读声明: 未修改任何仓库文件; 本报告只写入 /tmp/r16-lane-a.md。

## 结论概览

1 个中危（TRUE）+ 3 个低危（TRUE）+ 1 个注记级（TRUE）。round 15 的九项修复本身全部复核成立（见文末"已检查且干净"）。
以下每条 finding 均给出 file:line 与最小失败场景, 并有明确 TRUE/FALSE 裁决; 无一条依赖未标注的猜测。

---

## F1（中危, 裁决 TRUE）状态轨 :has() 规则的特异性 (0,3,0) 永久压过写在它后面的 .unread/.archived/.selected (0,2,0) — 规则顺序表达的优先级失效, 选中态的状态轨在两类列表里给出两种答案

- 证据 A（规则与顺序）: src/client/src/components/shared.ts:424-428 是工作状态轨规则（.action-row:has(.activity-indicator.session) → success 绿, :has(.activity-indicator.terminal) → accent, :has(.activity-indicator.sending) → warning, :has(.unread-ring) → accent）; shared.ts:431-433 依次写 .unread / .archived / .selected 的 border-left-color — 即作者把"行状态类"写在 :has 规则**之后**, 表达"后者覆盖前者"的意图。按 CSS Selectors L4, :has() 的特异性取其参数中最具体者: .action-row:has(.activity-indicator.session) = (0,3,0), .action-row.selected = (0,2,0) — 与源顺序无关, :has 恒胜。这正是 pointerQueryOrder.test.ts 注释记录过的同一类坑（"媒体查询不带来特异性, 顺序不能打败特异性"）, 只是这里的特异性来源换成了 :has()。
- 证据 B（两类标记共存的行真实存在）: 三个插件列表的行同时携带 selected 类与 .activity-indicator 子元素 — pi-web-plugins/machines/browser/MachineList.ts:126（selected 类）与 :142/:149-155（renderActivity → renderActionActivityIndicator → .activity-indicator.session/.terminal, 渲染在该行 .action-main 内）; pi-web-plugins/workspaces/browser/ProjectList.ts:98 与 :236; WorkspaceList.ts:166。这些列表 adopt 宿主 listStyles（machines/browser/hostUi.ts:35-40, workspaces/browser/hostUi.ts:38）, 规则确实生效。
- 最小失败场景: 选中一台正在运行会话的机器（机器面板, 选中行含 .activity-indicator.session）→ 该行左轨按 shared.ts:424 渲染为 success 绿; 而同一"选中"状态在 SessionList 的行上（行内只有 .session-state 徽标, 无 .activity-indicator, :has 不命中）按 shared.ts:433 渲染为 accent 蓝。shared.ts:433 写在最后却在携带活动标记的行上是死代码; 同一语义, 两个列表两种答案。
- 附注: SessionList 自身无可见冲突（其行不渲染 .activity-indicator/.unread-ring, 走 sessionRowIndicator.ts 的 .session-state 体系）; :432 .archived 与 :has 的冲突目前也无共现实例（插件列表无归档态）。故用户可见损害限于"选中行轨色不一致 + 431-433 的优先级链在插件列表失效"。
- 裁决: TRUE（级联机制是规范行为, 非猜测）。修复方向属产品裁决二选一: (a) 把工作状态 :has 规则移到状态类规则之后, 让选中/归档覆盖状态轨; (b) 删除 :432-433 的重述并在注释里写明"状态色优先"。现状是"一条死规则 + 跨列表不一致", 无论选哪边都应闭合。

## F2（低危, 裁决 TRUE）工作区菜单 detail-copy 复制钮宽 18px, 低于本仓库自己引用的 24px AA 地板; 其 height:18px 声明在用于值上已被同面板按钮规则的 min-height 覆盖

- 证据: src/client/src/components/shared.ts:397 — .action-menu-panel .detail-copy { width: 18px; height: 18px; ... }, 无任何 coarse 覆盖（全仓库仅此一处定义, grep 证实）。该按钮就是 .action-menu-panel 里的 <button>（pi-web-plugins/workspaces/browser/WorkspaceList.ts:237 面板 + :345 按钮渲染）, 因此同时命中 shared.ts:452（.action-menu-panel button { min-height: var(--pi-control-height-comfort) } 即 36px）与 shared.ts:456（coarse min-height: touch 44px）。height 与 min-height 是不同属性、同时生效: 用于值 = 细指针 18×36, 粗指针 18×44 — 宽度轴永远 18px。
- 最小失败场景: 手机上打开某工作区行的 ⋯ 菜单 → "Copy path/ Copy workspace label" 复制钮可点区域宽 18px; 拇指落点横向偏 3px 即落到路径文本上, 无反馈。shared.ts 自己的豁免记录（:346-349, tile 菜单 36px 豁免）明言"24px AA floor still applies and is met" — 此钮不满足仓库自己立的地板。
- 裁决: TRUE（低危: 误触后果是"没复制上", 非破坏性; 但它正是 round 15 漏掉的一个"未换算的地板"生产者）。修复方向: coarse 下给宽度 ≥24px, 或按 ChatView.ts:391-399 .msg-action 的先例用 ::after 扩展 hit 区而不放大图标。

## F3（低危, 裁决 TRUE, 字面量先于本 wave 存在）SessionTreeNavigator 三个节奏字面量活在间距守卫辖区之外 — 同时暴露 spacingScale 守卫的两个盲区

- 证据 A（字面量）: src/client/src/components/SessionTreeNavigator.ts:595 — .custom-focus { margin: var(--pi-space-1) 0 0 30px }; :599 — .validation-error { margin-inline-start: 30px }; :617 — 手机断点 .tree-row { padding-inline-start: calc(7px + min(var(--tree-indent-mobile), 48px)) }。
- 证据 B（守卫盲区）: src/client/src/components/spacingScale.test.ts:28 的 SPACING_PROPERTY 正则只认 padding-inline/block、margin-inline/block, **不认 -start/-end 长属性名** → padding-inline-start / margin-inline-start 整条落空, 7px 免检; 30px 走 :29/:61 的"size > RHYTHM_TOP(24) 即结构值"豁免免检 — 但 30px 是文本缩进节奏, 不是守卫注释定义的"控件占位"类结构值（守卫注释举例的是 44px 菜单钮、58px composer 槽）。已验证: 若把正则补上 -start/-end, 当前仓库恰好只有 SessionTreeNavigator.ts:617 一处会亮。
- 最小失败场景: "Summarize with custom focus" 的文本域与校验错误行左缩进 30px, 意图是对齐 radio 选项的文字列, 但 radio 列宽是 UA 内征尺寸、随浏览器不同, 30px 不从任何令牌或栅格推导, 两处也不共享一个命名; 手机树缩进用私有 7px, 而同一属性桌面用的是 --pi-space-5(10px) — 同一角色两个私有答案。与 docs/design/phone-quality.md 的"角色令牌锁漂移"方向相悖。
- 裁决: TRUE（低危; 属本轮审查面 SessionTreeNavigator rendering, 且守卫盲区可静态验证）。

## F4（低危, 裁决 TRUE, 流程/记录）d5e0de1e 提交信息宣称的 triage 页与配套 changeset 都不在该提交里, 至 HEAD 仍未跟踪

- 证据: git show --stat d5e0de1e 只含 docs/design/research/r15-lane-{a,b,c}.md 三份 lane 报告 + 代码/测试; git ls-files 证实 docs/design/review-triage-uiux-round15.md 与 .changeset/round-fifteen-followups.md 至 74aa2895 均未跟踪（git status 显示 ??）。而 d5e0de1e 信息明言 "The triage page records every finding, its disposition, and the two lane disagreements settled by reading the source."; 该提交同时改了用户可见行为（折叠钮几何 AppNavigationPanel.ts、横幅退役 PiWebApp.ts、[hidden] 伴随规则 AppContextBar.ts）。
- 最小失败场景: 新 clone 到 d5e0de1e（fork updater 硬重置未推送提交的事故本项目发生过两次）读提交信息去找 triage 页 → 不存在; 发布时 round-fifteen-followups 的 patch 说明不进 changelog — 违反 AGENTS.md 既定规则"User-visible changes carry a patch-level changeset in the same commit"（对照: 5b63f491 就带了自己的 .changeset/round-fifteen-fixes.md）。
- 裁决: TRUE。是否有意留待 round-16 收尾提交无法从仓库判定, 只陈述 git 事实; 归属处置（fixed / not-fixed-with-reason）在 owner。

## F5（注记级, 裁决 TRUE, 先于本 wave）boxModelGuard 第二个测试 offences.push() 丢失全部诊断信息

- 证据: src/client/src/components/boxModelGuard.test.ts:91 — offences.push() 推入 undefined（对照第一个测试 :77 推入"文件: 规则文本"）。
- 最小失败场景: 未来出现"min-height: var(--pi-control-height-*) 与 padding 分写在两条同选择器规则且无 box-sizing"的违例（该测试要抓的形状）→ CI 变红但输出只有 [undefined], 不说明文件与选择器, 定位回到人肉读全库。守卫仍会失败（[undefined] 不 toEqual([])）, 故是诊断缺陷而非漏检缺陷。
- 裁决: TRUE（测试质量缺陷; 引入于 round 11 b3ae9c83, 非本 wave; 因它守护的正是本 lane 的契约而附带报告）。

---

## 已检查且干净的项（明确声明, 非缺席）

1. 指针查询顺序: 六个 wave 文件内全部 class/id 选择器的 coarse 块均位于其后同选择器基础规则之前（AppNavigationPanel.ts:511 在 :503 后; QuickSwitcher.ts:491-501、:512、:515 在各自基础规则后; SettingsDialog.ts:780 在 :768 后; shared.ts:350-354 在 :344 后、:456 在 :452 后; PiWebApp.ts:205 在 :196 后; AppContextSwitcher.ts:120 在 :119 后）。无回归。
   - 附带注记（不另立 finding）: pointerQueryOrder.test.ts 的 SELECTOR 正则（:22）只匹配 ./# 开头的选择器, 元素选择器（button/textarea/input/footer）不在守卫内; 已人工核查 wave 面内全部元素选择器的 coarse 用法（PromptEditor.ts:167-173 的 textarea/editor-attach、QuickSwitcher 的 input/rename、PiWebApp.ts:205、ChatView.ts:171-178/343-348/373/399）, 无"coarse 在前被基础规则反压"实例 — 现状干净, 但守卫的承诺覆盖不到元素选择器这一类。
2. [hidden] 与作者 display: 全仓库 6 处 ?hidden 站点（AppNavigationPanel.ts:192、:393, AppContextBar.ts:61, ChatView.ts:1154, 两个插件 activityBadge.ts:47）均有伴随规则或 :host([hidden])（AppContextBar.ts:87-89、shared.ts:410、ChatView.ts:163、shared.ts :host([hidden]) 规则、MachineSwitcher.ts:295）。F1/F2 的 round-15 修复无漏网点。
3. 盒模型复合重算: 折叠钮 44×44（.compact-fold width=44 + .compact-header-action min-height=44 + coarse min 44; padding:0 以 (0,2,0) 胜出 — F3 修复成立）; compact 头 45px 契约（min-height 44 + 1px 边）与 AppContextBar 45px 对齐; tile 角标派生在 base/coarse 两组令牌下数值重算自洽（按钮盒 6..38 / 4..40, 活动点 right 42..50 / 44..52, 垂直中心线均 22px; 与按钮中心线各差 1px, 源于 .action-row 的 1px 边框使两个定位锚相差 1px — 低于可见阈值, 不作 finding）; tile 行高自洽（.action-name 2.5em↔line-height 1.25, tiles small 2.6em↔1.3 — F4 修复成立, .workspace-primary-label calc(2*1.3em)↔1.3）。
4. 折叠 composer 对齐: footer.collapsed 与 footer、转写列同用 --pi-chat-gutter（PromptEditor.ts:61/:67 — F5 修复成立）; docs/design/phone-quality.md 的 before/after 表（45px/53px/--pi-reading-edge 10/16px）与 index.html:87/:203 及 AppNavigationPanel compact 头/动作行实现一致, 无文档-代码漂移。operation-model.md 的"landed"清单（prefetch/in-flight/lazy surfaces/honest load-failure）与代码一致。
5. 触底抽查: compact 头全部控件 ≥44（scope/session/working/fold/actions 行）; tools-section 行 48px（min-height calc(44+4)）; SettingsDialog close 钮 coarse 44（:780）; QuickSwitcher 全套 coarse 44（:491-501, :512, :515）; MachineSwitcher 菜单触发与条目 coarse 44（MachineSwitcher.ts:341-343）。唯一低于地板的是 F2 的 detail-copy。
6. 作用域与生命周期契约: prefetch 以 machineSessionKey(machineId, id) 作键并在失败时遗忘（sessionController.ts:1909-1921 — B2/B4 修复成立）; api.messages 按 machineId 路由（api/clients.ts:278）; chatHistoryCache 的键由调用方传入 machine 限定 key（chatTranscriptStore.ts:45-48/76 ← sessionController.ts:1537-1539）; inFlight 仅 GET 共享、以同一 Promise 身份判删（api/inFlight.ts:26-35）。banner 生命周期: openLazySurface 成功清除仅在 error === failure 时（PiWebApp.ts:1731-1737 — B3 修复成立, 死分支已移除）; trackLoad 失败遗忘带身份守卫（lazySurfaces.ts）; bannerHold 的 show/hold/hide 与 heldErrorBanner 非空不变量成立（bannerHold.ts, PiWebApp.ts:3735-3753）。willUpdate 树加载触发有 treeDialogAnnounced 单次闸门（PiWebApp.ts:656-667 — B1 修复成立, 无环）。
7. lazySurfaces 文档串已与 fire-and-forget 机制一致（r15 note 5 的漂移已在 d5e0de1e 修复, lazySurfaces.ts:1-9）。

## 猜测标注

- F2 的"拇指偏 3px 即脱靶"是触觉推断, 未在 8505 栈实测; 宽度 18px 对 24px 地板的差距是静态事实。
- F1 的"作者意图"判断基于 :431-433 的书写顺序与重述的存在性; 若 owner 本意即"状态色优先于选中", 则缺陷改判为":433 在插件列表为死代码 + 跨列表不一致", 仍 TRUE 但降为注记级。
- F4 是否"有意留待 round-16 收尾提交"无法从仓库判定, 只陈述 git 事实。

## 裁决汇总

| 编号 | 严重度 | 裁决 | 一句话 |
| --- | --- | --- | --- |
| F1 | 中 | TRUE | :has 状态轨特异性压过后写的 .selected/.archived/.unread, 跨列表两种答案 |
| F2 | 低 | TRUE | 工作区菜单复制钮 18px 宽, 低于仓库自引用的 24px 地板 |
| F3 | 低 | TRUE | 树导航 30px/7px 节奏字面量 + spacing 守卫对 -start/-end 长属性名与 >24px 的双盲区 |
| F4 | 低 | TRUE | d5e0de1e 宣称的 triage 页与配套 changeset 未随提交, 至今未跟踪 |
| F5 | 注记 | TRUE | boxModelGuard 第二测试 offences.push() 丢诊断（先于本 wave） |

本轮不是干净轮: 5 项裁决全部 TRUE, 其中 F1 建议进入收敛裁定（另有两条注记级先于本 wave 的测试债务）。round 15 的九项修复本身经复核全部成立。
