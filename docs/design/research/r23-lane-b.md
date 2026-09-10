# Round 23 · Lane B：行为与数据（退役模型端到端、interrupted-runs 诚实性、prefetch/缓存键、切换后的状态）

审计基线：branch `refactor/plugin-architecture`，工作树 HEAD `5bd8e406`（round-22 修复 HEAD `fb975a0c` + 两个仅改 workflow 的 round-23 提交）。结论:**不是干净的一轮**——7 项 TRUE 发现(1 中、3 中低、3 低),外加 2 项低严重度的文档/裁定记录问题,以及一份"查过且成立"的清单。每项附 file:line、最小失败场景和 TRUE/FALSE 裁定。

---

## TRUE 发现

### B-1(中) `refreshMachineRuntime` 缺少它的孪生方法已有的"迟到失败选择守卫"——A 机器的迟到失败会画到 B 机器的屏幕上

- 证据:`src/client/src/controllers/machineController.ts:149-152`
  ```ts
  } catch (error) {
    if (this.runtimeRefreshSeqByMachine.get(machineId) === seq) this.setState(errorNoticePatch(error));
    return undefined;
  }
  ```
  对照孪生方法 `refreshMachineHealth`(`machineController.ts:133-137`):seq 守卫之后还有 `if (selectedMachineId(this.getState()) !== machineId) return undefined;`,注释明说"the sequence guard only moves when the same machine is re-polled, so it cannot see a machine switch; the selection check … is what stops a late failure from painting machine A's complaint onto machine B"。runtime 版没有这个选择检查。
- round-22 记录与代码不符:`docs/design/review-triage-uiux-round22.md` item 5 称"the selection check … is now the third copy's missing half",`fb975a0c` 的 diff 只给 `refreshMachineHealth` 加了 5 行守卫(`git show fb975a0c -- src/client/src/controllers/machineController.ts` 仅 +5 行且都在 health 内)。runtime 是没被点名的第四份拷贝。
- 最小失败场景:读者在机器 A;remote-restore 阶梯(`PiWebApp.ts:1505`)或 `selectMachine`(`machineController.ts:66`)发出 `api.runtime(A, true)`,该读很慢(30s deadline);读者切到机器 B;读在 30s 处失败,seq 未动(切到 B 不会动 A 的 seq),`errorNoticePatch` 把 A 的抱怨(如 "Remote machine unavailable (…)")画到 B 的横幅上,且 scope=A 时 B 的成功无法撤回它,只能靠读者手关或 A 的成功。
- 需要注意的反面:`SettingsDialog.ts:428` 会经 `onRefreshMachineRuntime`(`PiWebApp.ts:3967`)对**未选中**机器发起用户主动的 runtime 刷新——那种失败**应该**上屏。所以修复不能照抄 health 的守卫,要区分"用户主动"与"后台刷新"(例如调用点传 `{ silentWhenDeselected: true }` 之类),否则会把 settings 的失败静音。
- 裁定:**TRUE**。

### B-2(中) interrupted-run 标记会被任何成功的重读无条件收回——而两处注释声称的收回理由(demon 让渡/只收回"已继续的 run")在 read-and-clear 语义下不可能成立

- 证据链:
  - daemon 端是 read-and-clear:`src/server/daemon/sessions/sessionRoutes.ts:95-102`——"Read-and-clear: the record answers 'what did the last restart interrupt', so once handed over it is spent"(`record.runs.length > 0` 时立即 `clearInterruptedRuns()`)。
  - 客户端把"成功的空记录"采纳为收回:`src/client/src/components/PiWebApp.ts:765-768`("An empty record is the daemon retracting markers the user has already seen (it clears the file once read), so it is adopted verbatim")与 `:780-781`(无条件 `this.interruptedSessionIds = ids`)。
  - 开关器注释声称选择性收回:`PiWebApp.ts:2463-2464`"re-reading it when the switcher opens retracts markers **whose runs have since continued**"。
