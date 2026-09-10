# Round 20 — Lane B(行为与数据):退役模型端到端 / interrupted-runs 诚实性 / 缓存键 / 切换后的状态

HEAD `1c2013f7`(分支 `refactor/plugin-architecture`)。只读审查,未修改任何仓库文件。
本 lane 聚焦:banner 退役模型(machineId 作用域、过期、bannerHold)、interrupted-runs、prefetch/缓存键、跨切换的陈旧状态、round-17~19 文档与代码的偏差。

结论先行:**不清白。** 6 项 TRUE 裁定(1 项 P2、5 项 P3),其中两项直接证明 round-19 triage 的"已修复"声明与代码不符——修复停在错误的层上,这正是 round-19 自己命名的那类失败("the sweep had stopped one layer short")。

---

## 发现 1(TRUE,P2):`errorNoticePatch` 丢弃 machineId——round-19 第 5 项"timeout 带机器作用域"的修复没有到达任何生产调用点

**证据:**
- `src/client/src/notice.ts:97`(1c2013f7 新增):`if (error instanceof RequestTimeoutError) return noticeFromTransport(text, machineIdFromUrl(error.url));` — 为超时错误计算 URL 中的 machineId。
- `src/client/src/errorNotice.ts:23-29`:`errorNoticePatch` 是 `noticeFromError` 在生产代码中的**唯一**调用者(grep 全仓库确认),而它写死 `errorMachineId: "local"`:`return { error: notice.text, errorRetiredBy: notice.retiredBy, errorMachineId: "local" };`(第 28 行)——`notice.machineId` 被计算后直接丢弃。
- 全部约 50 个控制器错误上报点都经过 `errorNoticePatch`(sessionController.ts 40+ 处、machineController.ts:75/88/113/124/138、authController、workspaceController.ts:64/89、projectController.ts:47/96),没有任何调用点传第二个 `link` 参数,也没有任何调用点改写 `errorMachineId`(grep `errorMachineId` 全仓库:只有 clearTransientError 一处读取,PiWebApp.ts:1037)。
- 因此**真正到达 state 的机器级声明只有两处**手工构造的 `noticePatch(noticeFromTransport(text, machineId))`(machineController.ts:154、PiWebApp.ts:1534)。其余一切——包括全部 RequestTimeoutError——都是 "local" 作用域。
- `src/client/src/api/transportHealth.ts:25-26` 自己的文档:"The report vouches for the machine the URL addressed - **a success from machine A says nothing about machine B's link**"。
- `clearTransientError`(PiWebApp.ts:1035-1043,第 1037 行):`errorMachineId === "local"` 的声明被**任何**机器的成功清除。

**最小失败场景:** 双机部署,远程机 build-box 隧道劣化。`machineController.refreshMachineRuntime("build-box")`(machineController.ts:80-91,URL `api/machines/build-box/runtime?refresh=1`,clients.ts:123)命中 30s 浏览器 deadline → `RequestTimeoutError` → `errorNoticePatch` → 产出 reply-retired、`errorMachineId: "local"` 的横幅("The server did not answer within 30s.",显示改写为 "A request timed out. Polls retry on their own.")。随后本地机的 `api/pi-web/status` 轮询(PiWebApp.ts:213 的 15 分钟间隔定时器,且大量交互事件都会以 defer 触发,clients.ts:110 的 URL 无 machines 段 → 提报 "local")或机器 A 的任何轮询成功 → `clearTransientError` 因 "local" 被任何成功否定而清除横幅——此时 build-box 仍然不可达。读者看到的是红光一闪、无解释,这正是模型要消灭的失败模式(notice.ts:84 的注释原文 "a red flash, no explanation")。违反 round-17 决策 1 的承诺:"a success from machine A no longer erases machine B's complaint"(review-triage-uiux-round17.md:36-41)。

**文档偏差:** `docs/design/review-triage-uiux-round19.md:26-27` 宣称 "5. **A timeout now carries its machine's scope** … the URL the RequestTimeoutError failed on names the machine";`.changeset/round-nineteen-seams.md:14-15` 宣称 "a timeout names the machine it failed against"。实际修复只落在 `noticeFromError`(其返回值的 machineId 无生产消费者),r19-lane-c.md:213 的建议修复 #4("Thread machineId into `errorNoticePatch` for reply-retired notices, replacing the hardcoded 'local' stamp; extend to machineController:130/:138")未被执行。另注意 `notice.test.ts:54` 只断言 `retiresOnReply`,没有任何测试断言 timeout notice 的 `machineId` 值,所以绿测掩盖了接缝。

**裁定:TRUE。** 行为级缺陷(远程机超时声明被跨机清除)+ 三处文档/变更集声明为假。

