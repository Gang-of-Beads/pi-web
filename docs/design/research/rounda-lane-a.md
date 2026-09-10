# Lane A — 手机端 393×850 全表面布局评审（rounda-lane-a）

评审对象：http://localhost:8505/（refactor/plugin-architecture @ c9ab1c62+）。
方法：playwright 真机浏览（393×850 hasTouch isMobile；桌面 1280×850、768×850），全部尺寸/间距用 `getBoundingClientRect` + computed style 实测，未猜测。脚本与截图仅在 /tmp（`/tmp/rounda/*.mjs`、`/tmp/rounda/*.png`），未改仓库文件、未重启栈。

**运动目标声明**：评审中途（00:21）并行 lane 的修复提交 `c9ab1c62`("Round A token-layer fixes: visible boundaries, one distribution, one radius language") 落地并热重载。下列发现凡受其影响处均给出 **修复前（实测）→ 修复后（复测）** 两个数字，并逐条裁决"已闭环 / 仍开放"。

---

## 一、四项 owner 投诉的裁决

### 投诉 2（留白节奏）：Sessions 标题行 — 属实，"不均匀"已修，"过松"未修
- **修复前实测**（phone-06-sessions.png）：`h2` 行内四元素 [Sessions][☑][Clean up][+ New session]（393 宽），间距实测 **37.7 / 20 / 20 px** —— 第一段比其余大 17.7px。根因是两套分配机制叠加：`shared.ts:257` 的 `justify-content: space-between` + `SessionList.ts` 旧版 `h2 > .bulk-select-entry { margin-left: auto }`（auto 吞掉全部剩余空间 17.7px，堆在标题后），加上手机端 `SessionList.ts:703` `@media (pointer: coarse) { h2 { gap: var(--pi-space-8) } }`（20px 基础间距）。
- **修复后复测**（c9ab1c62 把 auto margin 改为 0）：间距 **25.9 / 25.9 / 25.9 px**，均匀了；但仍等于桌面同一标题行（实测 9.5–9.6px，1280 会话面板）的 **2.7 倍**。
- **裁决：TRUE（部分闭环）**。不均匀已由 c9ab1c62 修掉（auto margin 与 space-between 二选一）；**仍开放**的是绝对松紧：coarse 端 `gap: space-8(20px)` 这一档（SessionList.ts:703）使同一控件行在手机上比桌面松一整档以上，且该 20px 与全 app 的 6/8/10px 主体节奏脱节（tokens：index.html:33-41）。控件本身 44px 高、标题字 12px，20px+ 的缝在 393px 宽里占了近 1/6 行宽。建议把 coarse 覆盖降到 `--pi-space-6`(12px) 或与 `--pi-chrome-inset` 挂钩。

### 投诉 4（圆形折叠钮）：圆 — 已修；"顶天立地无呼吸" — 未修
- **修复前实测**（phone-boot 运行）：`.compact-fold` 44×44 @ (343,0)，computed `border-radius: 999px`（AppNavigationPanel.ts:463 旧值 radius-pill），与同行一切 2px 方角控件（搜索框 2px、tool-row 3px、行卡片 2px）冲突；且 header 高 45px（44+1border）内按钮 y=0..44：**距顶边 0px，距底部分隔线 1px**，两侧相切。
- **修复后复测**（phone-15/16/17、fold-zoom）：radius 已是 **2px** ✓（c9ab1c62 消费了 `--pi-header-control-radius`，AppNavigationPanel.ts:463 现值）；但 `toTop: 0, toBottom: 1` **原样未动**。源头：`.compact-header`（AppNavigationPanel.ts:447）`min-height:44px; box-sizing:border-box; padding: space-1(2px) reading-edge(10px); align-items:center` — 44px 高的 44px 控件在 44px 盒里居中必然溢出 2px 内边距（44+2+2+1>44）。同屏对照：折叠展开后的 `.compact-actions-row`（AppNavigationPanel.ts:461）`padding: 4px 6px`，其 Settings/Actions 按钮有 4px 呼吸——同一面板内两条相邻 chrome 行，一条相切一条有呼吸。
- **裁决：TRUE（一半闭环）**。圆→方已闭环；**仍开放**：要么 header `min-height` 提到 48（44 控件+2×2 呼吸），要么控件在 coarse 下降到 42，二选一，别让 44 塞 44。

