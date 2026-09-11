# Round F — Lane B 报告:桌面(1280)+ 响应式断点全面核查

配置:实机栈 http://localhost:8505/,分支 `refactor/plugin-architecture` @ 387ad48f(验证对象:Round E 修复波 b2f826b5)。Playwright chromium;桌面 1280×850(fine pointer),响应式 393×850(hasTouch/isMobile)/ 768 / 1024。全部数字来自 evaluate 读取的 computed style / bounding rect / CSSOM(shadow DOM 穿透)。截图:/tmp/roundf-shots/。探测脚本:/tmp/roundf-v*.js(node,cwd=repo root)。未改任何 repo 文件,未重启栈。

---

## 1. Round E 修复波到达读者核验(b2f826b5)

### 1.1 goals refresh 悬停回归(多余右括号)— ✅ 已到达读者
- 服务字节核验:`curl :8505/pi-web-plugins/goals/goalsSectionElement.js` 中 `@media (hover: hover) { .refresh:hover { color: var(--pi-text); background: var(--pi-surface-hover); }` 为独立完好规则块(多余的 `}` 已删,与源 `pi-web-plugins/goals/goalsSectionElement.ts:24` 一致)。
- 实测(桌面 1280,fine pointer,真实 mouse hover):`.refresh` 32×32、radius 1px、静置 bg `rgba(0,0,0,0)`;hover 中 **bg `rgb(27,32,39)`(= --pi-surface-hover)+ color `rgb(230,232,236)`(= --pi-text)**,`e.matches(':hover') === true`。
- 截图:/tmp/roundf-shots/desk-goals-refresh-hover.png。**判定:TRUE(修复到达读者)**。

### 1.2 bare-small 家族上Type Scale — ✅ 四个点名生产者全部 11px,另加一行旁证
| 生产者 | owning 规则 | 实测 computed |
|---|---|---|
| ChatView custom-card fallback | `src/client/src/components/ChatView.ts:283` `.custom-card-unknown small, .part > small { font-size: var(--pi-text-2xs) }`(CSSOM 中存在) | **11px**(test 项目 "Gree" 会话内 3 张真实未注册卡片 "Nothing on this machine renders \"pi-goal…\"" 实测;Round D/E 时代为 11.6667px) |
| ActionPalette 选项描述 | `ActionPalette.ts:121` bare `small { … font-size: var(--pi-text-2xs) }` | **11px**(桌面 22 项、手机 22 项均测) |
| shared 列表脚注(updates/info) | `src/client/src/components/shared.ts:172` `small, .muted { color…; font-size: var(--pi-text-2xs) }` | **11px**(updates 面板 "running 1.202609.18 · installed …" ×2、info 面板路径/checked 行 ×4) |
| AutocompleteMenu 描述行 | `AutocompleteMenu.ts:14` `small { … font-size: var(--pi-text-2xs) }` | **11px**(composer 输入 "/" 后 12 个真实条目;Round E 时代为 10px) |
| 旁证:会话行 meta("12 messages") | 同 shared.ts:172(listStyles 注入 SessionList) | **11px** |

- 截图:/tmp/roundf-shots/desk-part-small-test-*.png、desk-palette-roundf.png、desk-tool-updates-roundf.png、desk-tool-info-roundf.png、desk-autocomplete-roundf.png、desk-upload-dialog-roundf.png。**判定:TRUE(四个生产者全部到达读者)**。

---

## 2. 新 TRUE 发现(超出 ledger,循环继续)

### F-1(TRUE — 修复波自带的第二个括号回归,同一提交)— ActionPalette.ts:114 丢了右括号,选项 selected/hover/disabled 规则全部失效
- 源:`src/client/src/components/ActionPalette.ts:114` 行尾为 `…; text-align: left; ` **无 `}`**,下一行 115 是 `.options button small { font-size: var(--pi-text-2xs); }`。对比 diff:b2f826b5 的 `-` 行原以 `text-align: left; }` 结尾——删掉了 `.options button` 自己的收括号。
- CSSOM 铁证(live adoptedStyleSheets):`.options button` 的 nested rules 变成 `& .options button small`、`& .options button.selected`、`& .options button:hover:not(:disabled)`、`& .options button:disabled`、`& .options button.disabled.selected`、`& .main`、`& strong`、`& small`、`& kbd`、`& .empty`、coarse media 整块——即其后的**所有**规则都被吞进嵌套。展开后 `:is(.options button) .options button.selected` 类选择器要求 button 嵌套 button,永假。
- 读者实测(桌面 1280):
  - hover 第一项:`hovered: true` 且 **bg 仍 `rgba(0,0,0,0)`**(应为 --pi-selection-bg)→ 桌面悬停反馈死。
  - ArrowDown 后 `.selected` 类在按钮上,实测 **bg 仍 `rgba(0,0,0,0)`** → 键盘选择指示死(a11y 相关:键盘用户看不到选中项)。
  - `:disabled` 透明度规则同批死亡(当前默认 33 项中 0 项 disabled——潜伏)。
  - 手机(coarse):`& .options button { grid-template-columns: minmax(0,1fr) }` 死,但被 kbd `display:none` 掩盖(auto 列实测 0px,视觉不变)。
  - bare `small` 规则(121 行)同样被吞为 `& small`,但 `.main` 内的 small 是 button 后代,仍匹配 → 11px 修复仍到达读者(与 §1.2 实测一致)。
