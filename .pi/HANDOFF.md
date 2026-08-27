# 交接:五件未完成的工作

当前已发布 `1.202608.42`,本机四元一致。工作区干净。

## 铁律(违反过,代价很大)

- **先复现再改**。今天两次凭想象写匹配模式,都白改;测试用例必须**从实际发出的字符串抄**,不能自己编。
- **写文件前先查是否已存在**。今天用 `Write` 覆盖过已有模块并删掉它的 26 条测试。
- **测试绿 ≠ 功能对**。每条修复要么红→绿,要么做**变异检验**(把实现改坏,确认测试变红)。
- **tsc/lint 才是真检验**。今天 4 次测试全绿而 tsc 抓出错误(字段名、返回值形状、索引签名、`exactOptionalPropertyTypes`)。
- **禁 `as` 类型断言**(lint 拦);圆角等必须取自设计尺度(`--pi-radius-*`),写死数值会被 `designTokens.test.ts` 拦。
- **verify 跑动时不要改仓库**。今天并发过一次,产生了假失败。
- **浏览器验证脚本必须拒绝空过**:若被测对象根本不满足前提(如转录不滚动),要判 FAIL 而不是静默通过。
- 每条修复**单独提交**,提交信息写"为什么",不写"做了什么"。

## 环境

- 预览实例 **8505**(服务 `dist/`,改样式后须 `npm run build`);**8504 是生产,别动**。
- 验证:`npm run verify`(用 `bg_run` 跑)。构建:`npm run build`。
- Playwright 可执行档:`$HOME/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,脚本必须放在项目内才能解析依赖,导入用 `@playwright/test`(不是 `playwright`,knip 会拦)。
- 桌面端快速切换面板用 **⌘P** 打开(`Meta+p`);窄屏走头部按钮。
- 发版:改 `.changeset/` → `npx changeset version` → 提交 → `git tag` → `gh release create` → **先取本次 run id 再 watch**(取"最近一次 run"会 watch 到上一轮,假成功)。禁本地 `npm publish`。
- 更新本机:`~/nix-config/scripts/pi-web-update.sh --force astra-mbp`(**必须带 flake-id**,漏了会静默退出且返回 0)。

---

## 1. 后台运行的会话在列表里显灰(应为紫)

**现象**:某会话的轮次已结束但仍有后台运行,对话内显示紫色 `idle · 1 background run`,而会话列表显示**灰点**(idle)。

**根因**(已查实):列表侧只有 `SessionStatus`(流式/bash/压缩/排队)与 `SessionActivity`(`phase: active|idle|error`),**都不含后台运行**。轮次结束后 `phase` → `idle`,`sessionActivityCategory` 走到最后一行 `return "idle"`。

**关键文件**
- `src/shared/sessionActivityState.ts:22` `sessionActivityCategory`
- `src/shared/apiTypes.ts:782` `SessionActivity`
- `src/server/sessions/piSessionService.ts:4279` `publishActivity`
- `src/client/src/quickSwitcher.ts:236` `quickSwitcherSessionStates`
- `src/client/src/components/ChatView.ts:2331` `backgroundWorkLabel`(对话里紫色标签的算法,照它对齐)
- 徽章种类:`src/client/src/components/activityBadge.ts`;样式:`sessionStateBadgeStyles.ts`

**做法**:服务端透出每会话"后台运行数" → 共享类型加字段 → `SessionActivityCategory` 增加一档 `"background"`,排在 `idle` 之前,配**紫色空心**。

**不要**把它报成 `working`(实心紫):轮次其实已经结束,谎称在工作会让人以为还能等它自己往下走。

**服务端改动,发布后需重启 sessiond。**

---

## 2. 快速搜索面板重做

**四个抱怨同一个根**(已查实,`PiWebApp.ts:1915` `loadQuickSwitcherData`):

```
projects(machineId)              ← 只取当前机器
  → workspaces(project)   每个项目一次
    → sessions(workspace) 每个工作区一次
