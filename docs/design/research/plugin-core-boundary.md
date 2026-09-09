# 插件边界审查:core 留什么、plugin 走什么(逐项)

审查车道:core/plugin 边界划分。只读分析,未修改仓库任何文件;所有断言给出本仓库 file:line 证据;凡属推测一律标注。
分析基线:工作树(git status 显示 AGENTS.md、docs/design/surfaces-as-plugins.md、src/client/src/components/PiWebApp.ts、SessionList.ts、appShell/AppNavigationPanel.ts、controllers/sessionController.ts 有未提交修改;surfaces-as-plugins.md 的工作树版本已含 owner 2026-09-09 的四条回答,本报告以工作树版本为准)。

---

## 0. 用的分类器

分类只用 owner 亲口给出的五项 core 定义(docs/design/surfaces-as-plugins.md:35-48,"Core keeps" 在 :47-48):

1. agent 能力本身;2. 会话管理;3. 网络层;4. 最小 UI;5. 扩展机制。

外加两条本项目已立的硬约束:
- 进程所有权:web 模块不得 import daemon 模块,反之亦然;共享归 shared/(AGENTS.md "Server layout: process ownership")。
- 插件不得 import src/client/src,只能借宿主 seam(surfaces-as-plugins.md "What is already true");server 侧契约面是 `@gang-of-beads/pi-web/server-plugin-api`(src/server-plugin-api.ts:13-27 `PiWebServerPlugin`)。

每项标为:【CORE】五项定义内 /【PLUGIN】应离开 core /【两可】需 owner 拍板。

---

## 1. 客户端(src/client/src)今天拥有的表面,逐项分类

