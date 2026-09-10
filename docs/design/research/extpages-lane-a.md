# Lane A — 扩展「页面」能力盘点与机制核查(branch: refactor/plugin-architecture)

范围声明:本报告只做盘点与机制核查并给出直接答案;设计取舍评价归 lane B。所有行号均已在当前工作树核实。

## 0. 结论(直接回答)

**TRUE(有限定):今天扩展就能加「页面」,但只有一种形态 —— `workspacePanels`。**

一个 `piWebPlugin` 声明的 workspace panel 就是一个 full-pane、可导航、有 URL 深链的视图:

- full-pane:桌面占右侧面板列;`host.setWorkspacePanelFullscreen(true)` 后独占整个画布(PiWebApp.ts:147-150 的 `.shell.workspace-panel-fullscreen`,API 在 plugin-api.ts:631 与 WorkspaceHost,PiWebApp.ts:3054-3061 实现);手机(coarse/max-width 760)上直接占满全屏(PiWebApp.ts:170-174 媒体查询)。
- 有 URL 深链:`?view=<pluginId>:<panelId>`(读 route.ts:32-33,解析 route.ts:37-51,应用为 `mainView` 在 PiWebApp.ts:1363-1369;写回在 route.ts:68 与 PiWebApp.ts:1697-1698)。
- 可全屏深链:`?view=...&core.workspace--expanded=1`(PiWebApp.ts:3058 写,1418-1420 经 readWorkspaceRouteSurface 读回)。
- 面板内部状态可经 `ui.query` 写入 `<namespace>--<key>` 查询参数并存活 reload(plugin-api.ts:152-155;namespacedQueryArgs.ts:27-41;实证 files/viewMode.ts:79-84 与 probe-files.mjs:9-13)。

**不能做的:**

- 不能新增 SPA path 路由:客户端路由只读 search 参数(route.ts:25-33),未知路径一律回退同一 index.html(app.ts:376-388),插件无法声明 `/my-page`。
- 不能加全局或机器级页面:panel 被 workspace 作用域限制,未选中 workspace 时 `visibleWorkspacePanels()` 返回空、工具行整体消失(PiWebApp.ts:2799-2803)。
- 声明式 dialogs 不存在(见第 3 节勘误);`ui.showDialog` 的 `fullscreen` 表现自称「the plugin page form」(PiWebApp.ts:106-109,声明 plugin-api.ts:171)但没有 URL、不跨 reload(PiWebApp.ts:438 是纯内存 `@state`)。
- 服务端插件路由技术上能返回 HTML(ServerPluginReply.send 接受 string/bytes + header,serverPluginRouteMount.ts:117-127),但那是脱离应用外壳的独立文档;没有任何捆绑插件这样用(全仓 grep `text/html` 只命中 workspaces 文件服务的媒体类型表,workspaces/server/workspaceFiles.ts:19、49-50)。

> 一句话:扩展页面 = workspacePanel(+ 自管 namespaced query 状态)。它是页面语义的 90%:全屏、深链、reload 存活;缺的是 path 路由与 workspace 之外的槽位。

## 1. 贡献面清单(逐一核实:声明 → 渲染 → 到达方式 → URL → reload 存活)

