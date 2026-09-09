# Round 15 — Lane B(行为与数据)审查报告

分支 refactor/plugin-architecture,HEAD 0664ee35。只读审查,未改动任何仓库文件;临时探针脚本放在 /tmp 并已删除。聚焦:prefetch 正确性、in-flight 共享竞态、lazy surface warm/await 路径、chunk 失败上报诚实性、缓存逐出边界。

**结论:这不是一条干净的 lane。** 4 个 TRUE(1 高 + 3 低),另有一组明确裁决为 FALSE 的疑点。本波 14 个相关测试(lazySurfaces / chatHistoryCacheQuota / inFlight)实跑全部通过(14 passed),但 B1 恰好落在测试盲区。

---

## B1(TRUE,高)会话树对话框打开后进入无界微任务渲染循环 —— 主线程饥饿,页面冻结

**证据链(全部为当前 HEAD 实测引用):**

1. `src/client/src/components/PiWebApp.ts:2642-2643` —— 加载副作用写在渲染路径里:
   ```ts
   private renderSessionTreeNavigator(state: AppState) {
     if (state.treeDialog !== undefined) this.openLazySurface("session-tree", "Session tree");
   ```
   该方法由模板无条件调用:`src/client/src/components/PiWebApp.ts:3875`(`${this.renderSessionTreeNavigator(state)}`)。
2. `src/client/src/components/PiWebApp.ts:1715-1720` —— `openLazySurface` 成功分支:
   ```ts
   void loadSurface(surface).then(
     () => { this.requestUpdate(); }, ...
   ```
3. `src/client/src/components/lazySurfaces.ts:23,39-43` —— `loadSurface` 在加载成功后**保留**已 resolve 的 promise(`started` Map "keep it only if it succeeded"),此后每次调用都返回这个已 settle 的 promise。

于是只要 `treeDialog !== undefined` 且模块已加载:每次 update → render → `openLazySurface` → 对已 resolve 的 promise `.then(() => requestUpdate())` → 排队微任务 → 微任务执行时 `isUpdatePending` 已被 `__markUpdated` 复位(Lit 3.3.3,`@lit/reactive-element/development/reactive-element.js:1031` 在 `update()` 内、render 之后同步调用)→ `requestUpdate()` 再次入队 → 再次 render → …… 整个循环都在微任务域内(更新周期无 setTimeout/rAF 边界),**宏任务永远得不到执行机会**。

**最小失败场景:** 打开任一会话 → 行菜单 "History and branches"(或 /tree 命令)→ `treeDialog` 置位(commit cd5d3edf 引入,5abd21b5 重构为 `openLazySurface`,形状未变)→ 树模块加载完成的那次更新结束后,循环启动:无输入、无绘制、socket 帧不再处理,页面冻结且树面板永远画不出来(绘制需要宏任务)。

**验证方式(如实标注):** 我没有跑 8505 实机探针;用仓库自带的 Lit 3.3.3(`@lit/reactive-element` development 构建)在 happy-dom 下写了最小复现:一个元素在每次 `update()` 里对 `Promise.resolve()` `.then(() => this.requestUpdate())`,结果 300ms 的 `setTimeout` 永不触发、渲染计数冲破 500 才被.cap 终止 —— 即微任务饥饿成立。调度语义与 PiWebApp 逐点核对过:`requestUpdate()` 无参入队、无 `shouldUpdate` 覆盖、更新链全微任务。此为实验室级复现而非线上复现,但机制链条每一环都有源码出处。

**修复方向(供裁决,未改码):** 把加载移出 render——像 settings/quick-switcher 一样在打开事件里调用 `openLazySurface`(render 内只负责"模块已就绪才渲染元素"),或让成功分支仅在首次加载完成时 `requestUpdate`。

**附带同根缺陷(单列则降为 minor):** 模块**缺失**时(旧 tab 撞上重新部署),失败的加载被 `trackLoad` 遗忘(lazySurfaces.ts:35-37),而 render 路径每次渲染都会重新发起一次注定 404 的 import;因错误串恒定被 `patchChangesState` 去重(PiWebApp.ts:1058-1060),循环被压成"每个外部状态变化一次 404 import"——流式会话下即是每个状态帧一次网络垃圾。

---

## B2(TRUE,低)prefetch 用捕获的 machine 发请求,却用**当下**的 machine 落缓存键

