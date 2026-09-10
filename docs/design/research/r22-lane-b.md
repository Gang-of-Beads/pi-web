# Round 22 收敛评审 — Lane B（行为与数据）

- 仓库：/Users/hanxiao.du/Desktop/vincent/projects/pi-web，分支 refactor/plugin-architecture，HEAD 1c2013f7（只读评审，未改动任何仓库文件）。
- 分工焦点：退役模型端到端（machineId 作用域、过期、bannerHold）、interrupted-runs 诚实性、prefetch/缓存键、跨切换的状态。
- 结论：**不是干净的一轮**。11 项发现全部裁定为 TRUE（2 中、2 中低、6 低、1 项低且带 SPECULATION 标注），另有 8 个怀疑被证据裁定为 FALSE，列在文末；两项为 round-20/21 已挂起的旧账，未计入新发现。

---

## B-1（中）本机 daemon 掉线的主张被标成 page 作用域 —— HttpError 从不回退到 URL 的机器作用域

**裁定：TRUE。**

证据链：

- `src/client/src/api/http.ts:58` —— HttpError 的 machineId 只来自响应体的 `machineId` 字段；请求 URL 明明在手（`fetchBody(url, …)`），却没有 `machineIdFromUrl(url)` 兜底。
- `src/client/src/notice.ts:94-96` —— URL 机器作用域只为 `RequestTimeoutError` 提取（`machineIdFromUrl(error.url)`）；fetch 家族（TypeError）和"body 不带 machineId 的 HttpError"都落到无机器证据。
- `src/server/web/sessionProxyRoutes.ts:66-68` —— 本机会话代理的 502 应答体是 `{ error: "Session daemon unavailable: connect ENOENT …" }`，**不带 machineId**（对比远程网关 `src/server/web/machines/machineProxyRoutes.ts:365-372` 的 `sendGatewayError`，它带）。
- `src/client/src/components/PiWebApp.ts:1042-1049` —— page 主张被"任何来源应答"推翻（`errorMachineId === "page"` 即 disproved）。

最小失败场景：fleet = local + remote-a，remote-a 健康且其 socket 活跃。自更新重启 sessiond（web 进程仍活着）：本机 unread 快照（`api/machines/local/sessions/unread`）答 502 → 措辞表命中（errorBanner.ts:65-66）→ reply-retired、machineId=page 的 "Reconnecting to the session daemon…" 横幅；下一拍 remote-a 的活动事件触发 `sessionUnread.refresh("remote-a")` 成功 → `reportTransportReachable("api/machines/remote-a/…")` → `clearTransientError` 把 page 主张清除。**remote-a 的成功抹掉了本机 daemon 的抱怨**——正是 `.changeset/banner-retirement-model.md` 宣称已修复的形态：a success from machine A no longer erases machine B 的抱怨，而 `errorBanner.ts:60-63` 自己的注释称这是 "the commonest banner an update produces"。同理可被任何 web-owned 成功清除（如打开设置 machines 区触发的 `api/pi-web/fleet`，web 进程在 daemon 掉线时照样 200）。

修复 seam（两处任一）：http.ts 抛 HttpError 时以 `machineIdFromUrl(url)` 兜底（transportHealth.ts:29-33 已导出该函数，http.ts:2 已在 import 它）；或 sessionProxyRoutes.ts:67、workspaceDeletionRoutes.ts:38 等 local 502 体补上 machineId（与远程网关对齐）。注意对 web-owned URL（`api/plugin-backends/...`、`/api/pi-packages`）代理到本机 daemon 的失败，URL 规则给不出 "local"，这是模型词汇表的残余缺口，需要 owner 认。

## B-2（中）composed 的 reply 主张以"永久红 alert"样式渲染，6 秒后却被定时器删掉

**裁定：TRUE。**

证据链：

- `src/client/src/components/errorBanner.ts:64` —— `composed = /is unavailable; reconnecting/i`，其后所有改写规则都带 `!composed` 守卫，composed 文本最终 `return undefined`。
- `src/client/src/components/errorBanner.ts:23-24` —— `transient = retiredBy === "reply" ? normalizeTransientError(error) : undefined`；composed + reply → undefined → 渲染成 **无 transient 类、role="alert" 的永久红 alert**。
- `src/client/src/components/PiWebApp.ts:1073-1078` —— 6 秒过期只看 `errorRetiredBy === RetiredBy.reply`，composed 主张正是 reply（notice.ts:32-36 直接构造，不经 isTransientError）→ 6 秒后被 `clearErrorPatch()` 删除。

