# 收敛第 25 轮 · Lane B（行为与数据：retirement model 端到端、interrupted-runs 诚实性、prefetch/cache key、切换后的状态）

审查对象：`refactor/plugin-architecture` @ `bee891a3`（"Start convergence round 25"；任务书写的 a8cc0451 是 round-24 修复点，实际 HEAD 已前移一个 launch commit，两者之间没有代码差异，仅多一个空 launch 提交）。本 lane 只读，未改动任何仓库文件。

范围：notice/errorNotice/errorBanner/bannerHold/transportHealth/http 的退役模型端到端；PiWebApp 的 clearTransientError / scheduleTransientErrorDismissal / setRemoteRouteRestoreMessage / refreshInterruptedRuns；三个 controller 的错误点；interrupted-runs 读写链（含 daemon 侧 read-and-clear）；prefetch 与各缓存 key；机器/工作区切换后的残留状态；round-17/18 triage 与两个 changeset 的 doc-vs-code 漂移。

---

## 新发现

### B-1（Medium，TRUE）`refreshActiveTerminals` 的 catch 没有选择守卫：迟到的后台失败把 A 机的投诉画到 B 机的屏幕上

**证据**：`src/client/src/components/PiWebApp.ts:2038-2051`。成功路径有双重守卫（:2043 `if (selectedMachineId(this.state) !== machineId || this.state.selectedWorkspace?.id !== workspace.id) return;`），catch（:2048-2050）直接 `this.setState(errorNoticePatch(error));`，无任何身份检查。

**调用方全是后台路径**：工作区变更 `PiWebApp.ts:1927`（`handleWorkspaceChange` 内 `void this.refreshActiveTerminals(...)`）、realtime 重连回调 `:1972`、workspace 工具解析 `:1326`。请求带 30s 浏览器期限（`requestDeadline.ts:18` REQUEST_TIMEOUT_MS），窗口真实存在。

**最小失败场景**：读者在机器 A 的工作区 W1 上触发了终端列表读取（切换工作区或 socket 重连）；请求挂起；读者切到机器 B 的会话；30s 后 `RequestTimeoutError`（或 A 机代理的 502）落进 catch → `errorNoticePatch` 打出一条 A 机作用域（或 page 作用域）的横幅，正压在 B 机的屏幕上。这正是 round-22 item 5（health）、round-23 item 1（runtime，自称 "the fourth copy"）修掉的那一类；终端列表这一份是下一个兄弟，当时漏掉了。`machineController.ts:131-140` 的注释把这个约定写得很清楚（"a late failure must not paint machine A's complaint onto machine B"）。

**裁定**：TRUE。同族兄弟全部有守卫，唯此 catch 裸奔；无论错误最终是机器作用域还是 page 作用域，"迟到的后台失败不得跨选择作画"都被违反。

### B-2（Medium-Low，TRUE——记录与代码的缺口 + 潜在错分类；"今天就有可见横幅"这一半为 FALSE）`requestPluginBackend` 仍抛不带机器作用域的 plain Error，round-23 的记录读起来像这类已关闭

**证据**：
- `src/client/src/api/pluginBackends.ts:53-55`：fetch 失败统一包装成 `throw new Error("Plugin backend request unavailable: " + describeError(error), { cause: error })` —— plain Error，无 machineId。
- `:59-61`：非 2xx 应答 `throw new Error(pluginBackendErrorMessage(text) ?? "Plugin backend request returned HTTP …")` —— 同样 plain Error。网关 502 的 body 里明明带着机器名（`machineProxyRoutes.ts:374-382` `sendGatewayError` 回 `{ error: "Remote machine unavailable", machineId, detail }`），被 `pluginBackendErrorMessage` 抽出文本后机器戳被丢掉。
- 对照组（round-23 真正改掉的两处）：`src/client/src/api/clients.ts:388`（tree/fork，`new HttpError(..., machineIdFromUrl(...))`）、`:406`（terminal-command-run，`new HttpError(..., machineId)`）。
- round-23 triage item 9 原文："the session-tree fork, terminal-command-run, plugin-manifest and plugin-backend fetches now report reachability like request() does; **the same two sites throw HttpError carrying the machine scope instead of plain Errors that land page-scoped**." —— plugin-backend 一脚只补了 `reportTransportReachable`（`pluginBackends.ts:69`，且仅在成功后），错误侧仍是 plain Error。

