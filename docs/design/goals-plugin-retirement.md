# Goals 插件退役记录（2026-09-08）

refactor/ 分支已完全插件化，goals 以全新原生插件落地
（`pi-web-plugins/goals`：drawer 极简段 + `goals.list` 操作 + 宿主 tokens），
**替代** 旧设计而非迁移它。

## 旧设计（退役）

- 旧 goals 插件（fork 构建产物，`GoalPanel.ts` 系）：盒状 "Goals >" 头行、
  完整 goal 面板（列表/暂停/归档按钮）、34px 描边刷新钮。
- 8505 数据目录的旧安装已移至 `~/.pi-web-8505/plugins/goals-old-design.bak`，
  新插件装于 `~/.pi-web-8505/plugins/goals`。

## fork 仓 GoalPanel 触面修复的处置

goal 触面审计发现的 refresh-entry 34px 问题已在 fork 仓
（`~/.pi/agent/git/github.com/VincentHanxiaoDu/pi-web` 的 `GoalPanel.ts`）
修改并验证，但因该仓 main 落后远端无法即时推送——**该修复随旧设计退役，
不再单独提交**；以本插件（refresh 44 coarse token）为准。

## 新旧差异（为什么是重设计而非迁移）

| 维度 | 旧设计 | 新设计 |
|---|---|---|
| 表面 | 抽屉段 + 完整面板（列表/暂停/归档） | 仅抽屉极简段（状态点+目标+进度+刷新） |
| goal 生命周期操作 | 面板按钮 | 归 agent 工具/CLI（插件只读 + 刷新） |
| 视觉 | 自带盒状 chrome | 宿主 tokens，无框线（C2/C4） |
| 刷新钮 | 34px 描边 | 44 coarse token ghost |
| 数据 | goals.read/archive 操作 | goals.list 操作（同 .pi/goals 格式，version-3 JSON） |

无 goal 时 section 不渲染（available 契约）；badge = 活跃 goal 剩余任务数。
