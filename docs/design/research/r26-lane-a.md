# 收敛第 26 轮 · Lane A 报告：几何与契约
（pointer-query 顺序、box model、touch floor、间距/字号字面量、级联与规则顺序陷阱、rail 优先级）

仓库：`/Users/hanxiao.du/Desktop/vincent/projects/pi-web`，分支 `refactor/plugin-architecture`，HEAD `3ec25d8d`。只读审查；本 lane 聚焦几何与契约，banner 生命周期语义归其他 lane。

**结论先行：发现 4 条 TRUE（2 条代码几何、1 条文档-代码漂移、1 条守卫覆盖面），3 条经核查判 FALSE（附理由）。三份几何守卫（pointerQueryOrder / boxModelGuard / controlHeightScale + dotScale / spacingScale / typeScale / radiusScale / tokenReferences）在 HEAD 实跑全绿。**

---

## TRUE 发现

### A1. [TRUE · low] SessionList 粗指针 checkbox 居中公式用的是 comfort(36)，而它要居中的 toggle 画的是 touch(44) —— 水平偏心 4px，注释承诺落空

证据（同一 coarse 块内两条规则互相矛盾）：
- `src/client/src/components/SessionList.ts:771`：`@media (pointer: coarse) { .subtree-toggle { top: 0; width: var(--pi-control-height-touch); height: var(--pi-control-height-touch); } }`
- `src/client/src/components/SessionList.ts:774`：`.session-checkbox { top: calc((var(--pi-control-height-touch) - var(--pi-checkbox-size)) / 2); left: calc(var(--pi-space-3) + (var(--pi-control-height-comfort) - var(--pi-checkbox-size)) / 2 + var(--depth, 0) * var(--pi-space-7)); }`，其上方注释（773 行）写明意图："centre it in the toggle box rather than leaving two leading controls a few pixels out of true"。

计算（token 取自 `src/client/index.html`：space-3=6、checkbox=24、comfort=36、touch=44）：
- 交互 toggle（coarse，继承 base left = gutter-start 6 + depth·12）：占 6..50，中心 x = 28+depth·12。
- checkbox（coarse）：left = 6+(36−24)/2 = 12，占 12..36，中心 x = 24+depth·12。
- **水平差 4px**：checkbox 落在 44px toggle 方块中心的左侧 4px。垂直方向（top=(44−24)/2=10，中心 22 = toggle 中心 22）是对齐的——同一规则里 top 轴用 touch、left 轴用 comfort，两个轴引用了两个不同的"槽宽"。

最小失败场景：手机（coarse 指针）上进入批量选择，且行有一棵**展开的**子树（interactive `.subtree-toggle`，`SessionList.ts:477`）→ checkbox 在淡色 44px 方块内明显偏左 4px，与 773 行注释承诺的"居中"相反。功能不受影响（checkbox z-index 3 高于 toggle 的 2，`SessionList.ts:751/755`），纯视觉契约破坏，属 "Consistency is designed, not corrected" 类。

### A2. [TRUE · low] `.subtree-toggle.inert` 的 (0,2,0) base 规则压过 coarse 块的 (0,1,0) 提升 —— inert 占位符在触屏上保持鼠标几何，coarse 楼层与 top:0 永远到不了它

证据：
- `src/client/src/components/SessionList.ts:755`：`.subtree-toggle, .subtree-toggle.inert { position: absolute; top: var(--pi-space-4); ... width: var(--pi-row-gutter-size); height: var(--pi-row-gutter-size); ... }` —— 对带 `.inert` 的元素，该选择器是 **(0,2,0)**。
- `src/client/src/components/SessionList.ts:771`：coarse 提升 `.subtree-toggle { top: 0; width: touch(44); height: touch(44); }` —— **(0,1,0)**，同属性但特异性更低，按源顺序也救不回来。
- `.inert` 元素真实存在：`SessionList.ts:472`（批量选择且子树折叠时渲染 `<span class="subtree-toggle inert">`）；coarse 下 `--pi-row-gutter-size` 被提到 36（`SessionList.ts:694`）。