**错分类链**（若该错误进入 seam）：plain Error → `notice.ts:103-105` 的文本分支；`"Plugin backend request unavailable: Failed to fetch"` 会命中**未锚定**的 `/failed to fetch|load failed|…/i`（见 B-3）→ `noticeFromTransport(text, undefined)` → page 作用域、reply 退役 → 任何其它机器的下一个成功应答把它擦掉——恰是 round-22 item 1/2 为 `request()` 修掉的缺陷形状。

**今天的实际伤害**：有限。目前唯一消费者是 git 面板，错误留在面板内（`pi-web-plugins/git/browser/git-panel.ts:594, 613, 675` 的 `state.historyError` / `state.commitDiffError`），不走页面横幅。所以"今天就有跨机器擦除横幅"判 FALSE；"round-23 的句子暗示这类 plain-Error 落 page 作用域的口子已闭，而第四条机器作用域 fetch 腿没闭"判 TRUE。

**最小失败场景（潜在）**：任何后续调用方把 `backend.request` 的失败交给 `errorNoticePatch`（例如某个新面板选择上屏），remote-a 的 plugin backend 502 就会变成 page 作用域主张，被 remote-b 的下一次轮询抹掉，与 round-22 的修复对着干。

### B-3（Low，TRUE，潜伏——今天没有 live 生产者走到这一步）分类侧的 fetch 家族正则未锚定，与显示侧的锚定规则自相矛盾

**证据**：
- 显示侧已锚定（round-21 item 6）：`src/client/src/components/errorBanner.ts:97-99` `/^(failed to fetch|load failed|networkerror when attempting to fetch resource)[.!]?$/i`，注释明说理由——"this family's phrases also appear as the detail of a composed message … and rewriting that would erase the machine's name"。
- 分类侧未锚定：`src/client/src/notice.ts:104` `/failed to fetch|load failed|networkerror when attempting to fetch/i`（无 `^…$`）。

**最小失败场景**：文本 `"Plugin backend request unavailable: Failed to fetch"`（B-2 的包装产物）到达 `noticeFromError`：不匹配锚定的改写表（保持原文、**永久 alert 样式**，因为 `normalizeTransientError` 返回 undefined），却因未锚定的分类正则得到 reply 退役 → 渲染成"永久失败"的样子、寿命却是"下一条应答即消失"——正是 round-22 item 3 消灭的那种"渲染与寿命互相矛盾"。

**裁定**：TRUE（不一致客观存在）；标注：当前没有页面横幅生产者会把这种组合文本送进 seam（git 面板在面板内消化、上传批量错误也在面板内），故为潜伏债而非现行缺陷。

### B-4（Low-Medium，TRUE）interrupted-runs 未知横幅的承诺在"空记录"这一支上无法兑现，且与它自己的注释矛盾

**证据**：`src/client/src/components/PiWebApp.ts:778-807`。
- 抬横幅：读失败 → `:791-792` 抬 `INTERRUPTED_RUNS_UNKNOWN_MESSAGE`（:249，"…Reconnect to read it again."）。
- 撤回：`:787` `if (ids?.size === 0 && !adoptEmpty) return;` **先于** `:802-805` 的撤回块——一次"成功的空读"（重连后 read-and-clear 记录确实是空的）在到达撤回代码之前就被 return 掉了。
- 注释 `:798-800` 说 "The state is known again - do not leave our own promise unmet"，但空读分支永远到不了这里。

