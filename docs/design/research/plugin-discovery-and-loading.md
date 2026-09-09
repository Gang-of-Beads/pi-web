All evidence gathered. Composing the final report.

**Note on output path:** this run's toolset has no write-capable file tool (read/grep/find/ls/bash only; the owner's standing rules forbid heredoc/`cat >` shell writes), so per the runtime fallback rule I return the complete artifact inline below for persistence at **`/tmp/plugin-loading.md`**.

---

# 插件发现、安装与加载：现状全链路追踪，以及“GitHub 仓库安装”“表面懒加载”所需条件（评审 lanes：discovery / installation / loading）

评审范围：只读分析，未修改仓库任何文件。所有结论均给出 file:line 证据；无法核实的标注 **NOT VERIFIED**。

---

## 1. 现状：一个插件从“被找到”到“在浏览器里渲染”的完整链路

### 1.1 发现：五个根，两个进程各自组装

发现逻辑集中在进程无关的 `PiWebPluginCatalog`（`src/server/shared/piWebPluginCatalog.ts`），daemon 与 web 各建一个实例：

| 根 | 来源 | 证据 |
|---|---|---|
| bundled | `<packageRoot>/dist/pi-web-plugins` | `src/server/shared/piWebPluginCatalog.ts:297-308`（`defaultPluginRoots` + `bundledPluginRoot`） |
| dev | `<cwd>/plugins/`，仅当源码 checkout（存在 `src/server/index.ts`） | `piWebPluginCatalog.ts:311-314`（`sourceCheckoutPluginRoots`） |
| local（数据目录） | `$PI_WEB_DATA_DIR/plugins`（默认 `~/.pi-web/plugins`），目录或 symlink | `piWebPluginCatalog.ts:303`；`docs/plugins.md` "Local plugin usage" 节 |
| project | `<project>/.pi-web/plugins/`，受项目信任门控 | `src/server/shared/plugins/projectPluginVerdict.ts:23-25`（目录）；`:14-19`（`load / withheld-untrusted / absent` 三态）；信任读取 `src/server/shared/plugins/projectTrustReader.ts:30-34`（复用 pi 的 `ProjectTrustStore`，注释明确“第二个‘是否受信’实现就是第二个安全决策生产者”）。daemon 侧接线：`src/server/sessiond.ts:97-105`（`projectPlugins: () => projectPluginRoots({...})`） |
| pi 包（npm/git/local） | 活跃 agent profile 的包管理器配置 | `piWebPluginCatalog.ts:282-296`（`discoverPiPackagePlugins` 遍历 `packageProvider.listPackages()`）；provider 定义 `piWebPluginCatalog.ts:168-186`（`DefaultPiPackageProvider` 包装 `@earendil-works/pi-coding-agent` 的 `DefaultPackageManager`） |

web 进程与 daemon 的 catalog 实例：

- daemon：`src/server/sessiond.ts:97-105`（`agentDir: activeAgentProfile.dir`，config、project roots 均在此注入）。
- web：`src/server/web/app.ts:199-211`（`agentDirProvider: () => desiredPluginAgentDir(...)`，profile 优先、失败回落 `config.agent.dir`，`app.ts:143-152`）。注意：web 的 agentDir 要经由 daemon 的 active-profile 握手解析（`app.ts:194,200`），daemon 不可达且未配置 `agent.dir` 时发现不可用。

### 1.2 元数据：唯一的 `package.json` → `piWeb.plugins` 形状

