# Round B — Lane B 复审报告:桌面 1280 + 响应式断点(393/768/1024/1280)

- 仓库:`/Users/hanxiao.du/Desktop/vincent/projects/pi-web`,branch `refactor/plugin-architecture` @ 3442b587(修复波 = cad91351)。
- 被测栈:http://localhost:8505/(未重启;未改仓库文件;探测脚本与截图全部在 `/tmp/roundb-lane-b/`)。
- 方法:Playwright(Chromium)`getBoundingClientRect` + `getComputedStyle` 逐元素实测,穿透 open shadow DOM;样式表扫描用 `adoptedStyleSheets` 遍历查 `:active` 规则。每个结论附 file:line、双方元素与数字、截图路径、TRUE/FALSE 判定。
- **副作用披露**:为测空态,本次在 test 工作区新建了 2 个 "New session" 会话(桌面 1280、手机 393 各一次,与 Round A 同型操作);未做删除/归档等破坏性操作。Round A 遗留的 2 个同类会话仍在。
- **对下文最关键的一个机制事实(全部空态结论的根)**:聊天列 `.chat` 实测 `display: block`(1280/1024/768/393 四个宽度一致),普通块流里 `margin: auto` 的纵向分量解析为 0 —— 我在四个宽度下都实测到 `margin` 计算值 = "0px"。

---

## 一、Round A 修复逐项验收(修了什么,读者收到了什么)

| # | Round A 修复项 | 验收结果 | 关键实测 |
|---|---|---|---|
| V1 | 边框对比度 `#3a424e` | **已到达读者** | `--pi-border`=#3a424e(旧 #292f38),border/surface **1.79:1**、border/bg 1.92:1、border-muted/surface 1.29:1(旧 1.15)。仍 < WCAG 3:1 —— 与 triage 记录的"~1.8"一致,属已记录的取舍,残余缺口见 §四 |
| V2 | Sessions 标题行分布(space-between 单机制)| **均匀性已到达;"绝对松紧"未变** | 桌面 1280 四元素间隙 **9.6/9.5/9.6**(均匀);手机 393 **25.9/25.9/25.9**(均匀)。**但 coarse gap 20px→12px 的降档在本行是可证明的视觉空操作**:393 行内自由空间 77.7px 被 space-between 均摊,12+13.9=25.9 与旧 20+5.9=25.9 完全相同 —— 投诉的"那一行"修复前后逐像素一致(均匀但依旧松) |
| V3 | 列边缘收敛到 reading-edge | **导航列已到达;聊天列没跟上(见 N1)** | 桌面 1280:rail header "PI WEB" x=16、chips 盒 x=16(seg 边框盒)、Projects h2 x=16、tile x=16、session row x=16 —— **同一列一个左缘** ✓。手机 393 全部 x=10 ✓。快切 sheet 标题 x=19 == 列表内容 x=19 ✓ |
| V4 | 折叠按钮 radius + 上下呼吸 | **已到达读者** | 手机 393:`.compact-fold` y=2, h=44, header h=49 → **gapTop=2,gapBottom=3**(原 0/1),radius 2px ✓(`AppNavigationPanel.ts:447` pad `2px 10px`) |
| V5 | 空态居中 | **main 空态 ✓;新会话空态 ✗;tasks/relays 空态 ✗(后两者修复未生效,见 N3/N4)** | main `.empty`:margin 解析 362.75/362.75,水平 241.3/241.3 —— 居中 ✓(其父 `main` 是 flex,auto margin 有效)。`.empty-session` 与插件空态:实测 margin 全部解析为 0,顶部锚定(数值见 N3/N4) |
| V6 | Files 工具栏触控下限 | **已到达读者** | 手机 393 Upload/Refresh 实测 **44×44**(旧 32),`filesPanelElement.ts:502` coarse min-height 已在服务产物中(curl 验证) |
| V7 | 无边框控件按压态 | **已到达读者(6 个家族全部在线)** | 服务端样式表扫描:session-list(`.action-menu-toggle/.cleanup-entry/.bulk-select-entry`)、chat-view(`.msg-action/.activity-dock button`)、extension-dialog-card、prompt-editor、pi-files-panel toolbar、context-switcher-sheet(`.sheet-close`)、settings-dialog(`.close-button`)的 `:active{background:var(--pi-surface-hover)}` 全部可查 |
| V8 | 磁贴左缘 | **已到达读者** | 手机 tiles x=10 == h2 x=10 == search x=10(旧 12 vs 10);桌面 16==16(`shared.ts:295` 现为 `padding: var(--pi-space-2) 0`) |
| V9 | 标题节奏 space-2 | **已到达读者** | sessions/projects/sheet 词标题 h2 `margin: 0 0 4px` 全部一致(含 sheet 内 Machines/Projects/Workspaces 三个,旧 8/4/8)|
| V10 | Tasks 面板标题 | **已到达** | 面板 strong "Tasks" == rail 标签 "Tasks" ✓ |
| V11 | (lane C F4)快切 create tile 居中 | **已到达读者** | "+ New session" 标题中心 x=640 == 视口中心,副题同;`QuickSwitcher.ts:444` `place-items:center; text-align:center` 生效 |