**最小失败场景**：boot 读失败（网络抖动），记录当时本就是空的（daemon 重启但没打断任何 run，或记录已被别的浏览器读走）→ 横幅 "Reconnect to read it again" 上屏；socket 自动重连 → `refreshInterruptedRuns(machineId, { adoptEmpty: false })`（:1970）→ 读成功、答案为空 → `:787` 早退 → 横幅**永不撤回**，只能读者手关。读者照横幅的指示做了，什么也没改变。round-24 item 9 专门改写过这句话（"The unknown banner's promise is fulfilable"），但撤回门使它在空记录这一支上仍不可兑现。

**裁定**：TRUE（行为）。注："只有 boot 读可采纳空记录"的教义本身是 round-23 item 3 的正确修复（防 spent record 冒充撤回、抹掉在屏标记）；冲突在于**屏上没有任何标记**（`this.interruptedSessionIds.size === 0` 是代码完全可判定的条件）时空读仍不撤回。两个原则打架，代码单方面选了教义，横幅的承诺成了 casualty——按本仓库 "product semantics belong to the owner" 的规矩，这一支值得摆给 owner（空读+零在屏标记 → 撤回，还是改措辞）。

### B-5（Low，TRUE）`clearTransientError` 的机器作用域"反证"规则没有任何组件级测试钉住

**证据**：
- 被测规则本体：`src/client/src/components/PiWebApp.ts:1054-1070`（`:1058` `const disproved = this.state.errorMachineId === "page" || this.state.errorMachineId === machineId;`）。
- 现有测试：`PiWebApp.transportRecovery.test.ts` 全文 48 行，只用一个闭包桩验证 listener 被调（:30-41），**不经过** `clearTransientError` 的机器匹配分支；`notice.test.ts:45-52` 钉的是分类半边（notice 的 machineId 保留），不是反证半边。
- changeset 宣称（`.changeset/banner-retirement-model.md`）："recovery is now vouched for per machine: a success from machine A no longer erases machine B's complaint" —— 模型的中心不变量在它真正被执行的那一行上没有测试。

**最小失败场景**：未来任何重构（例如把 `disproved` 改成 `=== machineId` 而丢掉 `"page"` 分支，或反之）不会让任何测试变红——round-22 "two regression tests pin both halves" 钉的是 notice.ts 的分类，不是这里的执行。

**裁定**：TRUE（测试缺口；与 round-23 lane C 的 "Rail contract tests" 同类的 test-investment 决定，但这条是模型的心脏，优先级应更高）。

### B-6（Low，TRUE——文档漂移，无行为后果）round-18 "leaving the screen resets the schedule" 已不描述任何代码路径

**证据**：
- round-18 triage item 9 声称 hide 分支重置 schedule（`docs/design/review-triage-uiux-round18.md`："a replacement starts its own hold window and expiry; leaving the screen resets the schedule"）。
- 该 hide 分支在 round-19 被删除：`git show 1c2013f7` 中删除了 `if (decision.kind === "hide") { this.bannerShownAt = undefined; this.lastScheduledError = ""; … return null; }`。
- 现行 `renderErrorBanner`（`PiWebApp.ts:3823-3863`）没有 hide 分支：`kind === "hide"` 落进 show 门（`:3843`），对一个**空** error 盖 `bannerShownAt = Date.now()`（:3846，方向反了）、调 `scheduleTransientErrorDismissal("", …)`（在 reader 退役标记上立刻 return）。

**裁定**：行为 TRUE 等价（每次真 show 都会重新盖 shownAt，`errorBanner("")` 渲染 null，读者不可见）；文档断言 TRUE 漂移——round-18 的句子现在只靠 show 门的副作用"碰巧"成立。按本收敛流程自己对 "claims outrun edits" 的敏感度，应记一行勘误。

### B-7（Low，TRUE）`docs/capability-map-draft.md` 仍引用已删除的 `MachineSwitcher.ts` 三处，且 `AppContextBar.ts:218` 不存在

