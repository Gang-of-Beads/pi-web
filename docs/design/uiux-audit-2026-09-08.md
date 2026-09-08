# 全表面×全控件 UI/UX 审计（2026-09-08，393x850 coarse）

探针：`scripts/audit-uiux-full.mjs`（13 条表面/开启态路径，fail-loud，零静默跳过；
原始逐控件清单 `/tmp/uiux-audit/inventory.json`，截图 `/tmp/uiux-audit/*.png`）。

判据来源：`docs/design/minimal-layout-research.md`（C1-C7）+ ui-ux-pro-max skill
Minimalism & Swiss Style 基线 + 触面双 token 政策。

## 逐表面控件/框线计数（C1/C4/C5 口径，"复杂度"基线）

| 表面/开启态 | 交互控件 | 可见边框元素 |
|---|---|---|
| boot（导航/项目列表） | 32 | 17 |
| sessions | 28 | 10 |
| chat | 208 | 136 |
| chat-drawer | 209 | 137 |
| msg-row-menu | 210 | 137 |
| model-picker 弹层 | 291 | 137 |
| thinking-picker 弹层 | 298 | 137 |
| settings | 40 | 17 |
| settings-appearance | 43 | 25 |
| quick-switcher | 150 | 134 |
| qs-row-menu | 153 | 134 |
| context-sheet | 32 | 17 |
| add-project-dialog | 119 | 20 |

注：chat 表面 208 个控件/136 条框线是复杂度大头——与 owner"比以前还复杂"
的投诉对齐，C1 减法清单的主战场；model/thinking 弹层叠在 chat 上（291/298）
说明弹层没有替换聊天表面而是叠加。

## 违规清单（16 条，逐条落 task-3 修复或豁免）

1. chat-drawer `refresh-entry` "Refresh goals" 34x34 —— 低于 coarse 44（goals 段刷新按钮）
2. model-picker 弹层 Close 24x25 —— 低于 coarse 44
3. model-picker 过滤 chip "Enabled" 158x27 —— 低于 coarse 44
4. model-picker 过滤 chip "All models" 158x27 —— 低于 coarse 44
5. model-picker 搜索框 327x36 —— 低于 coarse 44
6. thinking-picker Close 24x25（同 2）
7. thinking-picker "Enabled" 158x27（同 3）
8. thinking-picker "All models" 158x27（同 4）
9. thinking-picker 搜索框 327x36（同 5）
10. thinking-picker "max" 351x36 —— 低于 coarse 44
11. settings-appearance INPUT 15x18 —— **低于 AA 24**（原生小控件未定制）
12. add-project-dialog Close 29x26 —— 低于 coarse 44
13. add-project-dialog URL 输入框 367x39 —— 低于 coarse 44
14. add-project-dialog 复选框 13x13 —— **低于 AA 24**（原生未定制）
15. add-project-dialog "Learn about project trust" 链接 141x15 —— **低于 AA 24**（行内链接）
16. context-sheet 开启态与 boot 计数完全相同（32/17）——疑未真正打开，需复核 opener 或记录为"上下文切换入口不可达"

## C 判据初步读数

- C1（减法）：chat 表面 208 控件 vs sessions 28 —— 弹层叠加结构放大复杂度；
  简化方向不是删控件而是**层替**（弹层应替换而非堆叠）。
- C4（框线）：chat 136 条可见边框 —— 极简基线的最大偏离点。
- C5（初屏预算）：boot 32 > 建议的每初屏主要选项 ≤7 的口径需按"分组"解释，
  真正超标的是 chat 弹层栈。