---

## 发现 2(TRUE,P3):`notice.ts:103` 是不可达死分支,与第 97 行对同一异常给出相反的 machineId 决定

**证据:**
- `notice.ts:97`:`if (error instanceof RequestTimeoutError) return noticeFromTransport(text, machineIdFromUrl(error.url));` — 已捕获**所有** RequestTimeoutError(第 80 行的 `link.live` 分支在生产中不可达,见下)。
- `notice.ts:103`:`if (error instanceof RequestTimeoutError) return noticeFromTransport(text);` — 永不可达。git show 1c2013f7 显示第 97 行是**新增**的,而第 103 行及其上方 "Measured live: a remote machine answered /status at 30.007s…" 的整段注释是**遗留**的。
- 两个分支对同一输入给出不同的 machineId(97 带 URL 机器,103 不带)——死分支若复活即改变作用域语义,且没有测试锁定任何一侧。

**最小失败场景:** 无直接行为危害(97 先命中);危害是双份决定并存:后续维护者删掉 97 行的参数(或合并冲突保留 103)即静默回到 "local" 作用域,而那个解释 30.007s 实测案例的注释挂在永不执行的分支上。附带:`errorNoticePatch` 的 `link` 参数无生产调用点传值(grep 确认),`notice.ts:74-78`/80 注释描述的"socket 存活时 deadline miss 不上页面横幅"在生产中不可达——此点 round-18/19 已书面 defer 且 operation-model.md:143-144 如实记录,不计新发现,但它是第 103 行死代码存在的同一根源。

**裁定:TRUE(死代码/注释失准;行为无害)。**

---

## 发现 3(TRUE,P3):"interrupted-runs 未知横幅按 flag 撤回" 是假声明——`interruptedRunsUnknown` 是从未读写的死字段,撤回仍靠匹配自己的措辞

**证据:**
- `PiWebApp.ts:307-308`(1c2013f7 新增):`/** Whether the last interrupted-runs read failed; a flag, not a wording match. */ private interruptedRunsUnknown = false;` — grep 全文件:**声明之外零读写**。
- 撤回路径 `PiWebApp.ts:786`:`if (this.state.error === "Interrupted-run status is unknown: the read failed. Retrying the connection will resolve it.") this.setState(clearErrorPatch());` — 仍然匹配完整句子字面量;该句子在 779(宣告)与 786(撤回)各有一份拷贝,无共享常量、无测试保护(r19-lane-c.md C6 第 126-135 行的原始警告原样成立)。
- `docs/design/review-triage-uiux-round19.md:33-35`(item 8 "the unknown banner's retraction tracks a flag, not a wording match")与 `.changeset/round-nineteen-seams.md:17-18`("the interrupted-runs banner retracts on recovery by flag rather than by matching its own wording")以及 1c2013f7 提交信息同句——三处声明与代码不符。

**最小失败场景:** 任何人编辑 779 行的宣告句子(例如按发现 4 的方向给它加机器名),786 行的撤回立即失配:恢复成功后不再撤回,reader-retired 的未知横幅将一直挂到手动关闭或被替换。今天字面量恰好一致所以功能"碰巧"可用——正是 round-19 对 round-18 的判词("inert by luck, not by construction")。

**裁定:TRUE(声明漂移 + 脆弱耦合)。**

---

## 发现 4(TRUE,P3):interrupted-runs 未知横幅的**宣告**没有机器守卫,而撤回有——陈旧机器的失败读取会在另一台机器的屏幕上宣告"状态未知"

**证据:**
- `PiWebApp.ts:778-781`:`if (ids === undefined) { if (this.state.error === "") this.setState(noticePatch(noticeForReader("Interrupted-run status is unknown: …")))…` — 只检查屏幕安静,不检查 `selectedMachineId(this.state) !== machineId`。
- 成功路径**有**该守卫(`PiWebApp.ts:782`:`if (selectedMachineId(this.state) !== machineId) return;`)——同一函数内一有一无,不对称。
- 调用点:`refreshInterruptedRuns` 在 connectRealtime(PiWebApp.ts:1910-1912)、socket 重连闭包(1929)、handleMachineChange 后的新连接(2023-2031 → 1912)、quick switcher 打开(2462)都以"当时的机器"触发;读取是异步的,`handleMachineChange` 关旧 socket(2028)不会取消已在飞行的读取 promise。

**最小失败场景:** 连接时选定机器 A,interrupted-runs 读取慢;用户切到机器 B(handleMachineChange → 新连接也开始 B 的读取);A 的读取随后 reject → 通用句子 "Interrupted-run status is unknown: the read failed." 出现在 B 的屏幕上,尽管 B 自己的记录读取可能已经成功。横幅是 reader-retired(noticeForReader → `errorMachineId: "local"`),只能靠发现 3 的措辞匹配撤回——也就是说,**关于 A 的未知横幅会被 B 的成功读取清除**,跨机数据又一次互相代言。