- 目录下必须有 `package.json` 且带 `piWeb.plugins` 数组：`piWebPluginCatalog.ts:638-660`（`readPiWebPackageConfig` 只读 `<root>/package.json`）；旧式 `piWeb.plugin` 单数键被硬性拒绝：`piWebPluginCatalog.ts:665-667`。
- 每个条目：`{ id, browserRoot?, module?, serverModule?, machineSpecific?, runs? }`：解析在 `piWebPluginCatalog.ts:662-725`；`runs` 合法值 `daemon|web|both` 且声明 `runs` 必须有 `serverModule`（`piWebPluginCatalog.ts:666-668` 及 `parseRuns`）。
- id 规则与保留字：`^[a-z][a-z0-9.-]*$`；保留 `core` 与 `machine.*` 前缀：`src/shared/pluginIds.ts:3-10`。注意 **文档说 `themes` 也保留**（`docs/plugins.md:463`），但代码只保留 `core`（`pluginIds.ts:9`，注释解释 themes 已随包发布而除名）——文档与代码漂移，见 §7。
- 路径安全：模块路径禁反斜杠/绝对路径/`..`/`.git`/`node_modules` 段（`isSafeRelativeModulePath`，`piWebPluginCatalog.ts` 约 785 行起）；浏览器模块必须逻辑与 symlink 解析后都在 `browserRoot` 内（`discoverModule`，`piWebPluginCatalog.ts:404-436`）。
- 去重：同 id 后到者丢弃并产出 `duplicate-id` 诊断；顺序是 local 根先、pi 包后（`discoverPlugins`，`piWebPluginCatalog.ts:248-260`；`addUnique` 745-753）——**bundled/dev/local 静默赢得同 id 冲突**。
- 包修订：`computePiWebPluginPackageRevision`（`piWebPluginCatalog.ts:514`）对整个包做 sha256（排除 `.git`/`node_modules`，501 行），预算 **4,096 目录项 / 16 MiB**（499-501，597-598）——预算计入 `browserRoot` 之外的文件（`docs/plugins.md:472` 明说）。
- 期望状态（enabled/settings）：`applyDesiredState` 读 pi-web 配置 `plugins.<id>`：`piWebPluginCatalog.ts:726-740`。

### 1.3 信任模型现状

- **除 project-local 外没有任何信任门**。docs/plugins.md:47-55："Treat every plugin package as trusted code"，server 条目“in-process inside sessiond… share sessiond's event loop"，"plugins should not be installed from untrusted sources"。
- 唯一的代码级门是项目信任：`projectPluginVerdict.ts:14-19`（untrusted 项目的 `.pi-web/plugins` 不加载，且诊断要能区分“没有/坏掉/不允许”三态）。
- 事故安全阀是 safe-start（离线可用的降级）：`src/serverPluginRecovery.ts:23-24`（`bundled-only | none`）、45-60（读配置、坏值 fail-closed 为 `none`）；runtime 侧按级别禁用非 bundled 条目：`src/server/shared/plugins/serverPluginRuntime.ts:384-389`（`disabledReason`）。
- 无签名、无哈希锁文件、无来源允许清单。**NOT VERIFIED**：是否有其他位置存在签名/校验（我在本次通读中未见到）。

### 1.4 构建与“raw ESM”假设

- bundled 插件由 `scripts/build-plugins.mjs` 构建：`pi-web-plugins/` → `dist/pi-web-plugins/`（脚本 8-9 行）；逐文件 TS 转译（100-146 行）；**仅当入口图触及裸导入时**才用 esbuild 原地打包（36-51, 77-83 行）；装饰器方言必须匹配宿主（`experimentalDecorators: true, useDefineForClassFields: false`，129-142 行，注释点名 Lit 装饰器）；bundled 插件对 `@gang-of-beads/pi-web/server-plugin-api` 的**运行时**导入被重写为相对 `dist/server-plugin-api.js`（156-163 行）。
- 三道守卫测试：`pi-web-plugins/browserEntryResolvable.test.ts:5-12`（遍历产物图，禁止浏览器无法解析的裸导入——voice 曾因此“不可加载”）；`pi-web-plugins/bundledManifests.test.ts:5-19`（带 routes 的 serverModule 必须声明 `runs: web|both`，workspaces 曾因此全量部署 404）；`pi-web-plugins/pluginPublicApi.test.ts:11-21`（禁止直接 fetch / 直拼 URL / 导入宿主内部 / fastify / node:child_process）。

### 1.5 进程分工：daemon 与 web 各自激活什么

