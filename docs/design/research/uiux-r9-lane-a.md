# UIUX 收敛审计 · 第九轮 · Lane A（应用外壳与 chrome 几何）

范围：appShell（AppContextBar / AppContextSwitcher / AppNavigationPanel / AppPanelEdgeControl / AppRefreshControl / ContextSwitcherSheet）、SessionList、StatusBar、ChatView、shared.ts、index.html token 块。焦点面：boot、sessions、chat、chat-drawer、context-sheet。

方法：逐行读源码 + 按 content-box 默认值做盒算术（已验证全仓库无全局 box-sizing 重置，唯一一处是 SessionTreeNavigator.ts:526 自己 shadow 内的 `* { box-sizing: border-box }`）。boxModelGuard（boxModelGuard.test.ts:23-24）只在同一条规则内同时出现 width+height+可见 border 时才要求 box-sizing，因此所有「只有 min-height + padding」的规则都不在护栏内——本轮多条发现正是从这个缝隙漏出来的。所有行号均已核对。

---

## F1 常驻条在「工作中」状态下长高 8px，破坏 45px chrome 对齐
- file:line: src/client/src/components/appShell/AppContextBar.ts:87（`.working { ... min-height: var(--pi-control-height-touch); padding: var(--pi-space-2) var(--pi-space-3); }`，无 box-sizing）；对照 :79（`.session-title` 显式 border-box，44）、:75（`.panel-toggle` 显式 border-box，44）、:73（`.context-bar` min-height `--pi-panel-header-height`=44 + 1px border）
- surface: chat（resident bar，桌面与手机同源）
- finding: `.working` 是 span，默认 content-box：min-height 44 约束的是内容盒，加上下 padding 各 4px，外高 52px。`.context-bar` 是 align-items:center 的 flex 行，高度被最高子项撑到 52 + 1px border = 53px；静止时最高子项是 44px 的 border-box 兄弟，行高 45px。token 声明读的是 44，画出来的是 52——正是第六/八轮修掉的「53 vs 45」从另一扇门回来。AppContextBar.test.ts:62 只断言了声明存在（`min-height: var(--pi-control-height-touch)`），没有断言画出的高度。
- minimal failure scenario: 打开一个会话 → agent 开始流式输出 → 三点指示器渲染，常驻条从 45 跳到 53，对面 45px 的 rail header 底边错位 8px，整个聊天列（drawer、transcript、composer）随之下移 8px；工作结束再跳回来。每次工作状态切换都是一次 8px 布局跳动。
- confidence: high（盒算术确定；兄弟控件在同一行内一边显式 border-box 一边漏，可对照）

## F2 sessions 标题工具栏三个兄弟控件高度不等（Clean up 比邻居高 12px）
- file:line: src/client/src/components/SessionList.ts:692（`.cleanup-entry { ... min-height: var(--pi-control-height); padding: var(--pi-space-3) var(--pi-space-4); ... border: 0; ... }`，无 box-sizing）；粗指针覆盖 :784；对照 :686 `.bulk-select-entry`、:687 `.start-session-button`（均显式 `box-sizing: border-box; height: var(--pi-control-height)`）；行高 :678 `h2 { min-height: var(--pi-control-height) }`
- surface: sessions（桌面 rail 与手机面板共用同一个标题工具栏）
- finding: Clean up 无 box-sizing → content-box 下外高 = 32 + 6 + 6 = 44px（鼠标）/ 44 + 6 + 6 = 56px（粗指针）；同行的 ☑ 与 New session 显式 border-box，恒为 32 / 44。h2 行被最高子项撑到 44 / 56，token 声明的 control-height 不是画出的高度。同文件里相邻的 `.section-add`（shared.ts）与两个兄弟都写了 box-sizing，唯独 cleanup-entry 漏了。
- minimal failure scenario: 鼠标用户看 rail 的 Sessions 标题行：Clean up 的上下边缘各超出 New session 6px，标题行 44px 高而非声明的 32；手机上同样的行里 Clean up 56px、New session 44px。SessionList.actionWeight.test.ts:18-27 记录的原始抱怨是「三个控件只有宽度不同」，现在变成高度不同。
- confidence: high

