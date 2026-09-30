# Industry layout & interaction research: mobile/desktop patterns from the field

Status: **research complete, cross-reviewed（task-1..4 全部完成）**。Method: five adversarial
`researcher` lanes (web search + public source investigation, 52 sourced pattern cards),
parent-side live-fetch verification (7 claims: 5 confirmed, 2 corrected), two-lane
cross-review (consistency + transferability red team, 20 findings all adopted).
No product code changes. Full lane briefs archived under subagent-artifacts (paths in §2);
the digest lives here: §2 patterns + verification, §3 cross-mapping, §4 wave corrections,
§5 adjudication. Owner decision points consolidated in §4.3/§5 tail.

## 1. Lane plan（task-1 分工表）

| Lane | 主题 | 搜索角度 | 目标源码仓/文档 | Hunt list |
|---|---|---|---|---|
| L1 responsive-strategy | 响应式总体策略：单树 responsive vs adaptive vs 分站；断点 token；视口单位 | Material 3 window size classes、Apple HIG、web.dev responsive、container queries 2024-2026 采用度、dvh/svh vs 100vh、safe-area | m3.material.io/foundations/adaptive-design；primer/react Layout；shadcn/ui；mantine hooks | size classes (compact/medium/expanded) 的映射规则；container queries 在生产设计系统的落地；pointer/hover 媒体查询的使用面；nav 壳如何切换布局形态 |
| L2 touch-targets | 触面基准与指针交互：平台规定 vs 密度现实；hover 依赖的触屏处理 | WCAG 2.5.8 (24px) vs 2.5.5 (44px) vs HIG 44pt vs Material 48dp；密度模式（comfortable/compact）；tooltip/menu 的触屏替代 | primer/react Button；Shopify Polaris actions；ant-design size token；radix-ui primitives | 各家成文的 tap-target 底线数字与豁免政策；coarse pointer 覆盖的实现方式；次级动作（⋯）菜单的命中区处理；hover 菜单在触屏的退化路径 |
| L3 nav-shells | 导航壳/抽屉/面板/分栏：手机与桌面的导航形态切换；master-detail；面板折叠 | bottom tabs vs nav rail vs hamburger vs drill-in 的取舍文章；Sheet/Drawer 模式；split view 塌缩 | shadcn/ui Sheet 与 vaul；MUI Drawer persistent/temporary；radix-ui；VS Code workbench 移动故事；Grafana panels | bottom sheet vs side drawer 的场景划分；split→single column 的过渡规则；面板态持久化；移动上面板全屏化的路由/状态处理 |
| L4 composer-input | 聊天 composer 与输入面：autogrow、工具条、键盘、send/stop、附件 | AI chat 产品的 composer 行为分析；visualViewport 键盘处理；autogrow textarea 上限 | assistant-ui；ai-sdk 相关 UI 组件；LibreChat；shadcn chat 生态 | visualViewport 键盘避让模式；autogrow 的 max-height 与滚动策略；send/stop 状态切换的 affordance；附件 chip 行 |
| L5 anti-patterns | 反模式与翻车案例（对抗位）：找有记录的失败，不是成功学 | NN/g mobile anti-patterns；100vh 键盘事故；hover 菜单触屏死路；input <16px 自动放大；fixed 定位键盘遮挡；drawer 陷阱 | NN/g、web.dev、quirksmode、Smashing；热门仓库的移动 bug issue（vaul/radix 的 mobile issues） | 每条反模式带一个具体翻车故事 + 业界修法；Safari/iOS 特有坑；"responsive redesign failed" 复盘 |

对抗性设计：L5 独立于 L1-L4 找失败案例，交叉评审时 L5 的反模式清单用来打 L1-L4 模式卡的适用性；task-3 另发独立验证 lane 抽查来源。

## 2. Pattern library（task-2，五 lanes 完成）

Lane 产物（完整模式卡）在 subagent-artifacts 留档；本节为消化后的模式清单 + 来源类型。共 **52 张卡**：

