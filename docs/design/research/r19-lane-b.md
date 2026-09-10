# Round 19 — Lane B（行为与数据）：退休模型端到端、interrupted-runs 诚实性、预取/缓存键、跨切换状态

HEAD `90b2238d`（branch `refactor/plugin-architecture`，任务基线 ed0cd40f 之上仅文档/脚本提交，以下引用均按当前工作区核实）。本车道不修改任何仓库文件；每条发现给出 file:line、最小失败场景与 TRUE/FALSE 裁决。无推测处均标注。

---

## 发现 1（高）：两个裸 `setState({ error })` 生产者仍在绕过 seam，round-18 的"全称"声明已被代码证伪

**证据**
- `src/client/src/controllers/sessionController.ts:532`：`this.setState({ error: "The backend session is not ready for queued sends. Copy your message before discarding this failed start." })` — 不带 `errorRetiredBy`、不带 `errorMachineId`。
- `src/client/src/controllers/sessionController.ts:655`：`this.setState({ error: \`Queued command “${text}” needs input; open the session and run it again.\` })` — 同样裸写。
- 对照声明：`docs/design/review-triage-uiux-round18.md:38-39`（第 8 条）："**Bare error writes skipped the seam** (lane B): every remaining 'setState({ error })' producer now travels with its retirement mark."；`.changeset/round-eighteen-audit.md` 同义。而 `src/client/src/errorNotice.ts:20-21` 的模型不变量是"Returning both fields together makes the pair impossible to set apart"。
- 另一个半写者：`src/client/src/components/PiWebApp.ts:3888`（prompt-editor 的 `onPluginNotice`）写 `{ error: message, errorRetiredBy: RetiredBy.reader }` —— 带 mark 但**不写 scope**，同样违反"always writes the scope"（round-18 第 5 条，review-triage-uiux-round18.md:29-31）。

**最小失败场景（532，读者可操作消息被当作可自愈主张）**
1. 机器 "lab" 不可达，restore 梯子或 `selectInitialMachine`（machineController.ts:154）挂出 reply- retired、machine-scoped 横幅 `"lab is unavailable; reconnecting…"`（6 秒过期、可被 lab 的成功清除）。
2. 横幅在屏期间，用户对 pending-start 会话排队发送，命中 532 守卫 → 新文本继承了 `errorRetiredBy:"reply"` 与 `errorMachineId:"lab"`。
3. 结果一：`scheduleTransientErrorDismissal`（PiWebApp.ts:1059 按 reply 判定）6 秒后吞掉这条"Copy your message before discarding…"——正是退休模型要消灭的"把永久失败演成自愈"；结果二：lab 上任何一个成功请求经 `clearTransientError("lab")`（PiWebApp.ts:1031-1036）把它当传输主张抹掉。

**裁决：TRUE**（代码事实无歧义；场景两步都在现有代码路径内，无需并发奇迹——reply 横幅寿命 6 秒/持续重挂，窗口充足）。655 同理（"needs input; open the session and run it again." 是读者指令，却被继承为 reply）。

---

## 发现 2（高）：daemon 重启横幅的"自愈改写"在退休模型下不可达——最常见横幅回归为永久原始 ECONNREFUSED