- daemon：启动时一次性解析快照并激活（`sessiond.ts:187-192`）；`ServerPluginRuntime.start` 只按 `serverModule !== undefined` 过滤、按 id 排序、逐个激活（`serverPluginRuntime.ts:275-279`）；阶段 import→validate→activate→start，各阶段 10s 上限（295-330 行；`DEFAULT_LIFECYCLE_TIMEOUT_MS = 10_000`，108 行）；`v1` 明确无热重载/卸载（`serverPluginRuntime.ts` 类注释，"v1 intentionally has no hot reload or unload path"）。
- web：进程内自建 runtime，只激活 `runs ∈ {web, both}` 的条目（`app.ts:303-305` `filterCatalogEntriesByRuns(snapshot.plugins, ["web", "both"])`；runtime 组装 `app.ts:306-341`）。
- **不对称点（代码事实，行为推论标注）**：daemon 不过滤 `runs`。一个 `runs:"web"` 的 serverModule 仍会被 daemon import 并 activate（`sessiond.ts:187-192` 无过滤 + `serverPluginRuntime.ts:275-279`）；machines 插件在 daemon 侧因无 `ports` 注入而诚实降级为 unhealthy（`pi-web-plugins/machines/server-plugin.ts:29-36`）。推论（依据上述代码路径，未跑活体验证）：第三方 `runs:"web"` 插件若贡献 `workspaceProvider`，其 probe/list 仍会在 daemon 进程内运行并参与 workspace 归属裁决（`workspaceProviderRegistry.ts:164-172` 只按健康过滤）。这是给第三方布局的一个隐蔽陷阱。

### 1.6 浏览器加载：manifest → URL → import → 同步 activate

1. 启动即拉取：`PiWebApp.ts:986` `void this.ensureGatewayPluginsLoaded()` → `:3061-3063` `loadExternalPlugins("pi-web-plugins/manifest.json")`。**没有按表面的懒加载**：manifest 里每个条目并行 `Promise.all` 全部 `import()`（`src/client/src/plugins/external.ts:41-53`）。
2. manifest 路由：`app.ts:225` → `piWebPluginService.manifest()`（`src/server/web/piWebPluginService.ts:85-101`）；发布门：dual-entry 插件的浏览器模块只在 server 半区 active、revision 配对且非 unhealthy 时出现（`piWebPluginLifecycle.ts:217-226` `shouldPublishBrowserPlugin`；配对判定 `revisionsAreStale` 233-243 行含 source/scope/settingsRevision）。
3. module URL：`/pi-web-plugins/<id>/<path>?v=sha256:...`（`piWebPluginService.ts:261-274`，段级 encodeURIComponent）。浏览器侧解析：`external.ts:47` 调 `resolvePluginModuleUrl`；定义 71-74 行——无前导斜杠按 manifest 相对解析，前导斜杠按应用根（`src/client/src/appUrl.ts:9-11,38-40`，注释明确这是“既有 plugin-manifest 兼容例外”，也是 AGENTS.md URL 规则中唯一豁免）。
4. import：`external.ts:49` + `importPluginModule` 76-78（`import(/* @vite-ignore */ moduleUrl)`，无完整性校验）。
5. 解析与注册：`parsePluginModule` 要求 default export、`apiVersion === 2`、`activate` 函数（`external.ts:143-155`）；`PiWebApp.ts:3096-3112` 逐个 `this.plugins.register(registration)`；**register 内同步调用 `plugin.activate(...)`** 并立即收编 contributions（`registry.ts:71-104`）。
6. 渲染消费：workspace 面板 tabs（桌面）与手机面板行是**同一个列表**的两个渲染器：`PiWebApp.ts:1971`（`.panels=${this.visibleWorkspacePanels()}`）与 `PiWebApp.ts:3753-3755`（`shellToolTabs()` 映射同一 `visibleWorkspacePanels()`）；`drawerSections` 同时喂给手机导航面板（`PiWebApp.ts:2173`）与会话抽屉（`PiWebApp.ts:3662`）。`surfaces-as-plugins.md:30-31` 的“两个渲染器、同一贡献列表”判断与代码一致（该文档括号里写的 "WorkspacePanel" 与实际组件名 `workspace-panel`/`shellToolTabs` 略有出入，实质正确）。
7. manifest 解析是**全有全无**：任一条目非法（含保留 id）整个 manifest 抛错 → 页面所有外部插件加载失败（`external.ts:90-107` 抛出 → `PiWebApp.ts:3110-3113` 整体 catch 只 console.warn）；而单模块失败是按插件隔离的（`external.ts:44-56` per-entry try/catch）。远端 manifest 解析失败则是整体 502（`machinePluginProxyRoutes.ts:52-61`）。