最小失败场景：远程机器 X 掉线，读者点开指向 X 的深链或行菜单 → `setRemoteRouteRestoreMessage`（PiWebApp.ts:1541-1544）产生 "X is unavailable; reconnecting… connect ECONNREFUSED …" → 渲染为醒目的红色永久 alert；6 秒后定时器把它无声删除，而重试梯下一次尝试在 8s/15s/30s 之后才重新举起它。一个"看起来是永久故障"的红条在 6 秒内自灭——正是 round-18 item 6 批评过的倒置（"presented a permanent failure as a self-healing one"），方向相反的同一个错：把自愈主张打扮成永久故障，然后悄悄删掉。改写与**样式**两个决定被耦合在同一个函数里：为保机器名而拒改写没问题，但 transient 样式应当 keyed on `retiredBy === "reply"`（所有 reply 主张都是自愈的），而不是 keyed on「是否被改写」。

## B-3（中低）重试梯终点的终态消息 "X is still unavailable." 也是 reply-retired，6 秒自毁

**裁定：TRUE。**

证据：`src/client/src/components/PiWebApp.ts:1541-1544` —— exhausted 与非 exhausted 两种措辞走同一个 `noticeFromTransport`（reply）；`1523-1526` / `1427-1429` 是梯子耗尽后唯一的 setMessage 调用，之后 `clearPendingMachineLoadRestore()` / `clearPendingRemoteRouteRestore()` 收摊，再无重试。

最小失败场景：读者带着指向 remote-a 的深链回来，remote-a 恰好掉线；梯子 1s+3s+8s+15s+30s ≈ 57 秒后打出 "remote-a is still unavailable. <detail>"，6 秒后自灭。读者一分钟后看手机：应用外表正常、会话没恢复、**没有任何解释残留**。round-18 item 6 的判词直接适用："presented a permanent failure as a self-healing one and deleted the operation the reader needs to retry" —— 梯子耗尽是终态，应当 reader-retired（或至少豁免 6s 过期），与 "Update failed: …" 同类。

## B-4（中低，产品决策缺口）任何作用域切换都会静默清除 reader-retired 失败

**裁定：TRUE（行为属实；是否可接受是 owner 的语义决策）。**

证据：`src/client/src/appState.ts:182-197` —— `resetWorkspaceScopedState()` 展开了 `clearErrorPatch()`；调用方包括 `machineController.ts:52-75`（selectMachine，:61）、`workspaceController.ts:42`（clearSelection）、`:55`（selectProject）、`:76`（selectWorkspace）。

最小失败场景：读者删除 workspace 失败 → 页面横幅 "Delete failed: …"（reader-retired，sessionController.ts:905）；读者切到另一个 workspace 想先看看别处 → 横幅无声消失。`errorBanner.ts` 顶部契约写的是 "stays until the user dismisses it, another message replaces it, **or the owning action clears it**" —— 切换作用域既不是读者处置也不是 owning action。round-21 item 8 的动机是作用域卫生（旧作用域的横幅不得在新作用域上说谎），这个动机对 reply 主张完全成立；但对 reader-retired 的操作失败，两个原则（"读到为止" vs "数据不得跨作用域残留"）冲突，代码单方面选了 scope 卫生，把失败消息**整个丢掉**而不是移到旧作用域上。按本仓库 "Product semantics belong to the owner" 规矩，这个取舍应当摆给 owner：切走即弃，或按 errorMachineId/作用域保留到读者处置。

## B-5（低）interrupted-runs unknown 横幅的撤销仍依赖两处重复的长字面量

**裁定：TRUE（round-20 item 7 "the retraction reads the flag, not the banner own wording" 只对了一半）。**

证据：`src/client/src/components/PiWebApp.ts:783` 与 `:792` —— 同一个 96 字符消息字符串出现两次；`:790` 的 flag 只决定"是否尝试撤销"，`:792` 决定"撤哪一个"仍是整串相等比较。

最小失败场景：将来有人改了 :783 的措辞（哪怕改个标点）没改 :792 → 读恢复后 flag 复位但横幅永不撤销，变成一条"只能手动关、否则永远挂着"的 reader 横幅，且没有任何测试失败（除非测试恰好锁了字符串）。建议提为常量（`INTERRUPTED_RUNS_UNKNOWN_MESSAGE`）单点引用，或给 Notice 加身份（id）而非比对文本。

## B-6（低）reportTransportReachable 覆盖不全：fetchWithDeadline 家族与 XHR 上传成功后不上报

**裁定：TRUE（影响小，属模型一致性债）。**

证据：`request()` 是唯一上报点（http.ts:50）。绕过它的成功应答：`api/clients.ts:378`（tree/fork）、`:399`（terminal-command-run 轮询）、`api/pluginBackends.ts:63`、`plugins/external.ts:81`（fetchWithDeadline）；`api/workspaceUploads.ts:126-163`（XHR 上传）。

