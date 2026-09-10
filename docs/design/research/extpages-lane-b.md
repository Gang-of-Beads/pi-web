# Lane B — 设计评审：扩展今天能不能添加"页面"（pi-web @ refactor/plugin-architecture）

角色：design review（lane B）。只读评审，未修改仓库文件；未运行 8505 实况栈（所有结论来自源码阅读，凡属推测均标注）。

---

## 0. 判决

**问：扩展（piWebPlugin）今天能添加自己的 PAGE —— 一个读者可导航、有独立 URL/深链的全幅视图 —— 还是只能往宿主拥有的页面里塞 panel/section/dialog？**

**答：没有"页面"这个贡献类型；契约上只有后者。但有一个事实上的"半页"：workspace panel 可以被提升为 mainView 并占据整个画布，且有 URL 深链。** 具体：

- `PluginContributions` 的全部词汇是 actions / navSections / machineSections / workspacePanels / workspaceLabels / themes / themePairs / composer / settingsSections / messageRenderers / drawerSections（src/plugin-api.ts:353-365；镜像于 src/client/src/plugins/types.ts）。**没有 `pages`/`views` 贡献。**
- 但 `AppState.mainView` 的类型是 `"navigation" | "chat" | QualifiedContributionId`（src/client/src/appState.ts），URL `?view=<pluginId>:<panelId>` 由 workspace-panel 解析器解析（src/client/src/route.ts:40-53），mainViewClass 把任何非 chat/navigation 的 mainView 归为 `workspace-view`（src/client/src/appShell/panelCollapseController.ts:63-67）。于是：**一个 plugin panel 可以成为主内容区，甚至通过 `setWorkspacePanelFullscreen` 占满全屏**（src/plugin-api.ts:626-632；PiWebApp.ts:147-150 的 CSS 隐藏 aside+main）。
- 这个"页"**永远以选中 workspace 为前提**：`visibleWorkspacePanels()` 在无 workspace 时返回 `[]`（PiWebApp.ts:2799-2803），`WorkspacePanel` 无 workspace 时渲染 "Select a workspace" 空态（WorkspacePanel.ts:23-28）。没有 workspace 的深链 `/?view=x:y` 交付的是一个选择器，不是页面。
- 唯一真正独立于 workspace 的插件 URL 面是 **settings section**：`?settings=<pluginId>:<sectionId>` 可深链（src/client/src/settingsRoute.ts:12-22, 60-62）。

所以精确表述：**今天扩展不能"添加页面"；它可以贡献 panel，然后借助宿主的 view/fullscreen 两个开关，让那个 panel 表现得像页面。** 这是一个表现上的页面、契约上的 panel——下面的评审论证这个折中已经到了天花板。

---

## 1. 已验证的表面清单（带 file:line）

### 1.1 客户端贡献词汇（registry 资格化 `pluginId:localId`，registry.ts `qualify()`）
| 贡献 | 渲染位置 | URL 到达方式 |
|---|---|---|
| workspacePanels | workspace 列（桌面 grid 第 5 列，PiWebApp.ts:132-135）；mainView=panel id 时成为主区（`workspace-view`，PiWebApp.ts:162-167）；fullscreen 时占满（PiWebApp.ts:147-150） | `?tool=` 与 `?view=` 都接受 qualified panel id（route.ts:29-37, 40-53）；别名迁移 `routeAliases`（plugin-api.ts:677；registry.ts:395-405）；`?view` 深链在 reload 后恢复（PiWebApp.ts:1360-1367：先 `loadPluginsForSelectedMachine()` 再 resolve） |
| drawerSections | 会话抽屉 tab（AppNavigationPanel.ts:313-316） | 无 URL |
| navSections（保留 `projects`/`workspaces` 槽）/ machineSections（保留 `machines` 槽） | 侧栏（types.ts 中的契约注释：unknown id 无槽不渲染） | 无 URL |
| composer / messageRenderers / workspaceLabels / themes / themePairs / actions | composer、transcript 卡片、workspace 头、主题、动作面板 | 无 URL（actions 经 palette） |
| settingsSections | settings 壳内一节 | **`?settings=<pluginId>:<sectionId>` 可深链**（settingsRoute.ts:60-62） |
| （宿主 API，非贡献）ui.showDialog / registerModal | 宿主模态层，`overlay`/`fullscreen` 两种呈现（plugin-api.ts:149-174）；`pluginDialogs` 是 `@state()` 级临时状态（PiWebApp.ts:438, 2502-2519），**reload 即失**，无 URL | 无 |
| （宿主 API）ui.query | 命名空间化 query-string 读写，注释自称"the plugin's wire format for deep links"（plugin-api.ts:152-155；pluginHostUi.ts:58-60；namespacedQueryArgs.ts:4-6, 29-43） | 插件自选命名空间，`ns--key` 形态写入 `location.search` |