**证据:** `src/client/src/controllers/sessionController.ts:1908-1917`:
```ts
const machineId = selectedMachineId(this.getState());
const key = `${machineId}:${session.id}`;
...
void this.api.messages(session, { limit: MESSAGE_PAGE_SIZE }, machineId)
  .then((page) => { this.transcripts.mergeHistory(this.sessionCacheKey(session.id), page); })
```
`sessionCacheKey`(1537-1539)在 **merge 时刻**重新读 `selectedMachineId(this.getState())`,而不是用已捕获的 `machineId`。

**最小失败场景:** 选中 federated 慢机器 A → 悬停会话 X(prefetch 发往 A,键 `A:X`)→ 响应未落时切到机器 B(机器切换走 `clearActiveSession`,PiWebApp.ts:1963,但 prefetch 的 merge 没有 seq/machine 守卫)→ A 的消息页被写进 sessionStorage 键 `pi-web:chat-history:v2:B:X`。今天 UUID 会话 id 跨机碰撞概率≈0,实际危害是"永远无人读取的死缓存条目";潜在风险是若未来出现跨机同 id 的会话迁移/恢复路径,会用 A 的 transcript 给 B 的会话做种子。这违反项目自己的"Data must carry the scope it belongs to"规则:取数 scope ≠ 存储 scope。

**裁决:TRUE(今日影响有界,属真实的键推导不一致)。** 修法是把 `machineSessionKey(machineId, session.id)` 一并用于 merge。

## B3(TRUE,低)lazy surface 失败横幅在重试成功后仍存留 —— 违反诚实性

**证据:** `src/client/src/components/PiWebApp.ts:1715-1720`:失败分支 `setState({ error: "${title} could not load. ..." })`;成功分支只有 `requestUpdate()`,不清 error。`errorRetiredBy` 默认 `RetiredBy.reader`(appState.ts:267-268),而 `clearTransientError`(PiWebApp.ts:992-999)只退 `RetiredBy.reply` 类;openLazySurface 的 setState 也绕过了 `scheduleTransientErrorDismissal`。

**最小失败场景:** 旧 tab 撞上部署 → 点 "Settings" → chunk 404 → 横幅"Settings could not load. This tab may be running an older version - reload to get it.";再点 Settings → 模块加载成功、设置面板已在屏幕上打开 → 横幅仍在断言"打不开"。同一断言被现实否定后无人撤回。

**裁决:TRUE(minor)。** 成功分支应显式退休自己种下的那条横幅(按 error 文本比对清除即可)。

## B4(TRUE,低)prefetch 失败被永久记住 —— 与同波 lazySurfaces"失败即遗忘"的语义相反

**证据:** `sessionController.ts:1910-1916`:`this.prefetched.add(key)` 在请求前加入,失败分支 `catch(() => undefined)` 不移除;全文件无其他对 `prefetched` 的删除。对照 `lazySurfaces.ts:33-37`(trackLoad):"A failed load must not be remembered as an answer... the next open tries again"。

**最小失败场景:** 悬停行 X 时链路抖动 2 秒 → prefetch 失败被吞(正确)→ 链路恢复 → 再次悬停 X → 不再 prefetch(键已在集合里)→ 该机器+会话在整个页面生命周期内永远失去 prefetch 收益;每次打开都付冷读。

**裁决:TRUE(minor;无数据错误——打开路径仍会真实读取,只是失去 warm 收益)。** 两处去重语义应统一:要么失败也遗忘,要么在注释里写明为什么 prefetch 选择记住失败。

---

## 明确裁决为 FALSE 的疑点(逐条给证据)

