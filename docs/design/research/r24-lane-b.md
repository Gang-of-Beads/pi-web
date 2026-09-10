# Round 24 · Lane B：行为与数据（退役模型端到端、interrupted-runs 诚实性、prefetch/缓存键、切换后的状态）

审计基线：branch `refactor/plugin-architecture`，工作树 HEAD `81d37fc0`（round-23 修复 HEAD `a35c5b7b` + 两个 round-24 提交）。READ_ONLY，未改任何仓库文件。

结论：**不是干净的一轮**。7 项 TRUE 发现（1 中、1 中低、5 低，其中 2 项是 round-23 已立案但未闭合的残余），外加 1 项简报旧账和一份"查过且成立"防重报清单。每项附 file:line、最小失败场景和 TRUE/FALSE 裁定。

---

## TRUE 发现

### B-1（中）机器切换重入用 boot 语义重读已花掉的 interrupted 记录，收回页面早期采纳的真实标记——round-23 item 3 的不变量在它自己的 `connectRealtime` 路径上不成立

- 证据链：
  - daemon 端 read-and-clear：`src/server/daemon/sessions/sessionRoutes.ts:95-103`（"once handed over it is spent"）。
  - 本轮不变量（a35c5b7b 新写的注释）：`src/client/src/components/PiWebApp.ts:763-770`——"Only the boot read may adopt an empty record as a retraction; a later read adopts new markers but never erases the ones already on screen"。
  - 但 adoptEmpty 只在两个调用点显式关掉：reconnect 回调 `PiWebApp.ts:1948`、开关器打开 `:2481`（都是 `{ adoptEmpty: false }`）；`connectRealtime` 的调用 `:1931` 是 `this.refreshInterruptedRuns(machineId);`——**默认 adoptEmpty: true**（签名 `:771`）。而 `handleMachineChange`（`:2043-2056`）在**每一次**机器切换时 `realtime.close()` + `connectRealtime()`，所以 A→B→A 的第二次连接对 A 发出的是 boot 式读。
  - round-23 lane B 自己（`docs/design/research/r23-lane-b.md:30`）把"机器切换重入"列为"此后任何一次读（reconnect 回调、开关器打开、**机器切换重入**）只能拿到空记录"的三个路径之一——修复却唯独漏了这条路径。round-23 triage 的 deferred 项只记了深链启动竞态（B-3），未记重入。
  - 该块零测试：全仓 grep `refreshInterruptedRuns|adoptEmpty|interruptedRunsUnknown` 的 `*.test.ts` 无命中。
- 最小失败场景：页面在机器 A 上启动，boot 读采纳标记 {s1} 并显示（记录随之花掉）；读者切到机器 B 再切回 A；`handleMachineChange` → `connectRealtime` → `refreshInterruptedRuns("A")`（默认 adoptEmpty:true）→ daemon 返回空（已花）→ `:787-788` 采纳空集 → s1 的 interrupted 徽标从快速切换器永远消失（重读只会再得到空），而 s1 的 run 从未继续。恰是 round-23 提交信息里"erasing markers the reader was on their way to act on"的原样重现，只是换了触发路径。
- 裁定：**TRUE**。

### B-2（中低）同一机器内的项目/工作区切换清除 reply-retired 的机器作用域传输主张——一次既不是"该链接的回答"也不是"owning action"的撤回

- 证据：
  - `src/client/src/appState.ts:182-201`：`resetWorkspaceScopedState()` 内联 `...clearErrorPatch()`（:195），三字段（error/errorRetiredBy/errorMachineId）全部复位。
  - 调用方：`workspaceController.ts:55`（selectProject）、`:76`（selectWorkspace）——**机器不变**的作用域切换也整体展开；`machineController.ts:61`（selectMachine，机器切换，属 round-22 已记录的作用域卫生范畴）。
  - 模型契约：`src/client/src/notice.ts:17-18`（reply："An answer from that link disproves it"——唯一撤回原因）；`src/client/src/components/errorBanner.ts:8-10`（"stays until the user dismisses it, another message replaces it, or the owning action clears it"）。选项目/工作区两者都不是。
  - 受影响的主张恰是**无 6s 寿命**的那两类：`machineController.ts:176-186`（selectInitialMachine 的 composed "X is unavailable; reconnecting…"）与 `PiWebApp.ts:1542-1554`（restore 阶梯的同类及终句 "X is still unavailable."）——composed 措辞使 `normalizeTransientError` 返回 undefined（`errorBanner.ts:64`），无自过期。
