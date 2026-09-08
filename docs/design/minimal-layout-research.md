# 极简布局调研：可执行判据（2026-09-08）

## 定位

本文不重复 `docs/design/industry-layout-research.md`（52 张带来源模式卡）。
聚焦 owner 的裁决性问题：**"看不出和以前的区别，甚至比以前的页面还复杂"** ——
需要的是把"极简"从形容词变成逐表面可数的判据，并解释为什么"加"比"减"更常见。

## 来源（全部逐句核验）

1. **NN/g — Aesthetic and Minimalist Design (Heuristic #8)**
   https://www.nngroup.com/articles/aesthetic-minimalist-design/
   > "Interfaces should not contain information which is irrelevant or rarely
   > needed. Every extra unit of information in an interface competes with the
   > relevant units of information and diminishes their relative visibility."

   操作要点：最大化"信号"（高信息值：标签、plain language、清晰 signifier、
   helper text），最小化"噪声"（低信息值：装饰、无关信息、无解释的术语）；
   "communicate, don't decorate"；负空间本身也是内容、也要有目的。

2. **NN/g — The Characteristics of Minimalism in Web Design**（112 个极简网站分析）
   https://www.nngroup.com/articles/characteristics-minimalism/
   定义性特征（≥75% 网站具备）：扁平 96%、受限/单色配色 95%（55 个单色站中
   51 个纯灰阶；46% 用单色底 + 1-2 个 accent）、元素克制 87%、大量负空间 84%、
   戏剧化字体 75%。
   警示一：扁平虽然定义了极简，但**经常无法表达可点性**（signifier 不能省）。
   警示二："subtract till it breaks"（除非缺失会造成严重问题，否则删掉）会
   误伤主任务内容——"minimalism for minimalism's sake doesn't help users"。

3. **NN/g — Progressive Disclosure**
   https://www.nngroup.com/articles/progressive-disclosure/
   > "Progressive disclosure defers advanced or rarely used features to a
   > secondary screen, making applications easier to learn and less error-prone."

   两档结构："Initially, show users **only a few** of the most important
   options" + "a **larger set** of specialized options upon request"。
   关键推论：**出现在初屏本身就是一个"重要"信号**——把次级功能留在初屏，
   是在向用户撒谎说它们都重要。

4. **Nature 592, 258–261 (2021) — People systematically overlook subtractive
   changes**（Adams, Converse, Hales & Klotz）
   https://doi.org/10.1038/s41586-021-03380-y
   核验到的实验数据：改进任务中，无提示时只有 **21%** 的参与者提出减法方案，
   给出"还可以减"的提示后升到 **48%**。机制：减法方案更少进入联想记忆。
   直接解释了本仓库的病史：每一轮反馈都"加一个东西解决"，界面只增不减。

## 可执行判据（task-2 审计的量化口径）

| # | 判据 | 度量（探针口径） | 来源 |
|---|---|---|---|
| C1 | 减法清单：每表面每个元素必须能说出支持哪个任务；说不出的进删除候选 | 逐表面交互+信息元素计数，与上版本对比，只许减不许净增 | NN/g #8 |
| C2 | 噪声删除：纯装饰元素（无信息的分隔线/图标配饰/重复标签/复述标题的说明）计 0 | 元素清单标注 informational/decorative | NN/g #8 |
| C3 | 色彩预算：单色（表面/文字灰阶）之外 ≤2 个 accent 色 | 截图取色计数 | NN/g 112 站数据 |
| C4 | 分组靠间距不靠框：同屏可见边框/卡片/分隔线数量下降（信息值保留，框线形式减） | 截图框线计数 | NN/g 负空间 84% + Gestalt |
| C5 | 初屏预算：每表面初屏主要选项 ≤7 个（溢出项进次级菜单/对话框） | 初屏可见交互控件计数 | NN/g progressive disclosure |
| C6 | 极简不删 signifier：扁平化不得移除可点性指示（affordance）；触面尺寸 token 不回退 | 触面探针（已有）+ 截图可点性复核 | NN/g 扁平警示 |
| C7 | 减法优先的工作法：每轮修复先列"能删什么"再列"能加什么"；任何修复 PR 不允许净增元素数 | task-3/4 提交前对照元素计数 | Nature 2021（21%→48%） |

## 与 owner 投诉的对齐

"看不出区别/更复杂"的最可能成因（待 task-2 实测证实或证伪）：
- 上一轮 wave 只改了**属性**（尺寸、颜色 token），没改**元素清单**——C1 的
  计数如果持平或上升，就是"看不出区别"的直接证据；
- 每表面同时可见的框线/卡片/按钮组（C4/C5）数量未降——视觉复杂度的主观
  感受主要来自这两个计数，不来自尺寸 token。

## ui-ux-pro-max skill 基线（owner 指定评审工具，2026-09-08）

owner 指定用 ui-ux-pro-max skill 重新 review UI/UX，方向定为**极简 + 插件化**：
refactor/ 分支的 UI 焕然一新，所有插件贡献面（panels/dialogs/drawer sections/
composer slots）与宿主共用同一套极简基线。

skill 检索结果（Minimalism & Swiss Style，匹配 developer tool/enterprise app）：

- 风格变量：`--spacing: 2rem`、`--border-radius: 0px`、`--shadow: none`、
  `--accent-color: single primary only`；"essential elements only"、
  "no unnecessary decorations"、"no box-shadow unless necessary"。
- 实现清单（skill 原文）：grid-based layout、typography hierarchy clear、
  no unnecessary decorations、contrast measured、mobile responsive grid。
- 无障碍前置（skill 标注）：contrast-text-4.5、keyboard、visible-focus、
  reduced-motion。
- 与本仓判据的映射：skill 的零圆角/零阴影/单 accent 收紧了 C3（色彩预算）
  与 C4（框线计数）；"essential elements only" 即 C1 的减法清单口径。

**插件化约束（owner 口径）**：插件贡献面不许自带第二套视觉语言——宿主
shared tokens（间距/字级/触面/色彩）是唯一来源，插件面板沿用
`workspacePanelStyles` 模式消费宿主样式，不各自造卡/造按钮。

## 边界

- 判据服务于 393x850 手机端基准；桌面密度不在本 goal 范围。
- "subtract till it breaks" 的误伤警示（来源 2）与本仓库触面政策一致：
  删除以不破坏主任务可达性为前提，豁免须书面记录。