结果：inert 占位符在触屏上渲染为 **36×36 @ top 8px**，而同列表的交互 toggle 是 **44×44 @ top 0**；checkbox（coarse top 10，中心 y=22）对 inert 方块中心（8+18=26）**垂直偏 4px**。780 行 `pointer-events: none` 保证不吞点击，所以是纯视觉，但 coarse 块（770-776 行）存在的目的恰恰是"批量选择时这两个前导控件对齐"，而它唯一必然出现的场景（选择模式）恰恰被特异性反噬。

最小失败场景：coarse 指针 + 批量选择 + 折叠的子树根行 → 同一屏里展开根的 toggle 是 44px 贴顶、折叠根的 inert 占位是 36px 下沉 8px，两行前导几何不一致，checkbox 各自偏离所在方块中心 4px。

旁证（把 A1/A2 连起来看更有说服力）：checkbox 的 **left** 公式（+6）恰好按 36px 槽推导（对 inert 方块完美居中），**top** 公式恰好按 44px 槽推导（对交互 toggle 完美居中）——同一个槽，两条公式各自只对一个变体成立。

### A3. [TRUE · low · docs] `operation-model.md` "已落地"清单对 timeout 行为的表述与代码及同文档"仍未做"清单自相矛盾

证据：
- `docs/design/operation-model.md`（"## Status: what landed" 段，约 128-130 行）： "**A timeout on a live link no longer claims the server did not answer — the banner stays down while the socket is alive.**"
- 同文档"Still open"段（约 146-150 行）："**Deadline does not consult liveness yet.** ... Wiring `errorNoticePatch`'s `link` argument to the socket's keepalive facts remains the open piece of consequence 2."
- 代码：`src/client/src/notice.ts:79` `noticeFromError(error, link = { live: false })`，`link.live` 为 true 时才返回 `NO_NOTICE`；而生产代码 **57 处** `errorNoticePatch(`/`noticeFromError(` 调用（`src/client/src/controllers/*.ts`、`PiWebApp.ts:1826/2056/2677/2928/3304...`）经逐点 grep 验证**没有任何一处传第二参**（多行调用也排除，仅定义本身跨行）。因此 `RequestTimeoutError` 恒走 transport 分支（`notice.ts:86-97`），横幅照常升起——只是措辞改写为 "A request timed out. Polls retry on their own." 并 6s 自撤，**不是"banner stays down"**。
- `docs/design/review-triage-uiux-round19.md` "Deferred with written reason" 也承认 "**link.live remains unwired** ... operation-model.md now says so in place" —— 但 operation-model 里"落地"段落那句仍然原样保留，读者先读到的是过度声明。

最小失败场景：新会话读者按"what landed"理解为"活链路上的超时不再出横幅"，实测 30s 超时仍会弹横幅（ albeit 自撤）——文档第一句与行为相反，需把 landed 段的这句改为与 Still open 段一致（或补上接线）。

### A4. [TRUE · low · 守卫覆盖面] pointerQueryOrder 守卫的选择器文法看不见**元素选择器**与**分组选择器**；两类形状今天都有真实提升点在跑（无现行违规，属潜伏盲区）

证据：
- 守卫文法 `src/client/src/components/pointerQueryOrder.test.ts:18`：`const SELECTOR = /(?:^|\})\s*(?<selector>[.#][\w-][^{}@]*?)\s*\{/gu` —— 首字符必须 `.`/`#`：
  - **元素选择器盲区**：现网 coarse 块确实在提升元素选择器 —— `src/client/src/components/PiWebApp.ts:170`（`@media (pointer: coarse), (max-width: 760px)` 内 `aside { display: none; }`）、`src/client/src/components/AuthDialog.ts:275`（块内 `header button`、`input`）、`src/client/src/components/QuickSwitcher.ts:514`（块内 `input`）。base `aside { display: flex; ... }` 在 `PiWebApp.ts:132`，今天顺序正确（132 < 168）；但若日后有人在 168 行之后加任何 `aside { display: ... }` base 规则，手机布局会重新出现桌面侧栏而守卫保持绿灯（`.shell.navigation-panel-collapsed > aside` 这类后代选择器也救不了 `display` 本身）。
  - **分组选择器盲区**：`src/client/src/components/ModelPicker.ts:295` 在 coarse 块内提升的是一整组 `.options > button, .catalog-row .pick`；守卫把整组文本当作一个选择器，后续 base 规则是单独的 `.options > button`（`ModelPicker.ts:303`）与 `.catalog-row .pick`（`ModelPicker.ts:313`），重复正则永远匹配不上。顺带：293-294 行注释宣称 "Declared after every base rule it raises"，而这两个 base 规则**在该 coarse 块之后**——注释与事实相反，今天两者不声明 `min-height` 才没有实际覆盖（我逐一核对过后置 base 的属性集，无交集）。