1. **"prefetch 打在 archived 行上是缺陷" — FALSE。** archived 行与普通行走同一个 `renderSession`(SessionList.ts:398-414,`@pointerenter`/`@focus` 无 archived 排除),而 archived 会话的打开路径恰是同一个 URL 的读取(sessionController.ts:343 vs 1913,`messagePath` 确定性,urls.ts:14-21)→ 悬停航班与点击航班共享(inFlight 设计意图),错误被吞(1914-1916 的 catch),无泄漏、无浪费(除一次性 `prefetched` 标记)。transient 新会话行会打出一次 404 prefetch,同样被吞且被 `prefetched` 去重——浪费一次读,非缺陷。
2. **"in-flight 共享与 abort 竞态" — FALSE。** 带 signal 的调用方不共享(http.ts:20-24:signal 存在则 `shareKey = undefined`),共享航班只可能属于无 signal 的 GET;不存在"一方取消 settle 掉别人的读"。deadline 对无 body GET 是同一常量(requestDeadline.ts 的 `timeoutForBody`),共享方拿到的超时语义一致。
3. **"共享把 A 的解析结果给了 B" — FALSE。** 共享单位是原始 body(http.ts:27 `shareInFlight(shareKey, () => fetchBody(url, init))` 返回 unknown body),每个调用方用自己的 parser(inFlight.ts 头注与实现一致)。同 body + 纯函数 parser → 结果必然一致。
4. **"shareInFlight 的 get/set 竞态" — FALSE。** `start()` 到 `inFlight.set` 之间无 await(inFlight.ts:30-35),JS 单线程下不可插入;settle 时带身份守卫删除(31-32: `if (inFlight.get(key) === pending)`)。
5. **"fitToEntry 死循环/缓存空页" — FALSE。** `while (candidate.messages.length > 1)` 且 `tailOf` 每轮至少保留 1 条(chatHistoryCache.ts);单条消息超上限 → 循环自然退出返回 undefined → 放弃写缓存(诚实降级),读取端 `isValidMessagePage` 也不会收下坏页。
6. **"非配额类 setItem 失败会把其他会话缓存全清光" — 标注为推测,裁决 FALSE(现实浏览器形态下不可达)。** 需要"setItem 永久失败但 getItem/removeItem 正常"的存储;Chrome 禁 cookie 时全访问抛错(被 catch,不逐出);Safari 旧私有好比首次写入即配额错但库为空,`evictionOrder` 返回空。防御性加固可做,非现实缺陷。
7. **"mergeChatHistory 的 sparse 回退会丢头部落款" — FALSE。** sparse 回退只在合并产生空洞时触发;现实生产者(最新页 refresh、连续的 loadEarlier、tail 修剪后的缓存种子)两两合并均连续重叠,空洞不可达。该分支是防御性代码。
8. **"composer 在 ask 提交后错误地重展开/不展开" — FALSE。** 触发收缩仅限焦点落入 ask-user-card / extension-dialog-card(composerCollapse.ts:13 `COLLAPSING_HOSTS`);两条释放路径——谨慎版 PiWebApp.ts:714-719(带 `shouldReleaseComposerCollapse` + activeElement 检查)与粗放版 1079——都以 `pendingAsk === undefined && pendingDialogs.length === 0` 为前置。能持有焦点的宿主都在这两张清单里:打开的 extension dialog 的可聚焦 detail div(`ExtensionDialogCard.ts:187-191`,tabindex=0)属于 `pendingDialogs` 成员;已关闭的 outcome 卡(`renderAnsweredRow`,283-292 行)无任何可聚焦后代,焦点进不去。ask 提交成功 → 卡移除 → activeElement 回落 body → 释放,行为正确。
9. **"warm 路径破坏了拆分" — FALSE。** warm 在首绘之后(PiWebApp.ts:948 `connectedCallback` 内,`warmLazySurfaces` → requestIdleCallback timeout 2s / 1.2s 兜底);PiWebApp 对三个模块无任何静态 import(grep 验证,只有模板里的标签名);首绘不等待。代价是"每会话最终都会拉全部三块"——这是文档明说的取舍,非缺陷。bootImportGraph.test.ts 只守 CodeMirror,不守这三个模块——守卫缺口记为备注,非运行时缺陷。
10. **"fold 状态跨 section 切换存活是 stale UI state" — FALSE。** `compactActionsOpen`(AppNavigationPanel.ts:44)确实跨 section/机器切换存续,但折叠行内容(Settings/Actions)是全局动作,与 section 无关,不会渲染陈旧数据;持久化是无害的。
11. **"启动时 settingsOpen 从 sessionStorage 恢复、元素未定义的窗口" — FALSE(设计内)。** 恢复路径(PiWebApp.ts:432, 1803)确实不 await 模块,但 `modalLayerOpen()` 不含 settings(2301-2315),back 走 URL 所有权(448-455),warm 的 idle 兜底 ≤2s;元素无全局 CSS,未升级前不可见。备注:openSettings 的注释"loaded before it is shown"(1723-1725)只对事件路径为真,对恢复路径是靠"未定义元素渲染为空"侥幸成立——措辞与代码有出入,记为文档级瑕疵。

---

## 复核声明

- 实跑:`npx vitest run lazySurfaces.test.ts chatHistoryCacheQuota.test.ts inFlight.test.ts` → 3 文件 14 用例全过(与 B1 不矛盾:测试不经过 PiWebApp 的渲染循环)。
- B1 的结论依据是"源码链条逐环核对 + 仓库自带 Lit 的最小复现",未做 8505 实机验证;如需实机确认,路径是:8505 栈上打开任意会话 → 行菜单 "History and branches" → 观察页面是否冻结(CPU 飙升、无响应)。
- B2/B3/B4 均为静态源码核对,失败场景为推演并标注了可达性边界。
