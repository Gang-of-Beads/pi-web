# Round G · Lane B — 独立复核 Round F 修复波（commit 400c4c63）

复核配置:live 8505 栈(未重启),Playwright headless chromium,桌面 1280×850(fine pointer)
与手机 393×850(hasTouch+isMobile,`matchMedia("(pointer: coarse)")` 实测 = true)。
探针脚本 /tmp/roundg-lib.mjs、/tmp/roundg-probe-a…h.mjs;全部测量为读者级 computed style + CSSOM。
工作树与 HEAD 一致(ActionPalette.ts / SessionList.ts 无未提交漂移)。

## 总结论

**两项修复均验证通过,CSSOM 结构检查通过,快速全扫无新 TRUE —— 收敛达标,报告 ZERO new TRUE。**

---

## 第 1 项:ActionPalette.ts:114 括号恢复 — ✅ 通过

### 源码层
- `src/client/src/components/ActionPalette.ts:114` 现以 `…text-align: left; }` 完整闭合;`:115-119` 五条后续规则逐条完好。`git show 400c4c63` 的 diff 即这一字符修复。

### CSSOM 层(probe A)
adoptedStyleSheets 规则树(共 32 条)中 `.options button` 位于 index 15、depth 0,其后:

```
cssom[15] depth=0 .options button
cssom[16] depth=0 .options button small          ← 兄弟
cssom[17] depth=0 .options button.selected       ← 兄弟
cssom[18] depth=0 @media (hover: hover)          ← 兄弟(媒体规则)
cssom[19] depth=1   └ .options button:hover:not(:disabled)   ← 媒体规则内部,正确嵌套
cssom[20] depth=0 .options button:disabled       ← 兄弟
cssom[21] depth=0 .options button.disabled.selected ← 兄弟
```

除 @media 内部那条外,**后续规则全部 depth 0 兄弟**,不再是 Round E 时的死嵌套(`&` 折叠)。✅

### 读者层·桌面 1280×850(probe A)
| 状态 | 实测 | 期望 | 判定 |
|---|---|---|---|
| 初始选中项(22 项中 row0 `.selected`) | bg `rgb(13, 40, 71)` | `--pi-selection-bg` #0d2847(index.html:163) | ✅ |
| 键盘 ArrowDown 后 | row0 清空为 `rgba(0, 0, 0, 0)`;row1 `.selected` bg `rgb(13, 40, 71)` + `aria-current="true"` | 高亮随键盘移动 | ✅ |
| 桌面 hover(非选中启用项) | `matches(":hover")` 且 bg `rgb(13, 40, 71)` | :117 hover 规则复活 | ✅ |
| 禁用项(row13 "New session") | `opacity: 0.55` | `--pi-disabled-opacity` = .55(index.html:114) | ✅ |
| 选项描述 smalls(43 个:plain/group/disabled-reason) | 全部 `font-size: 11px` | `--pi-text-2xs` = 11px(index.html:39) | ✅ |

截图:/tmp/roundg-desktop-palette-0.png、/tmp/roundg-desktop-palette-arrowdown.png(ArrowDown 后第二项带蓝色选区,肉眼可证)、/tmp/roundg-desktop-palette-hover.png

### 读者层·手机 393×850 coarse(probe F)
- 33 个选项;`.options button` computed `grid-template-columns: 327px` —— **粗指针单列覆盖(:132)复活**;`kbd` `display: none` ✅
- row0 `.selected` bg `rgb(13, 40, 71)`;small 11px ✅
- 空态:输入乱码后 "No actions found.",`padding: 24px`(= `--pi-space-9`,index.html:38),在 `.options` 内水平居中(中心差 < 2px)✅ —— Round F 报告中一并死亡的空态 padding 同步复活。
- 截图:/tmp/roundg-phone-palette-empty.png

## 第 2 项:SessionList.ts 菜单面板按压态 — ✅ 通过

### 源码层
- `src/client/src/components/SessionList.ts:818`:`.action-menu-toggle:active, .action-menu-panel button:active, .cleanup-entry:active, .bulk-select-entry:active, .action-main:active { background: var(--pi-surface-hover); }`,位于 `@media (pointer: coarse)` 块(:790-820)内。

### CSSOM 层(probe B + cssom-b)
session-list 共 252 条规则;按压规则位于 index 250、depth 1,其祖先链只有一条:

```
depth=0 @media (pointer: coarse)
depth=1 .action-menu-toggle:active, .action-menu-panel button:active, …
```

媒体块(index 243)到按压规则之间 **无任何 depth≥2 规则** —— 即它是粗指针媒体块的顶层直接子规则,未被其它规则吞并。✅

### 读者层·手机 393×850 coarse(probe B/E/F/G)
面板 174.5×186 @ (207.5,280),各项 min-height 44px。按压方式:pointer 移到项中心 → `mouse.down()` 保持 350ms → 项上实测 → 移开再 `up()`(**不触发 click,不执行任何菜单动作**)。基线(未按压)bg 全部 `rgba(0, 0, 0, 0)`。

