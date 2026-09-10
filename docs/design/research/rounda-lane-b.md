# Lane B — 桌面 1280 + 响应式断点(393/768/1024/1280)布局协调审查报告

- 仓库:`/Users/hanxiao.du/Desktop/vincent/projects/pi-web`(branch `refactor/plugin-architecture`)
- 被测栈:http://localhost:8505/ (未重启;探测脚本与截图全部在 `/tmp/rounda/`)
- 方法:Playwright(Chromium)注入 `getBoundingClientRect` + `getComputedStyle`,穿透 open shadow DOM 逐元素测量;每个结论附 file:line、双方元素与数字、截图路径、TRUE/FALSE 判定。
- **重要过程披露(影响两条旧结论)**:探测中途 8505 栈短暂拒连后恢复了服务(疑似 UI 服务自动重建)。第一次手机探测与第二次探测之间,`SessionList` 标题行规则与折叠按钮圆角在**被服务的前端产物中发生了变化**(源码 `SessionList.ts:707-709` 现为 `margin-left: 0` + 新注释,与首次探测测得的 auto-margin 行为不同)。下文所有判定均以**最终复测(当前产物)**为准,旧产物数值单独标注。
- 探测副作用披露:为到达"新会话空态"面,点按 `+ New session` 两次(手机、桌面各一次),在 test·main folder 工作区留下了两个 0 消息的 "New session" 会话(列表可见,见 `desktop-1280-sessions.png`)。未做删除/归档等破坏性操作。

---

## 判定总表

| # | 发现 | 判定 |
|---|------|------|
| A1 | 折叠按钮贴顶边、坐在底边框线上,零呼吸(触控构建) | **TRUE** |
| A2 | 折叠按钮"方阵中的圆" | **FALSE(当前产物已修为 2px 方角;早前旧产物确为 999px 圆)** |
| B1 | 手机 Sessions 标题行"巨大不均空隙" | **FALSE(当前产物已改为均匀分布;旧产物测得不均,已修)** |
| B2 | 同一标题工具栏的间隙在断点间跳变 4px↔20px(桌面↔手机) | TRUE(设计使然,但量级差 5 倍) |
| C1 | 每一列里"表头内边距(6px)≠正文内边距(16/10px)",左右边缘成排错位 | **TRUE(系统性)** |
| C2 | 桌面导航栏同一列出现第三个左缘(6 / 11 / 16) | TRUE |
| D1 | "空态"三种垂直摆法:居中 / 顶部锚定 / 左上角,无统一契约 | **TRUE** |
| D2 | 空态水平居中本身全部干净 | CLEAN |
| E1 | 幽灵按钮(hairline 描边)边界对比度 1.35:1 / 1.15:1,远低于 3:1;"Clean up"、☑ 无边框无底色,读作文字不读作按钮 | **TRUE** |
| E2 | 文字对比度、主按钮(实心 accent)均达标 | CLEAN |
| F1 | 断点跳变:工具栏间隙、gutter(16→6)、行高(36→44)在 640/760 边界跳 | TRUE(token 驱动,属设计) |
| F2 | 340px 侧栏、行高 58、tile 网格、设置卡片居中在四个断点间无意外跳变 | CLEAN |
| G1 | workspace 面板列内出现 0/6/8/12 四种边缘节奏 | TRUE(次要) |
| H1 | 手机 context sheet 三个兄弟分区的标题下边距 8/4/8,同屏两套节奏 | **TRUE** |
| I1 | 设置对话框:次级按钮边界不可见(1.35:1);Save 按钮在 850 高度视口折叠线以下(y=972) | TRUE(次要) |

---

## A. 折叠按钮(AppNavigationPanel compact header,投诉 4)

**A1 呼吸空间 = TRUE。** 手机 393(触控)实测两次(旧、新产物一致):

- `.compact-header`:y=0,h=45(min-height 44 + border-bottom 1px),padding-block 0(`AppNavigationPanel.ts:447`);
- `.compact-fold`:44×44,y=0 → **gapTop = 0px,gapBottom = 1px(即那条边框线本身)**,右边距 6px(`AppNavigationPanel.ts:463` 基础 min-height 44 + `:471` coarse 强制 44;`:467` padding:0);
- 即:按钮高度 == 表头内容高度,数学上不可能有呼吸。与投诉原话"touches the top edge and the bottom border line"逐字吻合。
- 佐证:图标仅 8×8(`.compact-fold-icon`,`--pi-dot-md`,`AppNavigationPanel.ts:459-460`),44px 盒子里 18% 的图形占比,贴边时更显突兀。
- 截图:`/tmp/rounda/phone-393-foldcheck.png`、`/tmp/rounda/phone-393-initial.png`。

