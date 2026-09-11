# Round G · Lane A — Round F 修复波(400c4c63)双项复核 + 四投诉快扫

- 复核对象:commit `400c4c63`(Round F fix wave,两项);基线分支 `refactor/plugin-architecture`,HEAD `654fdc15`。工作区 client 源码与 HEAD 一致(仅 AGENTS.md/package.json 有无关改动),dev 栈 8505(Vite dev 直出源码)即为修复后字节。
- 方法:Playwright(chromium,repo node_modules)真机仿真——手机 393×850 `hasTouch+isMobile` dpr2(`matchMedia('(pointer: coarse)')=true`、`(hover: hover)=false` 实测),桌面 1280×850(coarse=false、hover=true)。间距/颜色全部 `getBoundingClientRect` + `getComputedStyle` 实测;按压态用 mouse-down-hold ≥350ms 读 computed background + `matches(':active')`(Round E lane A 同法);CSSOM 用 adoptedStyleSheets 遍历证明规则"送达且活着"。探测脚本与截图仅写 /tmp,未改仓库文件、未重启栈。
- 参照账本:docs/design/research/roundf-lane-c.md(§2 括号回归、§5 四投诉、§6 空态居中)、roundf-lane-a.md(T-E1 菜单条目按压态裁定)、rounde-lane-a.md。

## 0. 结论

**两项修复全部在 reader 级证实到达,四投诉快扫零新违例 → 收敛门槛达成:本轮 ZERO new TRUE。**

---

## 1. Item 1 — ActionPalette.ts:114:`.options button` 规则闭合括号恢复

### 1.1 代码级
- `src/client/src/components/ActionPalette.ts:114` 现为完整规则,行尾 `}` 在位:
  `.options button { display: grid; … border-bottom: 1px solid var(--pi-border-muted); text-align: left; }`
- 修复 diff(git show 400c4c63):唯一改动就是补回该行行尾 `}`;Round E 波(b2f826b5)插入 `small` 家族规则时吞掉了它,与 Round F triage(654fdc15)描述一致。
- 其后各规则行号::115 `small → var(--pi-text-2xs)`、:116 `.selected → var(--pi-selection-bg)`、:117 `@media (hover:hover) :hover:not(:disabled) → selection-bg`、:118 `:disabled → opacity var(--pi-disabled-opacity)`、:119 `.disabled.selected → color-mix`、:130-133 coarse 下 `kbd{display:none}` + `.options button` 单列覆盖。

### 1.2 CSSOM(送达证明)
action-palette shadow adoptedStyleSheets 顶层实测(两 viewport 同):`.options`、`.options button`、`.options button small`、`.options button.selected`、`.options button:hover:not(:disabled)`、`.options button:disabled`、`.options button.disabled.selected`、coarse 媒体下的 `.options button`(单列)——**全部活着,无死嵌套**(Round F 的病症是这些选择器全部塌进死嵌套,见 roundf-lane-c.md §2)。

