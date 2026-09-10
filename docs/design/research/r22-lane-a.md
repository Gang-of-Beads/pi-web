# Round 22 — Lane A:几何与契约(pointer-query 顺序、box model、touch floor、间距/字号字面量、级联与规则顺序陷阱、rail 优先级)

分支 `refactor/plugin-architecture`,HEAD `1c2013f7`。只读审查,未改动任何仓库文件。
结论:**不干净** — 2 个模型级缺陷(其中 1 个用真实模块跑通证明)、3 个守卫盲区(其中 2 个有活体实例)、若干死代码/文档漂移。每条均给出 file:line、最小失败场景与 TRUE/FALSE 裁决。

---

## F1(P1,契约/模型):网关机器级 transport 声明被盖上 "page" 印 — `HttpError.machineId` 在分支顺序中被丢弃

**证据**
- `src/client/src/api/http.ts:58-60`:网关错误体里的 `machineId` 被读出并装进 `HttpError`。
- 服务端确实携带它:`src/server/web/machines/machineProxyRoutes.ts:365-373` 与 `machinePluginProxyRoutes.ts:234-236` 的 `sendGatewayError` 回 `{ error: "Remote machine unavailable"|"Remote machine timeout", machineId, detail }`。
- `src/client/src/notice.ts:94-95`:第一个分支 `if (isTransientError(text) || /failed to fetch|.../) return noticeFromTransport(text, error instanceof RequestTimeoutError ? machineIdFromUrl(error.url) : undefined)` — 三元式只给 `RequestTimeoutError` 提取 scope;`HttpError` 落到这里时 machineId 恒为 `undefined`。
- 网关两个 label 恰好全部命中措辞表(`errorBanner.ts:98-100` 的 `/^remote machine (unavailable|timeout)/i`),所以 `isTransientError` 恒为 true → `notice.ts:97-99` 那个会用 `error.machineId` 的 `HttpError` 分支,**对所有携带 machineId 的错误都不可达**(round-20 的元发现"a scope computed but stamped over"在这一层重演)。
- 用仓库真实模块跑通验证(tsx 直接 import `notice.ts`/`http.ts`):`errorNoticePatch(new HttpError("Remote machine unavailable (connect ECONNREFUSED …)", 502, "remote-a"))` → `{"errorRetiredBy":"reply","errorMachineId":"page"}`;对照组 `RequestTimeoutError("api/machines/remote-a/status")` → `machineId:"remote-a"`(正确)。

**最小失败场景**:remote-a 的 daemon 挂掉,机器代理回 502 → 横幅是 reply-retired 但 scope="page";remote-b 的一次成功 status 轮询(甚至任何 web-owned 轮询)在 `PiWebApp.ts:1046` 判定 "page 声明被任何响应推翻" → 横幅被清掉。这正是 round-20 triage 第 1 条宣称已不可能的"跨机器清除"(原文:"a remote machine's timeout survives every other machine's poll"),也是 round-21 第 1 条宣称的"the claim heals on that machine's own answers"的反例 — 代码实际是"任何回答都治愈"。

**裁决:TRUE**(用真实模块运行证明)。修复方向:第一分支改为 `error instanceof HttpError && error.machineId !== undefined ? error.machineId : (RequestTimeoutError ? machineIdFromUrl(...) : undefined)`,或调换分支顺序并让 HttpError 分支先消费 `error.machineId`。

---

## F2(low-medium,契约回归):1.5s hold 窗口吞掉了 `lastScheduledError` 的复位 — 同文重触不会重新武装 6s 过期

**证据**
- round-19(`1c2013f7`)给 `renderErrorBanner` 加了 `if (error === "" || this.bannerDismissedByReader) { …; this.lastScheduledError = ""; … }` — 这是 round-19 triage 第 7 条"a cleared-then-returned banner re-arms its own expiry"的兑现。
- round-21(`535fb94b`,triage 第 3 条"1.5s hold is back for auto-clears")把条件缩成 `if (this.bannerDismissedByReader)`(`PiWebApp.ts:3793-3800`),因为清空后还要靠 hold 继续显示 1.5s。副作用:hold 分支(3802-3806)提前 return,不复位 `lastScheduledError`;`clearTransientError`(`PiWebApp.ts:1042-1061`)清 timer(1053-1056)但也不动它。
- `PiWebApp.ts:3811-3814`:`if (error !== this.lastScheduledError)` 是唯一的重武装闸门。