| 菜单项 | 按压中 bg | 判定 |
|---|---|---|
| Archive | `rgb(27, 32, 39)` + `matches(":active")=true` | ✅ = `--pi-surface-hover` #1b2027(index.html:148) |
| Rename | `rgb(27, 32, 39)` | ✅ |
| History and branches | `rgb(27, 32, 39)` | ✅ |
| Reload from disk | `rgb(27, 32, 39)` | ✅ |
| Restore(归档行) | `rgb(27, 32, 39)` | ✅ |
| Delete archived session(danger 变体) | `rgb(27, 32, 39)`,字色保持 `rgb(255, 123, 114)` = `--pi-danger`(index.html:172) | ✅ |
| Mark as read | **当前应用状态无未读行,该项不存在**,无法按压实测;同一条共享规则(CSSOM 证)覆盖全部 panel 按钮,其余 6 项均实测通过 | ⚠️ 如实记录 |

截图:/tmp/roundg-phone-rowmenu.png、/tmp/roundg-phone-napress-Archive.png(Archive 项明显亮于兄弟项)、/tmp/roundg-phone-napress-Rename.png、/tmp/roundg-phone-napress-Historyandbr.png、/tmp/roundg-phone-napress-Reloadfromdi.png、/tmp/roundg-phone-napress2-Restore.png、/tmp/roundg-phone-napress-danger.png

## 附:quick switcher(第二个 palette)
- 选中高亮:先聚焦会话再打开,`.session-row.selected` bg `rgb(13, 40, 71)`(`--pi-selection-bg`)+ border `rgb(88, 166, 255)` = `--pi-accent`(QuickSwitcher.ts:447)✅;截图 /tmp/roundg-desktop-qs-selected.png
- 桌面 hover:非选中行 hover → bg `rgb(27, 32, 39)`(`--pi-surface-hover`,QuickSwitcher.ts:430)✅;截图 /tmp/roundg-desktop-qs-hover.png
- **规格 vs 实现说明(非回归)**:quick switcher 的 `handleKeyDown`(QuickSwitcher.ts:294-301)只处理 Enter;全组件无 ArrowDown 导航(仓库内 ArrowDown 只在 ActionPalette.ts:83、AuthDialog.ts:237、CommandPicker.ts:85、ModelPicker.ts:218 等)。任务书中 "keyboard ArrowDown too" 只在动作 palette 成立;quick switcher 的选中行是当前聚焦会话的静态映射。此为任务描述与实现的出入,记为说明,不计 TRUE。

## 快速全扫(四项 owner 抱怨)— 无新增
1. **按钮边界**:token 实测 `--pi-border` #3a424e / `--pi-border-muted` #262c35(index.html:152-153);palette 行 `border-bottom: 1px rgb(38, 44, 53)`、quick switcher 行 border `rgb(58, 66, 78)`;无边框触控控件按压态家族由本修复波扩到菜单面板项(即第 2 项)✅
2. **标题行分布**:sessions h2 `justify-content: space-between`;Clean up → + New session 间距 **手机 25.9px / 桌面 9.6px** —— 与 Round B/E/F 账本数字逐位一致(probe D/E/H)✅
3. **空态**:palette 空态 24px padding 居中(见上);新会话空态盒 381×525 @ (6,118),与 Round F lane C §6 关闭数字逐位一致 ✅;截图 /tmp/roundg-phone-chat-empty.png
4. **裁定为非问题的两个观察**(均非新 TRUE):
   - probe D 曾见未读 pill 在场时 "+ New session" 折到第二行 —— shared.ts:281-284 注释明示 ≤760px `h2 { flex-wrap: wrap }` 是**设计好的溢出行为**("Wrapping moves the overflow to a second line instead"),非回归。
   - 早期两次按压读到透明 bg(History and branches)为探针竞态:Rename 激活把行切进改名态、面板重挂后旧坐标失配。改用"每次按压前重开菜单+现测坐标、移开释放"后连续 3 次实测 `rgb(27, 32, 39)` —— 规则本身无恙。

## 探针副作用披露
- 为测空态在 test 工作区经 "+ New session" 创建了 **1 个空测试会话**;所有菜单项按压均为移开释放,**未激活任何菜单动作**(未 Archive/Rename/Delete 任何会话);未触碰 'pi web' 协调会话;未改仓库文件;未重启栈。

## 证据索引
- 提交:400c4c63(diff 单字符修复 + :818 选择器扩展)、654fdc15(Round F 三 lane triage)
- 探针:/tmp/roundg-lib.mjs、/tmp/roundg-probe-a.mjs(桌面 palette + CSSOM)、-b(手机菜单 + CSSOM)、-c/h(QS + 标题行)、-e/f/g(逐项按压复测、归档行、palette 手机态、空态)
- 截图:见上文各 /tmp/roundg-*.png