**证据**
- 分类：`src/client/src/notice.ts:85` `if (error instanceof HttpError) return noticeForReader(text);` — 网关 502 属 HttpError → **reader-retired**。
- 渲染门：`src/client/src/components/errorBanner.ts:23` `const transient = retiredBy === "reply" ? normalizeTransientError(error) : undefined;` — reader 横幅永远不应用改写表。
- 改写表第一支（errorBanner.ts:56-64）专门匹配 `…session daemon…unavailable: connect (enoent|econnrefused)…sessiond.sock`，注释明言这是"the commonest banner"（daemon 重启时必有）。但该文本只可能经 HttpError 进入横幅（server 端 `src/server/web/sessionProxyRoutes.ts:66-68` 502 + `{error: "Session daemon unavailable: …"}`）→ 永远 reader-retired → **该分支在生产不可达**。`noticeFromTransport` 的仅有的两个生产调用（PiWebApp.ts:1530、machineController.ts:154）都不产生 sessiond 文本。
- 测试盲区：`errorBanner.test.ts` 的 "daemon restart" 组与 `isTransientError` 用例全部直呼 `normalize`/以默认 `retiredBy="reply"` 渲染，从未把"HttpError 分类→reader→改写被跳过"这条生产链测进去。
- 文件内自相矛盾：errorBanner.ts:12-18 头注释仍宣称这类失败"usually self-heal after the next retry or a sessiond restart… not a full red 'something is broken forever' treatment"，而模型把它的载体（HttpError）判为 reader-retired（永久、role="alert"，errorBanner.ts:24）。

**最小失败场景**
按 AGENTS.md 的常规操作重启 sessiond（"a manual restart of the session daemon is needed"）。web 进程存活，daemon 下线：任意经 `/api/machines/local/...` 代理的轮询 502 → 横幅显示原始 `"Session daemon unavailable: Error: connect ECONNREFUSED /home/…/.pi-web/sessiond.sock"`，role="alert"；daemon 恢复后所有请求成功，但 reader 退休意味着任何成功都不清除（clearTransientError:1032 要求 reply）→ 横幅一直挂着直到用户手动点 ×。round-17 修复叙事（errorBanner.ts:58-61 "left the commonest banner sitting on the screen long after the daemon was back"——为此第二次修措辞）所治愈的行为，被同一轮的模型改判悄悄恢复。

**裁决：TRUE**（分支死代码 + 文件头注释/round-17 叙事与现行行为矛盾，都可静态复核）。注：这是"决策（HttpError=读者退休）与其表意工具（自愈改写）未合拢"的设计回路未闭合——owner 可能有意接受永久化，但那样 normalize 第一支与整套 "daemon restart" 测试是应删除的死代码，且改动注释应同步；两者必居其一，现状两头都不成立。

---

## 发现 3（中）：同一文本在 1.5s hold 窗口内"清除后重现"不会重新武装 6s 过期——模型承诺的寿命失效

**证据**
- `PiWebApp.ts:3778-3805` `renderErrorBanner`：`bannerHoldDecision` 对 `next !== ""` 一律返回 show（3780）；重新武装的条件是 `error !== this.lastScheduledError`（3794）。
- `bannerHold.ts:8-19`：hold 分支只在 `next === ""` 且显示不足 1.5s 时触发，此时**不重置** `lastScheduledError`/`bannerShownAt`（仅 hide 分支在 3786-3789 重置）。
- `PiWebApp.ts:1031-1041` `clearTransientError` 清除文本时清掉 `transientErrorTimer`（1037-1039），同样不重置 `lastScheduledError`。
- 对照声明：review-triage-uiux-round18.md:40-41（第 9 条）"a replacement starts its own hold window and expiry"。

**最小失败场景**
1. t0：本地链路断，`"Failed to fetch"` → reply-retired 横幅；`lastScheduledError=E`、`shownAt=t0`、6s 定时器武装。
2. t0+0.4s：一个请求成功，`reportTransportReachable` → `clearTransientError` 清文本并**取消**定时器。
3. t0+0.5s：渲染走 hold 分支（距 shownAt<1.5s）→ 保留旧横幅、`lastScheduledError` 仍是 E。
4. t0+0.9s：链路再断，下一个轮询以**逐字节相同**的 `"Failed to fetch"` 重挂 → 渲染 show 分支，`error === lastScheduledError` → 跳过重武装；旧定时器已在第 2 步取消。
5. 结果：这条 reply-retired 主张永不过期（模型承诺 6s），若链路此后持续断开也无成功可清除——只能手动关。机器级等价物：flapping 隧道下 restore 梯子 1s 首延迟重挂同一文本（REMOTE_ROUTE_RESTORE_RETRY_DELAYS_MS[0]=1000 < 1500，PiWebApp.ts:257）。