**验收结论:10/11 到达;1 项(V5 的两个分支)声称已修但读者没收到 —— 这是本轮最重要的复核结果。**

---

## 二、新发现(桌面 + 断点扫描)

### N1. 聊天列头部仍是全 app 唯一不共享正文读边的头部;且修复波让两条相对的头部行变得不对称 —— TRUE
- 元素:`app-context-bar` 的 `.context-bar`(含 ☰ `.panel-toggle`)vs 同列正文(转写 `.chat`、composer `.cm-editor`)vs 隔栏相对的 rail header。
- 实测(1280):列缘 x=341;toggle x=**347**(=`--pi-chrome-inset` 6px,`AppContextBar.ts:72` 仍是 `padding: 0 var(--pi-chrome-inset)`);转写/composer x=**357**(`--pi-chat-gutter` 16px)→ **头部与正文差 10px**(Round A 同数字,未修)。1024/768 同为 347/357;393 上两侧恰因两个 token 都是 6 而"侥幸对齐"(6/6)。
- **新回归面**:修复波把 rail header 从 chrome-inset 移到 reading-edge(`AppNavigationPanel.ts:447`),于是隔 1px 分隔线相对的两条 45px 头部行现在是 **16 | 6 不对称**(修复前 6|6 对称,双双错正文;现在 rail 对了、chat 双重错)。这正是 owner 规则里"同一症状要枚举所有 producer"的反例:改了一个 sibling,另一个没跟。
- 截图:`/tmp/roundb-lane-b/d-chat-open.png`(toggle 与正文 10px 错位可见)。

### N2. 手机折叠展开后的 `.compact-actions-row` 仍用旧 6px 内距,与已修的 header 10px 相差 4px —— TRUE
- `AppNavigationPanel.ts:447`(header,`padding: var(--pi-space-1) var(--pi-reading-edge)`)vs `:461`(actions-row,`padding: var(--pi-space-2) var(--pi-chrome-inset)`)。
- 实测 393(fold 展开):header 内容左缘 x=10、fold 右缘 **383**;Settings 按钮盒 x=**6**、Actions 右缘 **387** —— 同一面板相邻两条 chrome 行,左右锚点各差 4px,展开瞬间整个面板的边缘"跳一下"。
- 截图:`/tmp/roundb-lane-b/phone-393-foldopen.png`。

### N3. "New session" 空态的垂直居中修复未生效(4 个宽度全部顶部锚定)—— TRUE(验收失败)
- 声称(triage):"the new-session empty state centers in the viewport (was top-anchored with 591px of nothing)"。
- 机制:`ChatView.ts:367` `.empty-session { margin: auto; align-content: center; ... }` —— 其父 `.chat` 实测 `display: block`(滚动容器),块流中纵向 auto margin 解析为 0(四处实测 `mar: "0px"`);`align-content: center` 只作用于它自己内部的 grid 行,不改变它在父级的位置。**修复的两个机制都对不上父级的布局方式。**
- 实测:1280 → 盒 y=114,h=103.5,bottom=217.5;聊天区 90..658.8 → **下方空 441.3px**(到 composer 顶 706.8 为 489.3px),上方仅 24px(chat pad-top)。393 → y=114,h=121,bottom=235,下方空 **423.8px**。768/1024:chat 高同为 559.5,几何与 1280 相同 → 该缺陷**宽度不变,无断点差异,但也无处自动好转**。
- 水平居中 ✓(1280 盒中心 605.2 == 列中心 605.2;393 盒 6..387 居中)。
- 截图:`/tmp/roundb-lane-b/d-newsession-1280.png`、`/tmp/roundb-lane-b/phone-393-newsession.png`。

