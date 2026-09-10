# Round 23 — Lane C：跨文件一致性 / 死代码 / 文档与代码不符 / 绕过 banner 退役模型

审阅对象：`refactor/plugin-architecture` @ `5bd8e406`（只读，未改任何文件）。
本 lane 的四个靶子逐条给结论：

- **跨文件不一致**：F3（rail 契约注释 vs `SessionList.ts:744`）、F7（badge 色表 vs `ChatView.ts` dock）、F9（同一语义三处晕环色）、F13（核心与两个 plugin 的三份拷贝）
- **机器切换器删除后的死规则**：死 CSS/路由已清干净，死注释没清 —— F12
- **文档声称而代码没做**：F1（changeset 的 sequenced 只覆盖一半）、F4（rail 表同一状态两种颜色）、F5（"any successful exchange" 少一条腿）、F6（HttpError 契约）、F11（design 文档的 file:line 证据）
- **绕过 banner 退役模型**：F2（作用域被销毁而 claim 存活）、F6（机器级失败降级成页面级 claim）

编号 F1-F14，按严重度排序；F1-F4 值得本轮处理，其余可攒。

## 本轮验证过为“干净”的（负面结果，同样重要）

- **没有任何页面级错误绕过退役模型**。全仓 `setState({ error: ... })` 全部经 `errorNoticePatch` / `noticePatch` / `clearErrorPatch`；只有 `authController.ts` 的对话框局部 error（不进 `state.error`）。`PiWebApp.ts:3267` 的 `errorNoticePatch(new Error("This machine is no longer listed."))` 走的是 seam，没有裸写。
- **每个 row 恰好一个记号**：session row 由 `sessionRowIndicator.ts` 仲裁（asking > running > unread > error > background > idle），machine/workspace row 由 plugin `activityBadge.renderActionActivityIndicator()` 渲染单个 `.activity-indicator`。`:has()` 不会跨 row 渗色（session row 是平铺兄弟，`.is-child` 不嵌套在父 row 元素内）。
- **QuickSwitcher 没有 rail**：它不采用 `listStyles`（`QuickSwitcher.ts:499` 注释确认），所以 434-441 那批 `.action-row` rail 规则在 switcher 里不可能误着。
- **rail 与 dot 的色表基本对齐**：6 条 `:has()` rail 的颜色，逐一与其 `:where()` 成员在 `shared.ts`/`sessionStateBadgeStyles.ts` 里的 `background`/`color` 相符 —— 唯一的例外是 F4 那条重复的 `.session-state.running`，以及 F7 里 dock 自己改写 `currentColor`。
- `pointerQueryOrder` / `designTokens` / `dotScale` / `controlHeightScale` / `markLanguage` 5 个守卫测试 49 例全绿。
- `reportTransportReachable` 在 `http.ts:50` 对**每个**响应触发（不只 2xx），符合 "any successful exchange is proof" 的注释。

---

## F1 — Medium：`refreshMachineRuntime` 缺 machineId 守卫，而 changeset 声称这个守卫存在

`src/client/src/controllers/machineController.ts:136` 的 `refreshMachineHealth` 有：

```ts
if (selectedMachineId(this.getState()) !== machineId) return;   // line 136
```

它的注释（132-135）明确写出这条检查存在的理由："the same one the project and session controllers use - is what stops a late failure from painting machine A's complaint onto machine B"。

同一文件 `refreshMachineRuntime`（149-170）**没有这条检查**，而它的失败分支同样写 banner：

```ts
catch (error) {
  if (isTransportError(error)) {
    this.setState(errorNoticePatch(error, { message: machineUnavailableMessage(machine), machineId }));  // :161
```

`.changeset/round-twentyone-gateway.md` 声称："Background health failures are sequenced so a late failure cannot paint machine B's complaint onto machine A."
—— 只对 **health** 成立。**runtime 腿没有 sequenced。**

可达路径：`loadMachines()` 结尾对 roster 里每台机器**并发** fire-and-forget `refreshMachineHealth` + `refreshMachineRuntime`；用户在请求飞行中点了机器 A。A 的 runtime 先成功返回 → 落到 local 的 runtime map；B 的 runtime 超时后失败 → 屏幕上出现"B 暂时连不上"，而用户正看着 B，且没有任何后续 B 的回复能清掉它（它本身就是 B 的回复失败，只是被延迟判定的）。`deleteMachine` 结尾的 `refreshMachineHealth(machine.id)` 循环、`PiWebApp.ts` 的 fleet 轮询同样并发触发这条腿。