| # | 表面 | 位置(证据) | 分类 | 说明 |
|---|---|---|---|---|
| C1 | 应用外壳:三栏 grid、面板折叠/伸缩、返回手势、键盘机、模态层、断点 | components/PiWebApp.ts(4003 行)、appShell/panelCollapseController.ts、panelResizeController.ts、components/modalLayerRegistry.ts | CORE(最小 UI) | 无插件依赖 |
| C2 | URL 路由:?machine/?project/?workspace/?session/?tool/?view 读写与恢复 | src/client/src/route.ts:25-79;appUrl.ts | CORE(最小 UI+网络层) | `tool`/`view` 的解析已经走 registry(resolveWorkspacePanelRouteId,route.ts:37-57),即路由值空间已对插件开放 |
| C3 | 主题引擎、主题偏好、favicon | theme.ts(applyPiWebTheme theme.ts:100-113;resolveThemePreference theme.ts:121-135);PiWebApp.themeChoice.test.ts | CORE(最小 UI) | 主题数据已是外部插件(surfaces 插件包 pi-web-themes,见 docs/design/plugin-architecture-status.md "pi-web loaded it live" 段);注意 theme.ts:24 `CLASSIC_THEME_ID="themes:classic"` 是 core 指向插件贡献 id 的软引用,缺失时回落 themes[0] 或 undefined(theme.ts:136-139),属诚实缺失 |
| C4 | 动作面板 ActionPalette + 快捷键偏好 | components/ActionPalette.ts、keyboardShortcuts.ts、shortcutPreferences.ts;core 插件动作注册于保留 id "core"(PiWebApp.ts:3872;src/shared/pluginIds.ts:11) | CORE(最小 UI+扩展机制) | 注意:core 伪插件是 shell 自注册的特例,见 §5.4 |
| C5 | QuickSwitcher(会话快速切换/搜索) | quickSwitcher.ts、components/QuickSwitcher.ts;PiWebApp.ts:2985-3005(app.sessions.quick-switch 动作) | CORE(会话管理) | 枚举 machine×project×workspace 找会话,纯会话域 |
| C6 | 桌面导航栏 + 手机 quick-access 页(compact shell) | appShell/AppNavigationPanel.ts:139-172(desktop render)、174-206(compact render) | CORE(最小 UI 骨架) | 其 slots 由插件贡献:machine slot(AppNavigationPanel.ts:165,278-292)、projects/workspaces slots(166-167,292-315)、drawer sections(327-336)、toolTabs 工具行(337-360)。与 surfaces-as-plugins.md:30-32 断言一致:quick-access 与 tab strip 是同一贡献清单的两个渲染器 |
| C7 | 上下文条/切换器 AppContextBar、AppContextSwitcher、ContextSwitcherSheet | components/appShell/AppContextBar.ts、AppContextSwitcher.ts、ContextSwitcherSheet.ts | CORE(最小 UI 骨架) | machine 步骤的可用性来自 machines 插件的贡献(AppNavigationPanel.ts:239 `machinesSectionContributed()`) |
| C8 | 会话列表/树/清理/重命名 SessionList、SessionTreeNavigator、SessionCleanupDialog、SessionRenameDialog | components/SessionList.ts、SessionTreeNavigator.ts、SessionCleanupDialog.ts、SessionRenameDialog.ts | CORE(会话管理) | |
| C9 | 转录 ChatView:消息渲染、流式、滚动锚定、交付状态、pending/queued/ledger | components/ChatView.ts(2434 行)、chatTranscript*.ts、transcriptReconcile.ts、messageDelivery.ts、pendingOutbox.ts | CORE(agent 能力呈现;plugin-architecture.md:65 明言 message sync/delivery/outbox/ask settlement law 不插件化) | messageRenderers seam 已接入(ChatView.ts:608 findMessageRenderer;未认领 tag 渲染诚实未知卡,src/plugin-api.ts:405) |
| C10 | AskUser 卡 + 扩展对话卡 | AskUserCard.ts、ExtensionDialogCard.ts、daemon 侧 pendingAskStore/pendingExtensionDialogStore | CORE(agent 能力:对话结算法;plugin-architecture.md:65 "ask/dialog settlement law" 明确不插件化) | daemon 对扩展 UI 其它表面答复 unsupported:`unsupportedSurfaces: ["custom"]`(src/server/sessiond.ts:293) |
| C11 | 命令台账/发送队列/重发/草稿 | commandLedger.ts、sessionController.sendQueue 等 | CORE(会话管理+网络层) | |
| C12 | 作曲器 PromptEditor | components/PromptEditor.ts | CORE(最小 UI) | composer contributions seam(voice 的按钮/状态线走它,src/plugin-api.ts:441-451) |
| C13 | 模型/思考级别选择器 | ModelPicker.ts、thinkingLevels.ts | CORE(owner 已裁决:plugin-architecture-status.md "Owner rulings, 2026-09-05 (final)" 第 1 条) | 这是"两可"被 owner 关闭的实例 |
| C14 | 状态栏 StatusBar(workspace label 徽标) | components/StatusBar.ts;workspaceLabels seam(src/plugin-api.ts:712-718) | CORE(骨架)+插件贡献项 | |
| C15 | WorkspacePanel(右侧面板宿主,渲染"一个"选中面板) | components/WorkspacePanel.ts:21-47 | CORE(最小 UI 骨架) | 面板本体全部来自 registry(panels 属性);fullscreen 切换在头部(48-53) |
| C16 | 设置对话框壳 + 7 个 core 设置节 | SettingsDialog.ts:154-185;settingsRoute.ts:4 `CoreSettingsSection = "general"|"appearance"|"sessiond"|"machines"|"packages"|"plugins"|"shortcuts"` | CORE 壳 + 【两可】个别节 | plugin sections 以 QualifiedContributionId 混入(settingsRoute.ts:12);packages/plugins/sessiond 节管理插件与 daemon,天然 core;appearance 节是主题选择(引擎 core、数据插件),machines 节与 machines 插件重叠——见 §7 owner 项 |
| C17 | 活动坞(后台工作静默 pill) | ChatView.ts:1346-1387 renderActivityDock | 【两可】 | wave D 移除了活动/通知抽屉页,子代理与后台任务的**查看器**已死,只剩 pill(surfaces 插件状态文档 "Wave D" 段:"Subagent run and background-task conversation viewers died with the activity panel")。pill 是否 agent 能力的一部分,owner 未表态 |
| C18 | 插件运行时:registry、external loader、hostUi、workspaceFiles/TerminalSessions/Backend 能力 | plugins/registry.ts(35KB)、external.ts:35-77、pluginHostUi.ts:23-77、workspaceFiles.ts、workspaceTerminalSessions.ts、workspaceBackend.ts | CORE(扩展机制) | |
| C19 | API 层:clients/http/sockets/urls/requestDeadline/transportHealth/pluginBackends/workspaceUploads | api/*.ts | CORE(网络层) | |
| C20 | 控制器:session/machine/workspace/project/auth/machineStatus/piWebStatus | controllers/*.ts | CORE(会话管理+网络层) | |

## 2. Web 进程(src/server/web + src/server/index.ts)逐项

| # | 路由/职责 | 位置 | 分类 | 说明 |
|---|---|---|---|---|
| W1 | 静态服务 + SPA fallback(缓存策略) | web/app.ts:370-392 | CORE(网络层) | |
| W2 | 插件清单与资产:/pi-web-plugins/manifest.json、/pi-web-plugins/:pluginId/* | app.ts:225-236 | CORE(扩展机制) | 远端机器资产先走 machines 代理(app.ts:228-230 proxyMachinePluginAsset) |
| W3 | /api/pi-web/status、/version、/runtime | app.ts:237-242 | CORE(agent 能力状态真值) | |
| W4 | /api/plugins、/api/machines/local/plugins | app.ts:243-245 | CORE(扩展机制) | |
| W5 | Pi 包管理路由(install/remove/update) | piPackageRoutes.ts + piPackageService.ts:9-14(端口)、:61-76(DefaultPiPackageService) | CORE(扩展机制) | 这是决策 3"从 GitHub 安装"的既有通道:pi install 接受 npm/git/URL/本地路径源(docs/plugins.md "Pi packages" 段) |
| W6 | config 路由(全局+本地机) | configRoutes.ts | CORE | 但文件族配置键(uploads/pathAccess)实际为 workspaces 插件服务(app.ts hostPorts piWebConfig.readPathAccess app.ts:320-322),见 §5.11 |
| W7 | 项目路由:projects CRUD、project-directories、workspaces 列表 | app.ts:73-121 registerLocalProjectRoutes | CORE(会话管理邻域) | 面板在 workspaces 插件,store 在 core——即"插件面、core 店",add-project 对话框经 PluginRuntimeContext.createProject 插回(src/plugin-api.ts:515-518) |
| W8 | 会话代理、终端代理、工作区删除、信任路由(双前缀 /api 与 /api/machines/local) | sessionProxyRoutes.ts、terminalProxyRoutes.ts、workspaces/workspaceDeletionRoutes.ts、projectTrustRoutes.ts | CORE(会话管理+网络层) | 删除走 provider.prepareRemove 计划(插件)由宿主执行(server-plugin-api.ts WorkspaceRemovePlan 注释) |
| W9 | 插件 backend/operation 代理(远端机器) | plugins/pluginBackendProxyRoutes.ts、pluginOperationProxyRoutes.ts | CORE(扩展机制) | |
| W10 | 机器代理族(远端 HTTP/WS 转发) | machines/machineProxyRoutes.ts:5,17(REMOTE_HTTP_ROUTES = FEDERATED_HTTP_ROUTES) | CORE(网络层) | federated 表见 §5.6 |
| W11 | 自更新/重启/舰队路由 | updates/selfUpdateRoutes.ts、restartRoutes.ts、fleetRoutes.ts | 【两可】 | 机制在 core,面板在 updates 插件(pi-web-plugins/updates);owner 的"网络层"可覆盖,但"更新机器"是不是 agent 能力属 owner 定义 |
| W12 | web 侧 server-plugin 运行时(runs:"web"/"both" 的插件在此进程激活) | app.ts:281-345(createServerPluginRuntime + filterCatalogEntriesByRuns app.ts:303;挂载 app.ts:341-342) | CORE(扩展机制) | AGENTS.md 已记载该变化 |

## 3. Daemon(src/server/sessiond.ts + src/server/daemon)逐项

| # | 职责 | 位置 | 分类 | 说明 |
|---|---|---|---|---|
| D1 | 会话服务全家:PiSessionService、事件枢纽、提示队列/交付/验收账、中断运行、归档、未读、通知、命令服务、askUser、扩展对话、spawn/子会话、模型目录刷新 | daemon/sessions/*(~90 文件)、realtime/sessionEventHub.ts | CORE(agent 能力+会话管理) | |
| D2 | Pi 账号认证 AuthService + authRoutes | daemon/sessions/authService.ts、authRoutes.ts | CORE(agent 能力) | |
| D3 | 终端 pty TerminalService + terminalRoutes | daemon/terminals/* | CORE(owner 裁决:pty 能力留 core,plugin-architecture.md:111-113 面板才插件化) | |
| D4 | 机器状态 MachineStatusService + 归属 | daemon/status/* | CORE(状态真值) | |
| D5 | 工作区 provider 注册表 + 目录/删除路由 | daemon/workspaces/* | CORE(扩展机制的宿主侧;git 插件是 fallback provider,docs/plugins.md "Workspace providers" 段) | |
| D6 | 插件 operation/backend 路由 | daemon/plugins/pluginOperationRoutes.ts:25-55、daemon/workspaces/pluginBackendRoutes.ts | CORE(扩展机制) | 未声明操作 404 而非空答(pluginOperationRoutes.ts:43) |
| D7 | 全局扩展 provider 引导与冻结 | sessions/globalProviderPolicy.ts(sessiond.ts:215 调用) | CORE(扩展机制) | |
| D8 | 子代理/后台任务账目 | sessions/subagentRuns.ts、backgroundTasks.ts | CORE(agent 能力) | 客户端呈现归 C17 两可 |
| D9 | 注入轮分类 injectedTurnKinds(含 goal-continuation 声明消费) | sessions/injectedTurnKinds.ts:12-17(注释:插件声明 kinds,宿主只认无插件前置的 kinds) | CORE(机制)+插件声明 | |

## 4. 现有 11 个 bundled 插件逐个:贡献、依赖、依赖是否已走 seam、移动破坏面

manifest 全在 pi-web-plugins/*/package.json(`piWeb.plugins[]`:id/module/serverModule/browserRoot/machineSpecific/runs);发现与解析在 src/server/shared/piWebPluginCatalog.ts(parsePluginEntries :662-711;`runs` 缺省 "daemon" 见 filterCatalogEntriesByRuns :133-140)。浏览器装载经 manifest.json(plugins/external.ts:35)+ registry。