## F3 同一根因的家族：min-height + content-box 把「按钮地板」画得比 token 高 4–18px
- file:line:
  - src/client/src/components/PiWebApp.ts:195（`.empty button`：min-height touch 44 + padding 8/8 + border 2 → 画出 62px；boot/空会话页唯一的主按钮）
  - src/client/src/components/ChatView.ts:364（`.empty-session button`：44 + 12 + 2 → 58px）
  - src/client/src/components/ChatView.ts:320 + 粗指针 :341（`.history-load-button`：鼠标 32+12+2=46，触屏 44+12+2=58）
  - src/client/src/components/ChatView.ts:337 + :340（`.queued-clear-button`：32+4=36 / 44+4=48）
  - src/client/src/components/PiWebApp.ts:209 + :208（`.self-update-banner button`：32+4+2=38 / 44+4+2=50；:207 注释明说这行要和 44px 的 transcript 控件同列，实际画出 50）
  - src/client/src/components/SessionList.ts:704 + :786（`.bulk-row button`：32+12+2=46 / 44+12+2=58）
- surface: boot（.empty）、chat（历史边界、queued 条、空会话）、sessions（bulk 工具条）
- finding: 这些规则都只声明 min-height（无 width 或无可见 border 的组合），boxModelGuard 按构造放过它们；content-box 把 padding/border 加在 token 之外，声明的 `--pi-control-height(-touch)` 都不是画出的高度。第六轮「load-earlier / empty-transcript 达到地板」实际是超出地板 14px，第三轮「clear-queue pill 达到 control height」实际画出 36/48。
- minimal failure scenario: 手机 393x850 上点开空会话：「Load earlier messages」画出 58px 高，旁边的 drawer-tab 44px、queued-strip 里 Clear queue 48px——同屏三种「44px 意图」画出三种高度。
- confidence: high（算术唯一不确定项是 UA 默认垂直居中，不影响外高）