- 最小失败场景：深链指向宕机的远程机器 lab → boot composed 主张上屏（permanent 样式、无过期）；restore 阶梯五轮后终结于 "lab is still unavailable. …"；读者在侧栏点任意项目（列表已由阶梯的 loadProjects 载入）→ `selectProject` 的 `resetWorkspaceScopedState` 把主张无声清掉——lab 仍宕机，没有任何"回答"出现过。之后 lab 的 URL 只有读者再主动触发才会有 fetch（离线机器不订阅活动 socket，`PiWebApp.ts:4035-4039`），主张不会回来。部分自愈：点击项目本身会发 `api.workspaces(...,lab)`，失败时以 6s 的 "Reconnecting to the machine…" 重报——持久、带 detail 的主张被降级为一次 6s 闪烁。
- 与已立案项的边界：round-22/23 挂给 owner 的待决项 "Scope switches clear reader-retired failures"（`review-triage-uiux-round23.md` "Owner decisions pending"第一节）只覆盖 reader-retired 半边；r23-lane-b B-4 明确说作用域卫生动机"对 reply 主张完全成立"——但同机器的工作区切换根本不改变主张的机器作用域，该动机在此不适用。reply 半边是未裁决的模型违反。
- 裁定：**TRUE**（若 owner 把"切换作用域=撤回一切横幅"定为产品语义，则需改写 notice.ts/errorBanner.ts 的两处契约注释并记录决策）。

### B-3（低）过期定时器路径不复位调度标记：同批竞态下，重报的 claim 没有 6s 寿命——B-8 的孪生半边未修

- 证据：
  - reply 路径的清除显式复位标记并注明理由：`PiWebApp.ts:1049-1054`——"a re-raised identical text must re-arm its own expiry rather than be silently gated by the previous schedule"。
  - 过期定时器回调 `:1085-1089` 只做同文匹配 + `clearErrorPatch()`，**不**复位 `lastScheduledError`。正常情况下随后的 hide 渲染经 `:3820` 的 `error !== lastScheduledError`（""≠E）分支复位——r23-lane-b 防重报清单第 3 条据此判主路径闭合。
  - 但 lit 批处理下，若同文的重新上报落在"定时器 setState 之后、复位渲染之前"（同一微任务排空内），两次 setState 合并成一次渲染：渲染看到 error=E 且 `lastScheduledError` 仍=E → `:3820` 不成立 → 不重新武装。round-23 item 4（读者关闭取消定时器）只修了 dismissal 半边。
- 最小失败场景：T0 时 lab 的轮询超时 → "A request timed out. Polls retry on their own."（同文必然复现：`requestDeadline.ts:31` 固定措辞）；T0+6s 过期清屏的同一批次内下一次轮询超时以同文重报 → 渲染跳过武装 → 横幅无 6s 定时器，lab 不可达时无回复可撤回，违反其自我描述的寿命，直到读者手关或出现不同文本。
- 裁定：**TRUE**（窄竞态，低危；与已修的 B-8 同族同因：两条清除路径只有一条拿到了"复位调度标记"的处理）。

### B-4（低）`noticeFromError` 的 RequestTimeoutError 终分支是不可达死代码，其注释叙述的行为实际发生在上一个分支

- 证据：`src/client/src/notice.ts:106-108`——`if (error instanceof RequestTimeoutError) return noticeFromTransport(text);`。但 RequestTimeoutError 的消息恒为 "The server did not answer within Ns."（`requestDeadline.ts:31`），`normalizeTransientError` 的 `/did not answer within/` 规则（`errorBanner.ts:84`）必然命中 → `notice.ts:102-104` 的分支必然先返回（且已带 `machineIdFromUrl(error.url)` 的机器作用域）。终分支连同其"Measured live: a remote machine answered /status at 30.007s…"的注释（`:105-108`）永不执行——该注释叙述的修复实际由上面带作用域的分支承担。模型核心分类器里的死分支会误导下一轮修改。
- 裁定：**TRUE**（死代码 + 注释错位；无行为错误）。