| # | 贡献面 | 声明处 | 渲染处 | 到达方式 | URL/深链 | reload 存活 |
|---|---|---|---|---|---|---|
| 1 | workspacePanels(页面形态) | plugin-api.ts:671-689(client 镜像 types.ts QualifiedWorkspacePanelContribution;qualify 在 registry.ts:454-483) | WorkspacePanel.ts:25-43,挂载 PiWebApp.ts:2124-2138 | ①导航面板 Workspace views 行(AppNavigationPanel.ts:324-334 → PiWebApp.ts:3990-3994);②插件 action `selectWorkspaceTool`(PiWebApp.ts:3364 → 1748-1751);③深链 `?view=`/`?tool=`(PiWebApp.ts:1360-1369) | 是:`?view=<qualifiedId>`(route.ts:68)、`?tool=<qualifiedId|alias>`(route.ts:67);全屏加 `core.workspace--expanded=1` | 视图/工具/全屏选择存活;面板内部状态取决于面板是否自写 query |
| 2 | drawerSections | plugin-api.ts:395-403 | 会话抽屉,PiWebApp.ts:2338 | 抽屉 tab 点击 | 无 | 否(tab 选择不进 URL) |
| 3 | navSections | plugin-api.ts:289-296;保留槽位 `projects`/`workspaces`,未知 id 不渲染 | 导航面板与 context sheet,PiWebApp.ts:4031-4035 | 折叠区点击 | 无 | 否 |
| 4 | machineSections | plugin-api.ts:345-351;槽位 `machines` | PiWebApp.ts:2341、4032 | 机器区点击 | 无 | 否 |
| 5 | workspaceLabels | plugin-api.ts:714-721 | 工作区行 | 自动渲染 | 无 | 否 |
| 6 | actions | plugin-api.ts:559-571 | 动作面板/快捷键 | 命令面板 | 无(action 无自身 URL;可间接触发 selectMainView 写 URL) | 否(快捷键映射另行持久,shortcut/shortcutAliases plugin-api.ts:562-564) |
| 7 | composer | plugin-api.ts:443-456 | prompt-editor,PiWebApp.ts:4022(`.composerContributions`) | 自动渲染 | 无 | 否 |
| 8 | messageRenderers | plugin-api.ts:418-424;tag 先到先得、二次认领被拒(registry.ts:335-345) | ChatView.ts:1706(经 PiWebApp.ts:3834 注入) | 转播文中标签出现即渲染;未认领标签渲染为诚实未知卡 | 无 | 否 |
| 9 | settingsSections | plugin-api.ts:202-208 | settings-dialog,PiWebApp.ts:4076(`.pluginSections`) | Settings 抽屉导航 | **是**:`?settings` 开合、`?settings=<pluginId>:<sectionId>` 直达插件节(settingsRoute.ts:29-31、54-63;消费于 PiWebApp.ts:440、442) | 是(URL 即状态) |
| 10 | themes / themePairs | plugin-api.ts:724-746(themePairs 是地图漏项) | 主题选择器 | 主题对话框 | 否(偏好存 localStorage,PiWebApp.ts:407) | 是(经存储,非 URL) |
| 11 | 命令式:ui.showDialog(overlay/fullscreen)、ui.registerModal、ui.query | plugin-api.ts:159-175、140-150、152-155;host 绑定 PiWebApp.ts:403、2502;全屏 CSS PiWebApp.ts:106-109;渲染 PiWebApp.ts:4077 | modal-surface 层 | 插件代码自行调用(machines/addMachineDialog.ts:22-37、workspaces/addProjectDialog.ts:24 为实例) | **无** | **否**(PiWebApp.ts:438 纯内存;fullscreen 也不写 URL) |
| 12 | 服务端:operations | server-plugin-api.ts:96-100 | 浏览器侧 `callOperation` → `api/plugins/<pluginId>/<operation>`(registry.ts:346-349;代理 pluginOperationProxyRoutes.ts:10-14) | 插件代码 | n/a(JSON 通道) | n/a |
| 13 | 服务端:routes | server-plugin-api.ts:147-165 | 挂载于 `/api` 与 `/api/machines/local`(app.ts:341-342;adapter serverPluginRouteMount.ts:20-52) | HTTP | 可返回任意内容含 HTML,但无在用实例 | n/a |
| 14 | 服务端:agentFacts.surfaces | server-plugin-api.ts:105-108 | prompt 注入侧(server/daemon/sessions/declaredAgentFacts.ts:31),**非 UI** | agent | n/a | n/a |

## 2. URL 命名空间全图

**顶层查询参数(核心独占,无插件可认领新 path/顶层键):**