### 1.7 远程机器（federation）路径

- 网关代理远端 manifest：`machinePluginProxyRoutes.ts:41-60`（10s 超时；lifecycle 版本不匹配 409 拒绝整单）。
- module URL 重写为 `../../../../pi-web-plugins/<machine.<hex>.<id>>/...`（`machinePluginProxyRoutes.ts:88-103`）；机器域 id：`machine.<hex(machineId)>.<pluginId>`（`src/shared/machinePluginIds.ts:10-13`）。
- 资产代理带安全头允许清单（`machinePluginProxyRoutes.ts:21-28` SAFE_RESPONSE_HEADERS、62-86 路径净化）。
- 远端插件**按需**加载：仅当该远端机器被选中才拉 manifest（`PiWebApp.ts:3067-3094`，`loadedMachinePluginIds` 去重 + `PI_WEB_CAPABILITIES.pluginLifecycle` 能力门）——这是当前**唯一**存在的懒加载。
- 生命周期对账：daemon/web 双视图按 `runs` 选记录源（`piWebPluginLifecycle.ts:74-79`）；`both` 双视图漂移即 restart-required（`piWebPluginLifecycle.ts` `mergeBothRoleInfo` 与注释）。

### 1.8 服务面：operations / routes / backend / storage

- 运算：插件按名声明，宿主映射 `api/plugins/<pluginId>/<operation>`，未声明即 404（`src/server/shared/plugins/pluginOperations.ts:8-28`）；web 只转发给 daemon（`src/server/web/plugins/pluginOperationProxyRoutes.ts:17-38`），body 上限 256 KiB（`src/shared/pluginBackendProtocol.ts:3-16`）。
- 路由贡献：宿主拥有路径，`/api` 与 `/api/machines/local` 双挂载，冲突拒绝不炸进程（`src/server/web/plugins/serverPluginRouteMount.ts:14-58`）。
- workspace backend：`/api/plugin-backends/...` 代理，边界 8 MiB 响应（`pluginBackendProxyRoutes.ts:18-39`；`pluginBackendProtocol.ts:5`）。
- 存储：每插件一目录 `$PI_WEB_DATA_DIR/plugin-storage/<id>`，键逃逸拒绝、原子写（`pluginScopedStorage.ts:27-49` 及文件头注释）。
- 浏览器侧 `callOperation` 由宿主拼路径（`registry.ts:296-300`；契约 `src/plugin-api.ts:47-52`）。

---

## 2. 回答一：从 GitHub 仓库按 ref 安装，需要什么？

### 2.1 已经存在的轮子（重要）

pi SDK 的包管理器**原生支持 git 源**：

- 源解析：`npm:` / 本地路径 / git URL（含 `#ref`、hosted-git-info 归一化）——`node_modules/@earendil-works/pi-coding-agent/dist/core/package-manager.js:1148-1169`（`parseSource`）+ `dist/utils/git.js:150-194`（`parseGitUrl`）。
- 安装：`git clone <repo> <dir>` + `git checkout <ref>` + 有 package.json 则 `npm install --omit=dev`（`package-manager.js:1502-1533`；参数 1448-1454）；安装根 `<agentDir>/git/<host>/<path>`（1749-1767）。
- 配置真源是 agent settings 的 `packages` 数组（`package-manager.js:740-752` `listConfiguredPackages`）。
- pi-web 目录发现**不关心**包是 npm 还是 git 装的：`discoverPiPackagePlugins` 只拿 `installedPath` 再读 `package.json` 的 `piWeb` 元数据（`piWebPluginCatalog.ts:282-296` + `getInstalledPath` 对 git 类型的处理，SDK `package-manager.js:672-674`）。

