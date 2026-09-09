# 声明式插件契约必须覆盖什么

只读调查产物。语料 = 仓库内 11 个 bundled plugin 的实际行为（全部结论带 `file:line`）+ 已发布契约声明
（`src/plugin-api.ts`、`src/server-plugin-api.ts`、`src/shared/pluginApiTypes.ts`、`src/client/src/plugins/{types.ts,registry.ts,pluginHostUi.ts}`）
+ 基线 `test-fixtures/plugin-api-baseline/`。未改动任何源文件。

语料规模：121 个非测试 TS 文件 / 17,416 行；其中 31 个文件（25%）承载 render+style 代码，占 8,079 行（46%）。
判定口径对齐 owner 已拍板的 4 条决策（`docs/design/surfaces-as-plugins.md`），特别是决策 B：
“声明式”分三层 —— **(1) 声明式 manifest + 命令式 render；(2) 声明式 UI 模板；(3) 声明式 wiring**。
本报告目标是 **第 (1)+(3) 层的最小集合**，并标出第 (2) 层的真实上限与必须保留的 escape hatch。

---

## 0. 结论

1. **契约已经被声明了 11 个贡献位，但只有 7 个被 bundled plugin 用过。**
   `PluginContributions` 有 11 个列表（`src/plugin-api.ts:351-363`：actions / navSections / machineSections / workspacePanels /
   workspaceLabels / themes / themePairs / composer / settingsSections / messageRenderers / drawerSections）。
   实测贡献数：actions 8、workspacePanels 7、composer 2、navSections 1、machineSections 1、workspaceLabels 1、drawerSections 1；
   **themes / themePairs / settingsSections / messageRenderers = 0 使用**（只有测试贡献在维持其存在：
   `src/server/plugins/pluginRegistry.test.ts:115`、`src/server/plugins/pluginSettings.test.ts:112`）。
   server 侧同理：`agentFacts`（`src/server-plugin-api.ts:128`）与共享契约里的 `networkPorts`（`src/shared/pluginApiTypes.ts`，
   core 已零引用）**没有任何 bundled 生产者**。这些是“已对外承诺但未经验证”的表面积。

2. **契约被声明了两次，两份会漂。**
   `src/plugin-api.ts`（发布面，产出基线 `.d.ts`）与 `src/client/src/plugins/types.ts`（内部面）各有一份
   `PluginContributions` / `PluginRuntimeContext`；`types.ts` **完全不 import** `plugin-api.ts`
   （`grep -rln 'from ".*plugin-api"' src` → 只有 `src/plugin-api.test.ts` 一个命中）。
   两份 `PluginRuntimeContext` 的差集实测：发布面 `src/plugin-api.ts:507-555` 26 个成员；
   内部面 `src/client/src/plugins/types.ts:628-681` 32 个成员；内部独有 6 个
   （`deleteCachedNewSession`、`deleteWorkspace`、`openModelPicker`、`openThinkingLevelPicker`、`piWebUnstable`、`reloadSession`），
   基线 `.d.ts` 里这 6 个出现次数为 0。它们唯一的消费者是 core 自己的伪插件 `src/client/src/plugins/core/actions.ts`。
   **含义：core 已经在用“契约之外”的 context，而 owner 决策 4（core 只留四类职责）要度量的正是这类东西。**

3. **plugin 真正依赖的能力大多不在贡献位里。** browser 侧实测使用 **56 个不同 `context.*` 成员**；
   另有 **17 类绕过 seam 的浏览器/Node 原生调用**（§3，逐条行号）。

4. **最小声明式集合 = 6 个命名空间 + manifest 的 source 位（S1–S7，§4）。**
   按实测覆盖：约 **40/56** 个 context 成员可退化为声明（跳转/刷新/读取/失效/配置），
   **~16 个必须保留命令式**，**13 个 hatch** 覆盖全部越界行为（§5）。
   第 (2) 层（声明式 UI 模板）的真实上限是 **11 个 panel 里只有 4 个**能由 row/field/action 语法渲染（§6 判定表）——
   与 46% LOC 集中在 render 文件这一事实一致：**第 2 层的收益是“少写重复 markup”，不是“消灭 render”。**