- 矛盾:boot 读(PiWebApp.ts:1919-1924,connect 时)已把记录花掉;此后任何一次读(reconnect 回调 `:1941`、开关器打开 `:2473`、机器切换重入)只能拿到**空**记录。空记录无法区分"run 已继续"与"记录早已花掉",所以开关器重读的唯一实际效果是:把上次已显示的标记**全部**抹掉,不管 run 是否仍在被打断状态。而"run 已继续"本已由渲染处的状态仲裁兜住:`src/client/src/components/QuickSwitcher.ts:198` `const interrupted = this.interruptedSessionIds.has(session.id) && rawStateKind !== "working";`——仍在工作(=已继续)的行**本来就不显示** interrupted 徽标。于是重读没有加法价值,只有减法伤害。
- 最小失败场景:重启后 boot 读到标记 {s1, s2} 并显示;用户 10 分钟后打开 Cmd+K 想处理 s1——重读返回空记录 → 采纳 → s1/s2 的 interrupted 徽标在用户眼前消失(先闪现后消失,或直接不出现),而 s1 依然是那次重启被打断、从未恢复的会话。
- 裁定:**TRUE**(行为与两处注释的理由均矛盾;若"打开开关器=已阅即收回"是有意产品语义,需把注释改成这句话并把决定记录为 owner 决策)。

### B-3(中低) 深链启动竞态:boot 读会"消费并丢弃"local 机器的 interrupted 记录

- 证据:`PiWebApp.ts:1012`(`connectedCallback` 先 `this.connectRealtime()`)→ `:1919-1924` 连接即 `refreshInterruptedRuns(machineId)`,此时机器表为空,`selectedMachineId` 为 "local";`:1027` 才开始 `loadProjectsAndRestoreRoute()`,其中 `loadMachines(route.machineId)` 会选中深链的远程机器并触发 `handleMachineChange`(`:2036-2042`,realtime 重连)。读回来的采纳有丢弃守卫:`:772` `if (selectedMachineId(this.state) !== machineId) return;`——但 daemon 端记录已经被这次读**清掉**(`sessionRoutes.ts:97-98`)。
- 最小失败场景:本地 daemon 重启打断了两个本地会话;用户浏览器里开着一条指向远程机器的深链并刷新页面。boot 对 `api/machines/local/sessions/interrupted` 的读与 `loadMachines` 并发;若该读在后选机 setState 之后落定(两个 fetch 同窗口竞速,先后取决于服务端),local 的标记被丢弃,记录已被消费——整个页面生命周期内 local 的 interrupted 标记再也不可能出现(重读只会得到空)。快速连续切换机器 A→B 对 A 的记录同理。
- 裁定:**TRUE**(守卫丢弃的是"采纳",不是"消费";诚实性缺口)。修复方向(供参考,不为本次改动):丢弃前至少不要让记录白花——读的发起可以带选择代次,或在丢弃时保留到 `interruptedSessionIdsMachine` 供渲染门控(渲染处 `PiWebApp.ts:3941` 本来就按机器门控)。

### B-4(中低) round-22 挂给 owner 的产品问题"作用域切换是否清除 reader-retired 失败",代码已经单方面回答了"清除"

- 证据:`src/client/src/appState.ts:195`——`resetWorkspaceScopedState()` 内联 `...clearErrorPatch()`;该方法被 `machineController.ts:61`(selectMachine)与 `workspaceController.ts:42/55/76`(选项目/选工作区)整体展开进 setState。
- 对照文档:`docs/design/review-triage-uiux-round22.md` 末节"Product decisions brought to the owner"第一行:"**Scope switches clear reader-retired failures** (lane B): silent-clear vs. persist-per-machine is a product semantic."——这是**待 owner 决策**的记录,不是已决事项;而现行代码在每次机器/项目/工作区切换时无声清除横幅,**包括** reader-retired 的操作失败("Delete failed: workspace is busy")。
- 最小失败场景:读者点删除 → 失败横幅 "Delete failed: workspace is busy"(reader-retired);读者没细看,顺手点侧栏切到另一个工作区 → 横幅无声消失,操作失败再无任何痕迹。这正是 owner 记录过的"拿空换错"伤害族的反向版本(拿消失换诚实)。同类:用户在机器 A 发起的 archive 在飞行中,读者切到 B,失败画在 B 上(`sessionController.ts:842/859` 无守卫,属"操作横幅是全局铬"这一 operation-model 未决项的同一族,仅footnote)。
- 裁定:**TRUE**( unclosed design loop:文档记录为待决,代码已带默认答案;应显式化)。