因此“装 GitHub 仓库”在**发现层**基本免费：把 `git:https://github.com/<org>/<repo>.git#<ref>`（或裸 https URL）写进 packages 列表即可。已有两段证据：
- 自动化证明是 **npm tarball** 路径：`src/server/shared/plugins/packageInstalledPlugin.test.ts:17-47`（npm pack → agent settings → catalog 从 `node_modules` 发现，无目录根参与）。
- **git 路径的活体证明只存在于文字记录**：`docs/design/plugin-architecture-status.md` "Package loading on the live stack" 节——8505 栈上以 `source: git:https://github.com/Gang-of-Beads/pi-web-themes.git`、`scope: project` 装载成功。我今日未复跑，**NOT VERIFIED (live)**。
- 安装入口已存在：Settings → Pi packages 接受任意 source 字符串（`src/server/web/piPackageService.ts:107-127` 直通 `installAndPersist`；文档 `docs/plugins.md` "Enter only the package source, such as npm:@scope/package, a git/URL source, or a local path"）。

### 2.2 真正的缺口（按“官方插件新仓库 `pi-web-official-plugins`"设想）

1. **多插件单仓库（monorepo）不被发现**。发现只读仓库根的 `package.json`（`piWebPluginCatalog.ts:638-646`），不扫子目录的 package.json。补救 A：根 package.json 声明全部插件、路径指向子目录构建产物——`browserRoot/module/serverModule` 本就是 packageRoot 相对路径（`piWebPluginCatalog.ts:662-725`、`discoverPluginEntries` 359-392），格式上可行；补救 B：发一个 meta package / 每插件一包（`surfaces-as-plugins.md` §C 已列为选项）。
2. **git 安装不构建**：`npm install --omit=dev`（SDK 1448-1454）不装 devDependencies，`prepare` 构建脚本无从依赖工具链；status doc 的结论是仓库必须**提交构建产物**（"commits its bundled browser module (a git install runs no build)"）。这与“第三方随便给个 TS 源码仓库”不兼容（见 §4）。
3. **产物预算与源码 checkout 冲突**：4,096 项/16 MiB 计入包内一切非 `.git`/`node_modules` 文件（499-501；docs:472）。一个带测试、文档、多插件源码的 GitHub checkout 很容易触顶。官方仓库需要刻意“瘦身提交”（只提交 dist + package.json），或预算/排除规则要先扩。
4. **“一键安装”体验**：现有入口要求用户理解 pi 的 source 字符串语法并手填；`surfaces-as-plugins.md:26-27` 所说"no packaging boundary that a third party installs in one step"仍成立。方向 #3 要的“any file layout satisfying the format"需要先回答：仓库根即包根（方案 A）、子目录即包根（需要新的发现规则，如 `workspaces` 式子包扫描——**当前不存在**），还是 tarball/ZIP 资产（需要新下载器）。
5. **版本钉住**：唯一钉住机制是 source 字符串里的 ref（`git:...#v1.2.3`），存于 `<agentDir>/settings.json` 的 `packages` 数组；带 ref 的 update 停在 ref 上（SDK `updateGit` 1536-1543：仅 `fetch origin <ref>`）。pi-web 侧没有自己的 pin 存储或 lockfile；enable/settings 在 pi-web 配置（`piWebPluginCatalog.ts:726-733`）。**建议（标注：评审建议，非实现决定）**：钉住与信任应继续放在 pi settings 的 source 字符串（唯一已被 SDK 尊重的钉住点），pi-web 配置只管 enabled/settings；若要“GitHub at a ref"成为产品概念，应在安装 UI 把 ref 强制为必填并展示解析后的 commit，而不是接受可移动的分支名。

### 2.3 明确不需要做的（避免重复造轮子）

- 不需要新的 git clone 机制（SDK 已有）。
- 不需要新的“包→插件”解析（catalog 已按 `piWeb.plugins` 读任意 installedPath）。
- 不需要改浏览器加载器（git 装的包与 npm 包走完全相同的 manifest/asset 通道，`piWebPluginService.ts:85-121` 不区分 scope）。

