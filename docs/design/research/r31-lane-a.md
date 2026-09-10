# 收敛第 31 轮 · Lane A(几何与契约)审查报告

审查对象:PI WEB,分支 `refactor/plugin-architecture`。任务书给定的 HEAD 是 45691527(Round 30),工作区实际检出为其后一个提交 31560179("Start convergence round 31"),本报告按工作区现状审查;Round 30 及更早的收敛修复均已包含。本 lane 聚焦:pointer-query 顺序、盒模型、触控地板、间距/字号字面量、级联与规则次序陷阱、rail 优先级。只读审查,未修改任何仓库文件。

方法:通读 surface 文件(shared.ts、errorBanner.ts、bannerHold.ts、notice.ts、errorNotice.ts、transportHealth.ts、http.ts、PiWebApp.ts 样式段、AppNavigationPanel.ts、SessionList.ts、sessionStateBadgeStyles.ts、sessionRowIndicator.ts、QuickSwitcher.ts、SessionTreeNavigator.ts、ContextSwitcherSheet.ts、machines/workspaces 插件全部浏览器端文件、三个 triage 文档、两个 changeset、四个几何守卫测试),并用两个一次性探针脚本(写到 /tmp,不入仓库)实测了 pointerQueryOrder 守卫在扩展选择器集/分组选择器下的盲区。

---

## 发现

### 1.〔TRUE · 低-中〕插件元素的宿主样式表次序陷阱:`.machine-row` 的 12px 圆角是死规则

证据链(四段,缺一不可):

- `pi-web-plugins/machines/browser/MachineList.ts:262`:`.machine-row { border-radius: var(--pi-radius-lg); }` —— 意图是 12px。
- `src/client/src/components/shared.ts:354`:`.action-row { …; border-radius: var(--pi-radius-md); … }` —— 宿主 listStyles 的 8px,与 `.machine-row` 同元素(`MachineList.ts:132` 的 `class="action-row machine-row …"`)、同特异性 (0,1,0)、同属性。
- `pi-web-plugins/machines/browser/hostUi.ts:40`:`root.adoptedStyleSheets = [...root.adoptedStyleSheets, ...sheets];` —— 宿主表**追加在元素自身样式之后**。
- Lit 的 `adoptStyles` 是**整组替换**而非追加(`node_modules/@lit/reactive-element/development/css-tag.js:107`:`renderRoot.adoptedStyleSheets = styles.map(…)`,由 `createRenderRoot()` 在 `super.createRenderRoot()` 里先执行),所以最终次序恒为 **[插件自身样式, interactiveSurfaceStyles, listStyles]**;同特异性下后到的表获胜 → **listStyles 的 8px 恒胜,`.machine-row` 的 12px 永不生效**。

最小失败场景:导航面板/上下文切换页里的 machine 行渲染 8px 圆角,插件自己的声明与实际渲染不符且无任何报错;今后任何插件在同 sheet 用类级选择器去覆盖宿主 listStyles 的属性都会以同一方式无声失效(workspaces 两个列表因类名不重叠而暂未踩中,但其 hostUi 是同一追加模式)。

旁证不对称:内置列表把自身 css 排在 listStyles **之后**(`src/client/src/components/SessionList.ts:692` 的 styles 数组序),内置覆盖规则赢平局;插件经 adoptedStyleSheets 追加,插件覆盖规则输平局——同一"行组件"两种级联语义。另外 `.machine-row.no-actions .action-main`(MachineList.ts:263,(0,3,0))仍然生效,所以无菜单分支的主区拿到 12px、再被行的 8px `overflow: hidden` 裁掉,两分支的半径意图已经互相矛盾。`MachineList.test.ts` 无 radius 断言(与"静默失效"相符)。

判定:**TRUE**。修复方向(供 owner 选择,不单方面决定):要么把 `.machine-row` 半径提到宿主可表达的位置,要么把宿主表插到元素表之前、让插件约定"自身样式后置"与内置列表一致。

### 2.〔TRUE · 低〕tiles 网格:注释写 auto-fill,规则写 auto-fit,"compact cards" 与实际渲染相反

证据:`src/client/src/components/shared.ts:289` 注释 "Rows become compact cards in an auto-fill grid";`:291` 实际是 `grid-template-columns: repeat(auto-fit, minmax(150px, 1fr))`。

最小失败场景:单一 workspace/单项目安装(很常见)在手机面板(393px,`tiles: true`,见 `AppNavigationPanel.ts` renderNavSectionSlot)里只有一张卡片:auto-fit 把空轨道塌缩、唯一轨道以 `1fr` 拉满整行(≈377px 宽"卡"),auto-fill 才会保住 ~186px 的卡片形。注释描述的 compact cards 恰在"少条目"分支不成立。

