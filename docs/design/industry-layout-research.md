# Industry layout & interaction research: mobile/desktop patterns from the field

Status: research in progress (goal mtr1vkjr-o92wsy). Method: five adversarial
`researcher` lanes (web search + public source investigation), cross-review,
then a synthesis mapping transferable patterns back to PI WEB. No product code
changes. Evidence base: every pattern card carries a source (URL or
repo:path); the cross-review adjudicates sources, not vibes.

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

（待综合时填写：适用 / 需改造 / 不适用 + 理由）

## 4. Wave corrections（task-4）

（待综合时填写：对 mobile-layout-research.md §6 wave 提案的修正意见）

## 5. Adjudication record（task-3）

（待交叉评审分拣后填写）
