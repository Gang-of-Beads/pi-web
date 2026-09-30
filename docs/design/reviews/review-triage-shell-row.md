# 壳重构 bllm 评审分拣（commit 3c951ab0）

三路评审：glm 行为回归（43c8f3de）、glm 结构契约（67f601ee）、qwen 对照 owner 目标（cc128d66）。
分拣规则：fixed / not-fixed-with-reason / judged-not-true。

## P1（修）

| 发现 | 裁决 | 处置 |
|---|---|---|
| appRefresh 手机 PWA 回归：旧 `shouldShowAppRefreshInContextBar`（PWA+mobile）在顶栏渲染刷新钮，重写后手机 PWA 无任何刷新入口，而 appSurface 表声称 mobile=panel | true（读 3c951ab0~1:PiWebApp.ts:3420 坐实） | fixed：恢复方法，panel header 以 `shouldShowAppRefreshInHeader() || shouldShowAppRefreshInContextBar()` 门控 |
| 工具"唯一入口"不成立：WorkspacePanel 自带横滚 tab strip，`hideToolTabs` 全仓无调用方；手机选工具后面板行 + 内容区 tab 条并存 | true | fixed：`renderWorkspacePanel` 手机布局传 `hideToolTabs`（死属性转正），桌面保留 strip 快切 |
| 桌面面板头按钮 28px（`--pi-panel-header-control-height`），违反 B5"全部 ≥44px" | true | fixed：index.html var 28→44（消费面仅面板头按钮，designTokens.test 钉住 var 存在） |
| 契约表死表：docstring 声称"渲染器查同一张表"，实际零消费，防消失承诺为假 | true | fixed（对齐现实）：docstring 改为只声称测试真正保证的事（bar 集合被钉死、每 feature 至少一处可达）；完整表驱动渲染记为方案 A 前置工作，设计文档同步回写 |

## P2（修）

| 发现 | 裁决 | 处置 |
|---|---|---|
| `AppNavigationPanel.onQuickSwitch` 死接线（赋值但 render 从未用）——B1 病根残留 | true | fixed：删 prop 与赋值 |
| `sessionChipDestination.ts` + 测试成孤儿（唯一消费者面包屑 chips 已删） | true | fixed：连测试一起删 |
| `tabIcons` 的 navigation/chat/terminal 三支 switch 臂零调用（唯一消费 "files"） | true | fixed：收缩类型与函数 |
| 假注释："context bar chips above this panel already act as a breadcrumb"——chips 已删 | true | fixed：改写 |
| 设计文档漂移：SurfaceSlot 8 槽 vs 实现 3 槽、Actions/Settings footer vs header | true | fixed：回写 bars-minimalism-design.md |
| 键盘 ArrowRight 从 sessions 跳过 tools 区落 chat | true（部分成立；"Tab 泄漏"判 false——面板本无 focus trap，出口是既有设计） | not-fixed-with-reason：Tab 可达 tools 行，Arrow 出口为既有设计；工具区键盘序列入后续测试计划（记于设计文档） |
| rename 移入面板后"菜单→Rename→dialog"链路无断言 | true | fixed：补 SessionList 菜单路径 harness 测试 |

## judged-not-true（不修）

- 快速"选会话→立刻☰"返回跳步：400ms history 合并窗口既有行为（historyWrites.ts:3），非本 diff 引入。
- "Add project 移入 Projects 标题" scope 蔓延指控：早于本 diff 的既有决策（AppNavigationPanel 注释自证），非本次变更。

## 实机探针（8505，393x850 coarse pointer）

首轮探针被 shadow DOM 打穿（document.querySelector 不穿透 pi-web-app），改深走查后数字见探针输出；结论随修复批附记。