**最小失败场景**:t0 链路闪断,横幅 A("Failed to fetch" / "Session daemon unavailable: connect ECONNREFUSED …" 这类确定性文本)展示;t0+0.4s 一次成功请求触发恢复清除 → 进入 hold(横幅继续显示到 t0+1.5s,`lastScheduledError` 仍为 A,6s timer 已被取消);t0+0.9s 同一失败以逐字节相同的文本重触 → render 走 show 判定,`A === lastScheduledError` → 不调度 → **这条重触的声明完全没有 6s 寿命**,只能等下一次成功请求或读者手点。与 round-19 记录的修复相矛盾;round-20/21 carried 的 deferred 笔记("re-arms its 6s expiry each time it re-raises — a flicker")描述的机制与现在的代码相反(现在是 latch,不是 flicker)。

**裁决:TRUE**(逐行核对 + git -L 确认回归点在 535fb94b)。影响有界(恢复报告最终会清),但模型承诺("only reply-retired claims expire on the timer")在该路径失效。修复方向:hold 结束转为 hide 的那帧复位 `lastScheduledError`,或把身份比较改成 (text, shownAt) 对。

---

## F3(low,box model):`width:100%` + content-box 水平 padding 溢出滚动容器 — 3 个活体实例,box-model 守卫按策略看不见

**证据**
- `src/client/src/components/AuthDialog.ts:278`:`.options button { display: block; width: 100%; padding: var(--pi-space-5) var(--pi-space-6); border-bottom: … }`,父容器 `AuthDialog.ts:268` `.options { overflow: auto }` — content-box 下行的盒宽 = 100% + 24px。
- `src/client/src/components/ModelPicker.ts:301`(规则)+ `:284`(`.options { overflow: auto }`):同一形状。
- `pi-web-plugins/git/browser/git-panel.ts:1340`:`.git-panel .git-row { width: 100%; padding: … calc(var(--pi-space-3) + var(--depth,0) * …) }` 在 `:1339` 的 `overflow: auto` 列表内 — 至少 12px + 每层深度 12px 溢出。
- 守卫盲区即根因:`src/client/src/components/boxModelGuard.test.ts:27` `WIDTH = /(?:width|min-width):\s*(?!auto|100%|0\b)/` 把 100% 排除在外,docstring 声称"Percentage and `auto` sizes are not control geometry and are left alone" — 但 100%+padding 恰恰是"量出来不是它说的数"的那个形状。

**最小失败场景**:Windows/Linux(经典滚动条)打开 auth 提供者列表或模型选择列表 → 列表底部出现常驻横向滚动条;任何平台都可横向 pan,行的选中/悬停背景越出容器 24px。macOS overlay 滚动条下几乎不可见 — 如实降级为 low。

**裁决:TRUE**(机制由 CSS 规范确定;三处均为无 `box-sizing`、有横向 padding 的 `width:100%` 块级子元素,父容器 `overflow: auto`)。

---

## F4(low,守卫盲区 + 活体实例):间距守卫不认识逻辑属性 `-start/-end` — 一个活体 7px 在窗外

**证据**
- `src/client/src/components/spacingScale.test.ts:9` `SPACING_PROPERTY` 枚举了 `padding-(?:top|right|bottom|left|inline|block)`,没有 `padding-inline-start/end`、`margin-inline-start/end` — `padding-inline` 后跟 `-start:` 不匹配该交替分支。
- 活体:`src/client/src/components/SessionTreeNavigator.ts:624` `.tree-row { padding-inline-start: calc(7px + min(var(--tree-indent-mobile), 48px)) }` — 7px 不在刻度(2/4/6/8/10/12…)上,桌面孪生规则(551 行)用的是 `var(--pi-space-5)`。docstring 承诺"a new one has to be argued for rather than typed" — 这一条既没被看见也就没被 argue。

**裁决:TRUE**(对守卫正则逐步推演确认 `padding-inline-start:` 不匹配;实例真实存在)。

---

## F5(low,死 CSS):`.subtree-chevron` 样式作用于一个谁也不渲染的类

**证据**
- `src/client/src/components/SessionList.ts:774-775` 定义 `.subtree-chevron` 与 `.subtree-chevron.collapsed`;全仓库(`src` + `pi-web-plugins` + 脚本)对 `subtree-chevron` 的引用只有这两行样式本身。子树开关实际渲染 `renderDisclosureIcon(collapsed)`(`SessionList.ts:481`)→ `.disclosure-icon`(`disclosureIcon.ts:13-19`,样式经 `SessionList.ts:685` 采纳的 `disclosureIconStyle` 提供,活的)。
- 这是 chevron→共享图标的替换残留 — 恰是 round-22 简报里"AppNavigationPanel orphan CSS removed"要清的那类东西,但这份在 SessionList。