| Lane | 卡数 | 产物 | Lane 判词（押注的 2-3 个模式） |
|---|---|---|---|
| L1 responsive-strategy | 9 | `…subagent-artifacts/outputs/f877943d-102e-45b5-8f7c-fe0f75083e80/responsive-strategy.md` | 插件宿主区域用 container queries（自响应）；三层 viewport-class token 驱动导航形态；dvh/svh + safe-area 基底 |
| L2 touch-targets | 8 | `…/outputs/f877943d-102e-45b5-8f7c-fe0f75083e80/touch-targets.md` | 24px AA 硬底 + 44px coarse 舒适底两个 token；命中区与视觉解耦（padding/overlay）+ 整行目标；hover 退化 + 全尺寸 kebab 溢出菜单 |
| L3 nav-shells | 12 | `…/outputs/5a3fd595-7df2-4b8e-bebb-906ff08cfbbf/research.md` | master-detail 单路由 + URL 承载选中；单一导航模型三形态（bottom bar→rail→drawer，3-5 上限）；Dialog↔Drawer 换形 + snap points + 每面板键控持久化 |
| L4 composer-input | 12 | `…/outputs/f877943d-102e-45b5-8f7c-fe0f75083e80/composer-input.md` | 壳层声明键盘行为（interactive-widget + dvh）；iOS 用 shell 级 visualViewport inset 发布为 CSS 变量；Send⇄Stop 命名状态机 + 单槽位 + 提交行为分类器 |
| L5 anti-patterns | 11 | `…/outputs/a241071e-b111-488f-932f-e8df6566c3be/anti-patterns.md` | 键盘×视口失败类（opencode 同型事故）；overlay 生命周期卫生（scroll-lock 泄漏/焦点陷阱是插件架构高发）；16px 输入底线 |

高价值模式（跨 lane 共识）：

1. **键盘×视口策略是壳层职责**（L4 卡1-3 + L5 卡1）：`interactive-widget=resizes-content`（Chromium；Safari 未支持，WebKit PR 在途）+ `dvh` 壳 + iOS 用 shell 级 `visualViewport` inset 兑换为 CSS 变量。同型事故直接存在：opencode web（dev-tool 形态）`h-dvh` + 底部 composer 在 iOS/Android 键盘下完全隐藏（issue #15842）；CSSWG 明确 `dvh` 刻意不跟随键盘（#7194）；Chrome 108 改过 Android 默认行为——地面规则会变。
2. **触面双层 token**（L2 全卡 + L5 卡8）：24px（WCAG 2.2 AA 硬底）与 44px（coarse 舒适底）分开命名；命中区与视觉解耦是行业标准手法；NN/g 触屏研究给 1cm≈38px 的可用性数。
3. **导航形态切换由单一模型驱动**（L1 卡1-2 + L3 卡1/9/10/11）：600/840 断点表（M3 五档：compact<600/medium 600-839/expanded 840-1199/large 1200-1599/XL≥1600）；bottom bar ≤5 项上限；MUI 四种 drawer 变体（temporary/persistent/permanent/mini）同一数据四渲染器；NN/g 定量研究：隐藏导航可发现性几乎减半（179 人、6 站点）。
4. **master-detail 单路由 + URL 承载选中**（L3 卡2-3）：Android list-detail/SwiftUI NavigationSplitView/Next.js intercepting routes/React Router 配方殊途同归——“一个目的地、两种呈现、状态在 URL”。
5. **面板态键控持久化 + 手机全屏化**（L3 卡7-8）：Sentry 每面板 `drawerKey` 持久化宽度；Grafana 移动端 sidebar 默认隐藏 + localStorage 持久化（PR #120732）；面板在手机全屏而非挤压内容；多列内部需 min-width+横滚契约。
6. **overlay 生命周期卫生**（L5 卡2-3 + L3 卡4-6）：Radix scroll-lock 泄漏（异步 effect 清理 × SPA 路由跳过 cleanup）、vaul 焦点陷阱（`modal={false}` 未透传）——插件架构里 body 样式多 owner 是最高发 bug 类；**vaul 已失修，shadcn 迁往 Base UI drawer**（选型注意）。 dismissal 契约需按栈深定义（NN/g 五种 dismissal 手段竞争的用户翻车研究）。
7. **composer 状态机 + 单槽位**（L4 卡5-6）：ai-sdk `status: 'submitted'\|'streaming'\|'ready'\|'error'` 驱动 Send⇄Stop 原位换图标（常 44px 命中盒，aria-label 随态换）；提交中行为是命名分类器（disable/queue/steer）非散落 if；插件不得加第二个主操作。
8. **autogrow/附件带/16px 底线**（L4 卡4/7/9）：scrollHeight 驱动 + max-height 上限后内部滚动（手机 ~4-8 行，视口相对表达）；附件独立固定高一横滚带（56-72px 方块），非内联换行；输入控件计算字号 ≥16px 否则 iOS 聚焦放大（`user-scalable=no` iOS 10 起被忽略）。
9. **反模式清单**（L5）：100vh/dvh 键盘盲区、body 样式多 owner 泄漏、drawer 焦点陷阱、iOS 16px、五手段 dismissal 竞争、无限滚动的 footer 不可达/回顶 pogo stick、rage taps（20-24px 图标行低于所有底线）、hover 依赖导航、大爆炸改版回滚（Ars Technica 2016 全量回退：staging 全绿生产全崩）。