## F4 context sheet 的粘性标题引用已被删除的 token `--pi-bg-raised`，并让列表从两侧 8px 缝隙里滑过
- file:line: src/client/src/components/appShell/ContextSwitcherSheet.ts:85（`background: var(--pi-bg-raised, var(--pi-surface))`）；`.sheet { padding: var(--pi-space-4) }` :79；ModalSurface.ts:177（section `background: var(--pi-bg)`、radius-lg、overflow:hidden）；token 定义核对：`--pi-bg-raised` 在 src/client/src 与 pi-web-plugins 中零定义，存在的阶梯 token 拼写是 `--pi-surface-raised`（index.html 语义阶梯 canvas<panel<card<raised）
- surface: context-sheet
- finding: 两点。① 第八轮刚修的粘性标题用了第二轮已宣布「replaced」的 token 名，靠 fallback 落到 `--pi-surface`(#161b22)，贴在 `--pi-bg`(#0d1117) 的模态上——静止时就是一条更亮的横带，且它想要的「raised」阶梯 token 其实拼写不同，引用是哑的。② 标题 sticky top:0，粘在 scrollport 顶，盖掉上 padding，但 `.sheet` 左右各 8px padding 不在粘性元素的横向 containing block 内——滚动时列表行沿标题两侧的两条 8px 竖缝持续滑过，粘性标题两侧漏内容。
- minimal failure scenario: 手机打开 Change context，向下滚动 projects 列表：标题带以上没有缝，但标题左右各有一条 8px 宽的字缝在动，标题带本身的颜色又和它底下的 sheet 不同——读起来像贴错了位置的 bar。
- confidence: token/颜色事实 high；侧缝与色带严重度 medium（几何推导自 sticky-in-padded-scroller 规则，未在真机测量）

## F5 chat-drawer 手机粘性标题丢了自身抽屉的紫色调，形成色缝
- file:line: src/client/src/components/ChatView.ts:131（`@media (max-width: 640px)` 内 `.top-drawer:not(.collapsed) .drawer-header { position: sticky; top: 0; ... background: var(--pi-bg); }`）对照 :118（`.top-drawer { background: color-mix(in srgb, var(--pi-purple) 7%, var(--pi-bg)); }`）
- surface: chat-drawer
- finding: 抽屉整体是 7% 紫调的底，粘性标题却涂纯 `--pi-bg`。抽屉 body 一旦滚动，标题带与它下面的抽屉底色在一条直线上相接，紫色在标题边缘被一条直线切断——同一表面两个颜色。
- minimal failure scenario: 手机展开 session sections（goals/terminal），滚动 goal 列表：header 下方出现一条横贯全宽的色缝，标题带比它所在的抽屉「浅」一档。
- confidence: medium（7% 混色差异细微，但两色确不相等且直接相接）

## F6 手机面板 tools 网格的水平内缩 8px，与紧邻上方的列表 10px 差 2px
- file:line: src/client/src/components/appShell/AppNavigationPanel.ts:473（`.tools-section { ... padding: var(--pi-space-5) var(--pi-space-4) ... }`，水平 8px）对照 src/client/src/components/shared.ts:275（`section { ... padding: var(--pi-space-5); }`，10px；760px 以下只改 padding-top，水平仍 10）
- surface: sessions（手机 compact 面板：工具卡片网格紧跟会话列表之下）
- finding: 同一面板列里上下相邻的两个带边框面：会话行的左边框落在 x=10，工具卡片的左边框落在 x=8，两条竖边差 2px，不共线。
- minimal failure scenario: 393x850 的手机面板里，sessions 列表最后一行与 tools 区第一张卡上下相接，左边缘错开 2px，肉眼可辨为「没对齐」而非有意阶梯。
- confidence: 事实 high；严重度 low

## F7 折叠状态在列表标题里由裸文字箭头承载，而 chrome 的同一动词用 SVG chevron
- file:line: src/client/src/components/SessionList.ts:273（collapsed 状态写成文字 ▸/▾ 拼在 Sessions 前）、:321（Archived 同款）、:467（`.subtree-chevron` 文字 ▾ 靠 transform 旋转）；对照 src/client/src/components/ChatView.ts:448-451（drawer 折叠用 SVG 路径）与 AppPanelEdgeControl.ts 的 SVG chevron
- surface: sessions（含 chat-drawer 同屏对照）
- finding: 「展开/收起」这一个动词在抽屉里是几何 SVG chevron，在列表标题里是字体字形 ▸/▾：同一屏两种 mark；字形的光学中心随字体 fallback 漂移，且 ▸/▾ 与 SVG chevron 的线宽、大小不共享任何 scale。
- minimal failure scenario: 手机面板中 Sessions 标题（文字 ▾）与 chat 抽屉折叠钮（SVG chevron）同屏，两个「同一动作」的符号形状与线重不同。
- confidence: medium-low（模式判断，无功能失效）

---

已核对且干净（不计入发现）：AppContextSwitcher 的 seg/chip/add 几何（44px seg、add 沿 stretch 居中）；SessionList 粗指针下 checkbox 与 subtree-toggle 的同心公式（SessionList.ts:751-753，中心均为 24）；AppNavigationPanel 桌面 header / compact header 与 resident bar 的 45px 对齐；`--pi-header-control-radius` 通道（compact-header 设定 → AppRefreshControl 读取）成立；三份 count badge（drawer-tab-badge / section-unread-count / tool-badge）度量一致（14/16/2xs）；delivery-mark 四个 tone 的对比度均 ≥4.5:1；`.msg > .msg-header` 负 margin 粘顶与卡片圆弧由 overflow:clip 单点光栅化；StatusBar 的 `.activity/.dot` 为死样式（不可见缺陷，未计入）。

TOTAL: 7 findings