最小失败场景：transportHealth.ts 的前提是 "Any successful exchange with the server is proof the transport is back. recovery is noticed by whichever channel happens to succeed next"——但 tree/fork、插件后端、上传成功时都不作证。实际后果有限（socket 重连路径也会 clear，reply 主张 6s 也会自愈），所以定低；但模型声明与实现覆盖不一致，下一个依赖"任何成功都会撤销"的新功能会踩到。

## B-7（低，措辞）网关 502/504 的改写同时抹掉了机器名与证据 detail

**裁定：TRUE（round-21 item 1 记录了规则本身；抹除代价未被记录）。**

证据：`src/client/src/components/errorBanner.ts:98-99` —— "Remote machine unavailable (connect ETIMEDOUT …)" 被整体改写为 "Reconnecting to the machine…"；而同一文件 :60-63 为 composed 消息设立守卫的理由恰是 "shortening it would erase the machine"。`errorMachineId` 在 state 上是现成的（errorNotice.ts:28），横幅渲染时却没有用它补回名字。

最小失败场景：fleet 里两台远程机，remote-a 掉线：读者看到 "Reconnecting to the machine…"，无法分辨是哪台、为什么。6 秒自灭期间连 detail 也没了。建议改写为带机器名的 composed 形态（"remote-a is unavailable; reconnecting…"），与 B-2 的样式修正一并处理。

## B-8（低，潜伏）HttpError 只要 body 带 machineId 就 reply-retired，不看文本是否 transport 主张

**裁定：TRUE（现网可命中的是网关两个 transport label，分类恰好正确；缺陷是潜伏的）。**

证据：`src/client/src/notice.ts:97-99` —— `error.machineId !== undefined ? noticeFromTransport(…) : noticeForReader(…)`：retirement 跟随"body 里有没有 machineId"，而不是跟随消息证据——与同文件 :90-93 自述规则（"Retirement follows the evidence in the message, not the exception pedigree"）矛盾。现网带 machineId 的非 transport 失败体：`machineProxyRoutes.ts:114-121`（409 plugin-lifecycle，文本是操作结局）、`machineProxyRoutes.ts:171`（selected-machine config 上游非 2xx 的回退体）。它们目前走 requestPluginBackend/SettingsDialog 的本地错误处理，不进页面横幅，所以只是潜伏；任何未来把这类体接到 `errorNoticePatch` 的调用点都会得到"操作失败 6 秒自毁"。

最小失败场景（潜伏触发）：未来某 controller 直接把 config 保存失败接到 seam → 500 + machineId → reply-retired → 6 秒后消失，读者没机会看到需要重试的操作结局——即 changeset 宣称已消灭的 "red flash, no explanation"。

## B-9（低，意图待 owner 确认）机器列表行菜单 "Check again" 执行的是完整 selectMachine

**裁定：TRUE（行为属实；"check = 过去看看"是否为有意产品行为未记录）。**

证据：`pi-web-plugins/machines/browser/MachineList.ts:179` —— 行菜单按钮 "Check again"（title "Check {name} again"）→ `context.refreshMachine`；宿主实现 `src/client/src/components/PiWebApp.ts:2930-2934`：`void this.machines.selectMachine(machine).then(() => Promise.all([refreshMachineHealth(), refreshMachineRuntime()]))`。而 selectMachine（machineController.ts:52-75）会清空 projects/workspaces/session、重写 URL。对比同一 context 的 remove/rename 都是就地操作；palette 动作 "Refresh selected machine"（pi-web-plugin.ts:66-71）之所以无破坏，只是因为对已选机器 selectMachine 早退。

最小失败场景：读者正在 local 的会话里工作，展开 remote-a 行菜单点 "Check again" → 整个应用跳到 remote-a 的空项目列表，当前会话视图被弃。`refreshMachineHealth(machine.id)` 本可以直接调用（它带 machineId 参数），无需 selectMachine。若"顺便跳过去"是有意的，请把动作改名并把行为写进 triage；否则改为纯健康检查。

## B-10（低，文档漂移）operation-model 的代码 span 被吃掉一个词；round-21 的 deferred 记录与代码相抵

**裁定：TRUE。**

证据：`docs/design/operation-model.md:29` —— "The suppression branch exists in  but no production caller passes" —— 反引号 span 内容为空（修复脚本吞词的又一例，同 round-19 的 style="undefined"）。`docs/design/review-triage-uiux-round21.md:53-54` 称 "the dead proactive branch stays removed"，但 `src/client/src/notice.ts:80` 的 `link.live` 分支仍在、`errorNotice.ts:25` 仍在穿线这个从未有生产调用方传过的参数——triage 说的"removed"在树上不成立（或至少指代不明）。