| 插件 | 贡献面 | 依赖的 core 能力 | 是否已走 seam | 若移走/缺席会怎样 |
|---|---|---|---|---|
| files | workspacePanels("files",routeAliases 含 core:workspace.files,pi-web-plugin.ts:28) | WorkspaceFiles 能力(readFile/listFiles/writeFile/deleteFile/moveFile/previewUrl/uploadFiles,src/plugin-api.ts:582-615) | 已走:files 只调宿主发的 files 能力;但该能力的 HTTP 路径是 **workspaces 插件**贡献的 core-shaped 路由(见 workspaces 行)——插件间隐式依赖,manifest 无依赖声明 | Files 面板消失;若 workspaces 插件也在而 files 不在,则仅少一个 tab;若反之,tab 在但全部 404 |
| git | workspacePanels(git-panel.ts,1385 行)+ server 端 workspaceProvider(fallback provider,server-plugin.ts:47 `fallback: true`,工厂 :43-48)+ git.* backend 操作 | execFile 端口;backend.request(pluginBackendProtocol,src/shared/pluginBackendProtocol.ts 边界);WorkspaceRemovePlan | 已走 | 工作区语义退回"内核工作区"(docs/plugins.md:无 provider 认领时暴露项目文件夹);git diff/历史 UI 消失 |
| goals | drawerSections("goals",goals/pi-web-plugin.ts:56-88)+ server 端 operation "goals.list"(server-plugin.ts:66-68) | callOperation(api/plugins/goals/goals.list);requestUpdate seam;宿主 runCommand 经 drawer context(src/plugin-api.ts:388-390 runCommand 注释) | 已走(除 §5.2 的 goal-panel 特判) | 抽屉 Goals 节消失;agentFacts 的 goals surface 变为未声明(declaredAgentFacts.ts:13-15:未声明=未 backed) |
| info | actions + workspaceLabels + workspacePanels(info/pi-web-plugin.ts:16-50) | PluginRuntimeContext.state(copyDiagnostics 读 piWebStatus) | 已走(state 快照是契约字段,src/plugin-api.ts:363-372) | 仅少诊断入口 |
| machines | machineSections + actions(machines/browser/pi-web-plugin.ts:75 machineSections、:76-108 actions);server 端 machineRegistry + 7 条管理路由,runs:"web"(package.json:13) | 端口 machinesStorePath/localRuntime,或注入的 registry(server-plugin.ts:25-40);宿主 app.ts:345-347 直接消费 registry,缺席时 localMachineFallback(localMachineRegistry.ts:6-26) | 已走,且是"core 依赖插件"的反向依赖的范本(server-plugin-api.ts:91-95 注释:proxy 家族与舰队扇出经此接口) | 机器列表/增删/健康在本机退化为 fallback(只有 local、无管理);fleet/代理路由仍可用但只认 local |
| relays | workspacePanels("workspace.relays",relays/pi-web-plugin.ts:26-46) | WorkspaceFiles(listFiles/readFile 于 .pi-web/relays,relayDiscovery.ts:4) | 已走 | 仅少该面板 |
| terminal | workspacePanels("terminal",routeAliases core:workspace.terminal,pi-web-plugin.ts:34) | WorkspacePanelTerminal 能力(sessions/open/runCommand,src/plugin-api.ts:651-660;pty 是 core 能力,owner 裁决见 docs/design/plugin-architecture.md:60,134) | 已走 | 终端面板消失;pty 能力留在 core 不受影响 |
| updates | workspacePanels + actions(updates/pi-web-plugin.ts:159-194) | state.piWebStatus 快照;terminal.runCommand;checkForPiWebUpdates 上下文方法;另外读取宿主模块 URL 的 piWebDockerMode 查询参数(pi-web-plugin.ts:53,见 §5.8) | 大体已走;piWebDockerMode 是 seam 之外的 host 实现细节 | 少更新面板;状态/版本路由(W3)仍在 core |
| voice | composer 贡献(voice/pi-web-plugin.ts:71-93)+ server 端 "speech.token" 操作(server-plugin.ts:25-35) | settings-changed 事件;callOperation;composer.insertText/replaceDraft(与键盘同一写路径) | 已走(plugin-architecture-status.md "Extracted" 列 voice 为完成范本) | 无听写;无 core 残留(status 文档核验) |
| workspace-tasks | workspacePanels + actions(workspace-tasks/pi-web-plugin.ts:13-49) | files.readFile 读 .pi-web/tasks.json(config.ts:1);自己的项目配置文件 | 已走 | 少任务面板 |
| workspaces | navSections(projects+workspaces,workspaces/browser/pi-web-plugin.ts:91-104)+ add-project 动作;server 端 7 条文件族路由,runs:"web"(package.json:12;server-plugin.ts:33-236) | 端口 workspaceCatalog + piWebConfig(server-plugin.ts:39-41);缺端口时 health=unhealthy 诚实降级(server-plugin.ts:43-50) | 已走 | **这是最重的一块**:文件读/写/删/移/预览/建议、上传端点全部随插件走;若缺席,files 面板、上传、previewUrl 全部 404;projects/workspaces 导航体消失(只剩 core 会话列表) |