- `machine` `project` `workspace` `session` `tool` `view`(route.ts:28-33;写 route.ts:63-68)。本地机器永不写入 URL(PiWebApp.ts:493 附近注释「The local machine is the default」)。
- `settings`(开合 + 直达节,settingsRoute.ts:29-31、44-52)。

**核心命名空间键(`core.` 前缀,PiWebApp.ts:257-260 定义):**

- `core.workspace--expanded`:面板全屏(PiWebApp.ts:3058 写;读 1418-1420)。
- `core.workspace.files--file`:选中文件(PiWebApp.ts:1418 读、1712-1716 同步);文件视图模式经 `ui.query` 写同一命名空间(files/viewMode.ts:79-84)。probe-files.mjs:9-13 固定了这条深链合约(reload 后恢复选中文件)。
- `core.workspace.terminal--terminal`:终端选择(PiWebApp.ts:1418、1725、1810)。

**插件命名空间键:**

- `ui.query.read/write(namespace, key)`(plugin-api.ts:152-155)落到 `<namespace--key 换算>`:冒号变点(namespacedQueryArgs.ts:4-6),键形 `<namespace>--<key>`(namespacedQueryArgs.ts:27-41)。注释明说「The namespace is the plugin's wire format for deep links」(plugin-api.ts:150-151)。
- git 插件用同一键形但**自建写手**:gitRoute.ts:23-60 以 `git.workspace.git--mode/--diff/--commit` 直读直写 `window.history`(pushState/replaceState 在 gitRoute.ts:63-67),并读 `core.workspace--expanded`(gitRoute.ts:41)。深链示例(gitRoute.test.ts:15-16):`/?machine=remote-1&project=...&workspace=...&core.workspace--expanded=1`。

**深链恢复顺序(第三方面板冷加载可用):**`restoreRouteMachine` → `await loadPluginsForSelectedMachine()`(PiWebApp.ts:1360)→ `resolveAppRoute`(1362,插件此时已注册,alias 才可解析)→ `mainView = route.view ?? default`(1363)。

## 3. 对给定地图的勘误

1. **whereAmIBar 不存在**:全仓 grep 无此名。对应物是 `renderContextBar`(PiWebApp.ts:4013)与 `documentTitleFor`(PiWebApp.ts:97)。地图项应更名。
2. **「dialogs」不是声明性贡献键**:`PluginContributions` 的键集是 actions/navSections/machineSections/workspacePanels/workspaceLabels/themes/themePairs/composer/settingsSections/messageRenderers/drawerSections(plugin-api.ts:353-365,无 dialogs)。对话框有两条别的链:命令式 `ui.showDialog`(plugin-api.ts:159-175),以及守护进程驱动的会话扩展对话框 `pendingDialogs`(appState.ts:117-129)——后者是运行时事件,不是 UI 贡献词汇。
3. **「operations」「agentSurfaces」不在浏览器贡献词汇里**:它们是服务端激活返回(server-plugin-api.ts:96-108);agentSurfaces 实为 `agentFacts.surfaces`,喂 prompt 声明而非 UI(declaredAgentFacts.ts:31)。
4. **地图漏项**:actions、settingsSections(后者是除 workspacePanel 外唯一可深链的插件面)、themePairs、`ui.registerModal`、`ui.query`(深链机制的两个关键件)。
5. **navSections/machineSections 是保留槽位而非自由插槽**:注释明说 reserved ids `projects`/`workspaces`/`machines`,未知 id 不渲染(plugin-api.ts:288-289、344-345)。
6. **routeAliases 的定位是 browser-v1 迁移兼容**,不是新页面路由机制(docs/plugins.html:360 附近:「route aliases and shortcut aliases exist only for browser-v1 migrations」;同义 plugin-api.ts:676-677、registry.ts:589-597 强制其形态并并入 sourceId 别名)。
7. **src/client/src/plugins/types.ts 与 src/plugin-api.ts 是同一词汇的双份声明**,server/shared/pluginApiTypes.ts 只有 DTO(机器状态/文件/终端/主题 token),不含贡献词汇 —— 地图把它列进贡献词汇处是错的。