### B-5（低）unknown 横幅的 "Retrying the connection will resolve it" 在记录已被消费的情形下是无法兑现的承诺

- 证据：`PiWebApp.ts:249` 的消息第二句；`:779-786` 读失败即上屏（reader-retired，仅安静屏幕）。boot 读"到达了 daemon、响应丢失"时（`sessionRoutes.ts:97-99`：读和清在服务端同请求内完成），记录已被消费而客户端什么都没看到——此后**任何**重试只能得到空记录（round-23 B-2/B-3 确立的语义），unknown 状态实际不可再解决。横幅会一直挂到读者手关，而它的第二句在第一次重连重读返回空的那一刻就已经是假的。
- 最小失败场景：手机在 boot 读的响应到达前休眠；醒来后 socket 重连 → `refreshInterruptedRuns(machineId, { adoptEmpty:false })`（`PiWebApp.ts:1948`）成功返回空 → 早退（`:779`）→ 横幅原样保留："Interrupted-run status is unknown: the read failed. **Retrying the connection will resolve it.**"——重试刚发生过且没有解决它，今后也不会。
- 裁定：**TRUE**（措辞诚实性；第一句"read failed"仍真，第二句在 spent-record 情形为假。顺带：`interruptedRunsUnknown` 标志没有任何渲染路径，唯一消费点是撤销 `:791-794`）。

### B-6（低，round-23 B-6 的残余，当前 HEAD 仍未闭合）realtime 通道不作为"该链接的回答"：机器活动 socket 的重连与 machine.status 事件既不上报可达性也不清除该机器的主张

- 证据：`PiWebApp.ts:1968-1970`——活动 socket 重连回调只有 `void this.sessionUnread.refresh(machineId);`；`:1988-1996`——`machine.status` 事件只 `machineStatus.apply(...)`。`src/client/src/sessionSocket.ts` 全文无 `reportTransportReachable`。round-23 item 9（"the fetch legs answer, so they report"）只修了四条 fetch 腿（clients.ts:384/402、pluginBackends.ts:69、external.ts:83），realtime 半边既不在 fixed 也不在 deferred 清单里。
- 现状被掩盖的原因：非选中机器的主张会被 `resetWorkspaceScopedState` 清掉（见 B-2），所以今天这条缝大多无害；它变活的两个入口：(a) owner 对待决项选 persist-per-machine；(b) round-23 有意保留的 settings 路径——`machineController.ts:158-165`（`requireSelected:false`）让**未选中**机器的 runtime 失败合法上屏，此后该机器恢复时，其 socket 事件（直接证据）不会撤回主张，只能等读者切机器（触发清除）或手关。
- 最小失败场景：读者在 settings 里对 lab 点 runtime 刷新（当前选中 B）→ lab 宕机 → 机器作用域主张上屏；关掉 settings；lab 的 daemon 恢复、活动 socket 恢复推送 machine.status → 横幅仍挂着，模型语义 "an answer from that link disproves it"（notice.ts:17-18）对最直接的回答形式不生效。
- 裁定：**TRUE**（低；与 r23-b B-6 同源，此处仅补当前行号与新的触发入口）。

### B-7（低，注释/文档漂移）"The retraction tracks the flag, not the banner's wording" 与它下一行的同文匹配直接矛盾