修法：`refreshMachineRuntime` 的成功分支保留（runtime map 按 machineId 存，跨界写入无害），只在失败分支加与 136 行相同的守卫；或者把守卫抽成一个 helper，让两个 refresh 共用，这样注释里承诺的 sequenced 对两条腿同时为真。

## F2 — Medium：删除机器不会撤掉“关于这台机器”的 claim —— 退役模型的作用域被销毁后，claim 永久驻留

退役模型的前提是：**关于作用域 X 的断言，会被来自 X 的下一次回复证伪**（`PiWebApp.ts:1036-1041`）。

```ts
const disproved = this.state.errorMachineId === "page" || this.state.errorMachineId === machineId;
```

`machineController.deleteMachine()`（约 100-110 行）对 `machineStatuses` / `machineRuntimes` / `machineStatusSnapshots` 三张表做了 `omitKey` 清扫，但**没有碰 `state.error` / `state.errorMachineId`**。于是"作用域 X 被销毁，而关于 X 的 claim 还活着"这条不变量破口出现了：

1. 机器 B 掉线 → `refreshMachineRuntime`/`refreshMachineHealth` 抛 `HttpError` → `errorNoticePatch` 写入 `errorMachineId = "B"`，`errorRetiredBy = reader`（reader-retired 因为没有到期定时器）。
2. 读者在 Settings 里删掉 B（`PiWebApp.ts:3441 removeMachine` → `machines.deleteMachine` → fallback 到 local）。
3. 之后所有请求都是 `api/machines/local/...` → `clearTransientError("local")`，`"B" !== "local"` → **永不 disproved**。
4. reader-retired → `scheduleTransientErrorDismissal` 里 `errorRetiredBy !== reply` 直接 return → **也没有到期兜底**。
5. 结果：一条讲着已不存在的机器的红条，只能靠读者手点 dismiss。

这是"生产者绕过退役模型"的一种非典型形态：不是绕过，而是**销毁了 claim 的 scope 身份却没顺手撤 claim**。修法是在 `deleteMachine` 成功后加一步：若 `state.errorMachineId === machine.id`，走 `clearErrorPatch()`（或新增一个 `retireClaimsForMachine(machineId)` patch，语义上仍是 seam 内的一次撤销，而不是裸写 error）。

同一函数的另一处小不一致：`loadMachines` 结尾清理了 `machineRuntimes` 和 `machineStatusSnapshots` 两张表，唯独不清理 `machineStatuses`（`filterKeys` 只用在两者上）。所有读点都以 `state.machines` 为键遍历，所以暂时读不到脏值 —— 但三张同构的表被两套清扫规则覆盖，迟早会读不到。

## F3 — Medium：`shared.ts` 的 rail 契约注释自相矛盾，且"one table"实际散落在两个文件

`src/client/src/components/shared.ts:400-441`。三处问题，同一处代码：

1. **419 行**："the row-class rules below (**unread**/archived/selected) are (0,2,0), so they win on specificity regardless of order." 紧接着 421-424 行又解释："The unread CLASS is unconditional on a session row … **so a row-class unread rule would paint those rows purple against a blue or amber dot; the dot rules above are the only unread painters.**" —— 同一段注释先说"unread 在下面"，再用三行解释"下面其实没有 unread"。括号里的清单是上一版删掉 `.action-row.unread` 规则时漏改的。
2. **413 行**：`and :427's colour on the borderless .action-main painted nothing at all` —— 这是一条**行号引用**，指向曾经写在 `.action-main` 上的 rail 颜色规则。现在 427 行落在注释块中间，指向什么都不不是。这类引用在同一次改动里必然腐烂；改成"the earlier rule on `.action-main`"即可。
3. 注释承诺 rail 颜色只有这一张表，但**第三条 row-class rail 覆盖住在另一个文件**：`SessionList.ts:744` `.action-row.bulk-selected { border-color: var(--pi-accent); }`。这是 (0,2,0) 且在 `[listStyles, …]` 之后拼接，`border-color` 简写连 `border-left-color` 一起改 → 批量选中的行同样吃掉任何状态 rail。它不在 419 行的清单里，也不在 `shared.ts` 里。