- 与本轮修复的目标(goals 多余括号)同类:同一提交修了一个括号错、造了另一个括号错。
- 截图:/tmp/roundf-shots/desk-palette-hover-roundf.png、desk-palette-selected-roundf.png(选中行无高亮可见)、phone-palette-roundf.png。
- **判定:TRUE(新,不在 ledger)。一行修复:补回 114 行行尾 `}`。**

### F-2(TRUE,低危,可由 owner 裁量转 deferral)— `.section-toggle` 幽灵控件全指针零反馈
- owning:`shared.ts:349`(无 :hover 规则);`SessionList.ts:818` 的 :active 家族(`.action-menu-toggle, .cleanup-entry, .bulk-select-entry, .action-main`)**不含** `.section-toggle`;全库 grep 无 `section-toggle:hover` 历史。
- 实测:桌面 "Archived" 折叠钮(shared 列表头/会话面板/上下文 sheet 的 Machines/Projects/Workspaces 标题共用此规则):`hovered: true` 且 bg、color 均不变(`rgb(139,145,155)` → 同值);手机按压:bg 不变,无任何绘制。对照组:同视图所有幽灵控件都有反馈——msg-action(ChatView.ts:411 color+border)、session-title(AppContextBar.ts:86 color)、cleanup/bulk-select(SessionList.ts:722-725 bg+color)、panel-toggle、compact-scope(按压 rgb(27,32,39) 实测)、refresh(§1.1)。
- 影响面:一个类(shared.ts:349),多生产者(Archived 折叠、sheet 三段标题、面板 section 标题)。折叠/展开本身有结构性变化作结果,但与自家幽灵控件语言不一致——Round B "pressed family complete" 的扫描漏了它。
- 截图:/tmp/roundf-shots/desk-archived-toggle-hover.png、phone-sessions-roundf 系列。
- **判定:TRUE(新,不在 ledger);严重度低,若 owner 认定"静默标题"为设计意图可转 ledger。**

### F-3(TRUE — E-1 类未清零:修复波只封了四个点名的生产者,同类裸 `<small>` 还有约 5 处潜伏点)
按 Round D/E 已实证的 UA 计算规律(parent 12→10px、13→10.83px、14→11.6667px,均已在此前轮次 live 测得):
- `pi-web-plugins/terminal/TerminalPanel.ts:604` 快照行数 small:`.terminal-copy-toolbar`(765 行)仅 margin/color,父容器 766 行 `font: var(--pi-text-xs)`=12px → **10px,低于 11px 地板**(copy 模式可达,桌面入口为终端内选择;本 sweep 未触发成功,标注 source-level)。
- `src/client/src/components/ToolExecutionView.ts:103` diff 摘要 "N lines" small:165 行仅 color;`:host`(136)与 `.tool-card`/`.diff-details > summary` 均无 font-size → 沿 .msg 继承 14px → **11.67px**(diff 类工具卡片渲染时)。
- `src/client/src/components/SessionTreeNavigator.ts:254/269` 选项描述 small:601 行 `.choice-option small` 仅 color;`:host`(527)`font: var(--pi-text-base)`=14 → **11.67px**(/tree 对话框,含子树的会话可达;本 sweep 的 /tree 触发未弹出,标注 source-level)。
- `src/client/src/components/ChatView.ts:1581` 压缩中卡片 "N queued messages" small:365 行仅 color;`.session-activity`(362)无 font-size → 14 → **11.67px**(仅 compaction 期间,潜伏)。
- `src/client/src/components/SettingsDialog.ts:358/366/371/380` 插件 section 缺失/失败 fallback small:`:host`(762)base 14 → **11.67px**(边缘态潜伏;nav 列 small 已有 778 行 xs 覆盖,不受影响)。
- files 面板 upload 流 smalls(`filesPanelElement.ts:167/180/201/224/241`):241 在 `.upload-file-status`(525,xs=12)内 → 10px;其余继承面板字号,链路未完全解析——一并归入本类。
- 对照:history-boundary small(ChatView.ts:1702)有 `.history-boundary { font-size: var(--pi-text-xs) }` + `small { font-size: inherit }`(366 行)→ 实测 **12px,on-scale ✓**("Showing messages 15–115 of 115",E2E 会话 live);CommandPicker/ModelPicker/AuthDialog 的 bare small 均有 `font-size` 规则 ✓。
- **判定:TRUE(类未清零);每个点一行 `font-size: var(--pi-text-2xs)`(terminal 处需 2xs 而非依赖父 12px)。是否本轮必修由 owner 裁量。**