判定:**TRUE**(注释/代码漂移为客观事实;"单卡应否拉满"是产品取舍,归 owner)。四个几何守卫都不覆盖"注释与规则矛盾",所以它能在 30 轮里存活。

### 3.〔TRUE · 低,潜伏〕pointerQueryOrder 守卫对元素选择器与 `:host` 抛升不可见

证据:`src/client/src/components/pointerQueryOrder.test.ts:19` 的 `SELECTOR = /(?:^|\})\s*(?<selector>[.#][\w-][^{}@]*?)\s*\{/gu` 要求选择器以 `.`/`#` 开头。守卫看不见但仓库里实际存在的粗指针抛升:

- `src/client/src/components/QuickSwitcher.ts:515`:`input { height: var(--pi-control-height-touch); }`(元素选择器);
- `pi-web-plugins/machines/browser/MachineDialog.ts:152`:`input[type="text"], … { min-height: var(--pi-control-height-touch, 44px); }`(元素选择器);
- `src/client/src/components/QuickSwitcher.ts:409` 与 `src/client/src/components/SessionList.ts:697`:`@media (pointer: coarse) { :host { --qs-menu-size…/--pi-row-gutter-size… } }`(`:host` 自定义属性抛升)。

我用同一守卫算法、把选择器集扩展到元素/`:host` 后在 HEAD 上全量探测:**当前无活体违规**(这些抛升之后都没有同选择器的后置基线重声明)。判定:**TRUE**——盲区真实存在(与本守卫在 round-17 要堵的"首规则"洞同族),只是今天还没咬合; QuickSwitcher.ts:514-515 同一块里 `.row-menu button`(类选择器)被守卫看见、紧邻的 `input`(元素选择器)不被看见,正说明保护是按字面拼写碰运气。

### 4.〔TRUE · 低,潜伏〕MEDIA_BLOCK 只认 pointer|hover 出现在首个条件里的查询

证据:`pointerQueryOrder.test.ts:18`:`@media\s*\([^)]*(?:pointer|hover)[^)]*\)(?:\s*(?:,|and)\s*\([^)]*\))*\s*\{`。形如 `@media (max-width: 760px) and (pointer: coarse)` 的块(指针条件不在首位)整块不可见。现状 grep 全仓无该形态(现存复合查询都是 `(pointer: coarse), (max-width: 760px)` 形,如 `PiWebApp.ts:169/200`、`AppPanelEdgeControl.ts:233`,守卫可解析)。判定:**TRUE**(守卫盲区),当前无活体违规。

### 5.〔TRUE · 低,潜伏〕守卫对"同组选择器的成员被部分覆盖"不可见

证据:守卫把抛升的选择器串整体匹配后置基线;粗指针抛升 `.a, .b { min-height: 44px }` 之后、基线单独重声明 `.b { min-height: 36px }` 的覆盖查不到。我按"组内逐成员匹配"探测 HEAD:无活体违规。判定:**TRUE**(盲区),潜伏。(3/4/5 合起来构成该守卫的已知盲区清单;无一处今天咬合,故均为低。)

### 6.〔TRUE · 低〕offline+unread 复合行:角点紫色、rail 红色——代码记录了例外,changeset errata 只记录了另一条例外

证据链:

- `pi-web-plugins/machines/browser/MachineList.ts:159`:offline/error 机器把工作点置 `undefined` 但**保留 unread**("Unread survives offline");
- `pi-web-plugins/machines/browser/activityBadge.ts:35`:`markKind = kind ?? (present ? "unread" : "idle")` → 纯 unread 行渲染 `.activity-indicator.unread` 紫点(无环,`:36-37` ringClass 需 kind 与 unread 同时在场);
- `src/client/src/components/shared.ts:439`(紫)与 `:456`(machine-status danger,更后)→ rail 红、角点紫。

`:453-455` 注释明确 "health outranks unread on a row that is both"——代码侧是**有记录的故意例外**;但 `.changeset/banner-retirement-model.md` 的 ERRATA 只记录了"online 行 rail=success 而状态点读 online"这一条例外,offline+unread(点紫/rail 红)未入 changeset。最小失败场景:一台 offline 且有未读会话的机器,扫描距离读红、凑近读紫,与 "the rail wears the very colour the row's dot wears" 的字面承诺冲突,而 round-17 triage 的决策 2 没有写这个岔口。判定:**TRUE**(文档漂移;代码行为本身有注释背书,不算行为缺陷)。