### 1.3 手机 393×850 reader 级(action palette,21 条 option 行)
| 检查 | 实测 | 判定 |
|---|---|---|
| 选中行(`.selected`,aria-current=true,首行 "Focus prompt") | bg **rgb(13, 40, 71)** = `--pi-selection-bg`(#0d2847,index.html:163) | ✅ |
| 未选中行 | bg rgba(0,0,0,0)(透明,行间 1px hairline 分隔) | ✅ |
| 描述 smalls(含 `.group`、`.disabled-reason`) | **11px** 全量 = `--pi-text-2xs`(index.html:39);色 rgb(139,145,155) muted / 禁用原因 rgb(210,153,34) warning | ✅ |
| 禁用行("New session",`disabled` + 禁用原因) | **opacity 0.55** = `--pi-disabled-opacity`(index.html:114) | ✅ |
| kbd 徽标(coarse) | `display: none`(:130-132 覆盖在 CSSOM 内) | ✅ |
| 行高/几何 | 首行 351×70 @ (21,156),标题 14px,行内两列塌为单列(coarse 覆盖生效) | ✅ |

截图:/tmp/roundg-phone-palette.png(全量列表)、/tmp/roundg-phone-palette-arrowdown.png。

### 1.4 桌面 1280 reader �级
| 检查 | 实测 | 判定 |
|---|---|---|
| 选中行 r0 "Focus prompt" | bg **rgb(13, 40, 71)** | ✅ |
| hover 未选中行(r1 "Configure provider authentication") | `:hover=true`,bg **rgb(13, 40, 71)**(:117 hover 通道用 selection-bg,与手机按压不同通道——见 §4 观察) | ✅ |
| 禁用行 | opacity **0.55**;`:hover:not(:disabled)` 把禁用行排除在 hover 高亮外(:117) | ✅ |
| kbd(fine) | `display: block`,快捷键徽标可见 | ✅ |
| smalls | **11px** | ✅ |

截图:/tmp/roundg-desk-palette-hover.png(可见选中行与 hover 行同为 selection-bg 深蓝,11px 描述、kbd 徽标在位)。

### 1.5 键盘 ArrowDown(修复的主症状:键盘用户看不见选中项)
- 桌面洁净路径(焦点在搜索输入框,不碰鼠标):连按 3 次 ArrowDown → selectedIdx **1 → 2 → 3**,"Focus prompt"→"Configure provider authentication"→"Remove provider authentication"→"Select theme";每步 `.selected` 行 bg = rgb(13,40,71),`aria-current` 同步跟随。**✅ 高亮随键盘走。**
- 一次"卡在 1"的假象已裁定为 FALSE(非回归):先用 mouse-down 按过某行后,焦点落在行按钮上,`handleKeyDown` 对来自原生激活控件(keyboardEventOriginatesFromNativeActivationControl,keyboardEventTarget.ts:12-16)的按键让位——"focused native buttons keep their own semantics"(ActionPalette.ts:78-82 注释原话),此时方向键交还按钮自身语义,by design。洁净路径(焦点在输入框)三次全部正确移动。
- 截图:/tmp/roundg-desk-palette-arrowdown.png。

### 1.6 第二块面板:Quick switcher(quick-switcher,独立组件,自带 `.row` 规则,未被 Round E/F 波触及)
| 检查 | 实测 | 判定 |
|---|---|---|
| 选中会话行(先真实激活会话 "Gree" 再开 QS) | `.row.session-row.selected` bg **rgb(13, 40, 71)** + border **rgb(88, 166, 255)** = `--pi-accent`(QuickSwitcher.ts:447) | ✅ |
| 桌面 hover 未选中行 | `:hover=true`,bg **rgb(27, 32, 39)** = `--pi-surface-hover`(QuickSwitcher.ts:430) | ✅ |
| 静息瓦片 | rgb(19, 22, 27) = `--pi-surface`(index.html:147) | ✅ |
| 禁用(+ New session,未选工作区) | opacity **0.55**,叠加 selection-bg 底(QuickSwitcher.ts:445 对 create-row 恒定染色,禁用时靠 0.55 变暗——by design,非新发现) | ✅ |
| 副标题 | **12px** = `--pi-text-xs`(index.html:40)——QS 全文无 `<small>` 元素;"11px smalls"主张属于 action palette(§1.3/§1.4 已测 11px) | ✅(by design) |
| 键盘 | QS 设计为 Enter 开首条匹配(QuickSwitcher.ts:294-300 注释),无 ArrowDown 导航——任务所述 ArrowDown 属 action palette,已验 | ✅ |

截图:/tmp/roundg-phone-qs-selected.png(选中行深蓝+accent 描边)、/tmp/roundg-desk-qs-hover.png(hover 步进)。

**Item 1 判定:修复到达 reader,双面板双指针全绿。**

---

## 2. Item 2 — SessionList.ts:818:action-menu-panel 条目加入 coarse 按压态家族

### 2.1 代码级 + CSSOM
- `src/client/src/components/SessionList.ts:818`(coarse 媒体块内):
  `.action-menu-toggle:active, .action-menu-panel button:active, .cleanup-entry:active, .bulk-select-entry:active, .action-main:active { background: var(--pi-surface-hover); }`
  —— 400c4c63 的 diff 正是往这条规则里插入 `.action-menu-panel button:active`。
- reader 端 session-list shadow 的 adoptedStyleSheets 实测命中:
  `[coarse] .action-menu-toggle:active, .action-menu-panel button:active, .cleanup-entry:active, .bulk-select-entry:active, .action-main:active -> background: var(--pi-surface-hover)` — **规则送达**。
- 基础态:shared.ts:489(panel button bg transparent、border 0)、:490(hover:hover → selection-bg,手机 hover:none 不适用)、:493(coarse 44px 地板)。

### 2.2 手机 393×850 reader 级(打开会话行 ⋯ 菜单,mouse-down-hold 350ms,identity-tag 测量)
| 条目 | 静息 bg | 按住 350ms | `:active` | 判定 |
|---|---|---|---|---|
| "Archive session"(pb0) | rgba(0,0,0,0) | **rgb(27, 32, 39)** = `--pi-surface-hover`(#1b2027,index.html:148) | **true** | ✅ |
| "Give this session a name…" (Rename,pb1) | rgba(0,0,0,0) | **rgb(27, 32, 39)** | **true** | ✅ |
| 条目几何 | min-height **44px**(coarse 地板,shared.ts:493),面板 164.5px 宽、1px 边框、面板底 `--pi-surface` | | | ✅ |
- 视觉确认:/tmp/roundg-phone-menupress-archive.png——Archive 条目呈现明确的表面步进,同面板其余条目保持纯黑,与 rgb(27,32,39) 实测一致;这正是 Round E lane A 判 TRUE 时缺失的那个状态(T-E1)。
- 裁定过程记录(透明度):第一轮用 CDP `Input.dispatchTouchEvent` 按压,事件送达(pointerdown:touch/touchstart 监听器确认)但 `:active` 不engage——改用 Round E 同款 mouse-down-hold 后一次通过;桌面/触摸两通道差异为仿真器行为,非产品问题。
- danger 条目("Delete archived session")仅存在于 archived 行的本行菜单,本次非 archived 行不含该条;其颜色走 `.action-menu-panel button.danger`(SessionList.ts:751)与同一条 `:active` 规则覆盖,如实记录未单独实测。
- 释开方式:按住测量后移开指针再释出,菜单经"点外关闭"收起,**没有任何菜单动作被真实触发**(无 Archive 确认框、无 Rename 输入框出现,会话列表原样)。

**Item 2 判定:修复到达 reader,rgb(27,32,39) 实测成立。**

---

## 3. 四投诉快扫(对照 Round F 账本数字)

| # | 投诉 | 本轮实测(手机 / 桌面) | Round F 账本 | 判定 |
|---|---|---|---|---|
| 1 | 对齐/单一阅读边 | 手机:Sessions 标题行 left **10**、行组 [Sessions 10..67.8] [bulk 93.7..137.7] [Clean up 163.6..241.4] [+ New session 267.3..**383**];桌面:Projects h2 16..324、search 16..324、Sessions h2 **16..324**、CTA right **324** | 手机 10..383、桌面 rail x=16 右 324 | ✅ 无漂移 |
| 2 | 留白节奏(标题行) | 手机标题行 gaps **[25.9, 25.9, 25.9]**;桌面 **[9.6, 9.5, 9.6]**(Clean up→+New session 恰为 9.6;9.5 为 32px 控件的亚像素取整,同族同值) | 手机 25.9 / 桌面 9.6 | ✅ 账本数字原样 |
| 3 | 按钮边界 | 手机 boot **4** 种可见按钮风格 + 会话态 **7** 种,桌面 boot **6** 种:alpha 0.02–0.5 边框 flag **0** 个,半径出 0–4/999 flag **0** 个 | 零 flag | ✅ 无新违例 |
| 4 | 折叠按钮(圆入方阵) | `.compact-fold` **44×44 @ (339, 2)**,49px compact-header 内 topGap **2**/bottomGap **3**(含 1px 线),radius **2px**,border **1px rgb(58,66,78)**,bg **rgb(19,22,27)** | 44×44 @(339,2) r2 1px #3a424e rgb(19,22,27) 2/3 | ✅ 逐位一致 |
| + | 空态居中(快扫附带) | 新建空会话后:手机 empty-session 盒 **381×524.8 @ (6,118)**,内容上 **217.9**/下 **217.9**,scrollH=clientH=525 无假滚动;桌面 **496.4×524.8 @ (357,118)**,上 **226.6**/下 **226.7**;textAlign center | 手机 381×525 @ (6,118) 217.9/217.9;桌面 496×525 @ (357,118) 226.6/226.7 | ✅ 机制原样(min-height:100% + auto margin) |

截图:/tmp/roundg-sweep-phone-boot.png、/tmp/roundg-sweep-phone-empty.png、/tmp/roundg-sweep-desk-empty.png。

---

## 4. 裁定为 FALSE / 观察项(如实标明,均非本轮新 TRUE)

1. **观察(非立案):action palette 行的触控按压色走 selection-bg 而非 surface-hover。** 手机上按住未选中 option 行:焦点落行 → `@focus` 置 selectedIndex → 行翻转为 `.selected`,bg = rgb(13,40,71)(`:active` 同帧为 true;`:host` 内 `.options button.selected`(0,2,1) 特异性压过 coarse `button:active`(0,1,1),ActionPalette.ts:107 的按压规则仍送达 CSSOM、在 header 关闭钮等非选中场景生效)。按压反馈存在且即时,颜色归属 owner 裁量;与 Round E 已闭环的"palette pressed"(v14c-01)同观察。
2. **裁定 FALSE:QS 副标题非 11px。** QuickSwitcher 无 `<small>` 元素,副标题 12px 是 `--pi-text-xs` 的 by-design 字号;"option description smalls at 11px"的落点是 action palette 描述行,两 viewport 实测均为 11px。
3. **裁定 FALSE:ArrowDown"卡住"。** 详见 §1.5——键盘焦点在行按钮上时列表键让位是 ActionPalette.ts:78-82 的显式设计;洁净路径(输入框焦点)1→2→3 全部正确。

## 5. 副作用披露(与 Round F 同类,全部无害)

- 探测浏览器内导航:选中 project "test" → workspace "test · main"(纯客户端状态,不落盘)。
- 打开既有会话 "Gree" 一次(验证 QS 选中行);两次通过 "+ New session" CTA 新建空会话各一(手机/桌面各一,与 Round F 披露的同类副作用),用于空态居中实测。
- 会话行菜单开合多次;按压-移开-释出未触发任何菜单动作(Archive/Rename/Reload 均未执行,无确认框产生)。
- 未修改仓库文件;未重启栈;探测脚本均在 /tmp(/tmp/roundg-probe-*.mjs、/tmp/roundg-lib.mjs、/tmp/roundg-sweep-fn.mjs)。

## 6. 截图清单(本 lane 产物,均在 /tmp)

- 手机:/tmp/roundg-phone-base.png、roundg-phone-palette.png、roundg-phone-palette-arrowdown.png、roundg-phone-palette-press.png、roundg-phone-qs.png、roundg-phone-qs-selected.png、roundg-phone-chat.png、roundg-phone-sessions-list.png、roundg-phone-menupress-1.png、roundg-phone-menupress-archive.png、roundg-phone-menupress-rename.png
- 桌面:/tmp/roundg-desk-base.png、roundg-desk-palette-hover.png、roundg-desk-palette-arrowdown.png、roundg-desk-qs.png、roundg-desk-qs-hover.png
- 快扫:/tmp/roundg-sweep-phone-boot.png、roundg-sweep-phone-empty.png、roundg-sweep-desk-empty.png
- 调试(裁定过程):/tmp/roundg-debug-hold.png、/tmp/roundg-debug-mousehold.png

注:/tmp 下另有 roundg-phone-napress-*、roundg-desktop-* 等文件为其他 lane 并行产物,不在本清单内。

## 7. 底线

Round F 两项修复(菜单条目按压态、palette 括号)双双在 reader 级证实;快扫四投诉 + 空态全部守在账本数字上。**本轮 ZERO new TRUE,收敛门槛达成,布局协调循环可收敛。**
