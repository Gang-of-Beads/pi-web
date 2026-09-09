# Round 16 - Lane B(行为与数据)审查报告

范围:行为与数据 —— 横幅/错误/隐藏标记的生命周期诚实性、预取与缓存键、in-flight 共享、lazy 加载路径、切换后的状态残留。HEAD d5e0de1e,分支 refactor/plugin-architecture。全程只读。

## 结论(本 lane 的收敛判定)

**不干净。** 1 项实质发现(发现 1)+ 2 项低严重度发现(发现 2、3)。Round 15 的九项修复在本 lane 焦点内(B1-B4)全部核实仍然在位;但 round-15 的 B3 修复自己新引入的横幅调用点重新违反了本代码库已文档化的错误通知契约,并且该契约的转换在多个 wave 文件内的生产方上仍未完成。

---

## 发现 1 —— 错误横幅生产方绕过 errorNoticePatch,横幅寿命由陈旧的 errorRetiredBy 决定 【判定:TRUE】

### 证据链(每一环都已在源码核实)

1. 契约:`src/client/src/errorNotice.ts:20-21` 明文规定 "Returning both fields together makes the pair impossible to set apart, so a call site added later cannot reintroduce either half" —— `error` 与 `errorRetiredBy` 必须成对写入。
2. 分类:`src/client/src/notice.ts:70-79`(`noticeFromError`):`HttpError` 与 `RequestTimeoutError` 归类为 reply-retired;其余(含网络 TypeError)为 reader-retired。
3. 清除机制:`src/client/src/components/PiWebApp.ts:1003-1011`(`clearTransientError`)只清 `error` 文本,**不重置** `errorRetiredBy`。
4. 触发频率:`src/client/src/api/transportHealth.ts:33-42` —— `reportTransportReachable` 在**每一个成功请求**上被调用(`src/client/src/api/http.ts:54`),且 `PiWebApp.ts:963` 把它直接接到 `clearTransientError`。
5. 未配对的生产方(wave 文件内的全部列出):
   - `src/client/src/components/PiWebApp.ts:1736` —— `openLazySurface` 失败路径 `this.setState({ error: failure })`,**这正是 round-15 B3 修复自己新增的调用点**;
   - `src/client/src/controllers/sessionController.ts:1532-1535`(`applyBulkSessionFailures`,批量归档/删除失败)、`:881`、`:905`、`:1695`、`:532`、`:655`;
   - `src/client/src/controllers/machineController.ts:96`、`:150`;
   - `src/client/src/controllers/authController.ts:104`、`:186`;
   - 另有只清不配对的清除点:`sessionController.ts:544`、`:1617`、`:1658`、`:1783`,`PiWebApp.ts:1009`。

### 最小失败场景(发现 1 的主形态:操作失败横幅被无关成功请求抹掉)

1. daemon 重启期间任一请求拿到 502(`HttpError`)→ `errorNoticePatch` 置 `errorRetiredBy = "reply"`(这正是项目文档承认的常态:"ECONNREFUSED … is what an update looks like",见 `src/client/src/components/errorBanner.ts:70-73` 的注释)。
2. 传输恢复后的下一个成功请求 → `reportTransportReachable` → `clearTransientError` 清空文本;`errorRetiredBy` **永远留在 "reply"**,直到页面刷新。
3. 用户批量归档 3 个会话,2 个失败 → `sessionController.ts:1534` 写入 "Archive failed for 2 sessions: …"(未配对,继承陈旧的 "reply")。
4. 数秒内的任一成功请求(hover 预取 GET、15 分钟状态轮询、visibility 恢复刷新)→ `clearTransientError` 把横幅抹掉。归档确实失败了,屏幕却自行收回这个事实;用户若没在 1.5 秒内读到(`bannerHold.ts:2` 的 `BANNER_MIN_VISIBLE_MS = 1500` 只是延迟、不阻止),就会以为归档成功了。`scheduleTransientErrorDismissal` 不介入(该文案不匹配任何 transient 正则),所以唯一抹掉它的就是这次无关的成功请求。