---

## 3. 回答二：表面打开时才懒加载，需要什么为真？

现状：boot 即全量。manifest 每条目并行 import（`external.ts:41-53`），`register()` 同步 `activate()`（`registry.ts:71-104`），所有面板先注册后由 `visible()` 在渲染期过滤（`PiWebApp.ts:2632-2636`）。唯一的懒加载维度是“远端机器选中才装”（`PiWebApp.ts:3067-3094`）。

要为真的条件（按依赖顺序）：

1. **声明式 manifest 先行**：宿主必须能在不 import 插件代码的情况下知道“这个插件贡献哪些表面、标题、图标、顺序、可见性前置条件"。`surfaces-as-plugins.md:66-75` 自己已点名：declarative manifest 才"lets the shell reason about a plugin before loading its code — which is what makes lazy loading and code splitting possible"。数据源可行性已具备：catalog"reads never import or execute plugin code"（`piWebPluginCatalog.ts:203` 注释），可在 `piWebPluginService.manifest()`（85-101 行）追加每插件声明块。
2. **两阶段注册契约**：现契约是"activate 一次给出全部 contributions"（`src/plugin-api.ts:44-47`；`registry.ts:71-104` 立即展开并做 id 限定/查重）。需要声明（静态数据，先入册）与激活（代码，表面打开时）分离，registry 需要接受"已声明未激活”的挂起态；卸载侧 `disposePlugin`（`registry.ts:301-330`）已存在，可复用为“表面销毁→卸载”语义。
3. **表面→插件的映射要在声明层可判**：机器域 id、gateway 去重（`isRemoteDuplicateHiddenByGateway` / `shouldLoadRemotePlugin`，`registry.ts:146-149, 476-492`）目前在**模块加载后**由 registration 元数据判定；懒加载要求这些判定移到 manifest 声明层，否则加载策略无法在 import 前决定。
4. **按需可取的模块 URL**：已满足——URL 稳定且带内容修订（`piWebPluginService.ts:261-266`），`import(/* @vite-ignore */)` 通道现成（`external.ts:76-78`）；缺的只是“表面打开时才调用”。
5. **诚实的“未加载”状态**：房子规则“Absence is not negation"（AGENTS.md）。懒加载下“标签未出现”不再等价“插件未贡献”；quick-access 页与 tab strip 需要显式 unloaded/loading/failed 态。当前贡献模型只有“在/不在”两态（如 `DrawerSectionContribution.available` 三态返回是渲染期函数，`src/plugin-api.ts:473-480`），声明层需要把“该表面存在但代码未装”表达出来。
6. **server 配对门不放松**：dual-entry 的浏览器模块只在 server 半区 active+配对时发布（`piWebPluginLifecycle.ts:217-226`）——懒加载不能绕过该门，门本身在 manifest 期可判，兼容。
7. **配置管道补全**：`settings-changed` 事件与 `applyPluginSettings`（`registry.ts:257-272`）以及 `registration.settings`（`registry.ts:70,73`）在生产代码中**从未被喂入**——`external.ts` 构造的 registration 不含 settings，`PiWebApp.ts:3106` 原样注册；只有测试调用 `applyPluginSettings`（`pluginSettings.test.ts:41-50`）。daemon 侧 settings 正常（`serverPluginRuntime.ts:301-306`）。方向 #2 要"declarative down to data"，浏览器侧的数据插件必然需要这条管子，今天它是只存在于测试的死路径。

---

## 4. 回答三：当前构建假设了什么，第三方布局会违反什么？

逐条（每条 = 假设 + 违反后果 + 证据）：