### 1.2 路由命名空间现状（全部是 core 拥有）
- 六个核心参数：`machine/project/workspace/session/tool/view`（route.ts:29-37 读，56-74 写；writeRoute 只删这六个）。
- 命名空间化参数：`core.workspace.files--file`、`core.workspace.terminal--terminal`、`core.workspace--expanded`（PiWebApp.ts:257-260）。
- `?settings` 与 `?settings=<section>`（settingsRoute.ts）。
- 插件可自选命名空间写 query（ui.query），无登记、无保留检查、无作用域清理。
- 每机导航记忆（含 tool/view/fullscreen）按 machineId 存 sessionStorage（machineNavigationMemory.ts:27-35, 104-134），切机恢复各自的 view。

### 1.3 服务端
- 插件 HTTP 路由挂载在 `/api` 与 `/api/machines/local`（app.ts:341-342；serverPluginRouteMount.ts:20-42）；reply 契约允许 `string | Uint8Array | AsyncIterable` + 任意 header（serverPluginRouteMount.ts:139-152）——**技术上可以吐 HTML，但没有任何 bundled 插件这么做**（pi-web-plugins 全树 `text/html` 只命中 workspaces 的文件预览 MIME 表）。operation 代理是纯 JSON POST（pluginOperationProxyRoutes.ts:17-22；registry.ts `callPluginOperation` → `api/plugins/<id>/<op>`）。
- 远端机的插件资产经网关改写成 `/pi-web-plugins/machine.<hex(machineId)>.<pluginId>/...`（machinePluginProxyRoutes.ts:100；machinePluginIds.ts:10-15）。**远端插件 panel 的深链因此内嵌机器 id 的十六进制**——机器删除重建后链接悬空。
- 无认证钩子（app.ts 无 auth/Bearer 命中）——本地单用户姿态，插件路由继承之。

### 1.4 bundled 插件用面矩阵（pi-web-plugins/*/pi-web-plugin.ts 及 browser/）
- files：workspacePanels（routeAliases "files","core:workspace.files"，pi-web-plugin.ts:28）+ **ui.query**（viewMode.ts:70-84，写 `core.workspace.files--mode`，还叠 localStorage）+ 自己的 popstate 监听（fileViewerElement.ts:57）。
- git：actions + workspacePanels（git-panel.ts:135-136）。**最近的"页面"候选**：mode/diff/commit/expanded 四个 URL 状态、自建命名空间 `git.panel--*`、裸 `history.pushState/replaceState`（gitRoute.ts:62-68）、自己的 popstate（git-panel.ts:1172/1177）、按 workspace 缓存的重状态（git-panel.ts:39-40, 427-432）、`visible` 仅对自有 provider workspace 为真（git-panel.ts:758）、反向驱动宿主 fullscreen（git-panel.ts:550）。
- terminal：workspacePanels + expanded（terminal/pi-web-plugin.ts:29-34）。
- goals：drawerSections；machines：machineSections + actions；workspaces：navSections + actions；updates：actions + workspacePanels；info/relays/workspace-tasks：actions/labels/panels；voice：composer。