顺带把不变量的边界写清楚（现在注释没说）：`.action-row.selected` 是 (0,2,0)，**吃掉全部 6 条状态 rail**。选中的 asking row：dot 是 amber，rail 是 accent —— 与 403-404 行"the rail wears the very colour the row's own dot wears … a row never reads as one thing up close and another at scanning distance"正面冲突。选中态压过状态色大概是刻意的，但注释现在把这条规则描述成"服从表格"而不是"覆盖表格"，下一个读到注释的人会以为 rail 恒等于 dot。

## F4 — Medium：`.session-state.running` 在 rail 表里被写了两种颜色，其中一种是死代码

```
shared.ts:435  .action-row:has(:where(.activity-indicator.session, .session-state.running)) { border-left-color: var(--pi-success); }
shared.ts:436  .action-row:has(:where(.session-state.running))            { border-left-color: var(--pi-accent);  }
```

两条同为 (0,1,0)，436 在后 → 含 `.session-state.running` 的行永远是 accent。**435 的第二个成员从不生效**：它是 436 加进来时的残留。这不是"看起来多余"而已 —— 它让同一份表同时宣称 running 是 success 又是 accent，正是 rail 注释（400-407）最想防的"两处不同表"。修法：把 `.session-state.running` 从 435 的 `:where()` 里删掉，让 435 只写 machine/workspace 的 `activity-indicator.session`。

（同一条 `.session-state.running` 类名在 `sessionStateBadgeStyles.ts` 里**没有自己的 CSS 规则** —— 只有子元素 `.state-dot` 上色。它唯一的 CSS 消费者就是 436。这个事实值得写进注释，否则删规则的人会以为有依赖。）

## F5 — Low：`fetchWithDeadline` 这条腿绕开了 transport 恢复上报（4 个调用点）

`src/client/src/api/http.ts:50` 对每个响应调用 `reportTransportReachable(url)`；`src/client/src/api/requestDeadline.ts` 的 `fetchWithDeadline` 自己 `fetch`，**从不上报**（也不 `resolveAppUrl`，那个是调用方自己做的，是有意的）。

调用点：`external.ts:81`、`clients.ts:378`、`clients.ts:399`、`pluginBackends.ts:63`。其中 `pluginBackends.ts:63` 是同源 `api/machines/<id>/plugin-backends/...`，`machineIdFromUrl` 能解出 id —— **对它而言上报本来是正确的**，现在却完全沉默。

`transportHealth.ts` 头注释说 "Any successful exchange with the server is proof the transport is back"，字面上对这条腿不成立。影响面：这 4 个不是轮询主路径，banner 通常由 sessions/status 轮询或 socket 重连消掉，所以是文档-代码落差而不是常驻故障。修法：`fetchWithDeadline` 在 `fetch` resolve 后同样 `reportTransportReachable(url)`（调用方传进来的 url 已经是解析后的）。

## F6 — Low：`clients.ts` 的两个抛错绕开了 HttpError，机器级失败落回 page 作用域

```ts
// src/client/src/api/clients.ts:378 / :399
throw new Error(apiErrorMessage(body) ?? response.statusText);
```

`errorNoticePatch` 依赖 `HttpError` 上挂的机器上下文来给 `errorMachineId`；plain `Error` → `machineId: undefined` → 落回 `"page"`。也就是说：**同一台机器的同一次 502，走 `request()` 得到机器级 claim，走 `fetchWithDeadline` 得到页面级 claim。** 页面级 claim 会被*任何*同源回复证伪 —— 包括跟那台机器毫无关系的 web-owned 回复，正是 `http.ts:50-56` 那段注释专门加机器解析要避免的"web process 200 冒充机器活着"的反向版本。修法：这两个 throw 换成 `HttpError`（带 status + url），让 seam 能解析出机器。

## F7 — Low：`sessionStateBadgeStyles.ts` 声称"every surface … 同一个状态绝不在两处读起来不一样"，ChatView dock 就是第二处

`sessionStateBadgeStyles.ts:6-8`：

> One style block for every surface (list rows, chat dock, quick switcher, context bar) so the same state never reads differently in two places: working/running -> three bouncing **blue** dots

实际：

| 状态 | 列表 row | ChatView dock |
|---|---|---|
| working | `.state-dot { background: var(--pi-accent, var(--pi-success)) }` → **#58a6ff 蓝**（`src/client/index.html:157/163`：accent 蓝、success 绿） | `ChatView.ts:254 .activity-dock.working { color: var(--pi-success) }` → **#3fb950 绿** |
| sending | 同一个 running 记号（仲裁注释写明 sending 复用 running） | `ChatView.ts:255 .activity-dock.sending { color: var(--pi-warning) }` → **琥珀** |