```

| 抱怨 | 成因 |
|---|---|
| 最近的 session 搜不到 | 只加载**当前机器**;别的机器上的不在候选集里 |
| 刷新很慢 | N+1 请求串行 |
| 选项老变 | 筛选码从**已加载数据**推出,数据边加载边变 |
| 切项目页面不一样 | 同上;且筛选作用域与列表作用域不一致(截图里 `No sessions yet.` 却列出一堆 WORKSPACES) |

**要做**
- 跨机器加载
- 服务端一次返回,取代 N+1
- 筛选码用**固定来源**(机器/项目登记表),不从已加载数据推
- 加"最近/常用"分组置顶 —— 现在**完全没有**最近/常用的概念,只有按 `modified` 排序的全量列表

**已完成、不要推翻的**:磁贴布局(`QuickSwitcher.ts`)——基础 `minmax(240px, 1fr)` 保证桌面可读,`@media (max-width: 420px)` 降到 `140px` 并给标题两行;菜单钮一律叠在磁贴角上。验证脚本 `scripts/verify-session-tiles.mjs`(320/390/1440 三档)。

---

## 3. 终端双滚动条

**内层已定位**:`src/client/src/components/TerminalPanel.ts:732`

```css
.terminal-host .xterm-viewport { overflow-y: scroll; }
```

`scroll` 是**常显**,终端里只有提示符也画满整条轨道。

**外层未复现** —— 预览实例里终端总被切换面板盖住,量不到。

**风险**:xterm 用 `scroll` 是为了**宽度稳定**,改 `auto` 后滚动条随内容进出会改变视口宽度,可能触发反复重排。**先复现再改**。

---

## 4. 更新时杀会话的剩余路径(在 nix-config)

**已修的**:`pi-web restart`(CLI 发起)。`.40` 起改用 `launchctl kickstart -k`,launchd 自己完成停+启,调用方死不死都不影响。见 `src/nativeServices/serviceAction.ts` `restartsInPlace` / `launchdRestartInPlaceArgs`,宿主判定 `serviceEnvironment.ts` `hostingServiceId`(读 `PI_WEB_SESSION`)。

**未修的**:home-manager 激活时**自己重载 plist**(`~/nix-config/home/tools/pi-web.nix` 的 `piWebLaunchd` 激活块),根本不经过 pi-web 代码。`.42` 更新时又挂一次就是这条。

**做法**:激活块里检测 `PI_WEB_SESSION`,跳过重载,或改用 `launchctl kickstart -k`。

**注意**:`nix-config` 里有 sops 加密密钥,**任何 secret 都不得进 pi\* 仓库**。

---

## 5. 新需求:设置里加前端缩放滑条

用户反映 UI 忽然变大。已核实 `.41→.42` **没有任何字号/缩放改动**(`git diff` 命中 0),所以那次变大不是 pi-web 造成的(疑为浏览器缩放或系统显示尺寸)。

用户要的是:**在设置里加一个可调前端缩放的滑条**。

**建议做法**:在根元素上设一个 `--pi-scale`(或 `font-size`)由设置驱动,持久化到用户配置。注意:
- 设置面板在 `src/client/src/components/settings/`
- 配置读写要**同时**改 `parsePiWebConfig`(读)与 `piWebConfigRecord`(写)—— 解析器**逐字段构造,没点名的键静默丢弃**,漏一边等于功能从未生效(语音配置就栽过)。
- 缩放要影响布局断点的判断吗?先想清楚:`@media (max-width: 640px)` 用的是 CSS 像素,若用 `rem` 缩放会连带改变断点行为。

---

## 完成后

1. `npm run verify` 全绿
2. 逐条单独提交
3. 加 changeset → 发布 `.43`(走 GitHub Release → Actions)
4. `~/nix-config/scripts/pi-web-update.sh --force astra-mbp` 更新本机
5. **服务端有改动 → 提醒用户重启 sessiond**

---

## 第 5 项的补充实测(重要)

用户反映"启动起来字自动变大",怀疑是 `.42` 造成的。**已实测证伪**:

| 构建 | `html` | `body` | 按钮 | 视口 |
|---|---|---|---|---|
| 1.202608.40 | 16px | 16px | 12px | 393px |
| 1.202608.42 | 16px | 16px | 12px | 393px |

同设备(Pixel 5)、同视口、同 dpr,数值完全相同。方法:把旧构建的 `dist/client` 用 `python3 -m http.server` 起在闲置端口,与 8504 用同一脚本量。

**但这次量出了根因**:`html` 与 `body` 都是 **16px —— 浏览器默认值**。pi-web **从未固定过自己的基准字号**,所以浏览器/系统的文字缩放会直接穿透进来,应用毫无抵抗。用户没动 zoom 也会被 Chrome 无障碍文字缩放、或 PWA 与标签页各自的缩放记忆推着走。

**所以滑条的做法应是**:让 pi-web **显式设定自己的基准字号**(而不是继承浏览器默认),再由设置里的滑条驱动它。这样既能调,也不再被外部设置随意改变。

注意断点:若基准字号用 `rem` 传导,`@media (max-width: 640px)` / `(max-width: 420px)` 这些用 CSS 像素的断点**不会**跟着变——要想清楚这是想要的行为(通常是),还是需要改用 `em` 断点。

---

## task-3 调研结论(跨机器加载 + 消除 N+1)

**现状**:`PiWebApp.loadQuickSwitcherData` 逐项目取工作区、逐工作区取会话,全部串行,且只覆盖当前机器。

**服务端已有"整机一次返回"的范式**,四个路由都在 `src/server/sessions/sessionRoutes.ts`:

```
GET <prefix>/sessions/notifications
GET <prefix>/sessions/unread
GET <prefix>/sessions/statuses
GET <prefix>/sessions/interrupted
```

**唯独会话列表没有整机版本。** 两个候选实现:

| 函数 | 位置 | 覆盖 | 内容 |
|---|---|---|---|
| `list(cwd)` | `piSessionManagerGateway.ts:88` | 一个目录 | `scanSessionSummariesInDir`,**带摘要/标题** |
| `listAll()` | `piSessionManagerGateway.ts:114` | 整个库 | SDK 路径,现用于跨项目清理 |

**已查清:不能用 `listAll()` 顶替,但原因不是缺字段。** 两条路径**字段相同**(`piSessionManagerGateway.ts:85` 注释:*"Lightweight streaming summaries instead of the SDK's full-transcript listing: same fields, but message bodies are never parsed once the first user message is found"*)。

差别是**代价**:`summaryScanner` 找到首条用户消息就停止解析;SDK `listAll` **解析完整转录**。用它做整机列表,会把每个会话的全文读一遍——对上万条消息的会话来说**比现在的 N+1 更慢**。

**因此:新增一个"枚举 store 下所有会话目录 + 逐个走 summaryScanner"的方法**,复用 `listSessionsInDefaultPiStore` 的目录枚举(`readdir` + `Promise.all`),但把 `listSessionsInDir` 换成 `summaryScanner.scanSessionSummariesInDir`。

**建议实现**:新增 `GET <prefix>/sessions/catalog`,内部枚举 store 下所有会话目录并用 summaryScanner 扫描,一次返回整机会话。客户端改为按机器调用一次(机器数远小于工作区数),并覆盖所有已登记机器。

**注意**:`sessionStatusCatalog()` 只含**已加载**会话,不能当列表用。

服务端改动,发布后需重启 sessiond。

---

## 待设计覆盖的现场问题(用户实测,勿盲修)

- 抽屉展开后顶部只剩活动范围码(All / Subagents / Agent runs / Tasks),ACTIVITY / GOALS / NOTIFICATIONS 标签条不可见,展开状态下无法切换分区。要求:展开时仍能在三个分区之间切换。
- 同一条用户消息同时出现在转录与待发队列,界面显示两遍(一条 Read、一条 Queued to steer)。
- 非对话视图缺常驻返回;Machine/Project/Workspace chip 看似面包屑却跳到 navigation 而非回对话。
- 761–1180px 档 header 被隐藏(shared.ts:272),成为完全死胡同。
- 客户端 parsePiWebConfigValues 仍在丢 speechToText —— 语音功能自发布起从未可用;同函数还漏 environmentFacts、extensionDialogsTimeoutMs。

---

## 当前未提交改动(已验证,等一次性发版)

| 改动 | 验证方式 |
|---|---|
| 返回手势(currentRouteMatchesUrl 漏比较 view) | scripts/verify-back-gesture.mjs;修复前连按 4 次 main=chat-view,修复后 back#1 即回 workspace-view |
| 刷新不再把人换到别的会话(refreshMayReplaceSelection) | 3 条测试红→绿;审查员实机复现过原问题 |
| 项目筛选不再把会话全筛掉(空集合≠没有) | 测试红→绿 |
| 整机会话目录 scanStoreSessionSummaries | 实测 34ms vs SDK 395ms(11.6x) |
| 机器/工作区模糊搜索 | 8 条测试 |
| 解析器补 backgroundRunCount | 2 条测试红→绿 |
| 草稿跨刷新保留 | 6 条,含"先擦后读"防护 |
| 对话框正文溢出压住选项 | 1 条红→绿 |
| 终端单滚动条 | 实测 xterm 自绘条 + viewport 不溢出 |

已撤回:紧凑面板"返回对话"按钮 —— 建立在被实测推翻的诊断上(折叠钮并未被推出视野),且浏览器未验证成功。

## 待办(用户要求全部修完测完再一次发版)

1. **一键回底部按钮与状态条重叠**。预览里状态条是窄条不重叠,用户截图里 "receiving response" 跨屏宽即重叠。**不能靠挪位置**,应让按钮排进状态条那一行,构造上不可能重叠。verify-jump-to-bottom.mjs 已加 docks 非空断言,拒绝空过。
2. **对话消息多时很卡** —— 加载/渲染优化(用户新报)。
3. **一条消息显示两遍**(转录 + 待发队列两个来源)。
4. **抽屉展开后无法切换 ACTIVITY/GOALS/NOTIFICATIONS 分区**(标签条不可见)。
5. **后台任务完成通知盖住模态层**(非本次改动引入)。
6. **speechToText 仍在丢**:客户端 parsePiWebConfigValues 从未点名;同函数还漏 environmentFacts、extensionDialogsTimeoutMs。语音功能自发布起从未可用。
7. **P0-1 跨工作区选会话不同步祖先**:selectSession 只写 selectedSession。建议在 PiWebApp 加统一出口 openSessionAnywhere,复用 selectProject → selectWorkspace → selectSession 链路。
8. **S1-a** 非对话视图缺常驻返回;Machine/Project/Workspace chip 看似面包屑却跳 navigation。
9. **S2-a** 761–1180px 档 header 被隐藏(shared.ts:272 的 max-width:1180px 应为 760px),成为死胡同。

三份设计报告(状态模型 / 页面流转 / 边界契约)运行中,workflow 15635fdd-c2ac-45d2-a61d-88a5173aa773。

---

## 一条消息显示两遍 —— 已定位到机制,未修

实测:同一条用户消息同时以 `Queued to steer` 和 `Read` 出现为**两个转录气泡**。

`apiTypes.ts:801-808` 的类型注释写明了本应生效的机制:

> `clientMessageId` — Id minted by the browser that sent the prompt. It correlates a queued entry with the transcript bubble the sender already sees, **so the sender can show a delivery mark on that bubble instead of listing the same text a second time**.

对账在 `messageDelivery.ts:86` `findDeliveryLineIndex`,按 `line.meta.delivery.clientMessageId` 查找。解析器两处都点名了该字段(`parsers.ts:741`、`parsers.ts:1199`)。

**未查清的是**:为何服务端 append 回来的消息没有并入既有气泡,而是新增一行。候选:`meta.delivery` 是纯客户端状态,页面重载后转录气泡不再带它 → 队列条目找不到宿主 → 自己渲染成一行。需要先复现(发一条消息、在送达前刷新页面)再判断。

## 消息顺序 —— 证据与现状

记录统计:时间戳倒退**只发生在用户消息**(111 次),助手与工具结果**从不倒退**(各 0 次)。典型形态:

```
assistant   14:53:07
toolResult  14:53:21
user        14:53:10   ← 敲字时刻,送达在 :21 之后
assistant   14:53:21
```

修复(用户消息一律追加)在 `transcriptOrder.ts`,提交 cc478c92,已随 v1.202608.45 / .46 发布,本机运行 .46。**若仍见错位,应先确认是"顺序"还是"同一条显示两遍"** —— 后者见上一节。

## goal 插件确认对话框崩溃

`set_goal_tasks` 报 `Cannot read properties of undefined (reading 'decision')`。
调用点 `pi-goal/extensions/goal-task-tools.ts:298` 读 `dialogResult.decision`;
`goal-task-confirmation.ts:48` 用 `ctx.ui.custom<TaskConfirmationResult>(...)`,
而 **pi-web 的扩展 UI 只支持 confirm / select / input,不支持 custom**(与 pi-updater 的更新失败同一根因)。
`custom` 在 pi-web 下返回 undefined → 读 `.decision` 崩溃。

修法二选一:①pi-goal 在 `!ctx.hasUI` 之外再判断 custom 不可用时降级到 `ctx.ui.select`;②pi-web 为 `ui.custom` 提供可降级实现。**这条同时会修好 pi-updater 的"更新问过不停"。**

---

## 设计审查:状态模型(opus-design-reviewer-a,已完成)

**根因的精确表述**(比"两个真相来源"更准):

> 应用有 **5 个平行的「当前上下文」记录处** —— AppState 字段 / URL 查询参数 / sessionStorage 记忆 / 各 UI 组件自有列表 / localStorage 逐会话数据。而**「谁跟随谁」的规则是分散在每个调用点手写的字段列表,没有任何一处集中定义**。

这一条解释了今天全部症状:漏 `view`(路由比较的手写列表)、漏 `backgroundRunCount`(解析器的手写列表)、`selectSession` 不更新祖先(跟随规则的手写列表)——每处都是"手写清单漏一项"。

**文档缺口**:`docs/plugins.md:750` 把 selectedMachine/selectedWorkspace/selectedSession/workspaceTool/mainView 列为对插件稳定的字段,却**没有任何文档说明它们之间的不变式**。建议新增 `docs/client-state-model.md`,内容为该报告的 §1(状态清单与权威来源)、§2(派生规则表)、§3(收敛方案与迁移顺序)、§4(保留/重置/重拉判据)。

**该报告自述的未验证项**(勿当已证实):
1. 「插件工具 id 跨机器残留」仅为代码路径推断,未在浏览器复现。
2. 「保存通用设置会删除 environmentFacts」由三处代码合成,未执行过 PUT 验证。建议在隔离的 PI_WEB_CONFIG 下验证。
3. 全部判定基于源码与只读 HTTP 实测,未执行测试套件。
4. 审查对象是**当前工作区**而非 HEAD,行号可能与生产实例不一致。

完整报告路径见 subagent-artifacts 下 opus-design-reviewer-a 的 output.md。

---

## ⚠️ 我的 routeMatch 修复在桌面引入了新不一致(审查发现,必须先修)

`routeMatchesUrl`(routeMatch.ts:15)把"URL 无 view"归一化成 `"navigation"`。但:

- `writeRoute`(PiWebApp.ts:1208)把 `"navigation"` 定义为"不写 view 参数"
- `defaultRouteView`(appShellController.ts:93-97)在**非移动布局下直接返回 `"chat"`**,不看 sessionId

后果:**桌面上 `state.mainView === "chat"` 且 URL 无 view 时,`currentRouteMatchesUrl()` 永远返回 false**,PiWebApp.ts:317 的提前返回护栏在桌面完全失效 —— 每次 popstate 都会触发路由恢复。

三处对同一默认值的约定不一致,必须统一到一处再谈修复。这条本身就是"规则手写在各调用点、无集中定义"的又一次发作。

## 设计审查:页面流转(opus-design-reviewer-b,已完成)

**「我在哪」有 8 个记录处**(比状态模型报告的 5 个更多),各自有独立写入者:

1. AppState.selected{Machine,Project,Workspace,Session}(appState.ts:38-42,4 个 controller 写)
2. AppState.mainView / workspaceTool(appState.ts:96-97)
3. URL query machine/project/workspace/session/tool/view(route.ts:54-72)
4. URL 命名空间 query,如 `core:workspace.files:file`(PiWebApp.ts:1227-1230,**独立于 writeRoute**)
5. URL `settings=` 参数(settingsRoute.ts:7-16,**完全独立的 pushState 写入者**)
6. sessionStorage 四把钥匙(machineNavigationMemory / sessionSelection / workspaceSelection / terminalSelection,各自记忆)
7. 各 UI 组件自有列表(QuickSwitcher 的机器级缓存 vs SessionList 的工作区级)
8. localStorage 逐会话数据(草稿、主题、缩放)

**三个 blocker(报告标注已实测):**
- 4.1 `mainView` 在三档宽度下语义不同(≤760 三者互斥;761–1180 navigation 无效;≥1181 三者无视觉差异,实测 1400px 下 `view=core:workspace.files` 时 chatViewVisible=true)
- 4.2 QuickSwitcher 选会话不更新 project/workspace/sessions
- 4.3 **QuickSwitcher 选工作区跨项目时直接哑火(新发现,已实测)**

报告另含:§1 表面清单(主区三态 / 导航面板四列表 / 工作区面板 / 对话内嵌 / 覆盖层)、§2 三档宽度各自的流转图、§3 每个表面「必须显示什么才知道自己在哪」及当前缺什么。完整报告见 subagent-artifacts 下 opus-design-reviewer-b 的 output.md。

---

## 设计审查:边界契约(ds-design-reviewer,已完成)

**实际差异**:正在发生、用户可见的静默丢弃 **1 处**;类型/线上存在但解析器不点名 **6 处**。其余接口(SessionStatus 全字段、SessionInfo、MachineRuntime、ask/dialog 全家、notifications)**已对齐**——核对方法有效。

| 编号 | 严重度 | 内容 |
|---|---|---|
| F1 | **blocker** | 配置响应丢 `speechToText` —— 语音功能至今不可用 |
| F2 | major | 同响应还丢 `azureSpeech` / `environmentFacts` / `extensionDialogsTimeoutMs` |
| F3 | major | `PiWebRuntimeComponent` 丢 `activeAgentProfile` 与组件级 `deprecatedAgentInputs` |
| F4 | major | `notifications.summary` 事件**无解析器**,在 socket 边界被静默吞掉 |
| F5 | minor | `SessionNotificationCatalogSnapshot` 无解析器、无客户端 API |
| **F6** | **major(测试层)** | **`parsers.test.ts` 把「丢弃」固化为预期** —— 测试正在保护这个 bug,补字段反而会让测试变红 |

**F6 特别重要**:它解释了为什么这类 bug 能长期存活——修复看起来像破坏。动手补字段时必须同时改这些测试,并理解它们原本断言的是什么。

### 推荐方案:A 为最终机制,D 为过渡与双保险(明确不选 B/C)

- **A. 类型层强制全字段**(`AllFields<T>` + `satisfies`):零依赖、零运行时成本;78 个导出 parse 函数中约 35–40 个"全对象构建"函数各加 1–3 行;**在写代码的瞬间失败**而非 CI 之后;把"故意丢弃"逼成类型可见的 `Omit`;CI 本就跑 typecheck,**不需要新门禁**。
- **D. AST 静态脚本**(读类型声明 vs 解析器键引用):200–300 行,挂到 `verify`,**0 行解析器改动,当天可上**;脚本读 apiTypes 声明本身,**不自漂移**。
- **不选 B(契约测试)**:字段清单手写,**与类型同漂移**,新字段不会自动进 fixture —— 现有 parsers.test.ts 就是这个硬伤的活证据。
- **不选 C(zod/valibot 重写)**:2320 行全换,30+ 处既有跨字段不变量要在 refine 层重实现,新依赖。

报告 §3 另有「把未加载当成没有」的全仓清单与通用表示法建议(如何在类型层区分 未加载 / 空 / 有值)。完整报告见 subagent-artifacts 下 ds-design-reviewer 的 output.md。