## B-11（低；部署面为 SPECULATION，机制为代码可证）TCP 端点部署下 daemon 掉线横幅永不愈合

**裁定：TRUE（机制）；SPECULATION（仅限"多常见"——TCP 是非默认配置）。**

证据：`errorBanner.ts:65` 的规则要求同时命中 `/unavailable: connect (enoent|econnrefused)/i` **且** `/sessiond\.sock/i`；TCP 配置下 sessiond 客户端走 fetch（`src/server/shared/sessiondClient/sessionDaemonClient.ts:14-15, 39-53`），失败文本是 "fetch failed"（或无 socket 路径的 ECONNREFUSED），两个条件都不满足 → isTransientError 为 false → HttpError 无 body machineId → `noticeForReader` → **永久**横幅，而 `errorBanner.ts:34-35` 的注释称 ECONNREFUSED 正是 "what an update looks like"。最小场景：`PI_WEB_SESSIOND_PORT` 部署在更新窗口打开页面 → "Session daemon unavailable: fetch failed" 红条驻留直到手动关闭，daemon 恢复也不撤（只被下一条消息替代）。

---

## 裁定为 FALSE 的怀疑（记录以免重报）

1. **怀疑** refreshMachineHealth 的迟到失败会把 A 机器的抱怨画到 B 上 → **FALSE**：seq 守卫在位（machineController.ts:124-131，round-21 item 2），且网关 502/504 自带 machineId（machineProxyRoutes.ts:365-372），timeout 自带 URL 作用域（notice.ts:95）。
2. **怀疑** 会话转写缓存缺机器作用域 → **FALSE**：`sessionCacheKey` = machineSessionKey(machineId, sessionId)（sessionController.ts:1543-1545，:297）。
3. **怀疑** 子代理/后台任务行跨机器泄漏 → **FALSE**：`updated()` 按 chat identity 清空（PiWebApp.ts:692-700）。
4. **怀疑** prefetch 键缺机器作用域、失败后永久放弃 → **FALSE**：键含 machineId、失败即 forget（sessionController.ts:1914-1928）。
5. **怀疑** 快速切换器的 interrupted 标记跨机器泄漏 → **FALSE**：渲染处按 `interruptedSessionIdsMachine !== selectedMachineId` 归零（PiWebApp.ts:3940），失败读不清空标记（:779-785），符合 round-17 决策 4。
6. **怀疑** 1.5s hold 会复活被读者关掉的横幅 → **FALSE**：`bannerDismissedByReader` 先决（PiWebApp.ts:3793-3801，:3816-3823；round-21 item 3 成立）。
7. **怀疑** interruptedRunsUnknown 在切换机器后卡死 → **FALSE**：flag 由下一次成功读复位（:790-793），再宣告有 `state.error === ""` 守卫（:783），机器守卫在入口（:778）。
8. **怀疑** unix socket 的 ECONNREFUSED 也漏过措辞表 → **FALSE**：unix 路径的 connect 错误文本带 socket 路径（requestSocket 路径，sessionDaemonClient.ts:55-88），两条件都命中；只有 TCP 部署漏（见 B-11）。

## 已知且已挂起（未计入新发现）

- **persistent-failure pulse**（round-20/21 carried）：持续失败时 reply 主张反复重举、6s 过期反复重置——B-1/B-2 的场景会加剧它的观感，但条目本身仍是 owner 决策，不重复立案。
- **link.live 未接线**（round-19 起 carried）：见 B-10 的文档出入；行为本身已是记录在案的 deferred。

## 检查过且认为扎实的面（简列）

- bannerHold 状态机（bannerHold.ts:8-19 + PiWebApp.ts:3792-3825）：替换自起新窗口、读者否决权、clear 后 lastScheduledError 复位，链路自洽。
- loadInterruptedRuns 返回 undefined 而非空集（sessionController.ts:1007-1015），空集仅来自 daemon 真实清账——与 round-17 决策 4 一致。
- 快速切换器跨机器浏览的键（quickSwitcherMachineId/browseMachineId，PiWebApp.ts:2509-2583）与"就地行为须先 moveToBrowsedMachine"（:2612-2633）成对出现。
- 各缓存键：workspaceSessionsCache（machineId\u0000path）、cachedNewSessions（machineId 字段）、machineNavigation（按机器）、workspaceSelection（machineProjectKey）。
- resetWorkspaceScopedState 的类型使未来的裸 error 写入成为类型错误（appState.ts:168-179）——方向正确，代价见 B-4。

— Lane B，round 22。基于静态阅读与引用核对；未运行浏览器探针（本 lane 为只读评审）。