### 7.〔TRUE(事实)· 低/观察〕同一 "unread" 语义两种直径:机器 6px、会话 8px

证据:`shared.ts:395` `.activity-indicator { width: var(--pi-dot-sm) … }`(6px,machines/workspaces 的 unread 沿用此尺寸)vs `src/client/src/components/sessionStateBadgeStyles.ts:29` `.session-state { width: var(--pi-dot-md) … }`(8px,会话 unread)。round-18/25 已把两套词汇的 unread **颜色**统一为紫(`:468`),但同一导航面板相邻两节(机器节在上、会话节在下)的 unread 标记直径仍是 6 vs 8。判定:事实 **TRUE**;是否算缺陷属设计取舍——两词汇各自内部自洽,"跨词汇同语义不同尺寸"是否接受需 owner 裁决(此条含推测成分,已标注)。

---

## 明确的"干净"结论(逐项查过、未发现问题的声明)

以下各点均按 file:line 核对过,本轮**未发现**缺陷;按任务要求显式声明,而非留白:

- **自更新 banner / error-dismiss 粗指针地板次序**(round-17/18 的旧案):`PiWebApp.ts` 基线 `:198`(`.self-update-banner button`、`.error .error-dismiss`)在 `:200` 粗指针块之前;块后仅有 `.skip`/`.state-dot` 两条不同选择器规则,无回退。守卫复扫亦无违例。
- **bannerHold 1.5s 与新生命周期的交互**(hunt list 项):替换自带新 hold/expiry(PiWebApp.ts:3897-3904)、reader dismiss 后同文重抛重新武装(:3862-3875 重置 lastScheduled 对)、clearTransientError 清定时器并重置 schedule 标记(:1078-1092)、hold 期间清屏重置标记(:3881-3893)。静态推演四个序列(替换/成功 disproved/读者 dismiss/同批重抛)均自洽,未发现竞争窗。
- **rail 调色板 vs 点调色板**(除发现 6 的已记录例外):purple/success/accent/warning/danger 逐条对上(`shared.ts:439-456` vs `sessionStateBadgeStyles.ts`、`shared.ts:461-475`);arbiter 单点保证(`sessionRowIndicator.ts:39-49`)与"词汇分裂"注释一致;`.unread-ring` 复合行的 rail 取被环点颜色,注释与 `renderActionActivityIndicator` 实现一致。
- **tiles 角标推导**:fine(6+32+4+8+4=54px 储备 vs 实占 50px)与 coarse(4+36+4+8+4=56 vs 实占 52)两侧推导自洽(`shared.ts:299-300, 306-312, 341-343`)。
- **boxModelGuard 的 border:0 豁免回溯坑**:正则 lookahead 已修正(`boxModelGuard.test.ts:24-25`),抽查 `.error .error-dismiss`、`.compact-working`、`.load-retry` 等 floor+padding 规则均带 box-sizing。
- **machineIdFromUrl 契约**:`transportHealth.ts:27-38` 取首个 `/machines/` 段、解码失败回退原文不抛;`http.ts` ok/!ok 两路都上报可达、!ok 无 body machineId 时回退 URL 推导(:44-66);"page" 语义与 `appState.ts:130-131` 注释一致;`clients.ts:108` 本地状态走 `api/pi-web/status`(不 scoped)与"web 200 不为任何机器作证"的设计一致。
- **`--pi-list-word-heading-display` 继承链**:ContextSwitcherSheet.ts:93 设在 `.sheet-body` 上、经自定义属性继承穿透插件列表影子根,手机面板默认隐藏、sheet 内显式取回,且 ≤760px 媒体查询与 sheet 的手机场景一致。
- **round-25 relays 嵌套 media 的坏地板**:已在 2851f3fb("floors that fire")修复为平铺块(`relaysPanelElement.ts:526-530`),不再列为发现。
- **audit-uiux-full 的 contextSheet 触发器**:`scripts/audit-uiux-full.mjs:50` 为 20×250ms 有界轮询,与 triage 承诺一致。
- **MachineSwitcher 删除残留**:全仓 grep 无 `MachineSwitcher|machine-switcher` 引用;`AppNavigationPanel.ts` 的孤儿 CSS 已随 b0bce2a0 移除,audit 触发词里的 "Switch" 幻影已改。

## 报告外的话(不计入发现)

- machines 与 workspaces 两插件的 `activityBadge.ts` 逐字节相同(已 diff 验证)——是"自足插件"路线的代价,色板再改第三轮时是第三个要同步的地方,提示一下存在即可。
- 工作区含未跟踪的 CHECKLIST.md、scripts/review-*.workflow.js 等(round-31 开场产物),未纳入审查范围。