同一个会话在相邻的两个面上：列表蓝点、chat 绿点/琥珀点。注释还自指"chat dock"是它覆盖的 surface 之一。另外 `.state-dot` 的 `var(--pi-accent, var(--pi-success))` 回退、rail 435 的 success、rail 436 的 accent —— "running" 一共有四处颜色归属，两处蓝两处绿。这是本轮颜色语义里最乱的一条：不是缺规则，是**同一种状态有四个 owner**。修法二选一：把 dock 的 working 也接到 `--pi-accent`，或者把注释改成"list rows only"并让 dock 明说自己是第二种读法。

## F8 — Low：`.action-row.selected` 与 running / terminal rail 撞成同一个颜色

rail 表里 accent 被三种语义共用：running 的 session row（436）、terminal 的 machine row（438）、选中的任何 row（441）。rail 是设计里唯一的"扫读通道"，而选中态在 rail 上不可辨。选中态另有背景（356 行 `background: var(--pi-selection-bg)`）和 `aria-current`，所以不是无障碍灾难；但 rail 注释声称 rail 是"the one place this design spends colour on identity"，identity（"我在这行"）恰恰是它表达不了的语义。至少要写进注释，或者给 `.selected` 换成中性色（如 `--pi-text`）以让 rail 只表达状态。

## F9 — Low：`unread` 的晕环有三种颜色

同一个"未读"语义，三个位置三种色：

| 位置 | 色 |
|---|---|
| `shared.ts:449 .activity-indicator.unread` 的 `box-shadow` | `color-mix(--pi-accent 20%)` **蓝** |
| `sessionStateBadgeStyles.ts:35 .session-state.unread` 的 `box-shadow` | `color-mix(--pi-purple 22%)` **紫** |
| `shared.ts:450 .unread-ring` 的 `border` | `var(--pi-accent)` **蓝** |

`shared.ts:447-448` 的注释说 unread 是 purple "the same turn-ended colour the session dot wears"，紧接着自己的 halo 用了 accent。修法：三处统一紫，或注释写清"点是紫、环是 accent（表示环内有活）"。

## F10 — Low：rail 契约（22 条视觉规则）零测试

`grep border-left-color --include=*.test.ts` 空。这个仓库对别的视觉契约都有守卫（`dotScale`、`controlHeightScale`、`pointerQueryOrder`、`markLanguage`、`designTokens` 的 hidden 守卫），唯独 rail 没有。F3/F4 两处腐烂（清单写了不存在的规则、同一状态写了两种颜色）本来是可以被一条断言拦住的：

- 断言每条 rail 的 `:where()` 成员，其 dot 规则颜色与 rail 颜色一致；
- 断言任何一条 rail 的 `:where()` 成员不出现在另一条**不同颜色**的 rail 里（直接拦死 F4）；
- 断言注释里列举的 row-class 覆盖清单与实际存在的 (0,2,0) rail 规则集合相等（含 `SessionList.ts` 的 `bulk-selected`，直接拦死 F3）。

## F11 — Low：两份当活契约用的 design 文档，其 file:line 证据已失真

`docs/design/element-native-vs-plugin.md` 自称"states the current home with **file:line evidence**"（第 6 行），当活清单用，但下面几处已失真：

1. 第 45 行：`Machine list / machine switcher | MachineList.ts | native — ruled core method`。`MachineList.ts` 在 `pi-web-plugins/machines/browser/`，`MachineSwitcher.ts` 已不存在。`ProjectList`/`WorkspaceList` 同样在 `pi-web-plugins/workspaces/browser/`，表里写 `native` 不注明 home 已迁。
2. "Bundled today: git, info, relays, terminal, updates, voice, workspace-tasks" —— 漏 `files`（正文另一处已承认 299a8da0 抽出）、`machines`、`workspaces`、`goals`。
3. 第 38 行引 `PiWebApp.ts:777-783 (selfUpdateApi.status())`；777-783 现在是 interrupted-runs 的代码。
4. `docs/design/machines-axis-plugin-design.md:16` 的"插件所有"清单里仍写 `MachineList/MachineSwitcher/SettingsMachinesPanel/SettingsFleetSection` —— 其中 MachineSwitcher 这个文件已经不存在。

历史轮次的 research 报告（`docs/design/research/uiux-r14-lane-b.md` 等）提到 MachineSwitcher 是**当时的事实**，不必改；要改的是这两份当活契约用的 design 文档。