## 4. 机制细节与发现(每条带判定)

**4.1 未知/失效深链静默落到第一个面板 —— TRUE。** 最小场景:深链 `?view=ghost:page` 且该插件未装/禁用。route.ts:52-54 对合法 qualified id 直接放行(resolveAppRoute 无注册表校验),`mainView` 被设为 ghost:page(PiWebApp.ts:1363-1369);渲染时 WorkspacePanel 按 `panel.id === this.tool` 找不到便 `?? visiblePanels[0]`(WorkspacePanel.ts:33)——读者看到的是 Files 之类别的工具,外壳类名仍是 workspace-view,没有任何「该页不存在」的显式未知。这违反项目自身的 absence-is-not-negation 守则(AGENTS.md:「Absence is not negation」节)。

**4.2 查询命名空间无登记、无防碰撞 —— TRUE。** `ui.query` 接受任意 namespace 字符串(plugin-api.ts:152-155),核心用 `core:` 前缀但无保留清单或注册校验;两个插件都选 namespace `panel` 时,`panel--open` 互相覆盖,且共用同一个 URL 历史流。最小失败场景:两个扩展都写 `panel--id=1` 作为各自深链,后写者赢,前者的书签恢复到错误面板。

**4.3 git 插件绕过 `ui.query` 直写 `window.history` —— TRUE(行为事实,非缺陷断言)。** gitRoute.ts:51-60 自己拼 URL 并 pushState/replaceState,不经 `ui.query`/`writeRouteUrl` 的合并器(historyWrites.ts:26-33 的 400ms coalesce 与占位帧逻辑,historyWrites.ts:3-23)。URL 写入决策自此有两个生产者;插件直写不参与占位帧记账,理论上可在模态层打开时插入历史帧(未实测,标注为推测:该路径冲突需要 live probe 验证)。files 插件则走正道 `ui.query`(viewMode.ts:79-84)——同一能力两个用法并存。

**4.4 面板的入口清单(完整):** ①导航面板 Workspace views 行,自述「the one entrance」(WorkspacePanel.ts:48 注释;AppNavigationPanel.ts:324-334;PiWebApp.ts:3990-3994);②插件 action → `selectWorkspaceTool`(PiWebApp.ts:3364 → 1748-1751,同时设 `workspaceTool` 与 `mainView`);③URL 深链(PiWebApp.ts:1360-1369);④机器切换的 sessionStorage 导航记忆恢复(PiWebApp.ts:1734,restoreRouteFor 带 snapshot.surface/snapshot.view)。面板排序按 `order ?? 1000` + title(registry.ts:391-393);`visible()` 过滤在 PiWebApp.ts:2803。

**4.5 面板全屏状态进了 URL 且被机器导航记忆 —— TRUE。** `setWorkspacePanelFullscreen` 在非 restore 期间写 `core.workspace--expanded`(PiWebApp.ts:3054-3061),machineNavigation 快照携带 workspaceExpanded(PiWebApp.ts:1705-1709),机器往返与 reload 都存活。

**4.6 各面持久性对照:** 只有面板族有持久性(URL);settings 节有持久性(URL);主题有持久性(localStorage);抽屉 tab、composer、消息卡、标签、对话框全部回到默认。

**4.7 面板上下文的注入面:** panel 拿到 files/backend/terminal/prompt/host 五组能力(plugin-api.ts:636-668 WorkspaceContext+WorkspacePanelContext;backend 仅在浏览器入口与活跃服务端配对时给出,registry.ts:454-483 以 WorkspacePluginBinding 绑定 machine+revision,workspaceBackend 绑定见 docs/plugins.html:360 附近)。面板不自己拼 URL(files previewUrl 例外由 host 提供,plugin-api.ts:601-603)。

## 5. 捆绑插件面清单(参考用户盘点)