**裁定:TRUE。** 顺带说明:round-18 item 7 / round-19 item 8 声称的"markers carry their machine into the render"已落实(PiWebApp.ts:3929 用 `interruptedSessionIdsMachine !== selectedMachineId(state)` 守卫,配合 `quickSwitcherBrowsingElsewhere()`)——缺失的只是横幅这一半。

---

## 发现 5(TRUE,P3):7 处裸 `error: ""` 清除绕过 `clearErrorPatch`,round-19 "every clear resets mark and scope together" 声明过宽(当前潜伏,非可观察)

**证据:**
- `src/client/src/appState.ts:191`:`resetWorkspaceScopedState()` 返回 `error: ""` 而不动 `errorRetiredBy`/`errorMachineId`——这是**机器/项目/工作区切换**共用的清除路径(machineController.selectMachine:63、workspaceController.selectProject:55 / selectWorkspace:83)。
- `sessionController.ts:544`、`:1623`、`:1664`、`:1789`(排队发送成功、pending session 具名替换等成功路径)、`machineController.ts:14`、`projectController.ts:35` — 同样只写文本。
- 对照声明:`docs/design/review-triage-uiux-round19.md:18-21`(item 3 "every clear now goes through clearErrorPatch, which resets mark and scope together — the last stale-scope inheritance paths are closed")、`.changeset/round-nineteen-seams.md:11-12`、1c2013f7 提交信息同句。

**最小失败场景(潜在,非当前可观察):** 今天所有读取方在 `error === ""` 时提前返回(clearTransientError PiWebApp.ts:1036、renderErrorBanner 3783),而所有生产者都整体重写三元组,所以陈旧的 mark/scope 暂时无害。危害在声明与接缝本身:round-19 lane C 的 C7 指认的正是这一类(当时列了 3 处,修了 3 处,这里还有 7 处);"the last stale-scope inheritance paths are closed" 为假——任何一个未来生产者少写一个字段,这里就是复活点。

**裁定:TRUE(文档/变更集声明过宽;行为危害今日为零,如实标注为潜伏)。**

---

## 发现 6(TRUE,P3):shared.ts rail 注释(1c2013f7 亲自新写)与规则事实自相矛盾:"规则从不在一行上竞争;顺序只是 belt-and-braces" —— 顺序实际承载语义

**证据:**
- `src/client/src/components/shared.ts:437-441`(1c2013f7 修改的正是这段注释):"The row indicator's arbiter renders exactly one state dot per row, so **these rules never compete on one row; their order is belt-and-braces**."
- 反例 A(同一行、两条规则竞争):机器/工作区行 unread+working 时,`pi-web-plugins/machines/browser/activityBadge.ts:48-54` 渲染 `<span class="unread-ring"><span class="activity-indicator session">` —— 第 445 行(`:has(:where(.activity-indicator.unread, .unread-ring, …))` → 紫)与第 446 行(`:has(:where(.activity-indicator.session, …))` → success 绿)**在同一行上同时命中**,绿色获胜仅因 446 在后。把两行对调,unread+working 机器行的 rail 就从绿变紫,而点(紫环包绿芯)不变——正是 rail 设计要消灭的"近看一种颜色、扫视另一种"。
- 反例 B:第 446 行的选择器表内含 `.session-state.running`,第 447 行(accent)靠**出现在后面**同特异性覆盖它——对调 446/447,所有 working 会话行的 rail 变绿(r19-lane-c.md C9 已报,HEAD 未改,本轮复核确认仍成立)。
- 残留:`:436-441` 同段注释仍写 "the row-class rules below (**unread**/archived/selected)" —— shared.ts 中 `.action-row.unread` rail 规则已在 round-18 删除(现为 :451-452 仅 archived/selected);1c2013f7 改了这段注释却留下了失实的列举(r19 C9 第二残留,round-19 triage 既未列入 fixed 也未列入 deferred)。

**最小失败场景:** 任何人按注释的"顺序无关"保证重排/插入 445-450 的规则(插入新的未读规则在 446 之后即触发),CI 无守卫(audit 的顺序守卫只覆盖 PiWebApp 自更新 media block,r19 C9 已指出),合成行在合并状态(down + unread)下 rail/点异色。

**裁定:TRUE(注释为假 + 顺序脆弱;配色表本身逐状态核对无误:running accent、asking warning、unread/background 紫、error danger、machine/workspace session 绿、terminal accent,与 sessionStateBadgeStyles.ts 的点色一致)。**