**证据**：
- `docs/capability-map-draft.md:49`："Switch machine … C:components/**MachineSwitcher.ts:63-66,98**; C:components/appShell/**AppContextBar.ts:218**" —— `MachineSwitcher.ts` 全树不存在（`find **/MachineSwitcher*` 零命中）；`AppContextBar.ts` 全文只有 **110 行**，:218 不存在，且该文件已无任何 machine 引用；真正的机器 step 在 `appShell/AppContextSwitcher.ts:43`（`renderStep("machines", …)`）。
- `:54`："Remove machine … C:components/**MachineSwitcher.ts:116**"；`:231`："Machine list options … C:components/**MachineSwitcher.ts:303,309**"；`:242`、`:247` 同样引用。
- round-20 item 10 声称 "the capability map and the design docs now point at what exists" —— `git show 6c32b436 -- docs/capability-map-draft.md` 证实该轮只改了**措辞列**（"MachineSwitcher dropdown" → "context-bar machine chip"；"MachineSwitcher options" → "Machine list options"），三处 file:line 引用原样保留。round-20 自己的 "Citations now point at what exists" 与 diff 不符。

**最小失败场景**：下一个按 file:line 找 "Switch machine" 实现的人被指向一个不存在的文件和一个不存在的行号；收敛流程以 file:line 为证据单位，地图自己先失真。

**裁定**：TRUE（文档；round-20 记录的部分兑现）。

### B-8（Low/卫生，TRUE，无用户可见失败）`bannerHoldTimer` 在 `disconnectedCallback` 里不受清理

**证据**：`PiWebApp.ts:411` 声明、`:3836-3837` 设置；`disconnectedCallback`（:1108-1145）清了 `transientErrorTimer`（:1113）、`piWebStatusTimer`、`livenessTimer` 等，唯独没有 `bannerHoldTimer`。元素断连后残余 ≤1.5s 的 `requestUpdate` 定时器仍会触发一次（对已断连元素无渲染后果）。

**裁定**：TRUE（卫生；与其孪生定时器不对称，无行为失败场景）。

### 附带观察（不单独立案）

- `errorBanner(error, onDismiss, retiredBy = "reply")`（`errorBanner.ts:23`）的默认值是 reply：当前唯一调用方（`PiWebApp.ts:3849`）显式传参，但一个未来省参的调用方会静默拿到"自愈寿命"，与 "seam 必须写全标记" 的方向相反。建议改必填。
- round-22 lane B B-6 的 XHR 半边仍未闭：上传成功（`api/workspaceUploads.ts` 的 XHR 腿）依旧不作 `reportTransportReachable` 证；round-23 item 9 只补了四个 fetch 腿。已记录在 r22-lane-b，列出以防 round-25 记录误以为 B-6 已全闭。

---

## 已记录、本轮核实仍在场（不重复立案，供 round-25 记录对照）

1. **深链 boot 竞态**（round-23 "Owner decisions this round adds"）：`PiWebApp.ts:1030`（connectedCallback 里以当前机器=local 发起 boot 读）→ `loadMachines(route.machineId)` 选中远端 → `handleMachineChange`（:2065-2076）重连 → `refreshInterruptedRuns(remote)`；local 的读在 :785 被当作 stale 丢弃——但 daemon 侧 read-and-clear（`sessionRoutes.ts:95-99`）已经把 local 记录消费掉。round-23 说 "needs a selection-generation design"，HEAD 仍未修。
2. **local 命名空间混杂 + health 200-ok:false**（round-24 owner decision，lane C）：`localMachineRegistry.ts:44-52` 对 local 返回 HTTP 200 + `ok:false`；客户端 `fetchBody`（`http.ts:50-52`）先 report 后判 ok —— 报告"机器不可达"的那个应答同时在反证"机器不可达"的主张；且 `/api/machines/local/*` 的 web 自有路由 200 会为 local 的 daemon 链路作证（`transportHealth.ts:22-31` 无 local 例外）。仍开放。
3. **作用域切换静默清除 reader-retired 失败**（round-22 B-4）：`resetWorkspaceScopedState` 展开 `clearErrorPatch()`（`appState.ts:188-197`），机器/项目/工作区切换都会丢弃 "Delete failed: …" 这类操作失败。owner 决策仍 pending。
4. **link.live 的 socket 接线**：round-21 已把"死主动分支"从必办改为 "reactive model is the documented one"；`notice.ts:90` 的 `link.live` 分支与 `errorNoticePatch` 的默认 `{live:false}` 仍在，operation-model.md 如实记载为开放项。一致。