### 投诉 3（按钮边界）：边线对比度已整体抬升；"无边框透明控件"类仍开放
- **已闭环**：根因是 hairline 对比度。c9ab1c62 把 `--pi-border: #292f38 → #3a424e`、`--pi-border-muted: #1e232b → #262c35`（index.html:148-149）。修复前实测边线 rgb(41,47,56) 对底 #0b0d10；修复后复测 `--pi-border` = `#3a424e`，搜索框/工具卡/Save 按钮边线在截图中可辨（phone-15、phone-tool-files.png）。**TRUE 且已修**。
- **仍开放（无边框+透明的控件，粗指针上永远没有 hover 态）**，实测清单：
  1. 会话行菜单钮 `⋯`：44×56，`border:0; background:transparent; color:#8b919b`（SessionList.ts `.action-menu-toggle`）——一屏之内唯一的行级操作入口零边界（phone-06）。
  2. 标题行 `Clean up`：`border:0; background:transparent; color:#8b919b`（SessionList.ts `.cleanup-entry`，"Quiet by default"注释承认是有意为之）——在无 hover 的触屏上等于纯文本（phone-06）。
  3. 标题行多选钮 `☑`：44×44 透明无边框，16px 图标 #8b919b（SessionList.ts `.bulk-select-entry`）——与右边填色 accent 的 [+ New session] 同排，三种处理并存：隐形/隐形/实心（phone-06）。
  4. 聊天底 dock：模型 chip 131×44 纯文本（透明无边框，读作标签不读作按钮）、思考档/历史/麦克风/停止全部 44×44 透明无边框，仅 Send 有 accent 色（实测 dock 7 控件 border 全 0、bg 全透明）。
  5. 弹窗卡片按钮（Extension updates 的 Update now / Skip / Cancel）：`border:0; background:#1b2027` 贴在 `#35383c` 的 open-card 上——实测两者仅差两档 surface，且方向反了（全 app 惯例是按钮比底**亮**一档：#13161b on #0b0d10；这里是按钮比卡片**暗**），截图（phone-07-chat.png）里读作三块浮灰。TRUE。
  6. 各 modal 的 × 关闭钮：44×44 透明无边框 20px 字符（ContextSwitcherSheet.ts:88-89；SettingsDialog `.close-button` 同型）——点击区大但视觉上是个悬空字符。
- **裁决：TRUE（一半闭环）**。有边框的控件全部受益于 #3a424e；"无框透明"家族（1–6）在触屏上仍无任何边界/按压反馈，建议至少给 `:active` 一个 surface-hover 底或 1px 边。

