# Round F · Lane A(手机端全程 + Round E 修复波验证)报告

配置:live 8505 栈,Playwright(headless Chromium),手机 393×850 hasTouch/isMobile/dpr2 + 桌面 1280×850;全部数字来自 evaluate 读 computed style / boundingRect,截图在 /tmp/roundf-shots/。交付检查:dev server 字节 vs 源码(主 bundle `assets/index-DQ2dW-Rw.js` 与 goals 插件 bundle `?v=sha256:65e6397f…`)。

## 0. 结论

**Round E 修复波(b2f826b5)的两项修复全部到达读者**(goals hover、bare-small 四产线全部 11px 实测);**但该修复波自身引入 1 个新 TRUE**(ActionPalette 漏右括号——与本 commit 修掉的 goals 多余括号是同一类缺陷),外加 1 个新 TRUE(行菜单面板项无按压态)。**新 TRUE > 0,循环继续。**

---

## 1. Round E 修复波验证 — 全部到达读者

### 1.1 Goals refresh hover(多余右括号已除)✅
- 源码:`pi-web-plugins/goals/goalsSectionElement.ts:22-25`,括号恢复平衡;交付:插件 bundle 内含 `@media (hover: hover) { .refresh:hover { color: var(--pi-text); background: var(--pi-surface-hover); } }`。
- 读者实测(桌面 1280):rest `color: rgb(139,145,155) / bg transparent` → hover `color: rgb(230,232,236) / bg rgb(27,32,39)`(= --pi-surface-hover)。截图 desktop-goals-hover.png。
- CSSOM(goals section adopted sheet):16 条顶层规则,`.refresh:hover` 正确位于 hover media 内,`.refresh:active` 存在——无括号吞规则残留。手机粗指针下 refresh 实测 44×44(触摸下限)。

### 1.2 bare <small> 家族 → --pi-text-2xs(11px)✅ 四产线全中
| 产线 | Round E 实测 | 本次读者实测 | 证据 |
|---|---|---|---|
| ActionPalette 选项描述 | 11.67px | **11px**(33 选项、43 个 small) | phone-palette.png / desktop-palette.png |
| AutocompleteMenu 描述行 | 10px | **11px**("/status" 命令菜单,2 项,rf-slash2.png) | 实测 `fs: 11px` |
| shared 列表脚注(Updates footer "running 1.202609.18 · installed …" + 导航路径 small) | 10.83px | **11px**(rf-panel-updates.png) | shared.ts:172 规则,导航行路径 small 同为 11px |
| ChatView `.custom-card-unknown small, .part > small` | 11.67px | **11px**(Standing-instruction 会话中存在真实 `div.part.custom-card.custom-card-unknown`;在其内注入探针 small 测得 11px 后移除——合成 DOM 探针,已披露) | 规则位于 ChatView.ts:283,bundle 内字节核对一致 |

**bare-small 类(E-1)关闭。**

---

## 2. 新 TRUE(两项,均不在 owner-deferred 账本)

### 2.1 TRUE-1:Round E 修复波在 ActionPalette 漏掉了 `.options button` 的右括号 — 一条修复行吞掉了后续 5 条规则
- **源码**:`src/client/src/components/ActionPalette.ts:114` — 该行以 `…text-align: left; ` 结尾、**无 `}`**;`:115` 是插入的 `.options button small { font-size: var(--pi-text-2xs); }`。对比 b2f826b5 diff:原行尾的 `}` 在替换时被删掉。**与本 commit 修掉的 goals 多余括号同类**。
- **交付**:主 bundle 内字节与源码一致(`…text-align: left; \n .options button small {…}`)。
- **浏览器 CSSOM(ground truth)**:adoptedStyleSheets 规则树显示 `.options button` 之后的所有规则都成为其嵌套规则:
  ```
  .options button
    & .options button small
    & .options button.selected
    @media (hover: hover)
      & .options button:hover:not(:disabled)
    & .options button:disabled
    & .options button.disabled.selected
    & .main / & strong / & small / & .disabled-reason / & .group / & kbd / & .empty
    @media (pointer: coarse)
      & kbd
      & .options button        ← 嵌套 → 无按钮套按钮,死规则
  ```
- **读者实测伤害**(手机+桌面):
  1. **选中高亮死亡**:option[0] class="selected",computed `background-color: rgba(0,0,0,0)`(设计为 --pi-selection-bg)。键盘/初始选中项失去视觉(phone-palette.png / desktop-palette.png 中第一项无高亮)。
  2. **hover 死亡**(桌面):鼠标悬停 option[2] 250ms 后 bg 仍 transparent。
  3. **粗指针单列覆盖死亡**:coarse 下 computed `grid-template-columns: 315px 0px`、column-gap 12px — 每个选项行多出一条 0 宽轨道 + 12px 幽灵列间隙,标题可用宽度比设计少 12px(设计 = 单列 minmax(0,1fr),源码 :132)。
  4. **空态死亡**:搜索无结果时 "No actions found." computed `padding: 0px; text-align: start`(设计 = space-9 + 居中,ActionPalette.ts:127)。
  5. `:disabled { opacity }`(:118)与 `.disabled.selected`(:119)在 CSSOM 中已死;当时面板 33 项中 0 项 disabled,无活的受害者可拍——死规则本身由 CSSOM 证明。
- **仍然存活的**:11px small(`& small` 后代匹配——修复的目标"意外"达成)、`.group` 12px、coarse kbd display:none、`button:active` 按压(在括号丢失行之前,实测按压 bg rgb(27,32,39) ✓)。
- **裁定:TRUE**(新缺陷,修复波引入;一条 `}` 关闭)。修复 = 恢复 :114 行尾的 `}`。