### N4. tasks/relays 虚线空态的 `margin: auto` 同样是 no-op(声称"center in their panels"未到达)—— TRUE(验收失败)
- 修复产物确实已发布:curl 服务端 `tasksPanelElement.js` 内含 `margin: auto`(`tasksPanelElement.ts:302`、`relaysPanelElement.ts:571`)。
- 但实测(1280,面板 409.6×850):两处 `div.empty-state` 都是 **y=98, h=80.8, 计算margin "0px"**,紧贴工具栏(底部 86)之下,**面板内约 665px 空黑在下方**。
- 机制(tasks):空态渲染在 `<section class="viewer tasks-viewer">` 内(`tasksPanelElement.ts:84-86`),`.viewer`(`:287`)**没有 flex-grow** —— 作为 `.panel-content`(`shared.ts:168`,flex column)的 item 按 `flex: 0 1 auto` 收缩到内容高(实测 wrapper h=104.8 vs panel-content h=817),子元素 margin:auto 无自由空间可分。
- 机制(relays):`.viewer` 有 `flex: 1 1 auto`(`relaysPanelElement.ts:515`)但 `align-content: start` 把唯一的 grid 行压成内容高,效果相同 —— 盒子一样顶在 y=98。
- 对照:Files 面板 `.files-panel { flex: 1 1 auto }`(`filesPanelElement.ts`)是撑满的 —— 同一列里 Files"会填"、Tasks/Relays"抱着内容",既是空态不居中的根,也是 G1 边缘节奏的根之一。
- 截图:`/tmp/roundb-lane-b/d-tasks.png`、`/tmp/roundb-lane-b/d-relays-empty.png`。