**最小失败场景**:无用户可见影响;将来有人调"子树箭头旋转"会改到死规则上。**裁决:TRUE**(纯死代码)。

---

## F6(low,级联):rail 的 success 规则里 `.session-state.running` 半个选择器是死的,且与它头顶的注释矛盾

**证据**
- `src/client/src/components/shared.ts:453` `.action-row:has(:where(.activity-indicator.session, .session-state.running)) { border-left-color: var(--pi-success) }` 与 `:454` `.action-row:has(:where(.session-state.running)) { border-left-color: var(--pi-accent) }` 同为 (0,1,0)、后者在后 → 对带 `.session-state.running` 的行 454 恒胜,453 的该成员永不起作用。444-445 行注释自己说"Machine and workspace rows speak activity-indicator.session and stay success" — `.session-state.running` 放进 success 规则与注释意图相悖,一次重排就会让 running 静默变绿。
- 同类:`shared.ts:317-322` 两条 `.list-body.tiles .action-main` 相邻同选择器,前者的 `min-height: var(--pi-row-min-height)` 被后者 `min-height: calc(var(--pi-row-min-height) + var(--pi-space-9))` 覆盖,首个声明是死的。

**最小失败场景**:无直接用户可见缺陷;是"文档化的优先级"与代码不符的维护陷阱。**裁决:TRUE**(级联推导确定),定级 cosmetic。

---

## F7(low,一致性):计数徽章母题手抄六份,同样的 14px/16px 字面量,已经分裂成两个种(有边框/无边框)

**证据**:`shared.ts:181`(workspacePanelStyles 的 `.tab-badge`,带 `--pi-success-border` 边框)、`PiWebApp.ts:143`(`.tab-badge`,带边框)、`ChatView.ts:160`(`.drawer-tab-badge`,无边框)、`appShell/AppNavigationPanel.ts:495`(`.tool-badge`,无边框)、`SessionList.ts:696`(`.section-unread-count`,无边框)、`QuickSwitcher.ts:525`(`.row-tag`,无边框)。六处都是 `min-width: 14px; line-height: 16px; font-size: var(--pi-text-2xs); padding: 0 var(--pi-space-2/3); border-radius: pill` 的手工复制。

**最小失败场景**:下一处徽章照抄其中一份,行高或内边距与屏上其余五个不一致 — 项目自己的规则("Consistency is designed, not corrected")要求这类母题在建成时定死。**裁决:TRUE**(作为一致性债;是否收敛成 `--pi-badge-*` 令牌/共享样式属 owner 决定)。

---

## F8(low,文档漂移):两句被修复脚本吃掉行内代码的残句(与 round-19 第 2 条记录的同一种失败方式),operation-model 落后两轮

**证据**
- `docs/design/operation-model.md:28`:"The suppression branch exists in␣␣but no production caller passes…" — `in` 与 `but` 之间是双空格,文件引用被吃(od 校验)。
- `src/client/src/components/boxModelGuard.test.ts:14`:"The second shape is a control floor:␣\n * with padding, where content-box adds…" — "floor:" 后整段令牌描述丢失(od 校验),句子不通。
- `docs/design/operation-model.md:144-146` 仍把"wiring `deadlineSignal` to the socket's keepalive facts"列为"the remaining piece",而 round-21 triage 已裁定 "link.live … superseded — the dead proactive branch stays removed and the reactive model is the documented one";operation-model.md 最后一次修改停在 `1c2013f7`(round 19),round-20/21 重做的 page/machine scope 语义与网关词汇均未回流。
- 顺手:`src/client/src/components/PiWebApp.ts:897` 的 docstring "Render the 'Update now / Skip' strip above the session view." 挂在 `renderStaleClientBanner`(实际渲染 Reload 条)头上,真正的 Update now/Skip 在 `renderSelfUpdateBanner`(922 行起)。

**裁决:TRUE**(全部 od/git 验证)。

---

## F9(信息,无活体):两个守卫的下一批盲区,记录在案

