# Round D · Lane B — 桌面 1280 + 断点 393/768/1024/1280 复核报告

- 栈:http://localhost:8505/(未重启、未改仓库;探针与截图均在 /tmp/roundd*.png、/tmp/roundd/)。
- 方法:Playwright 真浏览器,shadow DOM 逐层 pierce;所有间距/对齐/颜色读 computed style、boundingRect、CSSOM,按压态用"按住不放 + 读 computed"实测,不做目测。
- 断点机制(`src/client/src/breakpoints.ts:17-36`):≤430 phone tokens、≤640 chat 收紧、≤760 mobile-nav、≥1181 side-by-side;coarse 指针在任意宽度走 phone 行为(`COARSE_OR_MOBILE_MEDIA_QUERY`)。本轮 393/768 用 isMobile+hasTouch(coarse),1024/1280 用 fine——768-coarse 是 760 线上的真实用户形状(触屏笔记本/平板)。
- 重要运行事实:**本栈的 web/API 与 sessiond 跑的是编译产物**(`node dist/server/index.js`、`node dist/server/sessiond.js`),客户端走 Vite 源码;**`dist/pi-web-plugins/` 构建于 Sep 11 09:32,而修复提交 dc41e086 是 09:37——插件面向读者的是修复前的旧 CSS**(当前无 `build-plugins --watch` 进程在跑)。

---

## 一、Round C(dc41e086)修复逐项核验:7 项中 4 项到达读者、3 项未到达

| # | Round C 声称 | 实测 | 判定 |
|---|---|---|---|
| 1 | 空会话空态 box-sizing + 居中 | 见 §一.1:四宽全部 `border-box`、`scrollHeight==clientHeight`、scrollTop 0 | ✅ 到达 |
| 2 | tasks viewer 空态居中(align-content stretch) | 见 D1:源码已改,**live 面向读者的仍是 start,空态贴顶 12/671.3** | ❌ 未送达 |
| 3 | 消息头分隔线改实色 | 六角色块 + group-msg 全部 `1px solid var(--pi-border-muted)`(CSSOM + live computed `rgb(38,44,53)`);**但漏了第 7 个生产者,见 D4** | ✅ 到达(带漏网) |
| 4 | compact 按压态解除嵌套 | `AppNavigationPanel.ts:466` 顶层规则,CSSOM 无 `&` 前缀;scope/session/fold/Settings/Actions 按住实测全部 `rgb(27,32,39)`=surface-hover | ✅ 到达 |
| 5 | session-row / drawer-control / goals-refresh / palette 按压态 | session-row ✅(§一.2);**drawer-control、goals-refresh、palette 三个全是死规则,见 D2** | **¼ 到达** |
| 6 | context-bar 呼吸(padding-block 2px) | 已送达(pad `2px 6px`、h=49);**但姊妹栏未跟上,顶部标尺错位 4px,见 D3** | ✅ 到达(带回归) |
| 7 | contributed-sections 内缩 | wrapper 存在,`padding-inline: 16px` = 桌面 `--pi-reading-edge`,与 sessions h2 文字 x=16 对齐(§一.3) | ✅ 到达 |

