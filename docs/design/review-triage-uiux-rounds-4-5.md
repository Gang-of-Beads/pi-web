# Review triage — UI polish convergence, rounds 4 and 5（终轮）

前三轮见 `review-triage-uiux-round1.md` 与 `review-triage-uiux-rounds-2-3.md`。
车道原始报告在 `docs/design/research/`。

## 收敛判定：未达成"零发现"，但发现的性质已经变了

| 轮次 | 发现数 | 其中"新缺陷" | 其中"上一轮扫尾没覆盖到" |
|---|---|---|---|
| 1 | 49 | 49 | — |
| 2 | 41 | ~35 | ~6 |
| 3 | 28 | ~15 | ~13（含守卫自身漏洞 5） |
| 4 | 29 | ~12 | ~17 |
| 5 | 31 | ~6 | ~25 |

第五轮 31 条里有 25 条是同一句话：**"这个修法没扫到这里"**（`font-weight: 700` 在 8 处、禁用透明度 `.6/.65/.68`、设置面板复选框 14/16/18、ActionPalette 与 AuthDialog 仍用浏览器字体、三处关闭键不在统一尺寸法则内、tile 菜单内缩只派生了一半）。结论不是"再扫一轮就干净"，而是**人工扫尾在这个规模上是错误的工具**。

因此终轮的产物是守卫而不是补丁：

| 守卫 | 覆盖 | 引入轮次 |
|---|---|---|
| `radiusScale.test.ts` | 任何像素圆角 | 2 |
| `controlHeightScale.test.ts` | 控件区间尺寸 + 藏进自定义属性的尺寸 | 2 / 4 |
| `dotScale.test.ts` | 状态点尺寸 | 2 |
| `typeScale.test.ts` | 字号、`font:` 简写、焦点环宽度、**字重**、**禁用透明度** | 3 / 5 |
| `spacingScale.test.ts` | 节奏区间间距，含 `calc()/max()` 内部与负值 | 3 |
| `tokenReferences.test.ts` | **引用不存在的 token（无 fallback）** | 4 |

`tokenReferences` 是回报最高的一个：同一类缺陷在四轮里出现 **4 次**（失败命令回执、活动坞 asking/error、重命名对话框输入框、以及第四轮又一处），每次都让整条声明静默失效，而所有基于"值是否在尺度上"的守卫都判它合规。

## 第四轮修复（`8e131a16`、`509bfcf0`、`d1c2e9bf`）

- 活动坞 asking/error 引用三个不存在的 token → 最需要被看见的两个状态失去底色
- 桌面面板标题不可收缩，未命名会话标题回退成整条首条消息 → 设置/Actions 按钮被挤出面板
- 快速切换器同槽画两个未读点（accent 蓝盖家法紫，两个同名 `role="img"`）→ 改走 `sessionRowIndicator` 仲裁器
- ⓘ 2.55:1、禁用行补救指引 2.14:1、用户角色标签 3.93:1 → 用颜色而非透明度表达
- 横幅按钮 32 vs 同列 44、粗指针复选框压住行名、计数徽章三色两高、✕/× 分叉、抽屉图标 17px、进度条写死 16px、队列条胶囊套胶囊、刷新键唯一正圆
- 手机设置详情页 × 卡在两行标题之间；QS `· main` 散文被两行钳制切掉 → 改标签
- **判为 not-true**：`--pi-muted` 低于 AA（车道报 4.42:1）。实测现网最差 muted 消费点 **5.56:1**、卡面档直接计算 **4.71:1**；车道数字来自把祖先 opacity 链乘进比较口径。探针留档 `scripts/probe-muted-contrast.mjs`

## 第五轮修复（`c7fa10da`、`d6f59723`）

- **context sheet 把自己的列表压扁**：外层已 `overflow-y: auto`，内部三个列表仍各自 `flex: 1 1 auto; min-height: 0` → 两台机器时第二台只剩 **8.9px 可见**（读起来像渲染残留），workspace 列表被压到 38px
- 同一张 sheet 把 "Machines" 画两遍（13px/600 与 12px/bold 上下相邻）
- msg-meta 静止态 `.28` 不透明度 = **1.37:1**（第四轮的修复只落在 `hover: none` 分支）
- 抽屉正文无左右天沟 → 插件状态点贴 x=0、刷新键贴屏幕右缘
- AuthDialog 无任何 coarse 地板；抽屉折叠钮鼠标端 32 而同位左栏控件 44；tool-row 52px 裸值；抽屉下方两条 1px 双色线
- 字重/禁用透明度/复选框/字体/关闭键的五处"没扫净"，连同守卫一起补齐

## 仍然开放（需 owner 决定，非技术阻塞）

1. **模态层级倒置**：picker 声明 `--pi-layer-popover`(30)，registry 却把它提为最上层 → 在 dialog(50) 之下绘制。设置打开时触发主题/模型选择器：背景变暗、对话框不出现、Esc 看似失灵。修法二选一（让 z-index 跟随 registry / 禁止 picker 在 dialog 之上打开），属产品语义。
2. **picker 的"当前值"是拼进标签的散文**（`… ✓ current`），而 `.selected` 底色表示键盘游标 —— 两种含义共用一处视觉。
3. 抽屉标签 22px：已有契约（`composerRoom.test.ts`），判定 not-true。
4. Lane C 第五轮的次要项：嵌套圆角不同心（内弧比"外弧减内边距"大 6–8px）、桌面两条顶栏 45 vs 53px、消息头图标行 20/8 两段节奏与 ⧉ 热区压住 ⓘ 2px、⋯/× 的字体族与圆角仍是两套 —— 均已记录，未修，属"再来一轮"的候选而非缺陷阻塞。