## F12 — Low：机器切换器删除后的死注释（死规则本体已清干净，注释没清）

组件、路由、CSS 都删干净了（全仓 grep 无 `machine-switcher` 元素、无 `customElement("...switcher")`），剩下的全是**把已删组件当成活体解释现状**的注释：

- `src/client/src/components/designTokens.test.ts:93`："The mobile shell keeps four lists and **the machine switcher** mounted-but-hidden, and the switcher shipped without the guard - so a phone named its machine twice." 这个测试只扫 `src/client/src/components`；`src/client/src/components` 下已无任何 switcher。守卫本身仍然有效（其余 list 组件还在），但**它举的反例已经不在扫描目录里**，读测试的人会去找一个不存在的组件。
- `pi-web-plugins/machines/browser/MachineList.ts:261`："The same mark-plus-word **the switcher** uses…"
- `docs/design/machines-axis-plugin-design.md:16`（见 F11）。

（`PiWebApp.ts:427/2325/2365/2464/2812` 等处的 "the switcher" 指 session/context switcher，仍然存在，**不是**死引用。）

## F13 — Low：`ActivityIndicatorKind` 的 `"sending"` 是死变体；核心 `activityBadge.ts` 的两个导出没有生产消费者

- `statusActivityKind()`（plugin 两份拷贝 `pi-web-plugins/{machines,workspaces}/browser/activityBadge.ts` 各一份）从不返回 `"sending"`；`sending` 只由 `renderStartingSession` 直接写类名（在 `.pending-session-row` 里，而 `.pending-session-row` 不带 `.action-row` → 没有 rail，`shared.ts:446` 注释也这么声明）。类型留着 `sending`，读类型的人会以为活动投影会产出它。
- `src/client/src/components/activityBadge.ts` 导出的 `statusActivityKind` / `hasStatusUnread` 只被 `activityBadge.test.ts` import；生产代码里没有任何 import（真正的消费者是 plugin 里的那两份拷贝）。这是一对**测试专用导出**，同时是**跨两个 plugin 的第三份逻辑拷贝** —— 投影 seam 迁移（`element-native-vs-plugin.md` 里的 step ②）做完后，核心这份应该删掉或改成 plugin 从核心 import，现在是三份各写一遍、只有一份被测。

## F14 — Cosmetic：自更新 banner 的文案是中文，其余 banner 是英文

`renderSelfUpdateBanner` / `applySelfUpdate` 产出 "正在更新 pi-web…"、"pi-web 有新版本"，而相邻的 `renderStaleClientBanner`、`errorBanner`、deprecated-inputs banner 全英文。同一个 banner 栈（`PiWebApp.ts:3906-3909` 连着渲染四条 banner）里两种语言。另：`renderStaleClientBanner`（894 行）头上挂着一段属于 `renderSelfUpdateBanner` 的重复 doc comment。

## 非缺陷（复核后撤回的候选）

- **`errorMachineId` 对 `api/machines/local/*` 返回 `"local"`**：local 路由经 gateway 进程，它就是本机。`piWebApi.status("local")` 走 `api/pi-web/status` → `undefined` → `"page"`，正确（web 进程的 200 只证明 web 进程活着，正是 `transportHealth.ts:24-29` 的说法）。
- **`normalizeTransientError` 的 composed 守卫**：`${machine} is unavailable; reconnecting… <detail>` 不匹配任何改写 → 不做 6 秒到期、走常驻样式。`PiWebApp.ts:1056-1074` 用一整段注释解释了为什么（到期会删掉重试阶梯的最后一句话）。代码与注释一致。
- **`handleMachineChange`（`PiWebApp.ts:2036-2042`）**：关 socket → 用新 machineId 重连（新闭包捕获新 id）→ 清 active session/terminal/cleanup → 重置 piWebStatus → 重新加载插件。切换机器时的 claim 泄漏在这里没有。
- **`reportTransportReachable` 对非 2xx 也上报**：`http.ts:50` 在 response 抵达后无条件调用。这是刻意的（"reached" ≠ "ok"），且 HTTP 层失败另有 `HttpError` 路径写 claim，两者不打架。
- **`sessionRowIndicator` 的优先级顺序**与 rail 的 source order：仲裁器保证一行只出一个状态类，所以 434-439 的先后在实际渲染里不产生差别；顺序是防御性的，不是缺陷。