| 插件 | 用到的贡献面 | 证据 |
|---|---|---|
| files | workspacePanel(order 10,aliases `files`、`core:workspace.files`)+ `ui.query` 深链 | files/pi-web-plugin.ts:21-33;viewMode.ts:79-84 |
| terminal | workspacePanel + badge + aliases | terminal/pi-web-plugin.ts:28-44 |
| git | workspacePanel + actions + 自建路由写手 + fullscreen 同步 | git/browser/git-panel.ts:127-136(127-131 建 panelId 与 route);gitRoute.ts:23-67;fullscreen 同步 git-panel.ts:155-163、174、551 |
| relays | actions + workspacePanel | relays/pi-web-plugin.ts:12-49 |
| workspace-tasks | actions + workspacePanel + badge | workspace-tasks/pi-web-plugin.ts:12-50 |
| info | actions + workspaceLabels + workspacePanel | info/pi-web-plugin.ts:14-52 |
| updates | actions + 条件 visible 的 workspacePanel + badge | updates/pi-web-plugin.ts:162-200 |
| goals | 仅 drawerSections | goals/pi-web-plugin.ts:55-85 |
| workspaces | navSections + actions + ui.showDialog + 服务端 routes(workspaces 是唯一声明服务端 routes 的捆绑插件) | workspaces/browser/pi-web-plugin.ts:90-93;workspaces/server-plugin.ts:232;addProjectDialog.ts:24 |
| machines | machineSections + actions + ui.showDialog | machines/browser/pi-web-plugin.ts:55-58;addMachineDialog.ts:22-37 |
| voice | composer | voice/pi-web-plugin.ts:70-71 |

**最接近「需要一个真页面」的是 git**:它已携带多模式面板内状态(changes/history、diff、commit)、自建深链写手、并主动同步全屏画布(git-panel.ts controller 的 hostFullscreen 比较)——它在 workspace-panel 合约之外事实上补了一层「页面路由」,这正是 workspacePanel-as-page 妥协被用到极限的样本(判断归 lane B)。次近的是 workspaces(管理面 + 自有服务端路由,但仍以 navSections/dialog 呈现)。

## 6. 「页面」还缺什么(机制缺口清单;取舍判定归 lane B)

1. 无插件可声明的 path 路由;路由面是 query-only(route.ts:25-33)。
2. 无全局/机器级页面槽位:一切页面形态都被 workspace 门槛限制(PiWebApp.ts:2799-2803 未选 workspace 即无工具)。
3. 未知视图无显式未知状态(4.1,TRUE 缺口)。
4. 查询命名空间无保留/防碰撞机制(4.2,TRUE 缺口)。
5. 全屏插件对话框无 URL、不存活 reload(PiWebApp.ts:438、4077),与「fullscreen 即页面形态」的自我描述(PiWebApp.ts:106-108)不一致。
6. URL 写入已有两个生产者(host 合并器 + git 直写,4.3),第三个插件照抄 gitRoute 模式会让合并器与占位帧逻辑进一步失真。

## 7. 复核用关键证据索引

- 路由读/写:route.ts:25-33、56-73;解析:route.ts:37-54;深链应用:PiWebApp.ts:1360-1369;写回:PiWebApp.ts:1693-1699。
- 命名空间 query:namespacedQueryArgs.ts:4-41;host 注入:pluginHostUi.ts:47-50;registry 解析:registry.ts:395-404。
- 面板渲染与入口:WorkspacePanel.ts:25-67;PiWebApp.ts:2124-2138、2799-2803、3976-3994。
- 对话框:plugin-api.ts:159-177;PiWebApp.ts:403、2502-2507、4077、106-109。
- 插件加载:external.ts:41-77(manifest → 动态 import);机器级:PiWebApp.ts:3234-3255;远程 manifest 代理:machines/machinePluginProxyRoutes.ts:41-48。
- SPA 回退:app.ts:376-388;静态插件资产:app.ts:225-227。
- 深链 probe 合约:probe-files.mjs:9-13、143。
- (附录)该任务由 scripts/audit-extension-pages.workflow.js 编排,与本次两 lane 分工一致。
