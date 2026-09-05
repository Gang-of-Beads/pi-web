# 顶栏极简设计（ui-ux-pro-max 辅助检索 + 多代理分析落地方案）

前置：`bars-minimalism-options.md`（病根与两案）。owner 裁决：底栏 status-bar **保留**（不动）；顶栏要极简重设计；桌面/手机功能一致、页面不同但有对应。

## ui-ux-pro-max 检索命中（应用到本设计的条目）

- **Compact Label Overflow（High）**：chip/pill 标签尽量整行不折行；不可避免截断必须提供**可操作的全值披露**（不能只靠 hover tooltip）——直击面包屑 22% 截断 + 触屏无 hover 的问题。
- **Horizontal Scroll（High）**：避免内容横向滚动——手机 chips `overflow-x:auto`（AppContextBar.ts:424）是违例，应删。
- **Touch Spacing（Medium）**：相邻触达目标 ≥8px 间距；**Touch Target Size（High）**：web 按 WCAG target size，项目自身 44px 底线更严，从之（修 B5 的 36px/34px）。
- **Breakpoint Testing（Medium）**：320/375/414/768/1024/1440 全宽验证——进验收清单。
- 未命中可用的条目如实标注：无"顶栏元素预算"的直接条目，元素预算来自 IA 分诊（高频必现仅 4 项：会话名、working、context%、切会话）。

## 设计（方案 B 地基 + 契约表，一步到位的顶栏）

顶栏一行固定 **4 个槽位**，无横滚、无第二行：

```
[ 身份 ]  [ 会话名 ········ working · context% ]        [ ☰ ]
```

1. **身份槽**（leading）：一个面包屑按钮（不再是 4 个 chips 横滚）。单行截断 + 点按 = 打开导航面板对应 section（现有 `onOpenSection` 缝），这就是截断的"可操作全值披露"。桌面全开顶栏不显示（身份在面板）——规则保留，但由契约表驱动。
2. **会话名槽**（flex，min-width:0）：点按 = 快速切换（修 B1：桌面 ≥1181px 面板展开时从此槽也有鼠标入口）；行内重命名保留在长按/次级菜单（触达 ≥44px，修 B5）。
3. **working 指示**：三点动画，无独立按钮。
4. **context% 小缀**：点击开 stats sheet（tokens/cost 在内——底栏保留，此处是快捷披露，不是迁移）。
5. **☰ 单按钮**：统一 sheet = 去哪（Sessions/Chat/工具面板，修 B4 三重入口：761–1180px 只留 sheet 入口）+ Actions + Settings（修 B2 手机 Settings 入口）+ 刷新。4 按钮 → 1。

## AppFeatureSpec 契约表（对应关系的可枚举形态）

`src/client/src/appShell/appSurface.ts`：

```ts
export type SurfaceSlot =
  | "context.leading" | "context.title" | "context.affix" | "context.trailing"
  | "nav.header" | "toolSheet.row" | "palette.only" | "hidden";

export interface AppFeatureSpec {
  id: string;
  slots: { desktopExpanded: SurfaceSlot; desktopCollapsed: SurfaceSlot; mobile: SurfaceSlot };
  rationale: string;
}
```

渲染器（AppContextBar / AppNavigationPanel / AppMobileToolSheet）查同一张表渲染；契约测试枚举全部 feature × 3 布局，缺槽即红。T1-T4 取舍写进 `rationale`。`showsWhereAmIBar` 三条件保留为"顶栏显隐"谓词，但顶栏**内容**由表驱动。

## 修复清单（两案共同部分，全部落在本次设计内）

| # | 修复 | 落点 |
|---|---|---|
| B1 | 桌面面板展开无快切鼠标入口 | 会话名槽点击 = 快速切换 |
| B2 | 手机 Settings 只有一条路 | ☰ sheet 固定含 Settings 行 |
| B3 | <1181px Expand 假控件 | slot 由 layout 决定，mobile/narrow = hidden |
| B4 | 工具三重入口 + hideToolTabs 死属性 | 761–1180px 只留 ☰ sheet 入口；删死属性 |
| B5 | 36px/34px 触达 | 顶栏全部可交互元素 ≥44px，间距 ≥8px |
| 截断 | 面包屑 22% + 无披露 | 身份槽单行 + 点按披露；`.context-value` 补 ellipsis |

底栏 status-bar：**不动**（owner 裁决保留）。

## 测试影响（诚实清单）

- `whereAmIBar.test.ts`：保留（显隐规则未变）。
- `AppContextBar.sessionLed.test.ts`：按钮断言重写（4 按钮 → 1）。
- `QuickSwitcher` 入口测试：新增桌面展开态入口断言。
- 新增 `appSurface.test.ts`：feature × 布局全枚举。
- 验收：`scripts/stack-8505.sh up` + 393x850 coarse pointer 实机探针（320/375/414/768/1024/1440 全宽过一遍顶栏）+ patch-level changeset。

## 留 owner 一眼确认

方案 A（废三条件、双端同组件常显）仍可作为后续演进——本次按 B 落地是因为它可逆、测试重写面小；契约表就位后，A 只是改表里三个 slot 的取值。