### 1.5 对任务给定 surface map 的修正
- "agentSurfaces" 不是 UI 贡献：它只存在于服务端 agent-facts 声明（src/server/shared/plugins/agentSurfaceDeclarations.ts:15-30），不出现在任何浏览器贡献词汇里。
- `TERMINAL_ROUTE_NAMESPACE` 等常量在 PiWebApp.ts:257-260，不在 appState.ts。
- "whereAmIBar" 不存在；对应物是 AppContextBar（会话上下文条，无工具入口）。
- 工具行的唯一入口是侧栏 tools-section（AppNavigationPanel.ts:324-343，注释自称 "the one entrance on every layout"），不是 WorkspacePanel 头部（头部只有 fullscreen 切换，WorkspacePanel.ts:50-53）。
- `docs/plugins.md` **完全没有提到 `ui.query`**（全文零命中 "query"），且明言 "`routeAliases` is only for migrating former URL tool/view values"（docs/plugins.md:868）。即：**成文契约里插件没有任何 URL 状态通道，而 shipped 代码里 files 在用 ui.query、git 在裸写 history**。文档落后于代码。

---

## 2. 设计评审：page/panel 故事哪里断

### 2.1 现在这个折中做对了什么（先说公道话）
- 深链是真实的：route 恢复前先装载该机插件再解析 view/tool（PiWebApp.ts:1360-1363），reload 后 panel 页回来；每机记忆让切机往返各自回到自己的 panel（machineNavigationMemory.ts:27-35）；`syncDocumentTitle` 把 mainView 写进标题（PiWebApp.ts:708-712）。
- 资格化与 machine 过滤统一走 registry（registry.ts:395-405 `resolveWorkspacePanelRouteId` + `isContributionActive`），插件不用懂路由。
- fullscreen 的"每次都给同一个可逆开关"是有测试钉住的刻意决定（WorkspacePanel.fullscreen.test.ts:22-37）。

### 2.2 断裂点

**B1（最尖锐）：未知/悬空的 view 静默渲染成另一个 panel —— 违反本项目自己的"absence is not negation"。**
`WorkspacePanel.render`：`visiblePanels.find((panel) => panel.id === this.tool) ?? visiblePanels[0]`（WorkspacePanel.ts:33）。而 route 解析器对"格式合法但不存在"的 qualified id 照单全收（route.ts:41-43 的 `?? isQualifiedContributionId(value)` 回退；registry.resolveWorkspacePanelRouteId 返回 undefined 时不否决）。最小失败场景：深链 `/?machine=m1&project=p&workspace=w&view=git:workspace.git` 指向一台没装 git 插件（或该 panel `visible` 为假）的机器 → 屏幕渲染 Files panel，URL 声称 git，无任何 unknown 提示。同一个回退也吃掉默认 `workspaceTool: "files:files"`（appState.ts:268）在无 files 插件机器上的悬空。

**B2：workspace 切换不重解析 mainView —— URL 的页在切换后悄悄变成另一页。**
mainView 的全部写入点：route restore（PiWebApp.ts:1363）、openWorkspaceTool（1750）、selectMainView（1823）、return-to-picker（1949）。`handleWorkspaceChange`（1938-1961）只对 `workspaceTool` 做 invalidate（1959），从不检查 `mainView` 指向的 panel 在新 workspace 上是否仍 visible。场景：读者在 git worktree 上看 `view=git:workspace.git`，切到一个普通目录 workspace → git panel 的 `visible` 变假（git-panel.ts:758）→ WorkspacePanel 回退渲染第一个可见 panel（B1 的回退）→ 没有任何一行代码或 UI 承认这次替换。这正是 AGENTS.md "同一症状报到两次"条款要防的多生产者漂移，只是发生在宿主自己身上。

**B3：三个 URL 写入者、两套写法、一个绕过。**
宿主经 `writeRouteUrl` 做合并（400ms 内 replace）与占位帧记账（historyWrites.ts:22-45）；git 的 `commitUrl` 直接 `window.history.pushState/replaceState`（gitRoute.ts:62-68），绕过合并与占位帧；files/git 又各自挂 popstate 监听自行裁决（fileViewerElement.ts:57、git-panel.ts:1172）。宿主的 `currentRouteMatchesUrl` 只比较五个核心面（PiWebApp.ts:487-504），**对只改了插件参数的 pop 一律回答"路由没变，不恢复"**——所以每个写 URL 的插件被迫自管 popstate，等于把路由器的一部分下放给了每个插件。这恰是 pluginHostUi.ts 注释里警告的"a plugin copying any of these becomes a second producer"，只是对象换成了 history。