### N5. 扩展更新对话框的选项按钮仍是"暗按钮贴亮卡"(方向反 + 1.11:1)—— TRUE(Round A 遗留,修复波只加了 :active)
- 实测(1280,聊天内):卡面 `article.card.open-card` bg = `--pi-surface-raised` ≈ #35383c(`index.html:193`,`ExtensionDialogCard.ts:346`);"Update now"/"Skip" 按钮 bg=**#1b2027** —— 比卡面**暗**两档,对比 **1.11:1**;同对话框 footer(#13161b)上的 "Cancel"(#1b2027)是"亮一档"惯例、对比也是 1.11:1。同一卡内两套方向、两处不可辨。
- app 惯例 elsewhere:按钮(#13161b)比底(#0b0d10)**亮**。这张卡是例外。
- 截图:`/tmp/roundb-lane-b/d-chat-open.png`(卡面完整可见)。

### N6. Appearance 主题卡互相叠压(P0)在桌面 1280 依旧全数复发 —— TRUE(Round A P0,修复波未触及)
- `settingsControlStyles.ts:7` 给一切 button 硬设 `height: var(--pi-control-height)`(桌面 32px/coarse 44px,非 min-height);`.theme` 卡(`SettingsAppearancePanel.ts:150`)内容(预览 74px+名称+scheme+描述+padding)≈170px。
- 实测 1280:11 张卡全部 h=**32**(computed height "32px"),网格行步进 **42px**(y=382.1→424.1→466.1→508.1),gap 10 —— **每张卡的内容向下溢出 ~138px,压进下面两行**;"Pro (native)" 的名字渲染在 y=437.1,比它自己卡的底(414.1)低 55px,落在第二行卡的盒子里。截图中可见三列并排互相覆盖。
- 截图:`/tmp/roundb-lane-b/d-settings-appearance.png`(叠加清晰可见)。

### N7. Settings 两个面板内容缩进差 13px(桌面复现 Round A 手机发现)—— TRUE
- General 面板控件 x=**404**(面板缘 391 + 13);Appearance 面板内容(theme-grid)x=**391**(缩进 0)。翻一层面板,内容整体左跳 13px。
- 截图:`/tmp/roundb-lane-b/d-settings-general.png` vs `d-settings-appearance.png`。

### N8. Settings 模态标题与索引行不共读边(桌面 6px)—— TRUE(次要)
- h1 "PI WEB" x=**167**,导航项 x=**161**(各自到卡缘 16.5 vs 10.5)。与 Round A 手机 4px 同族。

### N9. workspace 面板列内仍是四种左缘 + 两套工具栏带高(deferral 现状数字)—— TRUE(已记录的 owner 决策,未收敛)
- 1280,面板 870.4..1280:顶条 "Expand panel" 按钮盒 x=**870.4**(0,贴分隔线);Files toolbar 内容 x=**878.4**(pad 8,带高 49);Files `.list` 内容 x=**876.4**(pad 6);Tasks/Relays toolbar 内容 x=**882.4**(pad 10/12,带高 **53**)。Files↔Tasks 切换:标题左缘 878.4↔882.4(跳 4px)、带高 49↔53(跳 4px)、按钮高度同为 32 ✓(本轮唯一已对齐的量)。
- 截图:`/tmp/roundb-lane-b/d-chat-open.png`(Files)、`d-tasks.png`(Tasks)。

### N10. 断点扫描(393/768/1024/1280):除已记录的 token 跳变外无意外跳变 —— CLEAN
- rail 340px、session row 58px 高(x=16, right=324)、h2 gap 4px、tiles 150px、设置卡居中,在 768/1024/1280 三档逐项一致;≤640 的 gutter/reading-edge 降档(16→10、chat 16→6)与 coarse 控件升档(32→44)为设计跳变(Round A F1 已记录,数值复核一致)。
- "New session" 空态跨断点:几何宽度不变(chat 高 559.5 恒定),y=114 恒定 —— **没有断点断裂;缺陷是宽度无关的**(见 N3)。
- 截图:`/tmp/roundb-lane-b/sweep-768.png`、`sweep-1024.png`。

---

## 三、干净项(本轮实测证明,无需再猎)

1. 手机/桌面 sessions h2 右缘与行右缘逐像素一致(393: 383=383;1280: 324=324)。
2. 会话行节奏:58px 高、x=16、右缘 324,行距均匀(仅多行标题行 66.8px,内容驱动)。
3. 手机工具网格:2 列 x=10/200.5,右缘 383,行距 8,底缘收边一致。
4. 快切器:输入框/行/create tile 共一个左缘(x=371);create tile 高与行同(78)且内容居中。
5. chat 正文与 composer 共 gutter(1280: 357/853.4 两侧;393: 6/387)—— index.html 承诺兑现,Round A 账面保持。
6. main "Select a project" 空态:相对其可用空间精确居中(margin 362.75/362.75、水平 241.3/241.3;其父 main 为 flex,auto margin 有效)。
7. `.seg` chips 视觉盒 x=16(1px 是边框本身),与 header/h2 同缘。
8. 压缩头部标题/fold 图标在 49px 行内垂直居中(y=2 呼吸后)。

---

## 四、仍开放的已记录取舍(数字更新,非新发现)

- **hairline 仍低于 3:1**:1.79:1(surface)。owner 选的 ~1.8 已兑现;若要 WCAG 1.4.11 达标需再抬一档 surface 阶梯。
- **无边框透明控件的静置态**:Clean up/☑/⋯/dock 控件静置仍是无边框透明(按压态已补,静置可见性是已记录的 owner 决策)。
- **Settings Save 在 850 视口折叠线下**:General 面板 Save y=**972**(Round A 972,未变);按钮高度三档并存(导航 52.5-67.5 / 表单 32 / 关闭 36)。
- **三套 create 形态**(solid +New session / ghost +Add project / 快切 tile)、**pill 徽章**:维持 Round A 记录,本轮未复测变化。

## 五、修复优先级建议(按 owner 投诉对应)

1. **N3/N4(空态修复未生效——复检打回)**:让修复的机制与父级匹配 —— `.chat` 若保持 block,`.empty-session` 用 `margin: auto 0` 无效,应把聊天区改为 flex column 或给 `.empty-session` 包一层 stretch 容器;tasks 的根修是给 `.viewer` 加 `flex: 1 1 auto`(对齐 Files 面板的写法),relays 把 `align-content: start` 让位给空态(仅空态时居中)。
2. **N6(P0 叠压)**:`settingsControlStyles.ts:7` 的 `height:` 放开为 min-height(或给 `.theme` 单独豁免 `height: auto`)。
3. **N1**:chat `.context-bar` 与 rail header 二选一对齐(建议同走 reading-edge,6→16 一改两栏同时归位,顺带消掉头部/正文的 10px 差)。
4. **N2**:`.compact-actions-row` 的 `--pi-chrome-inset` 改 `--pi-reading-edge`,与 header 同锚。
5. **N5**:扩展卡选项按钮底换回亮一档(`--pi-surface` 系)或给卡内的按钮定"卡内凸起"专用 token。
6. N7/N8/N9:owner 已记录的节奏重构,数字如上,便于一并定夺。

## 六、证据索引

- 截图(/tmp/roundb-lane-b/):`desktop-1280-rail.png`(单左缘)、`d-sessions-view.png`(h2 分布+行缘)、`d-chat-open.png`(chat 10px 错位+扩展卡+Files 工具栏)、`d-tasks.png`/`d-relays-empty.png`(空态顶锚)、`d-newsession-1280.png`、`phone-393-newsession.png`(423.8px 空黑)、`d-settings-appearance.png`(P0 叠压)、`d-settings-general.png`(13px 缩进+Save 972)、`d-quickswitcher.png`(create tile 居中)、`phone-393-boot.png`/`phone-393-foldopen.png`(折叠钮呼吸/actions-row 4px)、`phone-393-sheet.png`(sheet 标题对齐)、`phone-393-projects.png`(tile 缘)、`phone-393-files.png`(44px floor)、`sweep-768.png`/`sweep-1024.png`、`d-boot.png`(main 空态居中)。
- 探测脚本:`/tmp/roundb-lane-b/p-*.mjs`(node,cwd=repo 根,playwright 1.62.1)。