### 2.2 TRUE-2:行菜单面板项(Archive/Rename/…)在触摸设备上无按压反馈 — 按压态家族扫描的漏网产线
- **拥有规则**:`src/client/src/components/shared.ts:488-493` — `.action-menu-panel button` border 0、bg transparent、coarse min-height 44px;唯一状态规则是 `@media (hover: hover) … :hover`(:490)。**全样式表无 `.action-menu-panel button:active`**(shared.ts 仅 :253/:818 两处 :active,均不含它)。
- **读者实测**(手机,按下保持 250ms 中读取):`document :hover` 命中该项、computed `background-color: rgba(0,0,0,0)` — **按下无任何视觉反馈**(rf9-rowmenu-press.png;面板几何:panel 207.5..382,1px rgb(58,66,78) 边框、radius 2px、pad 4px、四项均 44px 高 — 面板本身干净)。
- **家族对照**(同一栈同轮实测):会话行按压 rgb(27,32,39)(shared.ts:253)、⋯/Clean up/bulk 按压(shared.ts:818)、ActionPalette 选项按压 rgb(27,32,39)(ActionPalette.ts:104 的 `button:active`)。Round B 曾宣称按压家族"complete per lane B's stylesheet scan",但 roundb-lane-b.md:39 的清单只覆盖了 `.action-menu-toggle`(⋯ 触发器),面板项从未在任何一轮被覆盖。
- **裁定:TRUE**(新;一条 media 规则关闭:`@media (pointer: coarse) { .action-menu-panel button:active { background: var(--pi-surface-hover); } }`)。推测性备注(标明为推测):真机上 `-webkit-tap-highlight-color` 可能部分遮盖;但本项目扁平语言以 :active surface-hover 为按压反馈的既定契约,其余全部同类产线均有。

---

## 3. Owner 四大抱怨 + New-session 专项 — 复测(全部维持关闭/挂账)

1. **对齐**:导航列单左缘 x=10(compact-scope 10、h2 10、搜索 10、格容器 10、goals 宿主 10),右缘统一 383(+New session 267.3+115.7=383、fold 右缘 383、行卡 10..383);聊天列 6..387(消息卡 x=6 w=381、composer 内容 6);sheet 单左缘 19(标题 19、行 19、close 右缘 374=393-19 对称);switcher 10-11(search 10..383、分区标签 x=11、create 瓦片 11..382、CTA 11..382);Appearance 卡 x=12/200.5 左右各 12。瓦片/行内按钮 x=13 = Round E 已记录的"格 10、钮 13,观察不立案"3px 光学内缩,维持不立案。
2. **留白节奏**:Sessions 标题行 gap 实测 25.9/25.9/25.9(bulk 93.7..137.7→cleanup 163.6→241.4→+New 267.3,均匀)——与 Round B/D/E 完全一致,**touch-density 挂账不变**。会话行 58px 高、16px 步进(159/223/287);消息 rhythm mb 16px/pad 12 均匀。Files 工具栏右缘 385 vs Tasks/Relays 381 — 属挂账"Files vs Tasks/Relays toolbar rhythm",不变。
3. **按钮边界**:Files Upload/Refresh(44px、1px rgb(58,66,78))、Tasks Refresh/Open Terminal、Relays Refresh、Terminal + Shell、compact Settings/Actions 行(44px、1px 边框)、Appearance 主题卡(1px,选中卡提亮 rgb(139,145,155))、+New session(accent 填充)、行菜单面板(1px 边框)——全部可辨。关闭维持。
4. **fold 按钮**:compact header h=49,fold [339,2,44,44],radius 2px,边框 1px rgb(58,66,78),上方呼吸 2 / 下方 3(49-46)— 与 Round E 数字逐位相同;方角方阵中无圆形。**关闭维持**(rf-drawer.png)。
5. **New session 居中**:空会话 `.empty-session` 盒 118..642.8(滚动器 94..658.8),标题+CTA 簇上方 217.9 / 下方 217.9 — **死居中**(机制同 Round E,对称性是判据);桌面主区空态 leftGap 241.3 = rightGap 241.3(-margin:auto 两边相等,UA `<p>` 14px 备注维持 FALSE-as-defect);switcher create 瓦片内容居中(Round A 修复维持);Tasks/Relays 虚线空态居中(Round B/D 机制,viewer 中心 ~482 一致)。

## 4. 账本交叉核对

- 挂账各项本轮未发现恶化或翻案:标题节奏 25.9(挂)、跨列 10↔6(+桌面 16)契约(挂)、settings indent/Save 折下/create 表单三态/pill badges/workspace 四缘(未再重推,无矛盾证据)。
- **E-2(leading 字面量,挂账项)重计数**:off-ramp 字面量 44 → **33**(1.4×12、1.3×9、1.35×7、1.2×4、1.5×1;ramp 值 1.45×12、1.25×5 合规)。仍开放,数值缩水但未关闭,维持挂账。

## 5. 探针副作用披露

仅在 test 工作区的探针会话间导航(未打开 'pi web' 协调会话);开合 drawer/sheet/switcher/palette/settings/行菜单;在 composer 草稿输入 "/status" 后退格清空(未发送);在 live custom-card part 内注入并移除一个探针 small;未触碰任何 Extension updates / AskUser 对话框。未修改仓库文件。

## 6. 底线

Round E 修复波**送达验证通过**(goals hover + bare-small ×4);但 **TRUE-1(palette 括号,修复波自伤,读者级选中/hover/粗指针单列/空态四项实测死亡)** 与 **TRUE-2(行菜单项无按压态)** 为账本外新 TRUE——**循环继续**,两项各一条规则/一个括号即可关闭。