**B4：query 命名空间无主权、无作用域清理。**
`ui.query` 接受任意字符串命名空间：files 直接写进 core 的 `core.workspace.files` 命名空间（viewMode.ts:14-16, 83），git 硬编码读 `core.workspace--expanded`（gitRoute.ts:27）——宿主与插件在同一命名空间里各写各的键，无冲突检测。清理侧：`writeRoute` 只删六个核心参数（route.ts:57-63），`replaceRouteAndClearWorkspaceQuery` 只清三个 core 命名空间（PiWebApp.ts:1429-1434），**插件键跨 project/workspace 切换残留在 URL 里**；git 靠 `routeMatchesWorkspace`（gitRoute.ts:50-55）自保，naive 插件没有宿主帮助。而生命周期事件里**没有 workspace-changed**（plugin-api.ts:90-96 只有 session/connection/theme/activity/settings），panel 只能靠逐帧 diff render context 自查（git 的 workspaceContextKey 模式）——宿主的"data must carry scope"铁律实际由每个插件自己执行，契约不管。

**B5：fullscreen 是一个全局 bit，其恢复不变量散落三处。**
`workspacePanelFullscreen` 是单一布尔（PiWebApp.ts:281），不按 panel/机器键控（切 panel 保留展开是测试钉住的刻意行为，WorkspacePanel.fullscreen.test.ts:31-36）。它的事实不变量分布在：恢复时要求 `tool === mainView` 且 machine/project/workspace 全匹配（PiWebApp.ts:1641-1649）；URL 同步只在 mainView 是 panel 时写（1705, 3056-3058）；git 还会从自己的 route 状态反向 set 它（git-panel.ts:550）。三处手拉手维护一个隐式状态机——AGENTS.md 要求的"命名状态 + 纯 classifier + 测试枚举"（对照 `revisionVerdict`/`replayDecision`）在这里缺席。标注：panel 在桌面列内常驻渲染（chat 为主视图时也在），所以列内 panel 点 "Expand panel" 会直接隐藏 chat 主区（CSS PiWebApp.ts:147-149）——作为"评审模式"说得通，但它证明 fullscreen 实际是页面语义寄生在 panel 契约上。

**B6：焦点缺口（观察到的缺席，未实况验证）。**
openQuickSwitcher 有完整的键盘收起+焦点纪律（PiWebApp.ts:2511-2525），而 openWorkspaceTool/selectMainView（1748-1753, 1817-1825）没有任何焦点处理。panel 成为全屏页时焦点落在哪、软键盘是否该收，契约未命名。标注为推测级：需要 8505 实况验证。

**B7：远端插件 panel 的深链内嵌 hex 机器 id。**
`machine.<hex(machineId)>.<pluginId>:<panelId>`（machinePluginIds.ts:10-15）——功能上通，但深链不可读、机器重建即断，断法是 B1 的静默回退而非 unknown 页。

**B8：双份类型声明的已知漂移。**
`src/plugin-api.ts` 与 `src/client/src/plugins/types.ts` 手工双写（surfaces-as-plugins.md 自己记录了这一债务）；本次核对两者在贡献词汇上一致，但 client 版仍多出 core 伪插件用的上下文成员（如 `piWebUnstable`、`deleteWorkspace`）。任何新"页"契约若不先合一，会立刻变成第三份。

### 2.3 git 面板 = panel 契约到顶的证据
git 需要的全部"页面"要素——自己的 URL 参数、模式切换、深链恢复、作用域缓存、全屏评审、popstate——**每一项都是在 panel 契约之外手工补的**：自建 route 类（gitRoute.ts）、裸 history、自挂 popstate、硬编码读宿主命名空间。files 用了宿主 ui.query 但叠了 localStorage 并借用 core 命名空间。两个最重的 panel 各自发明了同一套缺失契约的不同子集——这就是"page 应该是一等贡献"的实证，不需要 hypothetical third party 来论证。

---

