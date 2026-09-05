# 顶栏极简设计（ui-ux-pro-max 辅助检索 + 多代理分析，owner 定稿）

前置：`bars-minimalism-options.md`（病根与两案）。owner 裁决流：底栏 status-bar **保留**；四槽方案被否（"还是两个 bar"；要求收缩菜单/面板单独承载快速访问/设置）；**终稿 = 常驻一条极简行 + 统一收缩面板**。

## ui-ux-pro-max 检索命中（应用到本设计的条目）

- **Compact Label Overflow（High）**：截断必须有**可操作的全值披露**，不能只靠 hover——身份信息入面板，面板内列表行自带全名与操作。
- **Horizontal Scroll（High）**：避免横向滚动——顶栏不再有任何 chips 横滚。
- **Touch Target Size / Spacing**：全部可交互元素 ≥44px、间距 ≥8px（修 B5 的 36px/34px）。
- **Breakpoint Testing（Medium）**：320/375/414/768/1024/1440 全宽验证，进验收清单。
- 如实标注：无"顶栏元素预算"直接条目；预算来自 IA 分诊（高频必现：会话名、working；context% 由保留的底栏承载）。

## 终稿：常驻一条极简行 + 统一收缩面板

```
常驻（双端同构，只有这一条）：
[☰]  会话名 ············ ●working

[☰] 打开统一收缩面板：
┌─────────────────────────┐
│ 快速访问（会话/机器/工作区）│
│ 会话列表（未读/working 标注）│
│ 机器 · 项目 · 工作区        │
│ 工具视图（终端/面板…）       │
│ Actions  ⚙ Settings  ↻    │
└─────────────────────────┘
桌面 = 侧栏常驻/可折叠；手机 = ☰ 抽屉覆盖。同一份内容结构，两种呈现。
```

- 顶栏 3 元素：**☰、会话名（点=快速切换）、working 指示**。身份面包屑收进面板；context% 由保留的底栏承载，顶栏不放。
- 统一面板 = 唯一二次承载面：快速访问、会话列表、机器/项目/工作区、工具视图、Actions、Settings、刷新。手机工具 sheet 退役（内容并入面板，修 B4 三重入口）；桌面 Actions/Settings 已在面板头，保持。
- mod+P 快速切换保留（键盘优先路径不变）；会话名点击 = 同一快速切换（修 B1 桌面展开态无鼠标入口）。
- `showsWhereAmIBar` 语义变更：常驻行双端恒在（☰ 槽取代"折叠才出现"的旧逻辑），由契约表驱动而非三条件特判。

## AppFeatureSpec 契约表（对应关系的可枚举形态）

`src/client/src/appShell/appSurface.ts`：

```ts
export type SurfaceSlot =
  | "bar.leading" | "bar.title" | "bar.affix" | "bar.trailing"
  | "panel.section" | "panel.footer" | "palette.only" | "hidden";

export interface AppFeatureSpec {
  id: string;
  slots: { desktopExpanded: SurfaceSlot; desktopCollapsed: SurfaceSlot; mobile: SurfaceSlot };
  rationale: string;
}
```

渲染器（shell bar / AppNavigationPanel）查同一张表；契约测试枚举全部 feature × 3 布局。T1-T4 取舍写进 `rationale`。

## 修复清单（全部落在本次设计内）

| # | 修复 | 落点 |
|---|---|---|
| B1 | 桌面面板展开无快切鼠标入口 | 会话名点击 = 快速切换；面板常驻 |
| B2 | 手机 Settings 只有一条路 | 面板固定 Settings 行 |
| B3 | <1181px Expand 假控件 | 面板归 layout 管，mobile/narrow 不渲染该钮 |
| B4 | 工具三重入口 | 手机工具 sheet 退役，工具视图入面板 |
| B5 | 36px/34px 触达 | 全部 ≥44px、间距 ≥8px |
| 截断 | 面包屑 22% + 无披露 | 身份入面板；面板行全名 |

底栏 status-bar：**不动**（owner 裁决保留）。

## 测试影响（诚实清单）

- `whereAmIBar.test.ts`：重写（三条件 → 常驻行 + 契约表）。
- `AppContextBar.sessionLed.test.ts`：重写（条目 4 → 3 元素）。
- `ChatView.drawerSections.test.ts` 等面板/抽屉测试：面板内容结构变更的增量修改。
- 新增 `appSurface.test.ts`：feature × 布局全枚举。
- 验收：`scripts/stack-8505.sh up` + 393x850 coarse pointer 实机探针 + 全宽走查 + patch-level changeset。