**裁决：TRUE**（时序窗口 ≤1.5s，但第 4 步不重武装是确定性代码路径；round-18 第 9 条的声明只对"文本不同"的替换成立）。

---

## 发现 4（中）：清除侧普遍不重置 (errorRetiredBy, errorMachineId) —— round-18 第 5 条"a cleared banner resets it"只落地了 3 处

**证据**
- 声明：review-triage-uiux-round18.md:29-31 "The seam now always writes the scope, and **a cleared banner resets it**."
- 已重置的清除：PiWebApp.ts:1036（recovery）、782（interrupted 撤退）、3799（手动关闭）。
- 未重置的清除：
  - `src/client/src/appState.ts:178-193` `resetWorkspaceScopedState` 只含 `error: ""`（191 行），不带 pair —— 它在**每次**机器切换（machineController.ts:60）与项目/工作区切换（workspaceController.ts:42、55、76）时执行，是最高频的清除路径；
  - `machineController.ts:14、69、81`、`projectController.ts:35`、`sessionController.ts`（enqueuePendingSessionSend 后半 `error: ""`）、`reportedError.ts:29`、`PiWebApp.ts:1063`（6s 过期）、`PiWebApp.ts:1771`（lazy surface 恢复）。
- 单独看是潜伏的（pair 只在 error≠"" 时被读）；与发现 1 的两个裸写者复合即成观测缺陷：切换机器后上一台机器的 reply 标记滞留，随后 532/655 的新读者消息继承它。

**最小失败场景**
机器 A 挂着 reply/machine-scoped 主张 → 用户切到机器 B（selectMachine 经 resetWorkspaceScopedState 清文本、留 `reply`/`"a"`）→ 用户在 B 触发 532 守卫 → "Copy your message…" 以 `reply`+"a" 上市 → A 的下一次成功（或 6 秒过期）抹掉它。

**裁决：TRUE**（文档声明与 8 处清除位点的现状不符；与发现 1 合并构成完整的复合缺陷链）。

---

## 发现 5（中）：interrupted-runs 标记的 machine scope 字段"写了没人读"，标记集跨机器切换不清除、渲染端不校验

**证据**
- `src/client/src/components/PiWebApp.ts:305-306`：`interruptedSessionIds` 与 `interruptedSessionIdsMachine` 成对声明，注释宣称"the interrupted markers **and the machine they were read from**: a late read … must not adopt here"。
- 写侧：780 行写入 machine 字段；写侧守卫 778 行（`selectedMachineId !== machineId` 则不采纳）。
- **全仓 grep：`interruptedSessionIdsMachine` 除声明与写入外零读取**（生产代码）。
- 读侧：3916 行把 `this.interruptedSessionIds` 无机器校验地传给 quick switcher，唯一守卫是 `quickSwitcherBrowsingElsewhere()`（浏览他机时传空集）；而 `machineController.selectMachine`（machineController.ts:17-41）重置AppState 里一切同类 per-session 映射（sessionStatuses/sessionActivities…），**不清**这个宿主字段。
- 对照声明：review-triage-uiux-round18.md:36-37（第 7 条）"markers carry their machine" —— 载体存在，消费端从未接线。

**最小失败场景**
机器 A 上打开 switcher → 标记集 {s1} 装入（宿主字段）→ 切到机器 B（AppState 全部重置，唯独此字段幸存）→ B 上打开 switcher：若 B 恰有同 id 会话（或未来任何按 id 聚合的消费方加入），A 的"被重启打断"环标记会贴在 B 的行上；即便无碰撞，B 上渲染的是 A 的数据这一事实只靠"ID 不撞"这一偶然成立，而不是靠 scope 校验成立。

**裁决：TRUE**（死字段 + scope 只在写侧闭环是事实；可见危害需要跨机 sessionId 相撞，故严重性低-中。设计回路：字段为读侧检查而立，检查从未写——典型的半截实现）。