### 来源核验抽查（task-2 父进程实拉，7 条）

| Claim（lane→卡） | 结果 | 证据 |
|---|---|---|
| WCAG 2.5.8 = 24×24 CSS px + 24px 圆间距豁免（L2→卡1/7） | ✅ 证实 | w3.org/TR/WCAG22#target-size-minimum 实拉 |
| interactive-widget 三值；Safari 不支持（L4→卡1） | ✅ 证实（补充：WebKit PR #48691/#48749 在途，webkit bug 259770） | MDN + caniuse + developer.chrome.com/blog/viewport-resize-behavior |
| M3 size classes expanded ≥840（L1→卡1） | ✅ 证实（补充：M3 现为五档） | m3.material.io/foundations/layout/breakpoints + developer.android.com |
| NN/g 隐藏导航可发现性几乎减半、179 人 6 站点（L3→卡11） | ✅ 证实（补充数字：desktop 隐藏 27% vs 可见 48%；移动 57% vs combo 86%） | nngroup.com/articles/hamburger-menus 实拉 |
| ai-sdk useChat status 四值枚举（L4→卡5） | ✅ 证实（修正：reload() 已更名 regenerate()） | ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat 实拉 |
| Primer "32px minimum interactive area"（L2→卡2/4） | ❌ 修正：Primer 成文底线是 **24px（WCAG 2.2 AA）**，small 按钮自认可能不达标；32px 是 medium 按钮视觉 min-height，非无障碍底线 | primer.style/product/components/button/accessibility |
| Ionic coarse 覆盖块在 core/src/css/structure.scss（L2→卡3） | ❌ 修正：该文件无 coarse 块（只有全局 reset）；实情是 Ionic 用 `(any-pointer: coarse)` 做 JS 平台检测，且有 hybrid 触屏笔记本误判的已知 issue #24179——粗指针 CSS 层的手法本身仍成立（MDN pointer/coarse），但"Ionic 结构scss"这个证据撤换 | 实拉 raw structure.scss + ionic-framework issues #24179/#17631 |

## 3. Cross-mapping to PI WEB（task-4）

对照基准：仓库实读（PiWebApp.ts、breakpoints.ts、pluginHostUi.ts、keyboardInset.ts、promptEnterBehavior.ts、panelCollapseController.ts、index.html、shared.ts）。三档：**已实现**（业界模式本仓已有且常更优）、**需改造**（方向对、机制/数值要改）、**不采纳**（与仓库已立机制冲突）。

