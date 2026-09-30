# Review triage — UI polish convergence, round 1 (2026-09-09)

三条并行车道扫描 `audit-uiux-full` 的 13 条表面，共 49 条 file:line 发现。

| 车道 | 模型 | 焦点 | 发现数 | 报告 |
|---|---|---|---|---|
| A | botim-bllm/glm-5.3-flash | shell + chrome 几何 | 11 | `/tmp/uiux-lane-a.md` |
| B | botim-bllm/qwen3.8-flash-next | pickers / dialogs / sheets | 18 | `/tmp/uiux-lane-b.md` |
| C | anthropic-personal/claude-opus-5 | 全 13 表面 polish（含真机测量） | 20 | `/tmp/uiux-lane-c.md` |

## Fixed — 第一批（commit 4dc5e8df）

| 发现 | 判定 | 修复 |
|---|---|---|
| B-F1 / C-F4 `--pi-text-muted` 未定义 | true | → `--pi-muted`（SettingsDialog:786/787、ChatView:271） |
| B-F12 `--pi-accent-contrast` 未定义，回退 white 2.5:1 | true | → `var(--pi-bg)`（AskUserCard、ExtensionDialogCard、SessionList） |
| C-F7 add-project 主按钮无前景色，3.34:1 | true | → `color: var(--pi-bg)` |
| C-F1 `focus-visible { border-radius: inherit }` 抹掉自身圆角 | true | 删除该声明（shared / ChatView / PromptEditor） |
| C-F2 msg-action 命中区重叠 14px | true | 水平外扩收窄至 3px，coarse 下间距抬到 20px 后恢复对称外扩 |
| B-F2 / B-F3 重命名对话框裸 UA 控件 + `--pi-bg-raised` 未定义 | true | 按同族对话框规格补齐（填充、8px 圆角、muted label、焦点环、primary、disabled、coarse floor） |

## Fixed — 第二批（commit 4f79d903）

| 发现 | 判定 | 修复 | 实测 |
|---|---|---|---|
| B-F5/B-F6/B-F7、C-F10 QS 双重内边距 + 死规则 | true | 单一 `--qs-menu-size` 派生，行内预留一次 | 标题/副标题右边界一致（333/333） |
| B-F9 / C-F5 QS 状态点落在菜单按钮盒内 | true | 状态标移至卡片右下 | `stateOverlapsToggle:false`，命中返回状态本身 |
| C-F9 QS 重命名按钮 40px | true | coarse 抬到 44 | toggle 实测 44x44 |
| C-F6 tile 活动点比 ⋯ 低 10px | true | 与菜单按钮同派生中线 | 三张卡 delta 10 → **0** |
| B-F14/B-F15 机器对话框与机器行菜单无 coarse floor | true | 补 44px（页脚/关闭/输入/菜单项/触发器） | 探针 coarse 全绿 |
| C-F20 add-project 页脚按钮按视口宽度而非指针类型 | true | 移入 `pointer: coarse` | — |
| B-F11 ModelPicker/CommandPicker 焦点环缺失 | true | 搜索框与选项容器补 focus-visible 环 | — |
| C-F3 ModelPicker 搜索框 62px（content-box） | true | 加 `box-sizing: border-box` | — |
| C-F16 scope 分段控件内圆角 6px（同心应为 4） | true | → 4px | — |
| A-F1 刷新控件 36px、图标 18px | true | → `--pi-panel-header-control-height`(44)、图标 16px | 未能实测：该控件在探针走到的表面上未挂载 |
| A-F7 context sheet × 缺 `line-height: 1` | true | 补齐 | — |
| C-F8 add-project 输入框用 UA 蓝焦点环 | true | 补主题焦点环 | — |

## 待处理（下一轮）

- B-F4 弹层层级倒置（picker z30 在 dialog z50 之下但被 registry 提为最上层）——真实缺陷，但修法涉及 modal layer 契约，**归产品/架构决策**，先记录。
- B-F13 / C-F18 "✓ current" 是拼进标签的裸文字；`.selected` 同时表示键盘游标——语义冲突，需 owner 定产品语义。
- C-F11 外观面板 "in use" 主题卡零样式。
- C-F13 抽屉标签裸计数 `(3)`，仓库内已有未使用的 `.tab-badge`。
- C-F14 composer 一行三档高度（40/36/32）。
- C-F12 抽屉标签 22px vs 折叠钮 32px（桌面态）。
- C-F17 QS 机器标签"贴合式 tab"下无可贴合的线。
- C-F19 思考等级弹窗容器焦点环三种角形。
- A-F2 顶部 chrome 三段高度 44/40/52；A-F3 活动圆点四种尺寸；A-F5/A-F6/A-F9/A-F10/A-F11 控件高度与行家族尺度漂移；B-F16/B-F17/C-F15 圆角与关闭键尺度漂移——**成组处理**（需要先确定尺度契约，再一次性收敛，否则会变成又一轮零散补丁）。

## Judged not true / 车道自查排除

- C 车道自查：消息操作图标光学中心偏移 0.5px（非基线漂移）；主题卡片同行等高（stretch 生效）；320px 下网格与页脚未塌陷。