- 证据：`PiWebApp.ts:791-792` 注释 "The state is known again - do not leave our own promise unmet. **The retraction tracks the flag, not the banner's wording.**"；`:793` `if (this.state.error === INTERRUPTED_RUNS_UNKNOWN_MESSAGE)` ——撤销同时要求 flag **和**整串同文匹配。round-19 item 8、round-20 item 7 的同一措辞已被 r23-lane-b footnote 6 判为"文档措辞不精确但行为正确"，但 a35c5b7b 重写了这个注释块（diff 可证）却保留了这句——注释与紧邻代码自相矛盾，且三处记录（round-19/round-20/本注释）持续传播一个代码不实现的语义。（同文匹配本身是对的：防止清掉别人的横幅。）
- 裁定：**TRUE**（漂移；无行为错误。修法：注释改为"retraction requires both the flag and that our message is still the one on screen"）。

---

## 查过且成立（防重报清单）

1. **单缝完整**：全仓无裸 `setState({ error: … })` 生产者（对话框级 error 均为组件局部状态）；`errorNoticePatch/noticePatch/clearErrorPatch`（`errorNotice.ts:23-39`）三字段成套。
2. **clearTransientError**（`PiWebApp.ts:1042-1060`）：page 主张被任意成功 disproved、机器主张只被该机器 disproved、清除时连 scope 与 `lastScheduledError` 一起复位并取消定时器；`http.ts:50` 在 ok 判定**前**上报（500 也算回答）；listener 抛错被吞（`transportHealth.ts:49-56`）。
3. **hold/expire 主路径**：读者关闭先决且取消定时器（`:3825-3838`）；hide 渲染经 `error !== lastScheduledError` 复位标记 → 过期后同文重报的**主**路径能重新武装（B-3 只剩同批竞态）；替换各自起新 hold/expiry（`:3820-3824`）。
4. **措辞表与作用域协同**：composed 守卫（`errorBanner.ts:64`）保证带机器名的组合消息不被改写、不 6s 过期，渲染与寿命一致；fetch 族整条消息锚定（`:76-85`）；网关标签 `^remote machine (unavailable|timeout)` 与服务端实际标签一致（`machineProxyRoutes.ts:236,367`）；TCP 部署靠 "session daemon" 短语命中。
5. **machineIdFromUrl** 有直测且解码在 try 内（`transportHealth.ts:30-41`、`transportHealth.test.ts:87-99`，round-23 item 10 在位）；四个 fetchWithDeadline 腿都上报且失败带机器作用域（round-23 item 9 在位）。
6. **TypeError→page 主张自洽**：fetch 层失败是 browser↔origin hop 的事实，page 作用域正确，且 origin 恢复后任意成功（含他机健康轮询）撤回它——不立案；RequestTimeoutError 的 URL 作用域是 round-19 item 5 的在案决策。
7. **缓存键携带机器**：`sessionCacheKey = machineSessionKey(...)`（`sessionController.ts:1543-1545`）；`workspaceSessionsCache` machineId+path；`cachedNewSessions` 全部按 (machineId, cwd) 过滤（`cachedNewSessions.ts:60-67`）；`workspacesByProjectId` 在 selectMachine 清空（`machineController.ts:63`）；`machineStatusSnapshots` 按 roster filter、按删除 omit（`machineController.ts:25,110`）。
8. **interrupted-runs 的机器门控**：采纳处 `:776`、渲染处 `:3955` 双重按机器门控；`loadInterruptedRuns` 失败返回 undefined（`sessionController.ts:1007-1015`）。
9. **sessionUnread 背景错误只 console.warn**（`PiWebApp.ts:293-295`），不产生假主张；其快照请求经 `request()`，成功时按机器上报可达性。
10. **resume/liveness 路径**：socket 自检重连 → 重连回调带 `{ adoptEmpty:false }` 的 interrupted 重读（`:1948`）+ `clearTransientError(machineId)`（`:1934-1936`）+ `hydrateSessionStatuses(replaceKnown:true)`，机器 id 取自连接时刻且 handleMachineChange 会随切换重连，无陈旧机器 id 路径。

## 附注（简报与代码的偏差，非仓库缺陷）

- 任务简报括号里写 unscoped 主张记为 `"local"`；现行代码是 `"page"`（`errorNotice.ts:28/33/38`、`transportHealth.ts:22-27` 注释 "not even the local one"）。r23-lane-b 附注已记录这是 round-22 的改名，简报沿用了旧账。