### 投诉 1（对齐）：五处实测错位 + 一张干净账
1. **磁贴 vs 行列表左缘差 2px**：同一面板里，project 磁贴第一列 x=12（`shared.ts:295` `.list-body.tiles` 的 `padding: space-2 space-1` 横向 2px），会话行/工具网格/搜索框 x=10（`shared.ts:256` section padding `--pi-reading-edge`=10）。同屏同 token 体系下 2px 之差（phone-02 vs phone-06）。**TRUE（minor，但正是"哪儿都差一丝"的手感来源）**。
2. **Context sheet 标题与内容左缘差 10px**：sheet 标题 "Change context" x=9（ContextSwitcherSheet.ts:83 `.sheet` padding 8 + :86 header 负 margin 技巧），而它下方所有列表标题/行 x=19（section 再加 `--pi-reading-edge` 10px，shared.ts:256）、行内文字 x=32。一个模态里三个左缘，标题独占 9。**TRUE**。
3. **Settings 两个面板内容缩进差 13px**：同一对话框同一 frame（x=12, w=369），General 面板所有 label/input/button x=25（frame 内缩进 13px），Appearance 面板 intro/follow 卡/主题网格全部 x=12（缩进 0）。翻一层面板内容整体左跳 13px（phone-13 vs phone-12）。**TRUE**。
4. **六个工具面板的标题栏三种节奏**：Files 工具栏 padding 8px/带高 49px/按钮 32px 高/标题 x=8/按钮字 12px；Tasks、Relays 工具栏 padding 10px 12px/带高 65px/按钮 44px/标题 x=12/字 13px。一次点按相邻切换的两个表面，标题栏高差 16px、按钮差一档（phone-tool-files vs phone-tool-tasks）。**TRUE**。
5. **Files 工具栏按钮低于自家触控下限**：Upload 61.4×32、Refresh 68.6×32（coarse 指针下实测），违反 app 自己的 token 约定 `--pi-control-height-touch: 44px`（index.html:100-105，且 AppNavigationPanel.ts:471、shared.ts 对 section-add 都执行了同一下限）。**TRUE（违反自家规范）**。
6. **干净账**：聊天卡片与 composer 外框完全共线（卡片 x=6 w=381，cm-editor x=6 w=381，逐像素相等）——index.html:222-225 注释承诺的"对话与 composer 共享 gutter"兑现 ✓。会话行/搜索框/工具网格左缘 x=10 对齐 ✓。各列表空态文案同一约定：`.list-empty`/`.search-empty`（shared.ts）与 `.empty-claim`（WorkspaceList.ts:409）都是 `padding: 12px 4px`、muted、左对齐 ✓。

---

## 二、NEW 项："New session" 标题/空态居中、边距、响应式
- **手机 393**（phone-14-new-session.png）：空态文案 "This session is empty…" 与 [Write the first message]（192.2×44）**水平精确居中**（块中心 196.5 = 视口中心 196.5）✓；**垂直是顶部锚定**：按钮顶 y=199，距聊天区顶(90) 109px，按钮底(243) 到 composer 顶(693.8) 之间 **450.8px 空黑**。
- **桌面 1280**：按钮 y=181.5..225.5，中心 605.25 = 聊天列中心 605.2，水平居中 ✓；同样顶部锚定（距顶 91.5px）。
- **768**：按钮 y=199..243，水平居中 ✓（同 393 的 109px 顶距）。
- **裁决**：三个断点行为一致（水平居中 ✓、顶部锚定一致 ✓、按钮同尺寸 192×44 ✓）——没有"响应式断裂"。**开放的是审美裁量**（交 owner 决定，不属 unilateral 修改项）：393 上空态上方 64–109px、下方 450px 的上下失衡是否要在手机上垂直居中。此为产品语义，仅呈报。
- 顺带实测：新建的临时 "New session" 在列表中正确出现（"new · 282916e5 · 0 messages"，桌面 d1280-02 截图），行菜单有 Delete 可清 ✓。
- **同屏最大硬伤（Appearance，非 New session 但属同批"空态/标题"检查）**：主题卡片互相叠压。实测（phone-12-appearance.png；1280/768 同病，d1280-03-appearance.png）：`.theme` 按钮 computed height **44px**（coarse）/32px（桌面），而其内容 = 预览 64px(桌面 74px) + 名称 17.5 + scheme 30.8 + 描述 30.8 + padding 20 ≈ **172–180px**，`overflow: visible`，网格行距仅 52px（44+8）→ 每张卡把下面两行盖住，主题名被上一行卡的预览画盖掉。根因：`settingsControlStyles.ts:16/20` 给**所有** settings 按钮硬设 `height: var(--pi-control-height[-touch])`（不止 min-height），`SettingsAppearancePanel.ts:149` 的 `.theme` 卡是 button、内容远超该高。**TRUE，三个断点全中，c9ab1c62 未触及**（该两文件最后改动 fa0cde3b，早于本次评审）。修法方向：height 放开为 min-height，或 `.theme { height: auto }` 豁免。