### B-5(低) `machineIdFromUrl`——整个按机器退役模型的支点——没有任何直接测试;且它的 `decodeURIComponent` 在 `reportTransportReachable` 的 try 之外

- 证据:`src/client/src/api/transportHealth.ts:30-33`
  ```ts
  export function machineIdFromUrl(url: string): string | undefined {
    const scoped = /\/machines\/([^/]+)/.exec(url);
    return scoped?.[1] === undefined ? undefined : decodeURIComponent(scoped[1]);
  }
  ```
  `:44-47` 的 try 只包 listener:`const machineId = machineIdFromUrl(url); try { current(machineId); } catch {}`——extractor 在 try 外。`notice.ts:104` 的 `machineIdFromUrl(error.url)` 同样裸奔。
  测试覆盖:`src/client/src/api/transportHealth.test.ts` 全文只测 listener 接线与 "api/probe"(无 machines 段);`notice.test.ts:71-72` 的 timeout 用例 URL 是 "/status"(无 machines 段)。round-19 item 5"timeout 带机器作用域"与 round-22 item 1/2 的两条作用域修复,其提取函数本身零直测。另注意第一个匹配语义:嵌套路径(如 remote plugin-backend URL `api/machines/A/plugin-backends/...`)取第一个 `/machines/` 段——目前所有生产 URL 都把动态段 `encodeURIComponent`(`clients.ts:75`),故为潜在面。
- 最小失败场景(崩溃路径,标注 SPECULATION):若未来某调用点以未编码的机器名(含裸 `%`,如 "50%off")拼 URL,`decodeURIComponent("50%off")` 抛 URIError → `reportTransportReachable` 抛出 → `fetchBody` 在**成功响应之后**抛错 → 200 被当成请求失败(违反该函数自己的注释"Called on every response, so it must not throw")。当前仓库内未发现这样的调用点。
- 裁定:覆盖缺口 **TRUE**(模型核心函数无直测);崩溃路径 TRUE-但-潜在(需未编码段才触发)。

### B-6(低) 恢复证明只有 fetch 一条腿:四处 `fetchWithDeadline` 成功路径与 realtime 事件都不上报可达性,非选中机器的 reply-retired 主张可能比它的恢复活得更久

- 证据:`fetchWithDeadline` 的生产调用点绕过 `reportTransportReachable`:`src/client/src/api/clients.ts:378`(session tree fork)、`:399`(terminal command run 读)、`src/client/src/api/pluginBackends.ts:63`、`src/client/src/plugins/external.ts:81`。realtime 通道同理:`PiWebApp.ts:1959-1964` 机器活动 socket 的重连回调只做 `sessionUnread.refresh`,不 `clearTransientError`;`handleMachineActivityEvent`(`:1976-1979`)收到 `machine.status`(=该机器链接活着的直接证据)也不上报。
- 最小失败场景:机器 C 的健康刷新(`loadMachines` 的 `refreshMachineHealthFor`)在 roster 重载时失败并留下"C is unavailable; reconnecting…"式的机器作用域主张(page 上唯一给非选中机器留主张的路径之一);此后 C 恢复,其活动 socket 开始正常推 `machine.status`、侧栏圆点转绿——横幅仍挂着,直到读者点开 C(触发 health 成功上报)或 roster 重跑健康清扫或手关。模型语义"an answer from that link disproves it"要求 `machine.status` 事件也算该链接的回答。
- 裁定:**TRUE**(模型自身的缝;触发频率低,因为非选中机器很少持有主张)。

### B-7(低) remote-restore 阶梯把"共享横幅状态"当自己的成功信号:无关横幅会让它多试一轮,并偷走读者的横幅;持续 runtime 失败可终结于对健康机器的"still unavailable"