另:themes 已离开本仓库(Gang-of-Beads/pi-web-themes,git 包安装,plugin-architecture-status.md "Package loading on the live stack" 段);goals/machines/workspaces 亦有 split 仓库(status 文档 "Split repository coverage" 段)。

## 5. 今天绕过 seam 的地方(每条 file:line)

1. **core 动作硬编码插件贡献 id**。core 伪插件的 "Go to files"/"Go to terminal" 动作直接 selectMainView("core:workspace.files")/(core:workspace.terminal)(src/client/src/plugins/core/actions.ts:74,84),这两个 id 靠 files/terminal 插件的 routeAliases 兜底解析(pi-web-plugins/files/pi-web-plugin.ts:28、terminal/pi-web-plugin.ts:34)。两插件任一缺席时,mod+2/mod+3 指向无人认领的视图 id(渲染回落 WorkspacePanel 首个可见面板,WorkspacePanel.ts:33)。core→插件 id 的正向耦合,官方包拆出后必须改为"按目标声明"或删除。
2. **shell 以 goals 命名通用 seam**。drawer 的 runCommand 是通用 seam(src/plugin-api.ts:410-414),但 PiWebApp 的实现是 `runGoalCommand` + `goalCommandInFlight`(PiWebApp.ts:2179、3541-3561),命令源硬编码 "goal-panel"(3557),错误文案点名 goals(3549)。泛化点:source 应由贡献节自带,flag 应属节状态。
3. **daemon 端 surface 名单封闭**。pluginSurfaces.ts:53-54 硬编码 `goals` 与 `subagents` 两个 surface 名;subagents 根本没有 pi-web plugin 前置(pluginSurfaces.ts:32-38 注释自认);浏览器解析端同构封闭(api/parsers.ts:581-589 只认 goals/subagents)。表面出现机制未声明化——goal 那波建好的 agentFacts(声明面)没有反哺这份名单。
4. **保留 id "core" + shell 自注册**。pluginIds.ts:11 保留 "core";PiWebApp.ts:3872 `registry.register({ id: "core", plugin: corePlugin })`。这是刻意的"core 渲染也走 seam",但 core 插件用的是**内部** PluginRuntimeContext(types.ts:631 piWebUnstable;664-665 openModelPicker/openThinkingLevelPicker;675-680 deleteWorkspace/reloadSession/deleteCachedNewSession),公开契约 src/plugin-api.ts 并无这些方法——两套同名接口已分叉,公开包 packages/pi-web-plugin-api/package.json 只带 d.ts。**给第三方插件用的是窄面,给自家 core 用的是宽面,这一不对称必须在"official 包从新仓库安装"之前说清**(否则官方包作者会被诱导依赖内部宽面)。
5. **phone 头部的机器切换器由 shell 决定表现**。同一 machines 节被 shell 以 `tiles:true` 重渲染为 compact 切换器(AppNavigationPanel.ts:263-277;display 由宿主注入,src/plugin-api.ts NavSectionDisplay)。与 owner 决策 1"贡献自己说出现在哪,shell 不替你决定"(surfaces-as-plugins.md:37-39)直接张力:machines 插件今天无法只在手机头部出现/不出现。
6. **core federated 路由表枚举插件贡献路径**。FEDERATED_HTTP_ROUTES 命名了文件族与终端族路径(src/shared/federatedRoutes.ts:63-90;文件族 63-76,终端族 82-90),机器代理按此表转发(machineProxyRoutes.ts:17);server-plugin-api.ts 的 ServerPluginActivation.routes 注释明确"a route whose path is named by the federated route table inherits that entry's transport bounds"。这是设计内的耦合,但意味着:官方包改动路径模板即改 core 契约,review 时必须把这份表当公共 API。
7. **死条目:goals federated 路由**。federatedRoutes.ts:64-65 列了 `/projects/:projectId/workspaces/:workspaceId/goals` 与 `/goals/:goalId/archive`,但全仓 grep(src/server、src/client)没有任何 handler 或调用方;goals 插件现只贡献 operation "goals.list"(pi-web-plugins/goals/server-plugin.ts:66-68)。goals 迁移到 operations 后没人回收这两行——未闭环的迁移回路。
8. **updates 插件探测宿主实现细节**。`new URL(import.meta.url).searchParams.get("piWebDockerMode")`(pi-web-plugins/updates/pi-web-plugin.ts:53)——宿主给模块 URL 加的部署标记成了插件的输入。若官方包从新仓库构建,这条隐秘通道必须变成契约字段或宿主事实。
9. **宿主能力对另一插件路由的硬依赖**。WorkspaceFiles 能力(workspaceFiles.ts:35-47)经 api/clients.ts 打的是 workspaces 插件挂载的 core-shaped 路径;files(浏览器)→workspaces(服务)是插件对插件的依赖,但 manifest 格式没有依赖声明,禁用 workspaces 而启用 files 得到的是 404 而不是"依赖缺失"的诚实说明。
10. **core 主题回退引用插件 id**。theme.ts:24 CLASSIC_THEME_ID="themes:classic"。回落链是诚实的(theme.ts:136-139 themes[0]/undefined),但"无主题包安装"的机器上 UI 将用样式表默认值——官方包不含 themes 时这是默认体验,需要 owner 确认可接受。
11. **保留 slot 词汇表**。navSections 只认 "projects"/"workspaces"(src/plugin-api.ts:284 注释"reserved ids"),machineSections 只认 "machines"(AppNavigationPanel.ts:278-292 按 localId==="machines" 取)。契约内的保留,但配合 §5.5 意味着:贡献什么 id 才有 slot,是 shell 的私有词汇,declarative 改造时它就是第二份"清单"。