---

## 三、其余实测记录（次要，供汇总）
- 会话行 `.action-main` padding `8px 24px 8px 10px`：右侧 24px 为状态点预留，行高 58 = token `--pi-row-min-height:56 + 2border` ✓ 在刻度上。
- 同一 context sheet 内机器行高 67 vs 项目行 58：内容行数不同（3 行 vs 2 行）所致，非漂移，不算错位。
- Settings 索引行 60.5px（`10px 16px` padding）对 token `--pi-row-min-height: 56`：+4.5px，在刻度外但单处出现，列为观察。
- Settings 模态头部（padding 12px，标题 x=12）与索引行文字（x=16）差 4px —— 与发现一.2/.3 同类（模态标题不与内容共读边），合并入"模态标题读边"一条。
- 模型 chip 截断式样：手机显示 "anthropi… claude-opus-5"（中段截断+前缀省略号），桌面同位置显示全名 "anthropic/claude-opus-5"（d1280-02）。功能正常，但前缀省略号在 mono 面孔下读起来像渲染残缺；列为观察，交 owner 裁量。
- c9ab1c62 还把 activity dock / 快切 chips 的 radius-pill 归一到 2px（复测：`.activity-dock` radius 2px，QS chips radius 2px ✓ 闭环；徽章类保留 pill 是声明过的惯例，index.html:47 `--pi-radius-pill`）。
- Actions palette（phone-10）：两侧留白 20px、行高 86px、搜索框 accent 边清晰、分组 hairline —— 干净 ✓。
- 行菜单（phone-09）：面板 174.5×186、border+radius 2、条目 44px 左对齐 —— 与其他菜单一致 ✓。

## 四、证据索引
- 截图（/tmp/rounda/）：phone-01-machines（启动）、02-projects、03-fold-open、04-context-sheet、06-sessions（投诉2 修复前）、07-chat（投诉3-5）、08-quick-switcher、09-row-menu、10-action-palette、11-settings、12-appearance（叠压硬伤）、13-general、14-new-session（NEW 项）、15/16/17-post-fix-*（c9ab1c62 后复测）、phone-tool-{files,terminal,tasks,relays,updates,info}（六面板）、d1280-{00,01b,02,03}、d768-{00,02}、phone-fold-zoom。
- 关键源码位：index.html:33-41(space tokens)/100-105(touch floor)/148-151(border tokens)/222-225(gutter)；AppNavigationPanel.ts:447,459,461,463,471；SessionList.ts:702,703；shared.ts:256,257,295；settingsControlStyles.ts:16,20；SettingsAppearancePanel.ts:149,174；ContextSwitcherSheet.ts:83,86,88,89；ChatView.ts:224；WorkspaceList.ts:409。
- 复现脚本：/tmp/rounda/*.mjs（node，cwd=repo 根）。

## 五、结论（按优先级）
1. **P0** Appearance 主题卡叠压（三断点全坏，可读性受损）— settingsControlStyles.ts:16/20 的 `height` 硬夹。
2. **P1** 折叠钮仍与顶边/分隔线相切（0/1px）— header 44 盒装 44 控件的几何问题，c9ab1c62 只修了圆角。
3. **P1** 触屏上无 hover 的无边框透明控件家族（⋯/Clean up/☑/dock/×/弹窗按钮）缺按压态边界。
4. **P2** coarse `h2 gap: 20px` 一档造成手机标题行 25.9px 均匀但过松（桌面 9.5）；Files 工具栏 32px 按钮低于 44 触控下限、三套工具栏节奏。
5. **P3** 2px 磁贴左缘差、sheet/模态标题读边不齐、Settings 两面板 13px 缩进差、模型 chip 前缀省略号、New session 手机端垂直平衡（交 owner 裁量）。