- 证据:`PiWebApp.ts:1505-1512`
  ```ts
  await this.machines.refreshMachineRuntime(machineId);
  …
  await this.projects.loadProjects();
  …
  if (this.state.error !== "") { this.scheduleNextRemoteRouteRestoreAttempt(route); return; }
  ```
  `this.state.error` 是全局共享横幅;阶梯期间任何其他生产者(reconnect 触发的 interrupted-runs unknown 横幅 `:777`、读者未关的旧失败)都使条件为真。随后 `scheduleNextRemoteRouteRestoreAttempt → setRemoteRouteRestoreMessage`(`:1546`)会用 "X is unavailable; reconnecting…" **替换**读者当前横幅——尽管本轮 `refreshMachineHealth` 已 ok(机器明明答了)。
- 最小失败场景:恢复阶梯进行中 socket 恰好重连,interrupted 读失败 → unknown 横幅(reader-retired)上屏 → 阶梯下一步见 `error !== ""` → 判失败 → 用 composed 主张覆盖 unknown 横幅并继续重试;若 runtime 读持续失败(健康 ok),五轮后终结于 "X is still unavailable."——对一台健康检查通过的机器是假主张。
- 裁定:**TRUE**(机制确凿;触发需要阶梯窗口内出现无关横幅,低频)。

### B-8(低) 读者关闭与"同一渲染批内的同文重报"竞态:新错误被吞,且旧的 6s 定时器随后把状态清掉

- 证据:关闭闭包(`PiWebApp.ts:3819-3824`)不取消 `transientErrorTimer`,只置 `bannerDismissedByReader` + `clearErrorPatch`;下一渲染的 dismissed 分支(`:3794-3801`)消费标志、重置 `lastScheduledError` 并**直接返回 null**——若同批(setState 合并进同一次 lit 渲染)有一个新错误(常见:同文的 "Lost connection to PI WEB. Reconnecting…" 轮询失败),它这次不被渲染也不重新武装;之后仅当出现无关状态变化才会渲染,而同文失败因 patch 无变化不再触发渲染;旧定时器在 t+6s 触发,`state.error === error` 成立 → `clearErrorPatch()` 把这个从未显示过的重报清掉。
- 最小失败场景:flappy 链路上读者关掉 "Lost connection…" 横幅;同 tick 内轮询失败以同文重报 → 徽标不出现;静默页面上后续同文失败不产生状态变化 → 横幅持续缺席,直到某个无关状态变化或恢复上报。
- 裁定:**TRUE**(窄竞态,低危;round-19 item 7"读者关闭是决定性的"修复没有覆盖"同批新错误"这一半)。

### B-9(低,文档漂移) "过期不看措辞"的三处记录都落后于 round-22 的再措辞门

- 证据:代码 `PiWebApp.ts:1073-1075`:`errorRetiredBy !== reply` **且** `normalizeTransientError(error) === undefined` 都要过——expiry 同时看退役标记**和**措辞层裁决(round-22 有意为之,代码注释 :1066-1072 论证充分)。
  落后的记录:`docs/design/review-triage-uiux-round17.md` 决策 5"decided by the retirement model, **not by matching the wording**";`.changeset/banner-retirement-model.md`"The six-second expiry checks the retirement mark **instead of guessing from the wording**"。round-17 文档对 item 1/2 都加了"not landed until round 18"式勘误注,对 item 5 没有对应注。
- 裁定:**TRUE**(历史记录未标注被后轮推翻;按 round-18 对"accounting failure"的标准,这类漂移应显式勘误)。

### B-10(低,裁定记录不准确) round-22 对 shared.ts 成功规则"两半都活着"的裁定,就效果而言不成立

- 证据:`src/client/src/components/shared.ts:435-436`
  ```css
  .action-row:has(:where(.activity-indicator.session, .session-state.running)) { border-left-color: var(--pi-success); }
  .action-row:has(:where(.session-state.running)) { border-left-color: var(--pi-accent); }
  ```
  两条特异性同为 (0,1,0)(`:has(:where(…))` 实参为 0);会话行同时命中两条,后者在后 → 会话 running 行**永远**是 accent,435 的 `.session-state.running` 半边从不决定最终颜色(它命中的每一行都被 436 覆盖)。功能结果正确(running=accent,与"running accent"一致),但 `docs/design/review-triage-uiux-round22.md` "Adjudicated FALSE" 里"both halves are live"的依据不准确——半边是**命中但无效**(dead weight),留着会误导后人以为它在承担会话行着色。
- 裁定:**TRUE**(裁定措辞与 CSS 实际效果不符;非行为 bug)。