---

## 发现 6（低-中）：interrupted-runs "unknown" 横幅的撤退仍靠精确措辞匹配，且被机器门卫与切换清除两头截断

**证据**
- 挂出：`PiWebApp.ts:775` `noticeForReader("Interrupted-run status is unknown: the read failed. Retrying the connection will resolve it.")`；撤退：782 行 `if (this.state.error === "Interrupted-run status is unknown: the read failed. …") this.setState({ error: "", … })` —— **同一字符串手工复制两份**，按措辞匹配退休恰是 notice.ts:8-11 立法禁止的形态（round-18 刚把 6s 过期从措辞匹配改为按 mark，review-triage-uiux-round18.md 所引 b0bce2a0）。
- 撤退被 778 行的 `if (selectedMachineId(this.state) !== machineId) return;` 挡在**采纳之前**：为机器 A 的重试成功而撤横幅，仅当用户仍选中 A。
- 同时任何机器/项目/工作区切换经 `resetWorkspaceScopedState`（appState.ts:191）清掉该横幅，但**过期标记集**（发现 5 的宿主字段）幸存 → UI 回到"显示可能过时的标记、无任何 unknown 提示"。

**最小失败场景**
A 上 switcher 打开、读取失败 → unknown 横幅（reader，永不自过期）→ 用户切工作区（resetWorkspaceScopedState 清文本）→ 横幅消失、旧标记继续显示且无 unknown 状态；若此时 A 的重试成功（socket 重连触发），778 门卫放行前用户在 B → 撤退分支根本不执行。round-18 声明"retracts itself when the state is known again"只在"字符串未改 ∧ 机器未切"时成立。

**裁决：TRUE**（措辞匹配退役是既定反模式；"已知后自撤"与"诚实渲染 unknown"两条承诺都在导航动作下失效。severity 低-中：标记只渲染于 switcher，重开 switcher 会重读并自愈）。

---

## 发现 7（低）：bannerHold 的 1.5s 最短可见窗口覆盖用户的显式关闭

**证据**
- `PiWebApp.ts:3779-3784`：hold 分支返回 `this.heldErrorBanner`（仍带关闭按钮的旧横幅）；手动关闭（3799）只 `setState({ error: "", errorMachineId: "local" })`，不清 `bannerShownAt`/held 模板。
- hold 语义（bannerHold.ts:1-5）为"防红闪"而设，针对的是**替换/清除流**；对用户点击 × 的显式意图没有豁免。

**最小失败场景**：横幅显示后 0.3s 用户点 × → 渲染 `error===""` → `bannerHoldDecision` 返回 hold（elapsed 0.3 < 1500）→ 旧横幅（含 ×）继续渲染至 t0+1.5s 才消失。用户"关了没关掉"最长约 1.2s。

**裁决：TRUE**（行为可从代码直接推出；影响为观感级，但与"dismiss 即撤"的按钮承诺相悖）。

---

## 发现 8（文档矛盾）：operation-model.md 声称"live 链路上的超时不再报错"已落地，round-18 却记录该分支生产不可达

**证据**
- `docs/design/operation-model.md:130-132`（Status: what landed）："**Three-arm settlement** … A timeout on a live link no longer claims the server did not answer — the banner stays down while the socket is alive."
- `docs/design/review-triage-uiux-round18.md:44-46`（Deferred with written reason）："**link.live is never passed in production** (lane C, P2): the timeout suppression branch is unreachable."
- 代码：`errorNotice.ts:25` 默认 `{ live: false }`；全仓生产调用 `errorNoticePatch(error)` 无一传 `link`（见 grep 清单，PiWebApp.ts:1779/2004/2625/2876… sessionController.ts 全部 40+ 处）。`notice.ts:78` 的 `link.live` 分支生产不可达。

**裁决：TRUE**（同一 HEAD 上两份文档互相矛盾；operation-model 的"已落地"高估了一项实际被 round-18 记录为 deferred 的事）。