### 反向场景(陈旧 "reader":该退场的传输横幅永不退场)

较早出现 reader 类通知(如 "Failed to fetch" 的 TypeError → `noticeForReader`)之后,`machineController.ts:150` 的 "X is unavailable; reconnecting…"(语义上属于传输、应随恢复退场)继承 "reader",既不匹配 transient 正则、又不随 reply 退场,只能手动关闭。

### 修复方向(供 triage,不在本 lane 执行)

所有生产方改走 `errorNoticePatch`(或显式 `noticeForReader`)。`openLazySurface` 的失败路径写成 `this.setState(errorNoticePatch(error))` 恰好语义正确:动态 import 失败的 TypeError 会被归类为 reader-retired,而成功路径已有的字符串匹配清除(`PiWebApp.ts:1733`)继续负责"重试成功即退场"。

---

## 发现 2 —— 从 URL 恢复的 settings 路由没有任何模块加载路径,失败时既无面板也无横幅 【判定:TRUE(低严重度)】

### 证据

- settings 的可见性可以不经 `openSettings` 置真:构造时 `PiWebApp.ts:434`(`readSettingsOpen()`)、boot 时 `PiWebApp.ts:1094` → `restoreSettingsRoute()`(`PiWebApp.ts:1820-1824`,只设标志)、onPopState 路径 `PiWebApp.ts:454/462`。
- 这些路径**都不调用** `openLazySurface("settings", …)`;唯一的加载者是 `warmLazySurfaces`(`PiWebApp.ts:959`),而它的失败被文档化为 "deliberately silent"(`src/client/src/components/lazySurfaces.ts:42-44`)。
- 对比:session-tree 有 willUpdate 触发器补位(`PiWebApp.ts:661-665`),settings 没有对应物。

### 最小失败场景

settings 打开状态下刷新页面;刷新恰好落在部署中段,入口 bundle 引用的 settings chunk 404 → warm 静默失败 → 路由宣称 settings 打开(URL、`settingsOpen` 均为真),屏幕上既无面板(未注册的自定义元素不渲染)也无横幅(`openLazySurface` 从未运行),**无限期**悬空,直到用户主动再点一次设置入口(那次点击会重试并可能在失败时报错)。讽刺的是 round-15 修复的横幅文案让用户 "reload to get it",而 reload 后的这个洞正好绕过该横幅。

### 附带的文档漂移(同一发现的证据)

- `lazySurfaces.ts:43-44` 仍写着 "the open path **awaits** the same load" —— d5e0de1e 修正了模块级 docstring 的 awaiting 说法(第 2-11 行已改为 fire-and-forget),漏掉了这条方法级注释。
- `PiWebApp.ts:1741-1743` 仍写着 "The dialog's module is loaded **before** it is shown",而代码(`PiWebApp.ts:1744-1745`)是先置 `settingsOpen = true` 再并发加载。两条都是 round-15 lane C "修正陈旧 awaiting 文档" 这一整改的漏网之鱼。

---

## 发现 3 —— inFlight.ts 的共享机制描述与实现相反 【判定:TRUE(仅文档;行为缺陷目前不成立,推测部分已标注)】

- `src/client/src/api/inFlight.ts:10-13`:"What is shared is the response body, **not a parsed value**: each caller applies its own parser to the **same bytes**."
- 实现:`src/client/src/api/http.ts:17-22` 共享的是 `fetchBody` 的返回值,而 `fetchBody` 在 `http.ts:51` 执行 `await response.json()` —— 共享的是**一份已解析的 JSON 值**,不是字节;各 caller 的 parse 施加在同一个解析对象上。
- 安全结论("一个 caller 的 parser 产物不会交给另一个 caller")仍然成立,但仅因两个未被执行的偶然事实:每次飞行 `JSON.parse` 产生新对象,且 `parsers.ts` 的解析器是构造式、不原地改写入参(抽查了头部主要 parser)。模块本身没有任何机制阻止未来某个 parser 原地改写共享对象而跨 caller 泄漏变异。【此为推测:当前代码不存在这样的 parser。】
- 这是 round-15 lane C "修正机制性 docstring" 同类的漏网项,且 inFlight.ts 明确在 wave 清单内。