---

## 3. Owner 四抱怨 + "New session" 专项 — 全部维持关闭(附实测)

1. **对齐**:桌面 rail 内容左缘统一 x=16(scope chips 16、h2 16、行容器 16、tiles 16、header-actions 右缘 324=行容器右缘 324=CTA 右缘 324=tile 右缘 324)。行内按钮 box x=19 的 3px 是 `shared.ts:414` 选中指示轨 `border-left: var(--pi-rail-width) solid transparent`——设计物,手机同构(10+3=13)。手机 reading edge 10 全列一致(tile 10/383 对称,gap 8,tile 高 87 全宽恒定,colGap 8/rowGap 95 在 393/768/1280 完全一致)。**FALSE(干净)**。
2. **留白节奏**:sessions 标题行 gap:手机 26/25(Round E 记录 25.9 — owner-deferred 触屏密度项,数值不变);桌面 10/9(Round E 记录 9.6 — 一致)。tools 网格、tiles 网格、设置 tabs 均匀。未发现新的极松/极紧值。**FALSE(除既有 deferral 外干净)**。
3. **按钮边界**:主 CTA(New session)accent 填充+accent 边(SessionList.ts:726);次级钮 1px token 边;设置对话框选中 tab 1px accent+选中底、未选中 tab 预留 1px 透明边(无布局跳动);设置关闭钮幽灵但 hover 实测 rgb(27,32,39) ✓。无边框家族除 F-1(调色板 selected/hover 死)与 F-2(section-toggle 零反馈)外全部有 hover/press 绘制(project-row 行容器 19,22,27→27,32,39 实测)。**FALSE(除 F-1/F-2 外干净)**。
4. **折叠钮**:手机 compact header 内 [10,2,50.7,44],radius **2px**,上间隙 **2**/下间隙 **3**(含 1px 边)——与 Round E 关闭数字一致,无回归。**FALSE(干净)**。截图:phone-fold-roundf.png。
5. **New session 居中(393/768/1024/1280 四宽)**:`.empty-session`(min-height:100% 填满滚动区,无假滚动):标题与 CTA 中心在四宽下与盒中心**逐像素重合**(393:标题中心 x=196.5=盒中心;CTA 中心 x=196.5;768:554.5/554.5;1024:682.5/682.5;1280:605.2/605.2;垂直:内容块中心=盒中心 380.4)。boot 态 "Select a project…" 桌面三宽 cx=0、cy=+24.5——恰好是 49px context-bar 的一半,即在其内容区内(条以下)正中,机制为对称 auto margin(PiWebApp.ts:185)。**FALSE(干净)**。截图:w393/w768/w1024/w1280-empty3-roundf.png。
6. **断点跳变**:全部为 token 台阶或设计切换:nav 393 全幅→≥768 固定 340;控制高度 32↔44(pointer: coarse);标题行高 44↔32;composer/drawer-tab/tile/settings-tab 在各宽几何恒定;无未解释的尺寸/位置跳变。**FALSE(干净)**。

---

## 4. Ledger 对照(不变项复核)
- 手机标题行 25.9 gap、nav10/chat6/desktop16 分栏契约、设置面板 13px 缩进、Save 折叠线下、workspace panel 四左缘(本次复测:面板内容左缘 870.4/878.4/882.4 三层,仍 deferred)、create 表单、pill 徽章——全部维持 deferred,无数值恶化。
- E-2(行距字面量 ramp)按本轮指示计入 ledger,不计新 TRUE。
- 探测副作用披露:在 test 工作区创建 1 个空 "New session" 草稿(四宽复用同一草稿机制,/tree 命令未发送任何消息——会话行数前后一致);未触碰 'pi web' 协调会话;未触碰 hu 的待决对话框。

## 5. 结论
Round E 两项修复**均到达读者**。但本轮发现 **2 个新 TRUE(F-1 调色板括号回归、F-2 section-toggle 零反馈)与 1 个类未清零(F-3,~5 处潜伏裸 small)**——按"零新 TRUE"标准,**循环继续**。F-1 为一行修复(补 `}`),建议与 F-3 的收尾一并入下一修复波。