- 我用扩展版扫描（拆分组选择器 + 纳入元素选择器 + 交叉属性比对）对 `src/client/src` 与 `pi-web-plugins` 全量跑过：**0 条现行违规**，故判"潜伏盲区、无现行故障"。round-18 triage（`review-triage-uiux-round18.md` 第 2 条）称守卫"first-rule blind spot actually fixed"属实，但这两类文法盲区不在该修复范围内。

---

## 经核查判 FALSE 的怀疑（按 lane 规则逐条裁定）

### F1. [FALSE · 作为守卫盲区记录] boxModelGuard 不查 `max-width`/`max-height` + border；全库两处命中的形状各有另一条规则兜底，无可见故障

- 守卫正则 `src/client/src/components/boxModelGuard.test.ts:20-22` 只认 `width|min-width` / `height|min-height`，`max-*` 逃逸。
- 现网命中（我用含 `max-*` 的扩展扫描找出）：`src/client/src/components/ChatView.ts:306` `.chat-image { max-width: 100%; max-height: 320px; border: 1px solid ... }`（无本规则 box-sizing）——但该 img 同时带 `.part` 类，`ChatView.ts:382` `.part { box-sizing: border-box; ... }` 为同一元素补上 box-sizing，border 计入 100%，不会溢出 2px。`pi-web-plugins/files/fileViewerElement.ts:356` `.image-preview img { max-width: 100%; max-height: 100%; border: 1px solid ... }`（content-box）——容器 `.image-preview`（358 行）有 `padding: var(--pi-space-7)`(20px) + `overflow: auto`，2px 超出被 padding 吸收，永不触发滚动条。
- 裁定：无最小失败场景可构造，判 FALSE；记录为守卫覆盖面缺口（max-* + border + 无 box-sizing 的第三种形状，若日后脱离 `.part` 语境复用 `.chat-image` 会翻车）。

### F2. [FALSE · 有记录的设计意图] rail 与圆点在组合态下的优先级矩阵经全量核对自洽

- 会话行：arbiter（`src/client/src/components/sessionRowIndicator.ts:21-33`）保证每行恰渲染一个点；rail 六条 `:has()` 规则（`src/client/src/components/shared.ts:439-450`，全为 (0,1,0)）因此每行至多命中一条；`.session-state.idle`（灰）无 rail 规则 = 有意留白（shared.ts:419-425 注释与 round-17 决策 2 一致）。
- 机器/工作区行：`renderActionActivityIndicator`（`pi-web-plugins/machines/browser/activityBadge.ts:31-46`）每行至多一个 `.activity-indicator`；unread+工作复合态由 `.unread-ring`（非 `.unread` 类）承载，内层工作点决定 rail（shared.ts:429-433 注释所言与实现一致；`MachineList.test.ts:124-133` 钉死）。隐藏行不再误点亮 rail：无信号时 markKind 固化为 `idle`（activityBadge.ts:38-40 的注释正是为此）。
- `.action-row.selected`/`.archived`（(0,2,0)）压过所有点色规则 → "选中机器行 rail 蓝、工作点绿"——shared.ts:435-438 注释明确声明此为 (0,2,0) 有意优先，`SessionList.ts:744` 的 `.bulk-selected` 也被点名为共治成员。判定：文档已声明的取舍，非缺陷。
- `.activity-indicator.sending`（`shared.ts:455`，警告色）无 rail 规则——不可达：两份 `statusActivityKind`（`components/activityBadge.ts:17-24`、`pi-web-plugins/*/browser/activityBadge.ts`）均不返回 `"sending"`，唯一 sending 点在 pending 行（`SessionList.ts:325`），该行不是 `.action-row`、无 rail。shared.ts:456 注释已写明 "Painted on the pending-session row, which has no rail"。判定 FALSE（潜在缺口仅在未来有人给 plugin 列表传 `"sending"` 时生效）。

### F3. [FALSE · 已核实] QuickSwitcher 运行态三点标记在角菜单下方的"居中"未因三点变宽而破坏