| # | 业界模式 | 判档 | 对照证据与改造点 |
|---|---|---|---|
| 1 | 键盘×视口策略（interactive-widget + dvh + visualViewport inset） | **已实现（超出业界基线）** | `keyboardInset.ts` 已发布 `--pi-app-keyboard-inset`/`--pi-app-viewport-offset-top`；`--pi-app-visible-height` 用测量而非 dvh 假设（PiWebApp.ts:122 "100dvh is an assumption…a measurement"）。缺口：① `interactive-widget=resizes-content` meta 不存在（Chromium 免费收益，需确认不与 keyboardInset 双重补偿）；② iOS `visualViewport.resize` 可靠性有 WICG #79（Safari 15 不触发/陈旧 height）反证，需真机探针后再写入提案 |
| 2 | 触面双层 token（24px AA + 44px coarse） | **需改造** | token 已存在（index.html:80-81）但情性（touch 版仅 2 处消费）；** enforcement 才是缺口**：document 级 coarse 层穿不透 shadow root（min-height 不继承，index.html:171-174 已记录教训），必须走 per-host adopted/spread 样式块（listStyles 模式）+ 渲染后 DOM 断言；已发 coarse 块本身含 sub-44 目标（shared.ts:321-324 36px tile menu、PromptEditor 28px attachment-remove、ChatView 28px image-zoom-close） |
| 3 | 导航形态切换（600/840 三档） | **需改造（保留自家数值）** | 单分类器思想对且已半落地；但 **600/840 不可采纳**：三栏壳地板 1002px（PiWebApp.ts:127）、side-by-side 实测 1181、插件契约已发布 `ui.breakpoints={coarseOrMobile:760, mobileNavigation, desktopSideBySide:1181}`（pluginHostUi.ts:31-37）——引 600/840 = 双词汇表 = L1 卡 8 自己的反模式；且宽度单轴不够：高度轴（SHORT_VIEWPORT 620）与指针轴是独立一等公民（breakpoints.ts:38-40 文档明写） |
| 4 | master-detail 单路由 + URL 承载选中 | **已实现** | mainView 按 QualifiedContributionId 键控；选中态走 `ui.query`/namespacedQueryArgs；panelCollapseController 建模 navigation\|chat\|workspace。真缺口：`PluginDialog` 无尺寸/呈现契约（types.ts:95-102）——同一直播件在 overlay 与直接加载页面两种宿主下无契约，L5 卡 6 的 dismissal 混乱是同源成本 |
| 5 | 面板态键控持久化 + 手机全屏 | **已实现（方向一致）** | panelToggleHiddenState 按作用域持久化；workspace 面板手机全屏；Sentry drawerKey/Grafana localStorage 先例只确认键控身份做法 |
| 6 | composer 状态机 + 单槽位 Send⇄Stop | **需改造（不可照搬）** | 已发形态 = 单控件跨 send/steer/queue 三义（PromptEditor.ts:373/:397/:975）+ stop 并存且**同时活着**——ai-sdk 单值 status 模型的隐藏假设（send/stop 互斥）不成立；照搬=降级（steer 功能消失）；真形态是 `(canSteer, isCompacting, sending)` 两正交轴；enterkeyhint 须从 `promptEnterBehavior.ts` 派生（手机 Enter=newline）而非硬编码 send |
| 7 | 16px 输入底线 | **需改造（三机制耦合）** | composer 是 CodeMirror `.cm-content` 非 input/textarea；当前缩放抑制靠 `html{touch-action:pan-x pan-y}`（刻意，keyboardInset 启发式依赖它）——16px 底线只在解锁 pinch 时才需要，且解锁会破坏 keyboardInset；`font:` 简写在 shadow 边界重置 font-size，宿主级选择器不可靠 |
| 8 | container queries on 插件宿主区域 | **方向对、落点改** | 仓库已立政策：container queries 豁免 device-line 规则、落在**叶内容**（AskUserCard/ExtensionDialogCard/AppContextSwitcher），非宿主区域——`inline-size` 收容使内容自适应宽度失效并重锚定 absolute 后代（附件 zoom 等）；"fastest-adopted 2023"最高级未经证实，撤 |
| 9 | 反模式清单 | **适用** | 键盘失败类（opencode 同型）、overlay 生命周期卫生（shadow 边界使 body 泄漏类更隐蔽）、rage taps、五手段 dismissal 竞争直接适用；Ars postmortem 弱化为 slice-and-revert（AGENTS.md 已编码该原则，无 flag 基建可 staging） |
| 10 | vaul/Base UI drawer 引入 | **不采纳** | vaul 已失修（L3 实仓验证）；Lit 自有组件已有对应能力；作模式参考不作依赖 |

## 4. Wave corrections（task-4，对 mobile-layout-research.md §6 的修正意见）

1. **L1 wave（缺陷修复）维持并强化**：files/terminal 时序 bug 修复路径（per-host adopt）与业界发现一致（document 级 coarse 层穿不透 shadow root 是业界同款陷阱）；抽屉级联修复用 `--pi-control-height-touch` token 与业界双层 token 模式一致。无修正，照做。
2. **新增候选（低风险一行）**：`interactive-widget=resizes-content` viewport meta——Chromium 上键盘语义声明化；前置条件：与 `keyboardInset.ts` 的 iOS fallback 做不双重补偿审查（L4 卡 1 反模式明写双补偿跳动）。
3. **owner 决策点新增**：① 触面密度语义（L2 {24+44} vs L2 卡 4 {24+32+44} vs L5 {44-everywhere} 三案并陈，重开 CHECKLIST.md:694）；② 断点词汇表（保留 760/1181 契约 vs 引入 M3 三档——qwen 车道裁决强烈倾向保留）；③ `PluginDialog` 呈现契约（overlay/全页双形态 + dismissal 栈深语义）作为新缝缺口立项与否。
4. **不采纳项**（防提案污染）：600/840 断点、vaul/Base UI 依赖、container-type 上宿主区域、ai-sdk 式单值 composer 分类器、`user-scalable=no` 回归。

## 5. Adjudication record（task-3，bllm 双车道交叉评审）

两车道（glm-consistency 一致性 / qwen-transferability 迁移性红队，后者实读仓库源码裁决）。产物：`…/subagent-artifacts/{dd2c4a72,760aa344}_reviewer_0_output.md`。20 项发现全部属实（ lanes 自带证据），分拣如下：