## 3. 最小诚实的"extension page"设计（只点名接缝，不写代码）

前提对齐 AGENTS.md 的 lazy 原则：**不要现在新增 `pages` 贡献类型**。`view` 槽已经接受任何 qualified id 且深链已通；缺的是三块诚实地板，都是小改动：

1. **未知视图状态（先修诚实性）**：当 `view`/`tool` 是合法 qualified id 但无人认领（插件未装/未启用/`visible` 为假）时，渲染一个明确的"此页面不可用：<id>（插件未安装或当前 workspace 不适用）"，而不是 `visiblePanels[0]` 回退（WorkspacePanel.ts:33）。这与"absence is not negation"和 `findMessageRenderer` 的 honest-unknown 先例（registry.ts 注释）同构。
2. **命名空间登记 + 作用域清理**：贡献里声明自己的 query 命名空间（登记时拒绝 `core.*` 与重复），宿主在 project/workspace 切换时清掉不属于当前作用域的已登记键（复用 `replaceRouteAndClearWorkspaceQuery` 的位置，PiWebApp.ts:1429-1434）。git 的 `routeMatchesWorkspace` 自保逻辑和 `core.workspace--expanded` 硬编码随之退役。
3. **一个 URL 写入者**：契约化"插件只准经 ui.query/historyWrites 写 URL"（files 已是榜样），git 的裸 `history.pushState` 是要迁移的违规者而非先例。宿主 `currentRouteMatchesUrl` 把已登记命名空间的键纳入比较，pop 的裁决权收回宿主。

若此后出现第二个真正需要 workspace 无关页面的消费者（YAGNI 门槛），再按既有接缝升级：
- **贡献面**：`views`（或复用 workspacePanels 加一个 `scope: "page"` 字段）进 `PluginContributions`，资格化机器照旧（registry.qualify 零新概念）；渲染点放在 main 而非 workspace 列；入口复用 tools-section 行（AppNavigationPanel.ts:324-343）——行就是入口，`view=` 就是地址。
- **作用域轴要显式决定**：今天的每个视图都活在 machine+project+workspace+session 之下；page 至多是 machine 级。这个轴差是现有折中最深的裂缝（B3 的无-workspace 空态是它的症状），必须在贡献类型里命名，不能靠 `workspace===undefined` 的空态含糊过去。
- **fullscreen 状态机命名**：把 {column, view, fullscreen, unknown-view} 收进一个纯 classifier + 测试枚举（AGENTS.md 风格），`tool===view` 不再是散落三处的口头约定。

---

## 4. 对 workspacePanel-as-page 折中的明确判决

**短期：正确的 lazy 折中，TRUE 保留。** 零新 API、深链已工作、每机记忆已工作、fullscreen 给了页面感；"工具行是唯一入口"（AppNavigationPanel.ts:323）与"头部只有展开决策"（WorkspacePanel.ts:50-53）都说明宿主有意识地在收敛入口。

**但作为终态：FALSE——它把三个不同契约（column 工具 / main 视图 / 可寻址页面）压进一个贡献类型，压出的缝就是上面 B1-B8。** 判断依据不是审美而是实证：两个最重的 bundled 插件各自手工重造了页面契约的碎片（git 五件套、files 的 query+storage+popstate），而宿主的成文文档（docs/plugins.md）干脆不承认 URL 通道存在。当契约的使用者必须绕过契约才能做完契约该支持的事，契约就该改名了。最小诚实路径见第 3 节 1-3 条：先修 unknown 状态、命名空间主权、单一写入者——这三个不依赖任何新贡献类型，且每一个都直接对应一条本项目已经付过学费的既有规则。

## 5. 未验证项（如实声明）
- 未运行 8505 实况栈/Playwright probe（只读评审约束）；B6 焦点行为与 2.2-B5 的精确复现链属代码推演，标注为待实况确认。
- probe-plugin-matrix.mjs 只覆盖 panel 内容与 drawer tab 的在场性（scripts/probe-plugin-matrix.mjs:46-61），未覆盖深链恢复与 fullscreen 路径——现有 probe 矩阵对"页"语义没有断言，这是验证面的缺口而非本次评审的结论缺口。