- `pointerQueryOrder.test.ts:26` 的 `SELECTOR` 只认 `.`/`#` 开头 — coarse 块内的元素选择器规则(`MachineDialog.ts:152-153` 的 `footer button`/`header button`、`ModelPicker.ts:295-296`、`QuickSwitcher.ts:515` 的 `input` 等)不在轨;我扫描后**未发现活体违例**(这些块顺序都对)。这与 round-21 已记录的"compound-selector pairing gap … no live instance (deferred)"同族。
- 守卫只扫 pointer/hover 块;`@media (max-width: …)` 块内的 floor 无守卫(PromptEditor.ts:186-209 的宽度阶梯目前靠注释与手工排序保持正确)。
- 观察(非裁决项):打开的行菜单面板是 `position: fixed` + 打开时刻坐标(`actionMenu.ts`),滚动/resize 不跟随也不关闭,仅 document click/Escape/行消失会收 — 轮次 15-21 无相关投诉,标记为观察。

---

## F10(low,跨面不一致):"隐藏区退场即清搜索词"规则覆盖三个插件列表,唯独 SessionList 不在列

**证据**:`pi-web-plugins/machines/browser/MachineList.ts:73`、`workspaces/browser/ProjectList.ts:77`、`workspaces/browser/WorkspaceList.ts:93` 都有 `if (changed.has("hidden") && this.hidden && this.searchQuery !== "") this.searchQuery = "";`,且 MachineList 注释把这条陈述为一般规则("Hidden sections retire their query … The same rule ProjectList and WorkspaceList already run");`src/client/src/components/SessionList.ts:92` 的 `searchQuery` 无对应处理,而 `AppNavigationPanel.ts` 的 `renderSessionList(_, hidden)` 在"一屏一区"布局下同样会把它 hidden。

**最小失败场景**:桌面端在 session 列表输入过滤 → 点 context 行看一眼 machines → 回来,过滤仍在(machines 同样操作则已清空)。缓解:SessionList 的过滤词与清除按钮保持可见,不属于"静默隐藏行"的那类危害。**裁决:TRUE**(行为不一致;危害低于插件列表当年要治的那个,定级 low,是否统一属 owner)。

---

## 观察(可能是有意,交 owner)

- 同一条自更新横幅内中英混排:`PiWebApp.ts:941` 中文句子 + "Update now"/"Skip" 英文按钮;紧邻的 stale-client 横幅(913-916)全英文。语言选择属 owner 的产品语义,仅指出不一致的存在。

---

## 核对为洁的声明(本轮 hunt list 上查过、无可报之处)

- **rail 优先级(合并态)**:session 行经 `sessionRowIndicator` 仲裁器每行恰一点(sessionRowIndicator.ts:46-56),rail 六条 `:has(:where(...))` 全部 (0,1,0)、源顺序即优先级(shared.ts:452-457),逐态对表 running→accent、asking→warning、unread/background→purple、error→danger、machine/workspace `.activity-indicator.session`→success、terminal→accent、idle→无 rail — 与点色一一相符;unread+work 的环形复合态(shared.ts:446-449 注释所述)与 `renderActionActivityIndicator`(activityBadge.ts:29-45)的 `unread-ring` 实现互相印证;`.action-row.unread` 只剩文字加粗(SessionList.ts:719),不再涂 rail。
- **pointer-query 顺序**:PiWebApp 自更新横幅(202→206)、`.error .error-dismiss`(196→206)、QuickSwitcher 全部 coarse 提升(510-519 在各 base 之后)、机器/工作区插件对话框(MachineDialog.ts:145→151、ProjectDialog.ts:340→357/378)、subtree toggle(748→764)逐块核对,顺序全部正确;全量媒体块扫描(含 max-width)仅出 5 个候选,逐一裁决全为误报(跨 media 块的同名选择器是互斥条件或有意阶梯)。
- **touch floor**:error-dismiss、self-update、quick switcher、插件对话框、树对话框 disclosure(24px AA 豁免,close 44px)均达标且有豁免记录。
- **盒模型**:除 F3 三例外,近期触及面(`.action-main`、tile padding 推导、`.error`、unread-ring)的 padding-right/角标推导在 fine/coarse 两套 token 下均自洽(tile:inset+size+gap+dot+gap ≥ 点右缘,两分支各算过一遍)。
- **machineIdFromUrl**:对现有全部 URL 形态(`api/machines/:id/…`,含 `fetchWithDeadline` 的 resolved 绝对 URL)提取正确;query 中的 `%2F` 编码不致误配;web-owned → undefined → "page" 符合注释语义;主题切换只覆盖 THEME_TOKENS 色彩组(theme.ts:30-72),几何令牌不受影响。
- **遗留清点**:仓库内已无 `MachineSwitcher`/`machine-switcher` 引用;`setState({ error` 裸写已绝迹(唯一命中在 errorNotice.ts 的注释里);`audit-uiux-full.mjs:50` 的 contextSheet 触发器指向真实 context 行且有界轮询(20×250ms,缺失即 throw)。
