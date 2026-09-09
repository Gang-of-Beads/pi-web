# Review triage — UI polish convergence, rounds 2 and 3

第一轮见 `review-triage-uiux-round1.md`。车道报告归档于 `docs/design/research/`。

## 第二轮（41 条新发现：A 15 / B 10 / C 16）

| 来源 | 发现 | 判定 | 处置 |
|---|---|---|---|
| A-F1 | 多选时 inert 折叠钮盖住行首复选框（coarse 全覆盖） | true | `pointer-events: none` + checkbox 提层（`9b08fa0e`） |
| A-F2 | Clean up ≈27px，同排兄弟 32px | true | 补 `--pi-control-height` |
| A-F3 | chip 标签 10px 越出字阶 | true | `--pi-text-2xs` |
| A-F10 | 同屏两个灯箱关闭键 44 vs 32 | true | 统一 44 |
| A-F14 | 两个「+ 文本」控件字形 12 vs 17 | true | `.section-add-glyph` |
| A-F15 | 未读数裸文本（家法是徽章） | true | 胶囊徽章 |
| B-F1 | AskUserCard 触面按容器宽度而非指针类型 | true | 改 `pointer: coarse` |
| B-F2 | 添加项目主按钮 border token 当填充 → 4.09:1 | true | accent 填充 |
| B-F3 | SessionCleanupDialog 零 coarse 规则 | true | 全控件 44 |
| C-F1 | **默认深色主按钮 3.74:1**（背景色当前景色） | true | 新增可选 token `--pi-on-accent`，主题包八主题各自定色 ≥4.94:1（`b8072ba6` + themes `cbc128b`） |
| C-F2 | picker 行落回 UA Arial 13.33px | true | `font: var(--pi-text-sm)/1.25 var(--pi-font-ui)` |
| C-F5 | session 行状态点独占一行（+18px） | true | 绝对定位（`14e9d131`） |
| C-F7 | 外观卡片高度随文案 169–200px | true | 描述两行钳制 |
| C-F8 | 跟随系统复选框被压成 15.8×24 | true | `flex: 0 0 auto` |
| C-F11 | 非 tiles 行菜单 coarse 仅 32px | true | 44 |
| C-F12 | `small` 落到 UA `smaller`（11.67/11.11px） | true | 走字阶 |
| C-F13/F14/F3 | ✓ 行高 1px 断层 / 分组标题不贴任何线 / thinking 末行塌 36px | true | 分别修复 |
| C-F12(A) | 抽屉标签 22px 应与 32px 折叠钮齐高 | **judged not true** | `composerRoom.test.ts` 明确契约：section tab 小于可按下的控件 |

尺度机械化（第二轮驱动）：`e47485a0` 圆角、`675986fd` 控件高度、`f2e4e0ea` 状态点、`40ca3645` 字号、`19bcd230` 间距，每条附守卫测试。

## 第三轮（A 11 / B 4 / C 13）

本轮最重要的产出是**守卫自身被审出漏洞**：

| 漏洞 | 影响 | 处置（`c36c496c`） |
|---|---|---|
| spacing 守卫遇 `calc()/max()` 整条跳过 | 手机设置 chrome 12/6/14/18px 逃检 | 进入算式内部检查 |
| 负值不匹配 | `margin-left: -8px` 隐形 | 计入并改写为 `calc(-1 * var(...))` |
| `font:` 简写不读 | 16px/10px 逃过字阶 | 简写纳入守卫 |
| `outline: 2px` 写死 | 18 处不跟随 `--pi-focus-ring-width` | 纳入守卫 |
| 控件尺寸存进自定义属性 | `--qs-menu-size: 32px` 合规外观下旁路 | 自定义属性纳入控件守卫（`64045ac4`） |

真缺陷（`86173ac2` / `64045ac4`）：

- 面板头 44 vs 40 —— token 自身（36）低于其内控件（44），承诺的"共享一条横线"从未成立 → token 提到 44
- 常驻条 `text-overflow` 写在 flex 容器上 → 长名硬切无省略号
- idle activity dock 用 0.75 不透明度压暗 → 12px 文字 **3.96:1**，改为用颜色压暗
- Clear queue 药丸 ≈22px，低于自家 AA 24 地板
- **失败命令回执引用三个不存在的 token**（`--pi-error*`）→ 整条声明失效，失败态比 pending 还弱
- **添加项目说明被宿主 `small` 夹成单行 nowrap** → 项目信任文档链接被推到弹窗外并裁掉，屏幕上不存在
- 设置返回键清了 border/padding/color 唯独没清 `background` → 标题上方一块填充矩形
- picker 关闭键细指针 24×25（同文件却在触屏管到 44）、选项描述落回 UA `smaller`、主题预览点是第五种圆点尺寸、磁贴活动点多进文字列 2px、粗指针下复选框与折叠钮不同心、错误横幅关闭键无尺寸（≈17px）

新命名的两条 ramp：`--pi-weight-strong: 650`（原 8 处手写）、`--pi-elevation-*`（原 10 处手写阴影）。

## 仍然故意保留（需 owner 决定产品语义）

1. 模态层级倒置：picker 声明 `--pi-layer-popover`(30) 却被 registry 提为最上层，可被 dialog(50) 遮住
2. picker 的「当前值」是拼进标签的裸文字，而 `.selected` 表示键盘游标——两种含义共用一处样式
3. 抽屉标签 22px（已有契约，判定 not true）