5. **最脆的一条不是缺功能，是字符串契约。** `workspace-tasks` 用 `error.message === "Path does not exist"` 判断文件缺失
   （`workspace-tasks/workspaceTasksClient.ts:7,29`；同一手法在 `workspaces/server/fileSuggestions.ts:237`）。
   host 改一句错误文案，插件的行为就翻转，而 TS 与基线都抓不到。这正是 S2/S3 要 input/**error** schema 的理由。

---

## 1. 每个 plugin 用了哪些 host 能力（逐条 file:line）

### 1.1 贡献位使用

| plugin | 行数 | 贡献位（证据） |
|---|---|---|
| files | 1,797 | workspacePanels `pi-web-plugin.ts:22`（id `workspace.files`、`icon: FOLDER_ICON:26`、`order: 27`、`routeAliases: ["files","core:workspace.files"]:28`）|
| git | 3,272 | workspacePanels `git/browser/git-panel.ts:136`；actions `:717`；panel 渲染 `:739,776` |
| goals | 362 | drawerSections `goals/pi-web-plugin.ts:56` |
| info | 283 | actions `info/pi-web-plugin.ts:16`；workspaceLabels `:25`；workspacePanels `:32` |
| machines | 2,483 | machineSections `machines/browser/pi-web-plugin.ts:75`；actions `:76` |
| relays | 1,051 | actions `relays/pi-web-plugin.ts:13`；workspacePanels `:26` |
| terminal | 1,938 | workspacePanels `terminal/pi-web-plugin.ts:29`（`icon: context.svg\`…\`:32`）|
| updates | 303 | actions `updates/pi-web-plugin.ts:159`；workspacePanels `:170` |
| voice | 1,665 | composer `voice/pi-web-plugin.ts:71-73`（`id:"dictate"`, `slot:"trailing"`）|
| workspace-tasks | 573 | actions `workspace-tasks/pi-web-plugin.ts:13`；workspacePanels `:26` |
| workspaces | 3,554 | navSections `workspaces/browser/pi-web-plugin.ts:91`；actions `:92` |

server 侧：git → `workspaceProvider`（`git/server-plugin.ts:39`）；goals → `operations`（`goals/server-plugin.ts:66`）；
machines → `machineRegistry` + `routes`（`machines/server-plugin.ts:28-29,45-46`）；workspaces → 7 条 `routes`
（`workspaces/server-plugin.ts:232`）；voice → `operations`；files / info / relays / terminal / updates **无 server 模块**。

### 1.2 `context` 成员的真实用途（代表性调用点）

| 能力 | 成员 | 证据 |
|---|---|---|
| 身份 / 选中态 | `machine`、`workspace`、`state`、`statusSnapshot` | `files/pi-web-plugin.ts:31`；`git-panel.ts:755`；`workspace-tasks/tasksPanelElement.ts:111`；`workspaces/browser/pi-web-plugin.ts:51,55` |
| 文件读写 | `files.{listFiles,readFile,uploadFiles,previewUrlBuilder,limits,uploadFolder}` | 行号一一对应 `filesPanelElement.ts:464,465,368,125,127,321`。**注意 `WorkspaceFiles.writeFile/deleteFile/moveFile` 被 0 个 plugin 使用**（`src/plugin-api.ts:592-625` 声明）|
| workspace 后端（唯一 JSON 通道） | `backend.request(name, input)` | `git-panel.ts:768`；契约 `src/plugin-api.ts:620`；host 实现 `src/client/src/plugins/workspaceBackend.ts` |
| server 侧 exec（对照） | `execFile`（**browser 侧 0 使用**） | `git/server-plugin.ts:193`、`workspaces/server-plugin.ts:264` |
| shell 导航 | `selectMainView`、`selectWorkspaceTool`、`terminal.open/runCommand`、`host.requestRender` | `git-panel.ts:726`；`relays/pi-web-plugin.ts:22`；`workspace-tasks/pi-web-plugin.ts:22`、`tasksPanelElement.ts:167,191`、`:219` |
| 全屏 / 画布 | `host.workspacePanelFullscreen()`、`setWorkspacePanelFullscreen()` | `terminal/pi-web-plugin.ts:50`；`tasksPanelElement.ts:207` |
| 失效 wiring | `refreshWorkspacePanels(panelId?)`；被 host 的 `onInvalidate` 回调消费 | `git-panel.ts:734`；契约 `src/plugin-api.ts:549`；host 侧 `src/client/src/plugins/registry.ts:564-576` |
| 生命周期事件（只读 facts） | `context.on?.(kind, cb)` | **契约有 6 种事件，只有 2 种被任何插件用**：`session-activity-settled`（`files/pi-web-plugin.ts:18`）、`settings-changed`（`voice/pi-web-plugin.ts:32`）；`session-selected`/`session-left`/`connection-changed`/`theme-applied` 声明后 0 消费者（`src/plugin-api.ts:90-94`）。两处订阅都写成 `context.on?.()`，因为 `on` 在契约里是可选成员（`src/plugin-api.ts:68`），`callOperation` 同理（`:78`，voice 在 `:35` 自己写了 reject 兜底）|
| 配置块 | `context.settings` | `voice/pi-web-plugin.ts:27`（`parseVoiceSettings(context.settings)`，**校验完全在插件内**）|
| 具名 operation | `context.callOperation`（契约里可选，`src/plugin-api.ts:78`） | `goals/pi-web-plugin.ts:28,34`；`voice/pi-web-plugin.ts:35`（写成 `context.callOperation ?? () => Promise.reject(…)`，插件已在防御 host 不提供该成员）|
| 对话框 / 模态栈 | `ui.showDialog`、`ui.registerModal` | `workspaces/browser/addProjectDialog.ts:24`；`machines/browser/addMachineDialog.ts:22`；`files/hostUi.ts:61` |
| URL 状态 | `ui.query.read/write`（**唯一消费者是 files**） | `files/viewMode.ts:79,82`（namespace `core.workspace.files`，`filesPanelElement.ts:547`）；契约 `src/plugin-api.ts:148-156` |
| 主题 / 断点 / markdown / 样式表 | `ui.breakpoints`、`renderMarkdownHtml`、`surfaceStyles/listStyles/textStyles/workspacePanelStyles`、`describeError`、`copyText` | 6 个 adapter：`files/hostUi.ts`(80)、`machines/browser/hostUi.ts`(79)、`workspaces/browser/hostUi.ts`(79)、`terminal/hostUi.ts`(64)、`goals/hostUi.ts`(35)、`git/browser/hostUi.ts`(19) = **356 行同构样板**；host 侧唯一实现 `src/client/src/plugins/pluginHostUi.ts:30-62` |
| 模板标签 | `html`、`svg` | `files/pi-web-plugin.ts:1,25`；`terminal/pi-web-plugin.ts:32` |
| 领域 API | `createProject`、`projectDirectories`、`createMachine`、`removeMachine`、`refreshMachine`… | 契约 `src/plugin-api.ts:512-541`；`workspaces/browser/AddProjectDialog.ts:111,124,152` |

**契约里存在但 0 个 plugin 使用的 context 成员（唯一消费者是 core 伪插件 `core/actions.ts`）**：
`prompt.getText`、`openActionPalette`、`focusPrompt`、`configureAuth`、`logoutAuth`、`openThemePicker`、
`startSession`、`archiveSession`、`stopActiveWork`、`reloadPage`。这 10 项 = core 自用能力伪装成插件契约，
是 owner 决策 4 拆 core 时第一批要还给 core 的东西。

---

## 2. server 侧能力分布

| plugin | ports | execFile | storage | 自带 Node 原生 | 贡献位 |
|---|---|---|---|---|---|
| git | 0 | **1**（`git/server-plugin.ts:193`，全部 git 命令） | 0 | `node:path` | `workspaceProvider:39` |
| goals | 0 | 0 | **0** | **`node:fs`** 直接读写 workspace 下 goal 文件 | `operations:66` |
| machines | **3** | 0 | **0** | `node:fs`（`machines/server/machineStore.ts:109`）、`node:crypto` | `machineRegistry:28-29` + `routes:45-46` |
| workspaces | **2** | **1**（`server-plugin.ts:264`） | **0** | `node:fs`/`node:path` 共 6 文件（`server/fileContentService.ts:76,87` 等） | `routes[7]:232` |
| voice | 0 | 0 | **0** | 无 | `operations` |

要点：
- **`storage`（`src/server-plugin-api.ts:31`，带 per-plugin 目录围栏 + key 不得逃逸 + 原子替换，
  `src/server/shared/plugins/pluginScopedStorage.ts`）被 0 个 bundled server plugin 使用。**
  持久状态全部走裸 `node:fs`。围栏做得很好，但没人走在里面。
- **`workspacePath` 由 browser 自由塞进 operation 入参**（`goals/pi-web-plugin.ts:31,37` → `goals/server-plugin.ts` 直接 `node:fs`），
  host 在边界上没有 schema 校验点。
- **operation 与 route 是两套并存形状**：operation 前缀 `/api/plugins`（`src/server/web/plugins/pluginOperationProxyRoutes.ts:15`），
  而 `routes` 走 `mountServerPluginRoutes(app, …, prefix)`（`src/server/web/plugins/serverPluginRouteMount.ts:20-22`）——
  workspaces 的 7 条路径是 `/projects/:projectId/workspaces/:workspaceId/{tree,file,file/move,file/preview,files}`
  （`workspaces/server-plugin.ts:76,94,112,135,153,174,210`），**直接落在 core 的路径词汇里，不带 plugin 命名空间**。
- **workspaces 的 7 条 route 与 host 自己的 `WorkspaceFiles` 通道是两套并行文件 IO**：
  host 侧 `src/client/src/plugins/workspaceFiles.ts:3-4` 走 core 的 `/api` upload/preview，
  插件侧另起 7 条 route 给自己的 tree/suggestions 组件。同一个“读工作区文件”事实有两个服务端。
- `machineRegistry`（`src/server-plugin-api.ts:119`）已明确写成“**取代 host 侧 machine JSON 路由**，
  避免 core→plugin 调用”（`:200-205` 注释）——这是仓库内最接近 owner 决策 4 的既有先例，应作为 server 侧的模板形状。

---

## 3. 越过 seam 的行为（17 条，逐条实测；契约目前完全不知情）

| # | 行为 | 证据 | 现状 |
|---|---|---|---|
| B1 | `window.localStorage` 私有偏好 | `terminal/terminalSoftKeysPreference.ts:1,59`（`pi-web.terminal.softKeys`）；`files/viewMode.ts:11,90`（`pi-web.workspace.files.viewMode`）；`git/browser/gitFileViewPreference.ts:1,36`（`pi-web.gitFileView`，**连自己 plugin id 都没带**） | 无声明位；key 命名 3 种风格；host 无清理/导出/迁移入口 |
| B2 | `navigator.clipboard` + `execCommand` 复制兜底 | `info/infoInternals.ts:114`；`workspaces/browser/clipboard.ts:42,45,59` | `ui.copyText` 已存在（`pluginHostUi.ts:32`）却被绕开；`workspaces/browser/clipboard.ts` 与 core `src/client/src/clipboard.ts` 去空白后**逐行相同**（101 行 vs 101 行，`diff -w` 为空）——有 seam，仍复制了实现 |
| B3 | 自带 markdown 管线 + 自带 sanitizer | `relays/markdownDocument.ts:1`（`import { marked } from "./vendor/marked.esm.js"`，42KB vendored）；`:3-6` 注释自陈“规则在 core 的 `src/client/src/formatting/markdown.ts`，plugin 不能 import，所以复制了一份”；自带 `escapeHtml:32`、`sanitizeHtml:41` | `ui.renderMarkdownHtml` 已存在（`pluginHostUi.ts:45`，files 在用 `files/hostUi.ts:52`）。**同一 XSS 边界两份实现** |
| B4 | 自建 router，绕过 `ui.query` | `git/browser/gitRoute.ts:54`（`new URL(window.location.href)`）、`:71`（`history.replaceState`）、`:133-148`（自带 HistoryState）、`:156-158`（`split("|")` 编码多值状态），并读 core 的 key `core.workspace--expanded` | `ui.query.write` 是 per-call 单 key、每次一次 history 提交（`src/client/src/namespacedQueryArgs.ts:104-124`），**无法原子提交 mode+diff+commit**；git 因此自建 router，并在 6 个文件间接 `onNavigate` 回调 |
| B5 | 自定义元素作为副作用挂载 | 12 处 `customElements.define`/`@customElement`（`git-panel.ts:1200,1265`；`relaysPanelElement.ts:22`；`tasksPanelElement.ts:23`；`terminal/defineTerminalPanel.ts`；`files/viewMode`、`workspaces`、`machines`、`goals` 各若干） | registry 只对 **message tag** 做认领与冲突检测（`src/client/src/plugins/registry.ts:146-160`）；custom element tag 无认领机制，两插件可撞同一 tag |
| B6 | `innerHTML` + 手写 escape | `relays/relaysPanelElement.ts:68,291,330,373,376`；`workspace-tasks/tasksPanelElement.ts:69` | 这些元素不走 lit，因此不参与 host render 生命周期/CSP 假设 |
| B7 | `window.confirm` / 全局事件总线 | `tasksPanelElement.ts:156`（confirm）；`:8,220`（`window.dispatchEvent(new Event("pi-web-workspace-tasks-config-changed"))`） | `ui.showDialog` 与 `context.on(...)` 都在，但无机制阻止绕行；跨插件通信走全局总线 |
| B8 | 观察/读回宿主主题与布局 | `terminal/TerminalPanel.ts:78`（`MutationObserver` on `document.documentElement`）、`:884`（`getComputedStyle(el).getPropertyValue(name)`）、`:83`（IntersectionObserver）、`:338`（ResizeObserver）、`:114,346`（rAF） | `ThemeTokens` 是**单向写入**（`src/plugin-api.ts:720`）；主题读回只能 `getComputedStyle`。host 发布 4 条 breakpoint 查询（`pluginHostUi.ts:38-44`），**只有 1 条被使用**（`terminal/hostUi.ts:56-57` coarseOrMobile）|
| B9 | 视口断点自拼 | 插件里硬编码 `@media`：`max-width:760px` ×4（`workspace-tasks/tasksPanelElement.ts:309`、`terminal/TerminalPanel.ts:736`、`workspaces/browser/ProjectDialog.ts:368`）、`640px`（`files/fileViewerElement.ts:366`）、`520px`（`updates/pi-web-plugin.ts:113`）、`240px/180px`（`relays:523`）；另 `@media (pointer: coarse)` ×6、`@media (hover: hover)` ×10 | host 拥有 4 条命名断点，但无“禁止自拼断点”的契约位 |
| B10 | CSS token 命名空间外扩 | 插件实用 **73 个** `--pi-*`；发布契约里只有 **41 个** token 字面量（`src/shared/pluginApiTypes.ts:241-244` 的 `ThemeToken = Legacy｜SemanticSurface｜Foreground`）；**45 个不在契约内**，最高频：`--pi-space-4`(72 处/14 文件)、`--pi-space-3`(61/16)、`--pi-space-5`(37/12)、`--pi-radius-md`(30/11)、`--pi-text-xs`(21/12)、`--pi-font-mono`、`--pi-layer-*`、`--pi-dot-*`、`--pi-terminal-*`。这 45 个全部定义在 **`src/client/index.html`**（该文件定义 108 个 `--pi-*`），即**在 app shell CSS 里而不在可主题化契约里**。反向也有：契约里 13 个 token 无任何插件使用（`--pi-purple*`、`--pi-shadow*`、`--pi-success-*`）| 事实契约零声明。后果不只是漂移：**第三方主题改不动间距/字号/层级**，因为 `ThemeTokens` 只覆盖 41 个，其余 45 个不是主题变量 |
| B11 | 样式投递四国演义 | (a) lit `static styles` 17 文件；(b) 模板内 `<style .textContent=…>`（`git-panel.ts:776`）；(c) `innerHTML` 注 style（`tasksPanelElement.ts:69`）；(d) `adoptedStyleSheets` 借 host 表（5 个 hostUi adapter） | 无“样式来源”声明，host 无法审计/CSP 预算（relays 的 CSP 风险自陈于 `relays/README.md:69`）|
| B12 | 第三方包 import（被宿主构建打进来） | `@xterm/xterm`+`@xterm/addon-fit`（`terminal/TerminalPanel.ts:5-6`，`:332-338,434-438` 多次实例化）、`lit`（30/121 文件）、vendored marked | manifest 无 dependencies 位；`scripts/build-plugins.mjs` 用 esbuild 打包，第三方代码物理进 bundle 但契约无记录 |
| B13 | 原生设备/媒体 API | `voice`：`new WebSocket(url)`（`voice/pi-web-plugin.ts:43`）、`fetch(config.endpoint)`（`voice/lib/speechToText.ts:51`）、`navigator.mediaDevices`+AudioWorklet（`voice/lib/microphoneSamples.ts:19,29`，另有第二份采集实现 `voice/lib/browserVoiceRecorder.ts:40,51`）、`crypto.randomUUID()` | 属 domain 能力，但契约无法在激活前告知“要麦克风 + 跨源连接”，也无法做 connect-src 预算 |
| B14 | HTTP 面分布 | 插件侧只有 1 处裸 `fetch`（`voice/lib/speechToText.ts:51`，外部 ASR endpoint）+ 2 处 WebSocket；**terminal 的 19 个 `/api/terminal/*` 全在 host 侧**（`src/client/src/plugins/workspaceTerminalSessions.ts`）| seam 在此处是干净的；但 19 个 endpoint 的形状只由测试锁定（`docs/quality/testing.md` “route shapes are contract”），契约类型里没有 endpoint 清单 |
| B15 | host 事实从构建期偷偷流入 | `updates/pi-web-plugin.ts:60` 从 `import.meta.url` 解析 `piWebDockerMode`（host 侧注入点 `src/server/web/piWebPluginService.ts:271`）；host 把 plugin-private 事实写进 Docker 提示（`src/server/web/piWebPluginService.ts`） | `docs/architecture.md:338` 已把它记为已知泄漏；本质是 **host→plugin 的输入无处声明** |
| B16 | Node 原生模块绕过 `storage` 围栏 | `node:fs` 出现在 `goals/server-plugin.ts`、`workspaces/server/{fileContentService,pathSuggestionService,moveTargetService,trashService,indexRebuild,workspaceResolver}.ts`、`machines/server/machineStore.ts:109`；`node:child_process` 2 处 | `storage`/`execFile` 围栏存在但零使用；裸 `node:fs` 无路径围栏声明 |
| B17 | 错误语义用字符串匹配 | `workspace-tasks/workspaceTasksClient.ts:7,29`（`missingWorkspaceFileError = "Path does not exist"` 与 `error.message` 比对）；`workspaces/server/fileSuggestions.ts:237` 同一手法 | 契约无 error schema；host 改文案即静默改变插件行为，TS 与基线都抓不到 |

越界密度排序：**git**（B4+B5+B1+轮询）> **terminal**（B8+B12+B15）> **workspaces**（B2 复制+B16+并行 route）>
**relays**（B3+B6+B11）> **workspace-tasks**（B6+B7+B17）> **files**（B1+）> goals / machines / updates / info / voice（各 1–2 项）。

---

## 4. 最小声明式集合：6 个命名空间（+ manifest source 位）

硬约束：**必须在插件代码被执行之前可读、可校验、可 diff**（否则懒加载、权限门、GitHub 仓库解析都无从谈起）。
每加一个字段都用 §3 的实测行号证明。id 体系直接沿用已有的双语法 + 双层校验
（`src/shared/pluginApiTypes.ts:35-52` 的 `LocalContributionId`/`QualifiedContributionId`，
运行时校验 `src/client/src/plugins/registry.ts:146-160`），不另造。

### S1 `surfaces`：两个列表，不是一张表（决策 A）

现状是一张 context 划一的贡献表（`src/plugin-api.ts:351-363`），手机与桌面共用 order——正是 owner 要废的形状。
声明必须按设备分列，每项带 `slot / id / order / visibility / icon`：

```jsonc
"surfaces": {
  "phone":   [ { "slot":"workspaceTool", "id":"workspace.files", "order":10, "icon":"folder", "visibility":"workspace" } ],
  "desktop": [ { "slot":"workspaceTool", "id":"workspace.files", "order":10 },
               { "slot":"workspaceLabel","id":"provider" },
               { "slot":"action", "id":"view.files", "shortcut":"mod+2" } ]
}
```

为什么必须先声明（实测）：
- `getWorkspacePanel` 是 **visible-first 再退 order**（`registry.ts:537-556`、`isWorkspacePanelVisible:559`）——
  可见性必须能在没有 context 的情况下求值，否则 URL 直达一个 hidden panel 的行为不可预测。
- `navSections` 的 slot 语义是“**未知 id 就不渲染**”（`src/plugin-api.ts:337-339` 注释）——只有先声明才能提前校验而不是静默不渲染。
- `icon` 现在只能是 `TemplateResult`（`src/plugin-api.ts:284` `WorkspacePanelIcon`），所以“有什么图标”在加载代码前不可知；
  实测插件写法 `terminal/pi-web-plugin.ts:32` 把整段 SVG 内联在注册处。声明位必须改为**具名资源引用**（可选内联兜底）。
- 两个设备列表确实需要不同 order：`files`（`pi-web-plugin.ts:27`）与 `updates`（`:170`）、`terminal`（`:29`）当前共用同一 order 空间。

### S2 `data`：声明式数据源 + wiring（决策 B 第 3 层；当前最大缺口）

| 今天怎么取数 | 证据 | 能否声明 |
|---|---|---|
| operation | `context.callOperation`（`goals/pi-web-plugin.ts:34`）；`backend.request`（`git-panel.ts:768`） | **能**（具名调用约定已在 server 侧成型：`src/server/shared/plugins/pluginOperations.ts:9-11`）|
| 工作区文件 | `context.files.readFile`（`tasksPanelElement.ts:212`；`workspaceTasksClient.ts:24-29`） | **能**（`{kind:"workspaceFile", path, parser}`）|
| 轮询 | `window.setInterval`（`git-panel.ts:1186`）；`COMMAND_RUN_POLL_INTERVAL_MS`（`terminal/TerminalPanel.ts:26`） | **能**（`policy.pollMs / whenVisible`）|
| 可见性驱动 | 共享 `IntersectionObserver`（`git-panel.ts:1205,1257`）、`terminal/TerminalPanel.ts:83` | **能**（`whenVisible`）|
| 事件驱动 | `context.on("session-selected")`、`on("settings-changed")`（`voice/pi-web-plugin.ts:35`） | **能**（`invalidatesOn`）|
| 流 | `voice` WebSocket/AudioWorklet（`voice/pi-web-plugin.ts:43`）；terminal socket | **不能** → §5-E3 |

**关键证据：失效管道已经是声明式的，缺的只是另一半。** host 已提供
`WorkspacePanelContribution.onInvalidate?`（`src/plugin-api.ts:680`）+ `invalidateWorkspacePanels`
（`registry.ts:564-576`）+ `refreshWorkspacePanels(panelId?)`（`src/plugin-api.ts:549`）。
把“什么数据、什么时候刷新”也声明出来，host 才能做去重、懒加载、后台合并、请求预算，
才能替插件消掉 `git-panel.ts:1172-1186` 那套自建 popstate+interval+observer。

```jsonc
"data": [
  { "id":"status", "operation":"git.status", "scope":"workspace",
    "input": { "workspaceId":"$selected.workspaceId" },
    "invalidatesOn": ["session-activity-settled","settings-changed"],
    "policy": { "whenVisible": true, "pollMs": 15000 },
    "errors": { "missing": { "kind":"notFound" } } }
]
```
`input` 的 `$selected.*` 由 host 解析 → 顺带解决 B17（`workspacePath` 不再由 browser 裸传）与 B16 的路径围栏；
`errors` 直接针对 B17 的字符串匹配。

### S3 `operations`：server 侧只补三点

形状已经对了（`operations` / `routes` / `machineRegistry` / `workspaceProvider`，
`src/server-plugin-api.ts:112-128`）。缺的三件，全部有实测根据：
1. **`input`/`output`/`error` schema**（否则 B17 永远在）。
2. **routes 必须命名空间化**：workspaces 的 7 条路径今天直接借用 core 的 `/projects/:id/workspaces/:id/*` 词汇
   （`workspaces/server-plugin.ts:76-210`），而 operation 有 `/api/plugins` 前缀（`pluginOperationProxyRoutes.ts:15`）——
   同一 server 契约里两种命名策略。声明位必须说明 `scope: machine|project|workspace` 并由此推导前缀。
3. **`networkPorts`、`agentFacts` 标注为“无 bundled 证据”**（与 `themes` 同批）。

### S4 `settings`：schema + 默认值 + client 偏好

今天 `context.settings` 是 `piWebPlugins.settings[pluginId]` 原样透传（`src/server/shared/piWebPluginCatalog.ts:196-204`），
**校验完全在插件内**（`voice/voiceSettings.ts` 手写解析）。`settingsSections` 声明位存在但 **0 个 bundled 使用**，
等价于“今天改任何插件设置都要手编 app config JSON”。同时 **client 侧偏好无处声明**（B1 的三个 localStorage key）。
必须声明 `{ server: <json-schema>, client: [{id, kind, default, scope}], ui: [{section, fields}] }`。
额外理由：`settingsRevision` **已经是配置指纹**（`piWebPluginCatalog.ts:47`，sessiond 启动时捕获），
声明 schema 后它才能从“指纹”升级为“迁移/校验触发器”；`settings-changed` 事件也已存在（`types.ts:49`）。

### S5 `capabilities`：权限/能力清单（当前 100% 隐式）

这是 owner 决策 4 能否落地的唯一抓手——core 要知道自己还欠插件什么，先要有清单。最小集合即 §3 全表：
`browser.storage`(B1) / `browser.clipboard`(B2) / `browser.markdown`(B3) / `browser.navigation.batch`(B4) /
`browser.customElements`(B5) / `browser.rawDom`(B6,B7) / `browser.observers`(B8) / `browser.thirdParty`(B12) /
`browser.media`(B13) / `net.connect`(B13) / `node.fs.workspace|pluginPrivate`、`node.childProcess`(B16) /
`host.facts`(B15) / `tokens`(B10) / `breakpoints`(B9) / `styles`(B11)。

不声明的代价是实测数字：**契约声明 41 个 token，插件实际依赖 73 个（45 个在 app shell CSS 里）；
host 发布 4 条断点查询，只有 1 条被用。** **隐式契约必然漂移，这是数据不是观点。**

### S6 `presentation`：token / 样式表 / 断点 / markdown 必须“借得写明”

- `usesTokens`: 需要的 `--pi-*` 名单或分组（`space.* / text.* / radius.* / control.* / elevation.* / layer.* / font.*`）；
  host 在加载时报“你用了 N 个契约外 token”（B10 的 45 个）。同时必须决定：这 45 个是**升进可主题化契约**，
  还是**明确划为不可主题化的 app shell**（当前状态是两者都不是）。
- `adoptsSheets: ["surface","workspacePanel","text","list"]` —— 直接替掉 6 个 hostUi adapter 里 356 行的
  `adoptedStyleSheets` 手工搬运（B11-d）。
- `breakpoints`: 引用 host 命名断点，禁止裸 `@media` 数字（B9 的 6 处硬编码）。
- `markdown: "host" | "own"`（own 需同时声明 sanitizer + thirdParty）——针对 B3。

### S7 manifest 的 `source` 位（决策 3 的落点；不是能力但必须在同一份文件里）

今天的 layout 契约是 **`package.json` 里的 `piWeb.plugins[]`**，字段仅
`{id, browserRoot, module, serverModule, machineSpecific, runs}`（例：`pi-web-plugins/git/package.json`；
解析器 `src/server/shared/piWebPluginCatalog.ts:662-695`）。`source` 无处声明，而“拆到 GitHub repo”需要它。
最小增量：`{ "kind":"npm"|"github"|"dir", "package"|"repo"|"path", "resolve":"exact|machine|env" }`。
`machineSpecific` 已证明同一插件需按 machine 解析不同副本（`registry.ts:714-729` 的 `perMachineId` 索引），
catalog 也已带 `source: package|local|project|agent` 与 `scope`（`piWebPluginCatalog.ts:15,28-29`），
只是那是**发现来源**而非**分发来源**。

**实现提示（实测）**：解析器是**白名单投影**——未知 key 被静默丢弃（`piWebPluginCatalog.ts:687-694` 只挑已知字段重新组对象）。
所以给 manifest 加 `surfaces/capabilities` 不需要改 parser 就能“通过”，但也不改 parser 就**读不到**；
更重要的是：**今天字段名写错是 fail-open（静默忽略），新声明位必须配 fail-closed 校验**，
否则声明式契约会变成第二份 `showWhenNarrow`（该字段在 `src/` 与 11 个插件的非测试代码里都不存在，是历史残留概念）。

---

## 5. 不会被声明式化的用法（E1–E13，每项给 hatch 名）

原则：**不消灭 render，只消灭隐式依赖。** hatch 必须出现在 S5 清单里，可申报、可报告、可设预算。

| # | 不可声明的用法 | 证据 | 为何声明式化不了 | hatch |
|---|---|---|---|---|
| E1 | 复杂 render 树 + 增量更新（文件树、diff viewer、commit history、machine 列表） | `filesPanelElement.ts`（634 行，`render()` 从 :86 起）；`git-panel.ts:739,776`；`machines/browser/MachineList.ts` | 虚拟化 / 多级折叠 / 拖放 / per-row 局部重渲染，row-field 语法表达不了 | **保留 `render`**（决策 B 第 1 层），但必须声明它渲染哪个 surface、依赖哪些 data id |
| E2 | 第三方渲染引擎挂载（xterm） | `terminal/TerminalPanel.ts:5-6,332-338,434-438` | 需要真实 DOM 节点、持有实例生命周期、自行绘制、还要 `getComputedStyle` 取色 | **`mount`**：host 给受管容器 + mount/unmount + **主题注入回调**（替掉 `:78,884` 的 MutationObserver+getComputedStyle） |
| E3 | 实时流（terminal socket、voice 听写流） | `voice/pi-web-plugin.ts:43`；host 侧 `workspaceTerminalSessions.ts` | 不是请求/响应，S2 的 operation 模型套不上 | **`stream`**：声明 `{kind:"stream"}` + host 提供 socket 工厂（含 connect-src 预算） |
| E4 | 原子多 key 路由状态（git：mode+diff+commit 一次落地） | `gitRoute.ts:54,71,133-148,156-158` | `ui.query.write` per-call 单 key（`namespacedQueryArgs.ts:104-124`）；git 被迫自建 router 并读 core 的 `core.workspace--expanded` | **`navigation.batch`**：`query.writeAll(namespace, {…}, {replace})` + 跨插件可读 key 白名单 |
| E5 | 客户端持久偏好 | 3 处 localStorage（`terminal:1,59`；`viewMode.ts:11,90`；`gitFileViewPreference.ts:1,36`） | **browser 侧根本没有 storage API**（`storage` 只在 server 契约 `src/server-plugin-api.ts:31`）| **`clientStorage`**（声明即 hatch）：per-plugin key 命名空间 + 迁移钩子；schema 走 S4 `settings.client` |
| E6 | 主题读回（终端要真实 RGB） | `terminal/TerminalPanel.ts:78,448,884` | `ThemeTokens` 单向写入（`src/plugin-api.ts:720`）；`theme-applied` 事件**已经存在但只带 `themeId`**（`src/plugin-api.ts:92`），拿不到解析后的 token 值，终端只能 `getComputedStyle` 自己读回来 | **`theme.read`**：不是新事件，是给既有 `theme-applied` 补 resolved-token payload |
| E7 | 自定义元素作副作用挂载 | 12 处 define（`relaysPanelElement.ts:22`、`tasksPanelElement.ts:23`、`git-panel.ts:1200,1265`…） | relays/workspace-tasks 完全不用 lit，tag 是一等挂载形态；无认领机制 | 保留 `define`，但 **tag 必须像 message tag 一样在 S1 声明并认领**（复用 `registry.ts:146-160` 的冲突检测）|
| E8 | 全局总线 / 原生模态 | `tasksPanelElement.ts:8,156,220` | 声明式 wiring 只在 host 主动 push 时生效，插件自行广播 host 看不见 | 声明 `events.publish` + `rawDom.confirm` 后允许；否则由 `scripts/check-arch-boundaries.mjs` 类守卫拒绝 |
| E9 | Node 直接 IO | `goals/server-plugin.ts`、`workspaces/server/*`、`machines/server/machineStore.ts:109`；`execFile` `git/server-plugin.ts:193`、`workspaces/server-plugin.ts:264` | `storage` 有围栏但 0 使用；workspace 文件服务确实需要真 fs | 三级 hatch：`fs.pluginPrivate`（=现有 `storage`）/ `fs.workspace`（围栏到 workspace root）/ `childProcess`（现有 `execFile` + 超时/cwd/输出上限）。裸 `node:fs` 只允许出现在 host wrapper 上 |
| E10 | operation 入参里的路径与身份 | `goals/pi-web-plugin.ts:31,37` → `goals/server-plugin.ts` | 常规输入可由 S2 `$selected.*` 解析，provider 回传的数据仍需自定义校验 | S3 的 `input/error` schema + host 侧 path fence |
| E11 | host 事实（Docker 模式、socket base URL） | `updates/pi-web-plugin.ts:60`（`import.meta.url`）；注入方 `src/server/web/piWebPluginService.ts:271` | 这是 host→plugin 的**输入**，不是能力；今天靠 URL 猜 | **`host.facts`** 只读声明字段（`dockerMode`、`apiBase`、`socketBase`）|
| E12 | provider 协议（git 的 worktree 发现/删除计划） | `git/server-plugin.ts:39`（`probe/list/request/prepareRemove` + AbortSignal + `data` 载荷） | 本质是接口不是数据；改成数据会得到一门新 DSL，收益不抵成本 | **保留 provider 接口**（形状已对），只在 S1/S3 声明它 claim 哪些 project、暴露哪些 operation |
| E13 | 焦点 / 键盘编排（nav section 间跳转、弹层焦点陷阱、点击外部关闭） | `workspaces/browser/{WorkspaceList.ts:82,ProjectList.ts:66}`、`machines/browser/{MachineSwitcher.ts:39,MachineList.ts:51}` 的 4 处 `document` 级监听；nav 的 `focusPreviousSection/focusNextSection/cancelKeyboardNavigation`（`workspaces/browser/pi-web-plugin.ts:60-62`） | 焦点 choreography 无法用数据表达 | 保留命令式，但 **document 级监听必须申报**（`rawDom.documentListeners`），host 才能审计卸载清理 |

hatch 共 13 项，其中 **E1/E7/E12/E13 本质是“把现有自由显式化”**，真正的新增只有 E4/E5/E6/E11 四项——
也就是 **契约缺的 4 个 API，而不是 40 个。**

---

## 6. 第 2 层（声明式 UI 模板）能走多远：逐面判定

判定口径：**去掉 render 之后，这个 surface 还剩什么？**

| Surface | 判定 | 证据 |
|---|---|---|
| `workspaceLabels` | **已经完全声明式**：`items()` 返回 `WorkspaceLabelItem[]`，`type: "text"｜"link"｜"render"`（`src/plugin-api.ts:711-730`） | 这就是 owner 要的 UI 模板形状，可直接当先例引用 |
| `actions`（8 个插件） | **是**：`{id,title,description,shortcut,group,enabled,disabledReason}` 全可声明，只 `run` 保留；`enabled` 多为 `state.selectedWorkspace !== undefined` 这类谓词（`workspace-tasks/pi-web-plugin.ts:19`） | |
| `composer`（voice） | **控件可声明，管线不可**：`slot/title/icon/enabled/status` 已声明式（`src/plugin-api.ts:441-452`），AudioWorklet+WebSocket 只能走命令式 `run` | |
| `drawerSections`（goals） | **部分**：列表行/徽标可声明；polling + localStorage fallback + live activity 需 S2 + E5 | `goals/README.md:52-54` |
| `machineSections`（machines） | **行可声明，菜单/对话框不可**：context 已是 host 喂好的 `machines[]/machineFlags[]/machineStatus[]` snapshot + 回调（`src/plugin-api.ts:304-336`）；`MachineSwitcher.ts:39` 的焦点/外点关闭不可 | |
| `navSections`（workspaces） | **不可**：贡献物只有 `{id, order, focus, render}`（`src/plugin-api.ts:287-294`），render 交出整个 `<workspace-list>`；键盘状态机活在插件里 | |
| `workspacePanels`：files / git / terminal | **不可**：交互面积即产品本体（IDE 面板 + diff + xterm 全屏） | |
| `workspacePanels`：relays / info / workspace-tasks / updates | **勉强可**（纯 innerHTML + 手拼 markup，说明它们**没有**依赖富渲染能力） | `relaysPanelElement.ts:68,291,330,373,376`；`tasksPanelElement.ts:69`；`updates/pi-web-plugin.ts` |

量化：**11 个 panel 类 surface 中约 4 个可由 row/field/action 语法渲染，5 个必须保留 render。**
这与“46% LOC 住在 31 个 render-bearing 文件”一致：**第 2 层的收益是少写重复 markup（并顺手统一 relays/workspace-tasks 的
innerHTML/CSP 风险），不是消灭 render。**

另一面必须记下：**host 已在给插件喂 join 后的数据**，这是第 2 层的正确基础，不要退回去让插件自己 join——
`MachineSectionContext.machines[]` 每项带 `workspaceCount/onlineWorkspaceCount/machineStatus/canEdit/canDelete/isDefault`
（`src/plugin-api.ts:313-336`）、`NavSectionContext` 带 `statusSnapshot/deletingWorkspaceIds/labelItems()`（`workspaces/browser/pi-web-plugin.ts:51-56`）。
这些字段在 2026-11 之前还不存在，插件当时自己拼状态。

---

## 7. 契约落地骨架

```jsonc
{
  "manifestVersion": 1,
  "id": "git",                                   // 沿用 PluginId 校验（pluginApiTypes.ts:12）
  "apiVersion": 1,
  "source": { "kind":"github", "repo":"…" },     // S7（新；现无此位）
  "runs": "both", "machineSpecific": true,       // 沿用 package.json piWeb.plugins 现有字段
  "surfaces":     { "phone":[…], "desktop":[…] },                      // S1
  "data":         [ … ],                                              // S2
  "operations":   [ { "name":"git.status", "scope":"workspace", "input":{…}, "error":{…}, "needs":["childProcess"] } ], // S3
  "settings":     { "server":{…}, "client":[…], "ui":[…] },             // S4
  "capabilities": { "browser":[…], "node":[…], "net":{ "connect":["wss:","http://127.0.0.1:*"] } }, // S5
  "presentation": { "usesTokens":[…], "adoptsSheets":[…], "breakpoints":[…], "markdown":"host" },   // S6
  "escapeHatches":[ { "id":"mount","for":"xterm" }, { "id":"navigation.batch" } ]                    // §5
}
```

manifest 生效后 host 可在 **执行插件代码之前** 做、今天做不到的 6 件事：
1. **懒加载**：S1+S2 决定“本机/本设备/当前可见性值得加载哪个 bundle”（现状：已启用插件的 browser 模块无条件求值，12 处 `define` 是模块副作用）。
2. **权限门 + 首屏审计**：“此插件要麦克风 + 3 个跨源连接 + 裸 `node:fs`”能报出来（B13/B16）。
3. **请求预算/去重**：S2 之后才能合并同 scope 请求、限制 `pollMs`（今天 git/terminal/goals 各自 setInterval）。
4. **提前的 id / tag / 断点 / token 冲突校验**：把 `registry.ts:146-160` 的 claim 机制扩到 custom element tag 与 `--pi-*`（B5/B9/B10）。
5. **配置校验与迁移**：S4 + 现有 `settingsRevision` 指纹（`piWebPluginCatalog.ts:47`）。
6. **core 拆分度量**（决策 4）：S5 是唯一能把“core 还欠插件什么”变成可减账单的东西。
   现成基线：`corePlugin`（`src/client/src/plugins/core/actions.ts`，257 行，经 `PiWebApp.ts:3872` 的
   `registry.register({id:"core", plugin: corePlugin})` 走同一 seam）是上述 10 个 context 成员 + 6 个内部面独有成员的
   **唯一消费者**——S1–S7 一生效，core 的内建 surface 也必须填同一份声明，账立刻可见。

---

## 8. 基线与不变量（必须复用，不要另造）

`test-fixtures/plugin-api-baseline/`：9 个文件 2,884 行（`plugin-api.d.ts` 685、`server-plugin-api.d.ts` 335、`shared/` 7 份）。
刷新链条 **四步缺一不可**（`README.md:175`、`docs/architecture.md:346`、`docs/quality/testing.md:50`）：
`build:plugin-api-package` → 拷 dist 进 baseline → `build:plugin-api` → `smoke:package-install`。
S1–S7 的任何改动都必须走这条链，并保留以下既有不变量：

- **双语法 id**：`LocalContributionId` 禁 `:`、`QualifiedContributionId` 必带 `pluginId` 前缀，类型层 + 运行时层双校验
  （`src/shared/pluginApiTypes.ts:35-52`；`registry.ts:146-160`）。S1/S2 直接沿用。
- **“能力缺失 = 字段缺席”，不是 `capabilities: {…}` 旗标**（`src/server-plugin-api.ts:151-155` 注释、`docs/architecture.md:338`）。
  ⇒ S5 的 `capabilities` 是**插件申报**（我要用什么），与这条 host 侧不变量语义不同，命名上要区分开（建议 `needs:`）。
- **lifecycle event 是只读 facts，不是 hook**（`src/client/src/plugins/types.ts:36-40`）。
  S2 的 `invalidatesOn` 必须建在这条语义上，否则插件又能拦截宿主行为，core 就拆不干净。
- **operation 按名字声明而非 URL**（`src/server/shared/plugins/pluginOperations.ts:9-11`）。S2 引用 operation 的格式以此为准。
- **storage 的单目录围栏 + key 不得逃逸 + 原子替换**（`pluginScopedStorage.ts`）。E9 的 `fs.pluginPrivate` 直接复用。
- **registry 已修的不变量不要退回**：backend revision 精确匹配（`registry.ts:489-499`）、跨 workspace 状态隔离
  （`registry.ts:520-531`）、per-machine 注册隔离（`registry.ts:714-729`）、单 message-tag 认领（`:146-160`）。
- **新的 seam 守卫有现成挂载点**：`scripts/check-arch-boundaries.mjs`、`scripts/check-no-dom-in-server-utils.mjs`
  已是 contract lint；§3 的 B7（`window.confirm`/全局 dispatch）、B9（裸 `@media` 数字断点）、B10（未申报 `--pi-*`）
  属同一类静态守卫，不需要新机制。
- **必须先修的前置**：`src/plugin-api.ts` 与 `src/client/src/plugins/types.ts` 两份平行契约（§0.2）。
  在两份声明上各加一遍 S1–S7 会把漂移面翻倍；正确顺序是先让 `types.ts` 引用 `plugin-api.ts`（或反之），
  再动形状。

---

## 9. 覆盖率与残差（可复核）

| 集合 | 数量 | 依据 |
|---|---|---|
| browser 侧被使用的 `context.*` 成员 | 56 | 全量 grep 去重 |
| 其中可退化为 S1–S4 声明（跳转 / 刷新 / 读取 / 失效 / 设置 / 具名 operation） | ~40 | §1.2 各行号 |
| 其中必须保留命令式（prompt 编辑、焦点、mount、stream、fullscreen、dialog） | ~16 | `prompt.*`、`terminal.*`、`host.*`、`ui.showDialog`、`projectDirectories`… |
| 契约有、**0 个 plugin 使用**的贡献位 | 4 UI + 2 server | `themes`、`themePairs`、`settingsSections`、`messageRenderers`；`agentFacts`、`networkPorts` |
| 契约有、**唯一消费者是 core 伪插件**的 context 成员 | 10 | §1.2 末段 |
| 契约有 6 种 lifecycle event、被使用的 | **2 / 6** | `files/pi-web-plugin.ts:18`、`voice/pi-web-plugin.ts:32` |
| 契约声明 / 插件实用 / 契约外 的 CSS token | 41 / 73 / **45** | `pluginApiTypes.ts:241-244` vs 11 插件全量 token；45 个定义在 `src/client/index.html`（共 108 个）|
| host 发布断点被使用比例 | **1 / 4** | 仅 `terminal/hostUi.ts:56-57`；其余 6 处硬编码 760/640/520/240/180 |
| 声明式 UI（第 2 层）可覆盖的 panel | **4 / 11** | §6 判定 |
| 必须申报的 hatch | 13（其中真正新增 API 仅 4 个） | §5 |
| 6 个 hostUi adapter 的样板行数 | 356 | 80+79+79+64+35+19 |

**结构性残差（不是待修的债）**：真实 render 树（46% 的 LOC）、第三方渲染引擎、双向实时流、
焦点 choreography、provider 协议。

---

## 10. 需要 owner 定的三件事（其余证据已足够）

1. **S5 capabilities 是强制还是报告式？** 强制 = 11 个插件立刻要补 manifest（B1/B2/B8/B9/B10/B12/B16 全要申报）；
   报告式 = 先只报 mismatch（例如 45 个契约外 token、6 处硬编码断点），零破坏但收敛慢。
2. **S1 的 phone / desktop 是两张独立表，还是一张表 + 设备 override？** 证据要求“可分列”（`navSections` 的未知 slot 不渲染语义、
   `getWorkspacePanel` 的 visible-first 解析、图标必须是可预读的资源引用），但 owner 已明确“先只分两份 list、不做 tablet/pencil”，
   需要定的是 **order/visibility 是否允许按设备不同**。
3. **B10 / B2 / B3 这三处“复制的契约”如何处置？**
   (a) 45 个 spacing/type/radius/elevation/layer token：升进可主题化契约，还是明确划为不可主题化的 app shell？
   (b) `workspaces/browser/clipboard.ts` 与 core `src/client/src/clipboard.ts` 去空白后逐行相同；
   (c) `relays/vendor/marked.esm.js`（42KB）+ 自带 `sanitizeHtml` 与 `ui.renderMarkdownHtml` 并存。
   是把 S6 定为“必须走 host”（删副本），还是把“自带实现”固化成一个可申报 hatch，需要 owner 定调。