---

## 查过且成立(防重报清单)

1. **单缝完整**:grep 全仓无裸 `setState({ error: … })` 生产者;authDialog/sessionCleanupDialog/SettingsDialog/SessionTreeNavigator 的 error 是各自组件局部状态,不经过页面横幅,合规。`errorNoticePatch/noticePatch/clearErrorPatch`(`errorNotice.ts:23-39`)三件套字段齐全(`errorNotice.test.ts:60` 钉住)。
2. **clearTransientError 的作用域判断**(`PiWebApp.ts:1035-1058`):page 主张被任意成功 disproved、机器主张只被该机器 disproved、清除时连 scope 和 `lastScheduledError` 一起重置——与 round-22 模型一致。`http.ts:51-56` 在 ok 判定**之前**上报(500 也算回答),listener 抛错被吞(`transportHealth.ts:44-50`)。
3. **hold/expire 状态机**(`PiWebApp.ts:3793-3826` + `bannerHold.ts`):hold 只为替换抖动、读者关闭先决、hide 渲染经 `error !== lastScheduledError` 分支重置调度标记 → 过期后同文重报能重新武装(B-8 之外的主路径都闭合);替换各自起新 hold 与新 expiry(:3812-3816);过期定时器回调带同文守卫(:1077-1078)。恢复清除路径显式重置 `lastScheduledError` 并清定时器(:1047-1057)。
4. **措辞表与作用域协同**:`errorBanner.ts:70-99` 的 composed 守卫保证 "X is unavailable; reconnecting… <detail>" 不被改写也不被 6s 过期,渲染(permanent style)与寿命一致;fetch 族整条消息锚定,组合消息不丢机器名;TCP 部署靠 "session daemon" 短语命中(round-22 item 7 在位)。
5. **缓存键携带机器**:`sessionCacheKey = machineSessionKey(machineId, sessionId)`(`sessionController.ts:1543-1545`,transcript 内存 Map 与 sessionStorage 同键);`workspaceSessionsCache.ts:15-17` 键 = machineId+NUL+workspacePath;`cachedNewSessions` 全部按 (machineId, cwd) 过滤;prefetch 键含 machineId、失败即 forget(`sessionController.ts:1914-1928`)。r22-lane-b 的"transcript 缓存缺 cwd"怀疑维持 FALSE:pi 的 `createSessionId()` 是 `uuidv7()`(node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js:12-14),跨 cwd 碰撞实际不可能,daemon docstring 的"an id alone is not enough"指查找机制而非 id 唯一性。
6. **interrupted-runs 的 unknown 纪律**:`loadInterruptedRuns` 失败返回 `undefined`(`sessionController.ts:1007-1015`);unknown 只在安静屏幕上宣告、按 flag 收回、渲染处按机器门控(`PiWebApp.ts:772-788, 3941`);round-22 item 6 的命名常量在位(`:249`)。(footnote:round-19/22 文档说 retraction "tracks a flag, not a wording match"——代码 :786 实为 flag **且** 同文匹配,后者是防止清掉别人横幅的必要守卫,文档措辞不精确但行为正确。)
7. **switcher 数据装载的机器/竞态卫生**(`PiWebApp.ts:2510-2556`):browsing-elsewhere 时项目向目标机器索取、迟到回答按 browseMachineId 丢弃、错误与 loading 的落定都带机器守卫;`quickSwitcherBrowsingElsewhere()` 让跨机器浏览时不带本机徽标(:2568-2573,3937-3943)。
8. **网关 502/504 带 machineId**:`machineProxyRoutes.ts:365-372`(`sendGatewayError`)与客户端 body 优先、URL 兜底(`http.ts:62`)闭环;本地代理 502 无 machineId 时由 URL 兜底为 "local"(`sessionProxyRoutes.ts:67`)。

## 附注(简报与代码的偏差,非仓库缺陷)

- 任务简报写 unscoped 主张记为 "local" 且被任意成功 disproved;现行代码是 `"page"`(`errorNotice.ts:28/33/38`、`transportHealth.ts:22-27` 注释"not even the local one")——round-22 已把 unscoped 从 "local" 改名为 "page",简报括号是旧账。