## 6. 文档与代码的矛盾 / 未闭环回路

1. **surfaces-as-plugins.md:32 自称"tab strip in WorkspacePanel"**,而 WorkspacePanel.ts:48-53 注释明确 tab strip 已退役("a tab strip here was a second entrance for the same six views")。文档"Where we actually are"段描述的是过去式——two-lists 设计落点(谁渲染哪份清单)要以现状为准:今天是 AppNavigationPanel 的 toolTabs 行 + WorkspacePanel 单面板。
2. **决策 C 只列选项未记选择**。owner 回答段说"Which format fits us best is a research question, answered below"(surfaces-as-plugins.md:46),但 §C(84 行起)给出三个选项后没有裁决记录。这是设计文档自己承诺又未兑现的闭环。既有事实可作为输入:pi 包管理器已能从 git/URL/本地路径安装(docs/plugins.md "Pi packages" 段;piPackageService.ts:9-14 接口),且"git 安装 + 包内捆绑 JS"已被 8505 实测(surfaces 插件状态文档)。
3. **bundled goals 是否已删,文档与树冲突**。plugin-architecture-status.md "Bundled goals removed" 段称 bundled goals 已移除、改从 git 包安装;但工作树 pi-web-plugins/goals/ 完整存在且有近期提交(git log 顶部为 "Round fourteen lanes A and B")。哪个是当前意图 NOT VERIFIED(需要 owner 或 git 历史裁决);对边界审查的影响是:goals 到底算"已迁出待打包"还是"仍是 bundled",迁移顺序第 4 步的起点不同。
4. **GOAL-STATUS.md:2-4 记录"goal 的任务工具在本宿主不可用"**——宿主侧 goals 工具链有未接线的痕迹,与本报告 §5.3 的封闭名单互为佐证(表面存在性靠声明,声明未到则诚实缺席)。