---

## 发现 7(机制层 TRUE,本轮未寻得实际命中实例——标注为推测):pointerQueryOrder 守卫的选择器等值比较漏掉组合选择器被部分覆盖的情形

**证据:** `src/client/src/components/pointerQueryOrder.test.ts:44-46`:对 media 块内提出的 selector 构造 `repeated` 正则时用**整段字面量**匹配;块内若提出的是组选择器 `.a, .b { floor: 44px }`,其后的基级单选择器 `.a { floor: 36px }` 不匹配该正则,守卫放行——而后者真实覆盖了 `.a` 的地板。SELECTOR 正则(`:38`)把整组捕获为一个 selector,组内成员不被拆分。
**最小失败场景(机制演示,非实测命中):** 未来任何人在 pointer 块内以组选择器抬升两个控件的地板、随后在基级只覆写其中一个的高度,守卫不红。本轮未对全部样式源逐一排查是否存在现成命中——如需闭环应补一次全库扫描或让守卫按逗号拆分组选择器。
**裁定:TRUE(机制层);实际存在命中与否未证实,标注为 speculation。**

---

## 本 lane 复核为干净的部分(每项都读过实现)

- **round-19 item 6(HTTP 500 也提报可达性)**:`http.ts:50-52` 在判状态码**之前**调用 `reportTransportReachable(url)` — 与声明一致,TRUE。
- **round-17 决策 5(6s 过期看模型不看措辞)**:`scheduleTransientErrorDismissal`(PiWebApp.ts:1054-1069)检查 `errorRetiredBy !== RetiredBy.reply` 即返回,定时器回调再验 text+mark — 与声明一致。
- **round-19 item 7(读者关闭决定性 / hold 与生命周期)**:`renderErrorBanner`(PiWebApp.ts:3783-3814)+ `bannerHoldDecision`:替换各自起 hold 窗口与 6s 时钟(hold 期间新消息不武装时钟,旧时钟因 text 失配空转);`bannerDismissedByReader` 使 1.5s 最小可见窗口无法复活已关闭的横幅;清除后重现会重新武装 — 声明全部成立。
- **手工构造的机器级声明**:machineController.ts:152-156("X is unavailable; reconnecting…",reply+machine)与 PiWebApp.ts:1534(setRemoteRouteRestoreMessage,含 exhausted 变体,detail 取自 health 读取而非自身旧文本,round-17 item 3 的自粘贴回归未复发)。
- **缓存键作用域**:`workspaceSessionsCache.ts:10-12`(machine+path)、`cachedNewSessions.ts`(逐条带 machineId,merge 按 machine+cwd 过滤)、transcript 存储(`machineSessionKey` machineKeys.ts:8-10,sessionController.ts:502/721/1488)、prefetch 去重键 `machineId:sessionId`(sessionController.ts:1916-1917)、inFlight `GET <完整URL>`(api/inFlight.ts:16-20,machine 段在 URL 内)— 均携带机器作用域。
- **interrupted-runs 数据面**:`loadInterruptedRuns` 失败返回 `undefined` 不采纳空记录(sessionController.ts:1007-1015);成功采纳前有机器守卫且渲染端再守一道(PiWebApp.ts:782、3929)。
- **link.live 未接线**:round-18/19 triage "Deferred with written reason" 与 operation-model.md:143-144 的"Still open"一致,无新的漂移(C5 引用的 changeset 句子已不在现文)。

## 对 round-19 收敛声明的总裁定

| round-19 triage 条目 | 声明 | 代码复核 |
|---|---|---|
| item 3 "every clear goes through clearErrorPatch" | 过宽 | 发现 5:7 处裸清除仍在 |
| item 5 "timeout carries its machine's scope" | **不成立** | 发现 1:machineId 在唯一生产消费点被丢弃 |
| item 8 "retraction tracks a flag, not a wording match" | **不成立** | 发现 3:flag 死字段,撤回仍措辞匹配 |
| item 8 "markers carry their machine into the render" | 成立 | PiWebApp.ts:3929 |
| items 1/2/4/6/7/9 | 成立 | 抽查通过 |

修复方向(供 triage,不在本 lane 执行):按 r19-lane-c.md:213 #4 让 `errorNoticePatch`(或 `request()` 给 `HttpError`/`RequestTimeoutError` 附加 URL 派生的 machineId)真正携带作用域;删除 notice.ts:103 死分支;让 `interruptedRunsUnknown` 被真实读写(779 置位、786 复位)并给宣告补机器守卫;裸清除统一走 `clearErrorPatch()`;更正 shared.ts:437-441 的两处注释失实。