**A2 圆形 vs 方形 = FALSE(当前产物)。** 当前实测 `border-radius: 2px`,`--pi-header-control-radius` 解析为 2px(`AppNavigationPanel.ts:447` 行内声明 + `:463` 引用;与兄弟控件 `.app-refresh-button` 的 `AppRefreshControl.ts:40` 同 token,同排控件圆角一致)。**首次探测(重建前的旧产物)测得 999px 圆形**——投诉在当时为 TRUE,现已被 `--pi-header-control-radius` 通道修复。此条判定为"已修",无需再动。

## B. Sessions 标题行(SessionList h2,投诉 2)

**B1 "巨大不均空隙" = FALSE(当前产物;早上旧产物为 TRUE)。**

- 旧产物(首次探测,auto-margin 分组):手机 393 标题行 [Sessions | ☑ | Clean up | +New session] 间隙 = **37.7 / 20 / 20px**(标题→复选框为 auto 吃掉全部自由空间);桌面 1280 = **20.7 / 4 / 4px**。不均属实。
- 当前产物(`SessionList.ts:711` 已改为 `h2 > .bulk-select-entry { margin-left: 0 }`,注释明说"auto margin … swallowed all free space into one uneven void"):
  - 手机 393:四元素 x = 10 / 93.7 / 163.6 / 267.3,右缘 383 → 间隙 **25.9 / 25.9 / 25.9px**,完全均匀;
  - 桌面 1280:x = 16 / 83.4 / 124.9 / 208.3,右缘 324 → **9.6 / 9.5 / 9.6px**,均匀。
- 机制:共享 `h2 { justify-content: space-between }`(`shared.ts:257`)独自分布。投诉所针对的不均已在当前产物消失。
- 截图:`/tmp/rounda/phone-393-sessions.png`(旧行为留档)、复测数据见上文。

**B2 同一工具栏跨断点间隙跳变 = TRUE(设计使然,量级值得知道)。** `h2` gap token:桌面 4px(`SessionList.ts:702`,`--pi-space-2`)→ 触控 20px(`:703`,`--pi-space-8`);叠加 space-between 均摊后:同一排控件桌面 9.5px、手机 25.9px,**2.7 倍跳变**。属 touch-floor 的有意设计,非缺陷;列入"跳变清单"供 owner 知情。

## C. 表头内边距 vs 正文内边距(投诉 1 对齐)

**C1 = TRUE(系统性,所有宽度)。** 两条 token 永不相等:`--pi-chrome-inset` 6px(全宽;`index.html:83`,≤640 仍 6,`:207-209`)vs `--pi-reading-edge` 16px(桌面,`index.html:87`)→ 10px(≤640,`:208`)。

实测(当前产物):

- **桌面 1280 导航栏同一列三个左缘**:`header strong "PI WEB"` x=6(`AppNavigationPanel.ts:437` padding 0 6px);context chips 盒 x=11(`AppContextSwitcher.ts:107` chip padding 4/8 所在行);`section` 内容 x=16(`shared.ts:256` padding reading-edge)。**6 / 11 / 16 三个边缘在同一 340px 列里。**
- **桌面 1280 聊天列**:`.panel-toggle`(☰)x=347(列缘 341+6,`app-context-bar` 6px 内距)vs 转写/Goals/composer x=357(16px,`ChatView.ts:205` `.chat { padding: … var(--pi-chat-gutter) … }`)。**表头控件与正文边缘差 10px。**
- **手机 393**:compact header x=6 vs 列表 section x=10(`≤640` reading-edge=10)→ 4px 错位;右侧同理:折叠按钮右缘 **387** vs "+ Add project"/"+New session" 右缘 **383**,同屏两个右锚点差 4px。聊天列自身 6/6 对齐 ✓(chat-gutter 与 chrome-inset 同为 6)。
- 截图:`/tmp/rounda/desktop-1280-projects.png`(左缘 6/16 可见)、`/tmp/rounda/phone-393-foldcheck.png`(387 vs 383 可见)。