---

## 已排查并判定为不成立的怀疑(逐条给出反证)

1. **PromptEditor 的未发送重试行跨会话残留** —— FALSE:`src/client/src/components/PromptEditor.ts:367-371` 在 sessionId/machineId 变化时按新 key 重载,注释明言 "The strip must carry the scope it belongs to"。
2. **预取写错机器键(B2 回归)** —— FALSE:`sessionController.ts:1908-1921` 在悬停时刻捕获 `machineId`,merge 用 `machineSessionKey(machineId, session.id)`,与打开路径同键形;`api/urls.ts:9-17` 的 URL 也带机器段,in-flight 去重键不会跨机器共享。
3. **预取失败被永久记住(B4 回归)** —— FALSE:`sessionController.ts:1915-1917` catch → forget。
4. **lazy 表面渲染路径循环(B1 回归)** —— FALSE:唯一的渲染路径触发点在 `PiWebApp.ts:655-666` 的 willUpdate,由 `treeDialogAnnounced` 门控;`SessionTreeNavigator.ts` 的 willUpdate 只做 `resetTree`,无加载调用。
5. **插件 activityBadge 的 idle 行仍带 unread 类(A2 回归)** —— FALSE:`pi-web-plugins/machines/browser/activityBadge.ts:47-48` 与 workspaces 副本一致,idle 时 `markKind = "idle"`;宿主 `shared.ts:410` 的 `.action-activity[hidden] { display: none; }` 经 hostUi seam(`pi-web-plugins/machines/browser/hostUi.ts:36-45` 采纳宿主 listStyles)覆盖插件列表。
6. **chatHistoryCache 跨机器串键** —— FALSE:存储键是调用方传入的已限定键(`machineSessionKey` 产物),`chatHistoryCache.ts` 的 `cacheKey` 只加前缀;TTL、逐条上限、最旧先逐出逻辑均自洽。
7. **lazy 失败横幅在重试成功后残留(B3 回归)** —— FALSE:`PiWebApp.ts:1731-1737` 成功路径清除;`loadSurface` 恒返回 Promise(`lazySurfaces.ts:33-37`),d5e0de1e 已移除死分支。
8. **合并时静默丢弃新读数**(`chatHistoryCache.ts` 的 `mergeChatHistory` 对不合法 incoming 返回 existing)—— 判定:边缘且当前不可达(需要 daemon 违反 `total >= start + len` 不变式),不作发现,仅记录。

## 对 round-15 九项修复的核对结果

- B1(tree 循环)、B2(预取机器键)、B3(横幅退役)、B4(预取遗忘):全部在位(见上)。
- A 系中与行为相关的抽查:`AppContextBar.ts:118` 与 `shared.ts:410` 的 `[hidden]` 伴生规则、`AppNavigationPanel.ts` 的 `.compact-header-action.compact-fold { padding: 0; }`(特异性覆盖)均在位;`shared.ts:324` 的 `line-height: 1.3` 与 2.6em 夹持自洽(2 × 1.3 = 2.6)。
- `docs/design/review-triage-uiux-round15.md` 与代码一致,包括如实记录"无预取测试覆盖"的接受缺口。`phone-quality.md` 的 `--pi-reading-edge` = 10px 手机 / 16px 桌面与 `src/client/index.html:34,36` 及 `readingEdge.test.ts` 一致;`operation-model.md` 的 "Still open" 清单与代码现状相符(如 deadline 未接 liveness)。

## 覆盖声明

已覆盖 focus 清单全部五项(生命周期诚实、预取/缓存键、in-flight 共享、lazy 加载路径、切换后状态)。几何/触摸 floor/间距字面量属 lane A,未深查;`quickSwitcherLoading` 双飞行竞态(同机两次 load 时 loading 提前熄灭)为瞬态、未列为发现;commandDialog 跨机器残留因模态阻挡(`modalLayerOpen()`,`PiWebApp.ts:2319-2325`)不可达,列为推测、不成立。