怀疑：`.row-flag, .row-state { right: calc((var(--qs-menu-size) - var(--pi-dot-md)) / 2 - 1px) }`（`src/client/src/components/QuickSwitcher.ts:449`）按 8px 点宽推导，而 running 渲染的是三个 4px 点（约 16px 宽）。核查：外层 `.session-state.running` 盒仍为 `--pi-dot-md` 8×8（`sessionStateBadgeStyles.ts:29`），`.state-dots` 以 `place-items: center` **对称溢出** ±4px，盒中心=视觉中心=右缘补 -1px 后与菜单钮中心严格对齐（base：W−16=W−16；coarse 44：W−22=W−22）。中断标记 `.row-flag.interrupted` 是真 8px，同样对齐。判定 FALSE。

---

## 已验证为净的声明（clean lane 的构成部分）

1. **三份几何守卫在 HEAD 实跑通过**：`npx vitest run pointerQueryOrder boxModelGuard controlHeightScale`（3 files / 5 tests passed）与 `dotScale / spacingScale / typeScale / radiusScale / tokenReferences`（5 files / 8 tests passed）。
2. **round-19 第 1 条那类"样式表结构性断裂"不在树上**：对 `src/client/src` 与 `pi-web-plugins` 全部 `css\`` 模板做含插值/嵌套模板的括号配平扫描，全部闭合（round-19 之后无回归）。
3. **switcher 移除无残留**：`MachineSwitcher`/`machine-switcher`/`compact-switcher` 在 `src/` 与 `pi-web-plugins/` 全库 0 命中；AppNavigationPanel 自有样式表 24 个类逐一对照渲染体，无孤儿 CSS（round-18 第 3 条"orphan CSS removed"成立）。
4. **audit-uiux-full 的 contextSheet 触发**已是带界扫描（`scripts/audit-uiux-full.mjs:50`：20 次 × 250ms 有界轮询，命中真实 context 行按钮），与 round-17 决策 3 的描述一致。
5. **banner 自身的 coarse 楼层顺序正确**：`PiWebApp.ts:189`（base `.error .error-dismiss` 32px）在前、`PiWebApp.ts:199`（coarse 44px）在后，其后 200-201 行仅声明 color/background/border-color，不回退尺寸——round-17/18 反复翻车的"死楼层"形状在现有文件里不再出现（含 `.self-update-banner button`）。
6. **rail 的树形对话框同源**：`SessionTreeNavigator.ts:554/557` 用 `--pi-rail-width` 内阴影画选中/活动轨，token 同源（`index.html` 定义 --pi-rail-width: 3px）；round-19 所称 "30px 字面量改 token" 已核实（现文件 28-44px 控制字面量扫描为 0，守卫通过）。
7. **机器/工作区插件列几何单一生产者**：`MachineList/WorkspaceList/ProjectList` 的 `.list-search*`、`.action-menu-toggle`、`.section-add`、tiles 派生（`--pi-tile-menu-*`）全部只由宿主 `listStyles`（经 `adoptMachinesHostStyles`/workspaces 对应 hostUi 采纳）提供，插件自有样式表未重复声明被 coarse 块提升的选择器；带按钮的插件元素全部满足 tap-highlight/touch-action 契约（逐文件 grep 核实）。

## 附注（不计入 TRUE/FALSE 的观察）

- `machineIdFromUrl`（`src/client/src/api/transportHealth.ts:24-33`）用子串 `\/machines\/([^/]+)` 取机器名，理论上会被查询串里出现的 `/machines/x`（如文件路径 `?path=/repo/machines/foo`）在**无机器前缀的** URL 上误报 scope；现网所有携带文件路径的请求 URL 均以 `api/machines/<id>/` 开头（`clients.ts:229-260`、`plugins/workspaceFiles.ts:45`），首个匹配恒为真实 scope，故无可达故障。若未来出现 web 自有的带路径查询的请求，需先收紧该正则。
- 会话点与机器/工作区点在同一槽位内缩进不一致 2px：`SessionList.ts:732`（`.action-main .session-state` right: space-4=8px）vs `shared.ts:389`（`.action-activity` right: space-3=6px）。两词汇表共享行形状、菜单列与 rail，同为 8px 点。低危视觉漂移，若修建议统一到同一 token 表达式。**（这条我按 low/TRUE 保留，但修复优先级最低。）**