1. **浏览器入口是"raw ESM、无 import map、无 serve 期打包"**——裸导入即静默失效（插件永远不激活，无诊断）。`build-plugins.mjs:26-35` 注释；守卫 `browserEntryResolvable.test.ts:5-12`。第三方"src 是 TS + `import lit from 'lit'`”的仓库直接不工作。
2. **pi-web 只为 bundled 插件编译 TS**；安装包无构建步骤（git 安装 `--omit=dev`，SDK 1448-1454）。第三方必须提交编译后的 JS（status doc 的 themes 先例即是如此）。
3. **装饰器方言必须匹配宿主**（`experimentalDecorators` + `useDefineForClassFields: false`，`build-plugins.mjs:129-142`）；用标准装饰器 Lit 语法的第三方源码在 raw-serve 下无法被浏览器解析，除非自带 esbuild 打包。
4. **契约包只有类型导出**（docs/plugins.md: "Use them with `import type`; there is no runtime JavaScript export"）；bundled 构建对契约运行时导入的重写（`build-plugins.mjs:148-163`）指向宿主 dist 的相对路径，第三方包不可依赖。machines 插件源码即全部 `import type`（`pi-web-plugins/machines/server-plugin.ts:1-9`）。
5. **包根唯一 `package.json`、唯一支持形状**：`piWeb.plugins` 数组、禁旧键（`piWebPluginCatalog.ts:638-725`）；无子包扫描 → 官方 monorepo 必须以根清单寻址子目录产物（§2.2-1）。
6. **整包预算 4,096/16MiB 含 browserRoot 之外的一切**（499-501；docs:472）→ GitHub 源码 checkout 常态性触顶。
7. **路径净化**：模块/根路径的字符集、`..`、绝对路径、Windows 盘符、symlink 逃逸全部拒绝（`isSafeRelativeModulePath`、`discoverBrowserRoot`/`discoverModule` 404-436 行）。
8. **id 即命名空间**：目录名（local 根）与声明 id 都要匹配 `^[a-z][a-z0-9.-]*$`（`pluginIds.ts:3`；`discoverLocalRoot` 按 `isPiWebPluginId(entry.name)` 过滤目录）；保留 `core`（代码）/`core`+`themes`（文档，漂移）+`machine.*`。宿主还有 id 特例逻辑：`updates` 的 URL 会注入 `piWebDockerMode` 查询（`piWebPluginService.ts:268-286`）——第三方撞用 `updates` 之外未保留但被特判的 id 属于未定义行为区。
9. **`machineSpecific` 隐含默认**：双条目默认 true 且不可显式 false（`piWebPluginCatalog.ts:691-699`；docs 同）——第三方“可移植双端插件”必须显式写 `false`，写错即清单拒绝。
10. **`runs` 纪律**：贡献 routes 的 serverModule 必须声明 `runs: web|both`（`bundledManifests.test.ts:5-19`，workspaces 曾在构建部署中全量 404）——但这只是 bundled 仓库的测试纪律，**没有**对安装包的同等强制；叠加 §1.5 的“daemon 不过滤 runs"，第三方 runs:"web"+provider 的组合会得到非预期 daemon 侧行为。
11. **资产服务只出 `browserRoot` 内文件**，`browserRoot: "."` 等于几乎全包公开（docs 明确警告勿放 secrets；`captureBrowserArtifact` 按 browserRoot 捕获，`piWebPluginService.ts:145-181`）。

---

## 5. 安全问题清单（就事论事）