## 7. 迁移顺序(每步结束 app 均可用)

前提:所有面板/节/贡献已经通过 PluginRegistry 渲染,缺插件=相应 tab/节诚实消失(现状已由 wave D、goals/machines/workspaces 提取验证,见 plugin-architecture-status.md 各段)。因此顺序的原则是:**先建声明,再按依赖深度拆包**。

- **第 0 步(契约,不改行为)**:把决策 1+2 落成 manifest 级声明——贡献的 placement(quick-access / tab-strip / drawer-section / nav-slot)+ 数据需求 + 操作清单;render 仍是函数(B 方案第 1 层)。现 manifest 只有 id/module/serverModule/browserRoot/machineSpecific/runs(piWebPluginCatalog.ts:662-711 parsePluginEntries;runs 缺省 "daemon" 见 :129-140);registry 已按 kind 分发(registry.ts:55 register,:88-104 各贡献类的 qualify 分发),加字段是纯增量。同时冻结"公开 PluginRuntimeContext 窄面、内部宽面"的规则(§5.4)。
- **第 1 步(纯浏览器、零服务端)**:info、relays、workspace-tasks、updates 打包出仓。依赖(WorkspaceFiles、state 快照、terminal.runCommand)全是既有 seam;失败模式只是少面板。
- **第 2 步(runs:"web" 服务端插件)**:workspaces、machines 出仓。两者 split 仓库已存在;路由经 mountServerPluginRoutes 挂载(app.ts:341-342),federated 表已命名其路径(§5.6),远端机代理不变。此步要同步解决 §5.9 的 files→workspaces 依赖声明与 §7-owner 项 1(machines fallback 去留)。
- **第 3 步(能力后盾的面板)**:files、terminal。pty/文件能力都是宿主能力(owner 裁决),搬的只是面板;§5.1 的硬编码动作 id 在此步一并改为"目标面板缺失则动作禁用并说明",否则 mod+2/3 悬空。
- **第 4 步(agent 事实声明型)**:goals。agentFacts 声明机制已建(agentSurfaceDeclarations.ts 全文);剩余工作恰是 §5.2 的去特判 + §5.7 死路由回收 + §5.3 名单声明化。
- **第 5 步(收尾)**:git 服务端 provider 已是 fallback provider 形态,打包即可;subagents/activity dock 的归属按 owner 裁决执行;AGENTS.md 写入最终 core 清单(surfaces-as-plugins.md 决策 D 自己要求的)。