**C2 = TRUE(同 C1 的第三个边缘)。** chips 盒 x=11 是 6 与 16 之外的第三值;三段内容(表头/上下文行/分区列表)左缘互不对齐。

## D. 空态的摆法(NEW:New session 相关)

**D1 垂直摆法不统一 = TRUE。** 三种"空"三种摆:

1. 无会话时主区 `.empty`:`margin: auto` → 完全居中(实测 margin-top=margin-bottom=362.75,水平 241.3/241.3;`PiWebApp.ts:185`);
2. 新会话 `.empty-session`:**顶部锚定** `margin: var(--space-9) auto` = 24px(`ChatView.ts:367`):手机实测 y=138、h=121,**下方 591px 空白**(视口 850);桌面实测 y=138(聊天区顶 90 + 24 padding + 24 margin),**下方 ~450px 空白** —— 头重脚轻,像没排版完;
3. workspace 面板空态两套:共享 `.empty-state` `margin:auto` 居中(`shared.ts:169`),而 tasks/relays 插件自渲染同名 `.empty-state` 为**左上角虚线框**(实测 x=882.4, y=98,text-align:start;`tasksPanelElement.ts:302`)——同一个类名、两种设计,面板切换时空态跳位。

**D2 水平居中 = CLEAN。** `.empty-session` 手机文本块 x=22..371(中心 196.5 = 393/2 ✓),按钮 100.4..292.6(中心 ✓);桌面 357..853.4(列中心 605.2 ✓)。标题类(会话标题、compact header、rail header)垂直居中全部 ✓(文本 13.3..30.8 in 0..44)。

## E. 按钮边界可见性(投诉 3)

**E1 = TRUE(hairline 描边按钮的边界低于可辨阈值)。** WCAG 非文本边界建议 ≥3:1,实测:

- 按钮 border `rgb(41,47,56)` 在按钮底 `rgb(19,22,27)` 上 = **1.35:1**;
- `--pi-border-muted` `rgb(30,35,43)` 在同底上 = **1.15:1**;
- hover 面 `rgb(27,32,39)` 在 surface 上 = **1.11:1**;surface 对画布 bg = 1.07:1(面板本身几乎浮不出来)。
- 受影响实测控件:rail header 的齿轮/Actions(`AppNavigationPanel.ts:498`)、设置对话框 "Reload"、空态按钮 "Write the first message"(`ChatView.ts:369`)、tool-row、会话行边框。
- 另一半事实:Sessions 工具栏里 "Clean up" 与 ☑ 是 **border 0 + 透明底**(实测 border-width 0,`SessionList.ts:721/724`),纯文字/裸字形;同排只有 "+ New session"(实心 accent,#58a6ff 底 + #0d1117 字)读作按钮。同一排三种存在方式:实心 / 幽灵文字 / 裸图标——投诉"哪些东西读作按钮"在这一排就能看到答案的分裂。
- 截图:`/tmp/rounda/desktop-1280-sessions.png`(Clean up 幽灵态)、`/tmp/rounda/desktop-1280-settings.png`(Reload)。

**E2 = CLEAN(文字对比)。** muted 文字对 bg 6.13:1,accent 对 surface 7.18:1,实心主按钮字对底 ≈6.5:1——文字可读性全部达标;问题只在**边界线**,不在文字。

## F. 断点扫描 393 / 768 / 1024 / 1280

**F1 = TRUE(token 驱动的跳变,均为有意设计,列出量级):**

| 量 | 393 | 768/1024/1280 | 边界 |
|---|---|---|---|
| 列表 gutter(reading-edge) | 10 | 16 | ≤640(`index.html:207-209`) |
| 聊天 gutter(chat-gutter) | 6 | 16 | ≤640 |
| h2 工具栏间隙 | 20(均摊后 25.9) | 4(均摊后 9.6) | coarse(`SessionList.ts:703`) |
| 搜索框高 | 44 | 36 | coarse(`shared.ts:252`) |
| h2/控件高度 | 44 | 32 | coarse |

**F2 = CLEAN(无意外跳变)。** rail 宽 340px 三个桌面宽度不变(shell grid 实测 `340px 1px 938px|683px|427px`);会话行 58px 高、12px 行距、x=16..324 恒定;tools 网格 2 列 52px 行恒定;设置卡片 1280 下左右各 151px 居中 ✓。≤1180 时 workspace 面板从右列改为叠在 main 下、768/1024 的 workspace-view 隐藏聊天(`PiWebApp.ts:156-167`)——设计如此,非回归。

## G. workspace 面板列内节奏(桌面 1280)= TRUE(次要)

同一 409.6px 宽面板列内实测四种边缘步:**0**(顶条 "Expand panel" 按钮盒 x=870.4 == 面板缘,`shared.ts:165` 无内距)、**8**(`.toolbar` padding space-4,`shared.ts:180`)、**6**(`.list` padding space-3,`shared.ts:188`)、**12**(tasks 插件空态框,x=882.4,`tasksPanelElement.ts:302` padding space-6)。Files→Tasks 切换时内容左缘 876.4↔882.4 跳 6px。截图:`/tmp/rounda/desktop-1280-tasks-view.png`。

## H. 手机 context sheet 标题节奏 = TRUE

393 宽 sheet 内三个兄弟分区的 h2 margin-bottom 实测:**Machines 8px / Projects 4px / Workspaces 8px**(heading→内容间距同值)。机制:词-only 标题命中 `h2:has(> span:only-child) { margin: var(--pi-list-word-heading-margin, 0) }`(`shared.ts:289`,特异 (0,1,2)),而 `.sheet-body { --pi-list-word-heading-margin: 0 0 var(--pi-space-4) }`(`ContextSwitcherSheet.ts:93`)把它顶回 8px,压过 ≤760 的手机节奏 4px(`shared.ts:285` 附近)——同屏两套节奏,正是 spacing 测试注释里写的"两个兄弟行呼吸不同"模式。截图:`/tmp/rounda/phone-393-context-sheet.png`。

## I. 设置对话框(桌面 1280)= TRUE(次要)

- "Reload"(secondary)border `#292f38` on `#13161b` = 1.35:1,边界不可见(同 E1);
- 表单主按钮 "Save gateway server config" y=972、"Save file/upload config" y=1623——**都在 850 高视口的折叠线以下**,保存动作需要滚动才可见(表单滚动容器内,属设计取舍但值得知道);
- 按钮高度三种并存:导航项 52.5–67.5(内容驱动)、表单按钮 32、关闭 × 36——同对话框内 32 与 36 两个"小按钮"标准。
- CLEAN:对话框卡片居中(左 151/右 151),选中导航项边界清晰(accent 边+选底)。

---

## 干净项清单(实测证明)

1. 主区无会话空态水平+垂直居中(241.3/241.3;362.75/362.75)。
2. `.empty-session` 水平居中(手机/桌面均过列中心)。
3. Sessions 工具栏右缘与行右缘逐像素对齐(桌面 324=324;手机 383=383)。
4. 会话行节奏均匀:58px 高、6/6 margin(行距 12px)、左右缘一致。
5. tools 网格:tile 等宽等高(桌面 150×52,手机 182.5×52),gap 8,与 section 内距对齐;手机底缘 10px 收边。
6. 手机两处搜索框当前均 44px(session/project 一致——旧产物中曾测得 36 vs 44 的漂移,当前已一致)。
7. 项目 tile 网格同行等高;上下文 chips 行 segmented 形态一致。
8. 各标题(会话标题/PI WEB/compact scope)在各自 44px 行内垂直居中。

## 修复优先级建议(按投诉对应)

1. **C1(对齐,投诉 1+2 的根)**:让 `--pi-chrome-inset` 与正文内距建立倍率关系(如 6/12/16 统一为"表头==正文"或恒定 4px 差),一改全列受益;这是三处错位(6/11/16、6/10、347/357)的共同根。
2. **A1(投诉 4 残留)**:折叠按钮 44px 在 44px 表头中 → 控件 40px 或表头 48px,给上下各留 2px;同时检查 `.compact-actions-row` 同款。
3. **E1(投诉 3)**:把 ghost 按钮的可见性做成系统决策——要么 `--pi-border` 提到 ≥3:1,要么 ghost 态给固定底(`--pi-surface-card`),二选一,别让"Clean up"与"Reload"各自悬空。
4. **D1(NEW)**:为"空态"定一条契约(建议:聊天空态因 composer 锚定可保留顶部,但把 24px 提到与下方留白成比例;插件空态并入共享 `.empty-state` 居中式,删除 tasksPanel/relaysPanel 的私有副本)。
5. **H1/G1(次要)**:sheet 的 `--pi-list-word-heading-margin` 改为引用手机节奏(space-2);workspace 面板 0/6/8/12 收敛为 0/8 或 8/12。