## 本 lane 验证为稳的部分（负结果也计工）

- **6s 过期机制**（round-22/23/24 三轮修补后）：schedule 携带机器（`PiWebApp.ts:415-416, 3843-3848`）、timer 只清自己认领的主张（:1094-1107）、clear/expire/dismiss 三个口都重置 gate 标记（:1063-1065, :1100, :3826-3831）——逐条推演无洞。"persistent-failure pulse" 仍按 round-20/21 的记录成立（每次重抬重新武装 6s），已列为固有。
- **bannerHold 决策表**（`bannerHold.ts`）与"替换立即上屏、清空才 hold、读者关断终局"的组合在现行代码下行为正确（B-6 只是文档漂移）。
- **prefetch/cache key 全部带机器作用域**：`sessionCacheKey` = `machineSessionKey(...)`（`sessionController.ts:1543-1545`）贯穿 transcript 内存 map 与 sessionStorage 缓存（`chatHistoryCache.ts:150-152` 只做字符串前缀拼接，收到的是已带前缀的 key）；`prefetchSession` 的去重键 `machineId:sessionId` 且失败即忘（`sessionController.ts:1914-1928`）；`workspaceSessionsCache.ts:15-17`（machine+path，注释说明为何带机器）；`cachedNewSessions.ts` 每条记录自带 machineId 并按 machine+cwd 过滤。round-22 对 lane B "prefetch keys / transcript cache scope" 的 FALSE 判词复核成立。
- **切换卫生**：`selectMachine` 重置 workspace 级状态、`sessionStatuses/sessionActivities` 清空、`machineRuntimes/machineStatusSnapshots` 按 roster 裁剪（`machineController.ts:48-64`）、`piWebStatus` 清空（`PiWebApp.ts:2074`）、`realtime.close()` 后 `onEvent` 已摘除（`sessionSocket.ts:233-241`），无跨机串台。`machineStatuses` 不随 roster 裁剪，但幽灵条目无读取路径（deleteMachine 自身会 omit，`machineController.ts:109`），不立案。
- **sessionController 的导航/树操作**（navigateTree/forkFromTree/abortTreeNavigation，:713-813）选择守卫齐全；send 路径的 three-outcome 分类与作用域无冲突。
- **rail 规则**（`shared.ts:408-451`）：`:where()` 压平特异性、行类 (0,2,0) 压过 :has (0,1,0)、success 规则不再含 `.session-state.running`（round-23 item 6 的勘误已落）——与 `sessionRowIndicator.ts` 的单点仲裁（asking > running > unread > error > background > idle，:24-51）逐状态对照一致，无"两色一态"残留。
- **interrupted-run 标记的机器过滤**（渲染侧 `PiWebApp.ts:3979`，消费侧 :785）与 unknown 横幅的"只上静默屏"（:792）复核成立。

## 结论

本轮 lane B 未发现 retirement 模型本身的现行行为缺陷；发现 1 个现行行为缺陷（B-1，迟到后台失败跨选择作画）、2 个"记录声称已闭而实际未闭/latent"的缝（B-2、B-3）、1 个模型内部原则冲突表现为不可兑现的承诺（B-4）、1 个测试缺口（B-5）、以及 3 条文档/记录漂移与 2 条卫生项（B-6、B-7、B-8、附带观察）。另附 4 条"已记录、核实仍在场"的开放项，避免 round-25 记录重复推导。