### 一.1 空会话空态(修复 #1)——四宽全部实测通过
`src/client/src/components/ChatView.ts:368`(`box-sizing: border-box; min-height: 100%`)→ `.chat`(`src/client/src/components/ChatView.ts:206`,padding `24px / gutter / 16px`)。
- 393:`scrollH 565 == clientH 565,scrollTop 0`(Round C 时 601/569/**32** 假滚动);空盒 gapTop 24 / gapBottom 16;内容块在自身盒内居中偏差 **±0.5px**(内容中心 262.9 vs 盒中心 262.4),相对视口中心 +4.0px——来源是 `.chat` 设计的 24/16 非对称 padding,四宽恒定,不随断点跳变。截图 `/tmp/roundd-phone-newsession-final.png`。
- 768:602/602/0;1024:610/610/0;1280:610/610/0;blockOffset 全部 **+4.0**。无断点跳变。截图 `/tmp/roundd-sweep4-768.png`、`/tmp/roundd-sweep4-1024.png`、`/tmp/roundd-d1280-newsession.png`。
- **判定 TRUE(修复到达读者,四宽一致)。**

### 一.2 session-row 按压态(修复 #5 的一部分)——到达
`src/client/src/components/SessionList.ts:818`(顶层 `@media (pointer: coarse)`,`.action-main:active` 并入既有组)。手机 393 实测(经 scope sheet 选 project "test" 进入 sessions 视图,`<session-list>` 显示):按住行 → `active:true`、bg **rgb(27,32,39)** = `--pi-surface-hover`。对比:project-list 同类行按住 bg `rgba(0,0,0,0)`(见 §三.4)。截图 `/tmp/roundd-phone-press-session-row.png`、`/tmp/roundd-phone-press-project-row.png`。

### 一.3 contributed-sections 内缩(修复 #7)——结构性到达
`src/client/src/components/appShell/AppNavigationPanel.ts:440`(`.contributed-sections { padding-inline: var(--pi-reading-edge); }`)。桌面 1280 sessions 视图:wrapper x=0、w=340、**padding-inline 16px** = h2 文字 x=16——对齐成立。goals 区块当前无聚焦 goal → `available()` false → 无子行可量(诚实说明:行级对齐未直接观测;phone 端同一规则走 `--pi-reading-edge`=10 自动成立)。截图 `/tmp/roundd-d1280-contrib.png`。

---

## 二、新 TRUE 发现(4 项,均在 owner-deferred 台账之外)

### D1 · tasks 空态居中修复未送达:dist 产物早于修复提交 5 分钟,live 仍是 `align-content: start` —— TRUE
- **归属**:源码 `pi-web-plugins/workspace-tasks/tasksPanelElement.ts:288` 已是 `align-content: stretch`(正确);但**面向读者的是 `dist/pi-web-plugins/workspace-tasks/tasksPanelElement.js`,其内联 CSS 仍是 `align-content: start`**,文件 mtime **Sep 11 09:32:07**,提交 dc41e086 为 **Sep 11 09:37**——修复提交后从未重建。live 栈由 `dist/server/index.js` 提供 `/pi-web-plugins/*` 静态件,manifest 以 `?v=sha256:…` 引用旧产物。
- **实测(1280,live)**:viewer computed `display: grid; align-content: start`;`.empty-state` gapTop **12** / gapBottom **671.3**(贴顶)。同面板同款虚线空态的 Relays:`align-content: stretch`,gapTop **341.6** = gapBottom **341.6**,完美居中——兄弟 tab 一居中一贴顶,Tasks↔Relays 切换跳变依旧。
- **机制证明(页内临时注入 `!important` 覆盖为 stretch,不落盘)**:gap 立即变为 **341.6 / 341.6**——源码修复机制正确,**唯一缺口是送达**。
- **对比面**:`.tasks-viewer` 空态 vs 同面板 `.viewer`(Relays)空态;以及 dist 产物 vs 源码。
- **截图**:`/tmp/roundd-d1280-tasks.png`(贴顶)vs `/tmp/roundd-d1280-relays.png`(居中)。
- **修复方向**:重跑 `npm run build:plugins`(或按 `docs/install.html` 的归属规则重启相应服务);无需改源码。

### D2 · 按压态"最后一族"四个生产者里三个是死 CSS:与同提交刚修好的 T3 同一种嵌套错误 —— TRUE
- **归属(源码 + live CSSOM 双证)**:
  - `src/client/src/components/ChatView.ts:176-177`:`.drawer-control:active` 嵌在 `.drawer-control:focus-visible { … }` 声明块内 → 浏览器按 CSS Nesting 反解为 `& .drawer-control:active`(后代组合器;CSSOM 链:`.drawer-control:focus-visible > @media(coarse) > "& .drawer-control:active"`),同一元素不可能是自己的后代 → 永不匹配。live:按住 `.drawer-control.drawer-collapse` → `active:true`、bg **rgba(0,0,0,0)**。
  - `pi-web-plugins/goals/goalsSectionElement.ts:23`:`.refresh:active` 嵌在 `.refresh { … }` 块内(且在 media 内)→ 反解为 `.refresh .refresh:active` → 永不匹配。live:按住 goals 区块 `.refresh` → `active:true`、bg transparent。**第二层**:该插件同样被 D1 的陈旧 dist 挡住——`dist/pi-web-plugins/goals/goalsSectionElement.js`(09:32)里**根本没有任何 `.refresh:active`**,即当前读者连"死规则"都没有。
  - `src/client/src/components/ActionPalette.ts:109`:`button:active` 嵌在 `button { … }` 块内 → `& button:active` = `button button:active`;HTML 解析器禁止 button 嵌 button → 永不匹配(CSSOM 链:`adopted > button > @media(coarse) > "& button:active"`;实测 `el.matches('button button:active')` = false,按住选中项 bg 保持自身 selection 底不变)。
- **对比面**:同一提交里 compact 家族(T3 修复)恰恰是把 `@media` 从声明块里**搬出来**修好的——同波次又在三个文件里把 `:active` 嵌回声明块。session-row(顶层写法)是四者中唯一活的。
- **后果**:手机端聊天工具抽屉的折叠钮、goals 刷新钮、命令面板所有选项按钮在 coarse 指针下无按压反馈;提交信息声称 "session rows, drawer control, goals refresh, action palette join the fold",四分之三未兑现。
- **截图**:`/tmp/roundd-phone-press-drawercontrol.png`、`/tmp/roundd-phone-press-goals-refresh.png`、`/tmp/roundd-phone-press-palette-option.png`、`/tmp/roundd-phone-press-palette-option2.png`、`/tmp/roundd-phone-press-fold-clean.png`(fold 活,对照组)。
- **修复方向**:三处照 `AppNavigationPanel.ts:466` 的样子把 `@media (pointer: coarse) { …:active { … } }` 提为样式表顶层规则;goals 还需先过 D1 的重建。

### D3 · context-bar 拿到 2px 呼吸后,一柱之隔的 rail header 没跟上:两栏顶部标尺错位 4px,且行内注释仍声称"同高" —— TRUE
- **归属**:`src/client/src/components/appShell/AppContextBar.ts:71-72` — 注释原文:"The rail header and this bar sit either side of one vertical divider, so they share a height: 44px of control plus the 1px rule, measured 45 on the rail and 53 here before the padding was taken out of the equation." 该注释同时写着 `padding: var(--pi-space-1) var(--pi-chrome-inset)`(`:72`)——dc41e086 把垂直 padding 加了回来,却没更新这条"同高"不变量,也没同步姊妹栏。
- **实测(1280,fine;1024 同值)**:rail header(`app-navigation-panel>header`,padding `0px 16px`)h=**45**,下缘标尺 y=**45**;context-bar(padding `2px 6px`)h=**49**,下缘标尺 y=**49**;两栏分界线 x=340,**两条 1px 横标尺在 T 交点错开 4.0px**(3× 放大截图可辨)。栏内按钮呼吸也不一致:context-bar 的 ☰ 上下各 2px,rail header 的齿轮/Actions 上下 **0px**(y=0,h=44)。
- **对比面**:`app-navigation-panel>header` vs `app-context-bar .context-bar`(代码自己声明的"一柱两侧"配对)。
- **判定说明**:给 context-bar 2px 是 Round C lane C 明示的两个许可选项之一("…or the next wave grants the context-bar the compact-header's 2px")——呼吸本身 owner 已准;**但授予后的跨栏 4px 错位与注释失实是本轮新产生的、未被记录的后果**(同"只修一个生产者、姊妹未跟"的既有事故模式)。
- **截图**:`/tmp/roundd-d1280-junction-zoom.png`(3× 交点特写)、`/tmp/roundd-d1280-initial.png`。
- **修复方向**:rail header 加同款 `padding: var(--pi-space-1) …`(两栏同回 49),或明确放弃同高并改写注释——产品取舍归 owner。

### D4 · 实色分隔线波次漏了第 7 个生产者:`.msg.user.queued > .msg-header` 仍带 35% alpha —— TRUE
- **归属**:`src/client/src/components/ChatView.ts:289` — `.msg.user.queued > .msg-header { border-bottom-color: color-mix(in srgb, var(--pi-warning-border) 35%, transparent); … }`。本轮修复把六个角色块 + group-msg + ask-user 卡全部改成实色 `var(--pi-border-muted)`(CSSOM 全量核对无误),唯独排队消息(q user.queued)这个变体没进枚举——正是"同一症状第二次出现前先枚举全部生产者"规则要拦的漏网。
- **实测(1280,探针节点注入 chat 后读 computed)**:分隔线合成色 `(58.7, 45.6, 10.4)` 于 warning-surface 底 `(31, 26, 16)` → 对比 **1.3:1**;同族七块现均为实色 `rgb(38,44,53)`。排队中的消息一出现,其头部就是全家唯一的 alpha 分隔线。
- **对比面**:`.msg.user.queued > .msg-header` vs `.msg.user > .msg-header`(`:381`,同为 user 语境,实色)。
- **截图**:队列态无 live 实例(不留扰动活会话),以探针节点 computed 值为准;全家实测见 `/tmp/roundd-d1280-piweb-transcript.png`。
- **修复方向**:一行——`:289` 改实色(保持或去掉 warning 色相由 owner 定,但要去 alpha)。

---

## 三、猎点清单(四项 owner 抱怨 + New session)——干净项附证明数字

1. **对齐(owner #1)**:栏内一致。桌面 rail:h2 文字 x=16,contributed wrapper 内容 x=16,行盒 x=19、行文字 x=29——行相对标题 +13px(3px 列表内缩 + 10px 行内边距),**手机同构(10→23,同样 +13)**,两个平台同一系统,非漂移。跨栏顶部标尺错位是唯一新 TRUE(见 D3);nav-10/chat-6/desktop-16 的横向 inset 差异维持台账 deferred。**FALSE(clean,除 D3)。**
2. **留白节奏(owner #2)**:sessions 标题行三段间距——393(coarse):25.9/25.9/25.9 均匀(台账 deferred 的 touch-density 决定,数值未变);**768-coarse(全宽 736px 行):146.9/146.9/146.9——同一 space-between 生产者随宽度放大 5.6×,仍均匀**,归台账同族(重新定量,非新缺陷);1024/1280(340px aside):9.6/9.5/9.6 均匀。空态垂直节奏:四宽 gapTop 24/gapBottom 16 恒定、内容居中偏差恒 +4(§一.1)。**FALSE(deferred 家族,重新定量;无新增)。**
3. **按钮边界(owner #3)**:全量扫描(手机 base、手机 scope sheet、桌面 base、桌面开聊天、Tasks 面板;口径:border 合成色与自身填充对"身后有效底色"同时 <1.2:1 才算不可见):**命中 0**(桌面 base 39 颗按钮、其余各面亦 0)。`+ New session` 主 CTA 为 accent 填充(故意的 7.7:1);设置 nav 行为列表式导航(既有设计)。**无新 TRUE,无回归。**
4. **折叠钮(owner #4)**:手机 compact fold:y=**2**、h=44(下缘 46),header 高 49 → 下缘距 1px 标尺 **3px**,上缘 2px,radius **2px**(方),图标 8×8——与 Round A 已决的 2/3px 一致。**FALSE(clean,标准在位)。**
5. **New session 面(本轮新增关注)**:标题/空态居中见 §一.1(四宽通过);QS 创建 tile("+ New session / Select a workspace first")文案居中(``/tmp/roundd-phone-qs.png``);手机 QS 会话 tile 双列 182.5px 网格整齐(`/tmp/roundd-phone-step-qs.png`);桌面裸主区空态("Select a project and workspace to start a session.")盒中心 (810, 450) 对主区中心 (810, 449.5) 居中。断点间无未声明的尺寸/位置跳变(唯一宽度变化是 `.chat` 高度本身的 reflow)。**FALSE(clean)。**

---

## 四、台账对账(owner-deferred 项,重新定量,数值未变或归族)

- 手机标题节奏 25.9 vs 桌面 9.6 —— 未变(deferred);**新增同族定量:768-coarse 全宽 146.9×3(同生产者,宽度放大)**,建议台账并记。
- 栏内边距系统 nav 10 / chat 6 / desktop 16 —— 未变(deferred)。
- Settings 缩进 13px、设置对话框标题边、Save 折叠下、workspace panel 四左缘(1280 截图中 "Expand panel" 仍贴顶 x≈870,y≈0)、三个创建按钮表单、pill 徽标 —— 未动,deferred 仍准确。
- Round C lane C §5 的"context-bar ☰ 贴边"——本轮被授予 2px 后消解;其后果升级为 D3。

## 五、结论

**4 项新 TRUE(D1–D4),超出"零新发现"门槛。** 性质分布:D1 是交付缺口(构建产物陈旧,源码正确);D2 是修复波次自身的 CSS 嵌套错误 ×3(与同提交修好的 T3 同形)+ 一处叠加交付缺口;D3 是许可的修复的未同步后果(含行内不变量注释失实);D4 是既定不变量的漏网生产者。四处修复都在 1–5 行内,收敛在望;D1 需要一次 `build:plugins`(涉及服务归属,按 `docs/install.html` 由 owner 决定重启方式)。

**探针留痕**:未重启栈、未改仓库文件;在 pi-web 项目创建过 2 个空会话(已被应用自身的 0 消息清理回收,现列表无残留);打开过 "hu"(其 Extension 更新提问未代答)、"pi web"(45111 条,live 运行中,未发送任何消息、未答任何问题)。