---

## 观察（裁决为真但当前无用户可见故障——明确标注为潜伏缝，非缺陷主张）

1. **in-flight 共享键忽略 cache 模式**：`src/client/src/api/inFlight.ts:15-18` `dedupeKey(url, method)` 不含 `cache:"no-store"`。若未来对同一 URL 同时存在普通读与 no-store 读，no-store 调用者会搭上首次（可能命中 HTTP 缓存的）飞行。当前所有 no-store 调用（clients.ts:111-113、123）URL 均含 `?refresh=1` 或独立路径，无碰撞。裁决：TRUE（潜伏），现无可达失败。
2. **machineId 提取取第一个 `/machines/` 段**（transportHealth.ts:35-37）：查询串含 `/machines/…` 的路由会误提取；现路由表无此形态，且 `remoteApiPath`（machineProxyRoutes.ts）保证真实机器段在最前。裁决：TRUE（潜伏）。
3. **restore 梯子把全局 error 槽当本步失败信号**：`PiWebApp.ts:1489-1491` `if (this.state.error !== "")` 在 loadProjects 后检查——任何并发生产者（如 reconnect 触发的 interrupted-runs unknown 横幅，1925 行同源）落入窗口会令该次尝试误判失败；`loadProjects` 起始清 error（projectController.ts:35）使多数 unrelated 横幅被自家清除，重试一次即恢复。裁决：真实竞态、自愈、影响 ≤ 一次重试延迟；列为观察。
4. **`setRemoteRouteRestoreMessage` 机器名回退**（PiWebApp.ts:1521）`?? this.state.selectedMachine?.name`：路由 machine 不在名册而 selectedMachine 存在时会以错误机器命名"X is unavailable"。`pendingRemoteRouteRestoreStillCurrent`（1533-1539）要求 selected===route.machineId，使该路径难以到达。裁决：推测性（标为 speculation），建议收敛时顺手收口为 `"Remote machine"` 单一回退。

## 已查证无发现的部分（clean 的部分也要说清查了什么）

- `reportTransportReachable` 的"只认 2xx"与网关语义一致：远端机器不可达时网关回 502/504（machineProxyRoutes.ts `sendGatewayError`），不会伪证机器可达；`decodeURIComponent` 正确还原编码 machineId；"local 主张被任何成功证伪"与 `clearTransientError` 的匹配规则（PiWebApp.ts:1033）及 PiWebApp.ts:1027-1029 的声明一致。
- 铁轨/圆点：`shared.ts:443-450` 等特异性 :has() 规则按源顺序编码 unread < session-success < running < asking < terminal < error < archived < selected，与 round-17 决策"unread < running < asking"一致；运行态确有 `.session-state.running` 类（sessionRowIndicator.ts:67-69 的包裹 span），445 行规则可达。单一指示器仲裁（sessionRowIndicator）使"行内双标记组合"基本不可达，铁轨与圆点在现有枚举内一致。
- 预取/缓存键：`workspaceSessionsCache` 键含 machine（workspaceSessionsCache.ts:14-16）；quick switcher 缓存按 `quickSwitcherMachineId`+30s TTL 且换机浏览时清空（PiWebApp.ts:2497-2501、2560-2568）；`hydrateSessionStatuses` 有机器守卫（sessionController.ts:1031）；`shareInFlight` 结算即弃、非缓存（inFlight.ts:27-40）。
- sessiond 中断记录的读-清协议（sessionRoutes.ts:95-103）与客户端 `loadInterruptedRuns` 的 undefined-on-failure（sessionController.ts:1007-1014）分层正确；daemon 侧"缺文件=无中断"（interruptedRunStore.ts readInterruptedRuns 注释）与客户端"读失败=未知"不冲突。
- round-17 第 3 条（restore 横幅自引用）确已修复：PiWebApp.ts:1523-1527 detail 取 `health?.error`，不再回读 `state.error`。