1. **同源任意 JS**：插件模块以 `application/javascript` 从应用源直出并被页面 import（`app.ts:227-236`；content-type `piWebPluginService.ts:313-321`）→ 插件获得完整页面能力（DOM、会话上下文、经 helper 的文件/终端）。无沙箱、无 CSP 分区（docs:48 承认 "Neither entry is sandboxed"）。
2. **daemon 进程内执行**：serverModule 与 sessiond 同 loop、同 FS/env/权限；阻塞回调可拖住全部会话；信号只是协作式的（docs:50-54；`serverPluginRuntime.ts` 的 runBounded 只能放弃等待）。
3. **GitHub 安装 = 无验证的任意代码**：无签名、无 commit 钉定校验、无来源允许清单；ref 若填 `main` 则“钉住”名存实亡（SDK `installGit` 按引用 checkout）。唯一限权是用户自觉 + safe-start（`serverPluginRecovery.ts`）。
4. **与 pi 扩展共享一个包列表**：`packages` 数组同时喂 pi 扩展装载与 pi-web 插件发现（SDK `listConfiguredPackages` 740-752 → `discoverPiPackagePlugins`）——装一个“pi-web 插件”即同时授予 pi 扩展装载资格，两个信任域共用一个入口。
5. **first-writer-wins 的同 id 遮蔽**：local 根先于 pi 包（`piWebPluginCatalog.ts:248-260`）；`~/.pi-web/plugins/goals` 会静默遮蔽官方包装的 goals（仅一条 duplicate 诊断）。对官方包安装这是供应链面。
6. **项目信任门只护 project 域**：`projectPluginVerdict.ts:14-19` 管不到 user/project-scope 的 git 安装。
7. **远端机器资产入网关源**：网关把远端 JS 以网关源身份服务给页面（`machinePluginProxyRoutes.ts:62-86`），仅安全头允许清单过滤——恶意的远端机器即恶意页面脚本（federation 设计固有，`machineSpecific` 是缓解不是边界）。
8. **manifest 全有全无**：一个坏条目（含保留 id）让页面**全部**外部插件失效且只有 console.warn（`external.ts:90-107` → `PiWebApp.ts:3110-3113`）——这是可用性问题也是“静默失败面”。
9. **修订查询参数不是完整性**：`?v=sha256:...` 是缓存/配对指纹（`piWebPluginService.ts:261-266,114-115`），非签名；能写包文件的进程即能改变它（本地开发语义使然，需在 GitHub 分发文档里写明）。
10. **`execFile` 有界 ≠ 进程受限**：argv 化、超时、输出上限（`src/server/shared/plugins/serverPluginExec.ts` 与 `server-plugin-api.ts:60-79` 契约）只约束 helper 本身；插件在进程内可直接调用 Node API。

---

## 6. 结论（一页话）

- **安装**：GitHub-at-ref 的机制 80% 已存在（SDK git 源 + catalog 读任意 installedPath + manifest/asset 通道不分来源）；缺口集中在 (a) monorepo 的包根/子包布局裁决，(b) git 安装无构建 ⇒ 必须提交产物，(c) 源码 checkout 撞产物预算，(d) 无人把“GitHub at ref”做成产品概念（UI、强制 ref、来源展示）。钉住与信任应钉在 pi settings 的 source 字符串与 pi-web 的 `plugins.<id>` 配置上，不需要发明新存储。
- **懒加载**：卡点不在加载器（`import(/* @vite-ignore */)` 现成），而在**契约**——同步 `activate()` 与“注册即贡献”的模型（`registry.ts:71-104`）必须让位于"声明先入册、代码按需 import”的两阶段；同时要补浏览器侧 settings 管道（现为死路径）与“未加载”的诚实状态。
- **第三方布局**：现构建假设 raw 自包含 ESM、宿主方、装饰器方言、契约 type-only、单根 package.json、整包预算——官方新仓库若按“TS 源码仓库”直觉搭建会五条全踩。
- **安全**：现有模型是“装了即全信”（docs:47-55），GitHub 安装把该假设推到极限；minimum 必答：签名/校验要不要、ref 钉定策略、同 id 遮蔽的裁决、daemon 侧 runs 语义补齐。

---

## 7. 文档-代码漂移（顺带发现）

1. `docs/design/plugin-architecture-status.md` "Bundled goals removed" 节称 bundled goals 已离开本仓库（e532db0e，2026-09-05），但 `pi-web-plugins/goals/` 现存于 HEAD，由 18780365（2026-09-08 "Rebuild goals as a native plugin drawer section"）重新引入；status doc 最后一次修改（06ba2c44，2026-09-07）早于重引入。文档现状陈述已过期。
2. `docs/plugins.md:463` 称 `themes` 为保留 id；代码 `src/shared/pluginIds.ts:5-9` 只保留 `core`（注释明确 themes 已除名以让包版本加载）。
3. `docs/design/surfaces-as-plugins.md:26-27` "There is no packaging boundary that a third party installs in one step"——下半句成立，但“包装载边界”本身已存在并有自动化证明（`packageInstalledPlugin.test.ts:17-47`）；表述宜精确为“无一步安装体验”。