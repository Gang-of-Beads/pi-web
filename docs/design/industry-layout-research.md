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

## 2. Pattern library（task-2，lanes 执行中）

（待 lanes 完成后填写）

## 3. Cross-mapping to PI WEB（task-4）

（待综合时填写：适用 / 需改造 / 不适用 + 理由）

## 4. Wave corrections（task-4）

（待综合时填写：对 mobile-layout-research.md §6 wave 提案的修正意见）

## 5. Adjudication record（task-3）

（待交叉评审分拣后填写）