每步可用性论证:1-2 步不触及会话/chat;3 步缺面板但 chat/composer 完好;4 步 goals 缺席=抽屉少一节(诚实缺席);5 步是清理。全程 web 进程插件运行时失败也不带崩路由(app.ts:334-339 注释:contributed routes absent until restart)。

## 8. 需要 owner 拍板的项(不是我能定的)

1. **最小安装是否允许"没有 machines 插件"**。app.ts:345-347 的 localMachineFallback 是为了插件缺席时代理/舰队不崩;若官方包必装,这个 fallback(及其"local 别名缺失"的降级)是否保留,决定 machines 是"必需插件"还是"可选插件"。
2. **子代理/后台任务的活动 pill(C17)**:算 agent 能力(core)还是插件?查看器已随 wave D 死亡,只剩 pill;且 subagents 至今没有 pi-web plugin 前置(pluginSurfaces.ts:32-38)。
3. **更新/重启/舰队机制(W11)**:留在 core(网络层)还是随 updates 插件走?机制走插件意味着"更新插件"要能更新承载它的宿主,次序上有自举问题。
4. **phone 头部机器切换器**:保留 shell 的 tiles 决定权(现状,AppNavigationPanel.ts:263-277),还是按决策 1 让 machines 插件声明两个贡献(machines-section 与 machine-switcher)?
5. **文件族路由的宿主**:维持 core-shaped 路径(workspaces 插件按 core 模板挂载,现状)还是改插件命名空间路由 + files→workspaces 的显式依赖声明?前者稳(远端表已覆盖),后者才符合"插件不借 core 的路"的彻底版本。
6. **config 键归属**:uploads/pathAccess 等键现由 core config 承载、经端口喂给 workspaces 插件(app.ts:320-322);workspaces 出仓后这些键算 core 配置还是插件配置(AGENTS.md 配置约定:核心特性进 config.json,插件可有自己的文件)。
7. **决策 C 的粒度**(surfaces-as-plugins.md §C 三选项):单包/每插件包+元包/留在本仓。既有事实:pi 包管理器接受任意 source 字符串,git 直装已实测可行;残稿未记录 owner 的选择。
8. **bundled goals 树上残留**(§6.3):删还是留,以及 themes 式"bundled copy 随 split 仓库成熟逐个移除"(status 文档末段)的节奏是否适用于全部 11 个。

## 9. 结论一览

- 已达 owner 定义 core 的:会话/交付/转录/composer/导航骨架/路由/API 层/插件运行时/pty/模型选择(owner 裁决)/设置壳。
- 已是插件且依赖走 seam 的:11 个 bundled 插件 + themes 包;反向依赖范本 machines(serverPluginApi machineRegistry)。
- seam 之外的债:§5 的 11 条,集中在 goal 特判、封闭 surface 名单、core 动作硬编码插件 id、宿主能力对 workspaces 路由的隐式依赖。
- 文档债:§6 的 4 条,决策 C 未闭环、bundled goals 去留两说、tab strip 描述过时、goals federated 死条目。
- 迁移顺序 §7;owner 决策项 §8。