| # | 发现 | 车道 | 处置 |
|---|---|---|---|
| 1 | L1 卡 4 "svh/dvh 修键盘"与 L5 卡 1/CSSWG #7194 矛盾（dvh 刻意不跟随键盘） | glm | fixed：§3 行 1 按修正后口径（interactive-widget/visualViewport 修键盘，svh/dvh 只修浏览器 chrome） |
| 2 | L2 Ionic structure.scss 证据 corrected-false 且 load-bearing | glm | fixed：§2 核验表已撤换；verdict 的 Ionic 句不进提案 |
| 3 | L2 Primer 32px 重复四次当无障碍底线 | glm | fixed：全报告统一为 24px 底线 / 32px 视觉高度 |
| 4 | 桌面/鼠标触面底线三案并陈 {24+44}/{24+32+44}/{44-everywhere} | glm | needs-owner：进 §4.3① |
| 5 | L1 卡 5 无保留引用 vaul（L3 已验证失修）；glm 纠正归属（vaul 在 L1 非 L4） | glm | fixed：§3 行 10 不采纳 + L4 澄清 |
| 6 | L4 卡 2 iOS visualViewport fallback 自标 [spec] 但 WICG #79 反证 + 自家 Gaps 延后确认 | glm | fixed：§3 行 1 缺口② 降信为需真机探针 |
| 7 | L1 卡 3 container-query 例证与自己 Gaps/Dropped 台账矛盾（Primer/shadcn 未验证+"fastest-adopted"超承诺） | glm | fixed：§3 行 8 撤最高级、落点改叶内容 |
| 8 | L1 卡 1 扩展档名（mediumExpanded≥1200）与验证过的五档表冲突 | glm | fixed：本报告只引五档表；档数是产品语义挂 owner |
| 9 | L4 卡 5 reload() 陈旧名（现 regenerate()）+ Chrome 108 月份差 | glm | fixed：§2 卡 7 采 regenerate()/Nov |
| 10 | L4 卡 7 附件移除徽标 "44px 合规" 与自述 32px 命中区打架 | glm | fixed：记录为徽标=44px 命中区才合规 |
| 11 | 600/840 数值不适合本壳（地板 1002/契约 1181/双词汇风险） | qwen | fixed：§3 行 3/§4.3② 保留 760/1181 |
| 12 | document 级 coarse 层穿不透 shadow root（min-height 不继承；index.html:171-174 在案教训；已发 coarse 块含 sub-44） | qwen | fixed：§3 行 2 改 per-host adopted/spread + DOM 断言 |
| 13 | 16px 底线的机制/代价错（touch-action 已抑制缩放且 keyboardInset 依赖；composer 是 .cm-content；font 简写穿不过 shadow） | qwen | fixed：§3 行 7 三机制耦合口径 |
| 14 | ai-sdk 单值分类器是降级（本仓 send/steer/queue+stop 同时活着） | qwen | fixed：§3 行 6 两正交轴口径 |
| 15 | 宽度单轴不够（高度轴 620 + 指针轴是一等公民） | qwen | fixed：§3 行 3 三轴口径 |
| 16 | container-type 落宿主区域会破坏内容自适应宿主+重锚定 absolute 后代（仓库政策=叶内容） | qwen | fixed：§3 行 8 |
| 17 | enterkeyhint 须派生（promptEnterBehavior 手机 Enter=newline）非硬编码 send | qwen | fixed：§3 行 6 |
| 18 | peek detent 放 terminal 输出违反 L3 卡 5 自己的 NN/g 护栏（工具面是主目的地非 overlay） | qwen | fixed：peek 模式限 per-session 状态，不进 terminal |
| 19 | "插件视图免费获得可分享 URL" 过Claim（机制是 Next.js 专属；真缺口是 PluginDialog 双呈现契约） | qwen | fixed：§3 行 4 真缺口改写 |
| 20 | Ars postmortem 不可迁移为 load-staging 证据（单运维无 fleet） | qwen | fixed：§3 行 9 弱化为 slice-and-revert |

两车道打架处：无正面冲突——glm 管一致性、qwen 管迁移性，重叠区（键盘故事、L1 卡 3/4）结论互补；glm 发现 5 纠正了任务书里 "L4 引用 vaul" 的归属错（实为 L1 卡 5）。核验基线（父进程 7 条抽查）双方均接受未再翻案。

**裁决后剩余 owner 决策点**（汇总）：① 触面密度语义三案（§4.3①）；② 断点词汇表 760/1181 vs M3 三档（§4.3②）；③ PluginDialog 呈现契约立项（§4.3③）；④ interactive-widget meta 是否随 L1 wave 落地（§4.2，前置双重补偿审查）。
