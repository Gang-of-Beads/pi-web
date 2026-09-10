# Round 27 — Lane A(几何与契约):pointer-query 顺序、box model、触控下限、级联与规则顺序、rail 优先级

审查范围:b0bce2a0 触及面 + round-17 面;只读审查,HEAD 00220101 之后(工作树起点 591b37e7)。
方法:通读 shared.ts(listStyles/workspacePanelStyles)、sessionStateBadgeStyles.ts、sessionRowIndicator.ts、PiWebApp.ts(appStyles/banner 渲染)、AppNavigationPanel.ts、SessionList.ts、AuthDialog.ts、QuickSwitcher.ts、SessionTreeNavigator.ts、AppPanelEdgeControl.ts、机器/工作区插件(MachineList/WorkspaceList/ProjectList/ProjectDialog/hostUi/activityBadge)、updates/info 裸模板面板;并用只读 node 脚本以放宽口径重放了 pointerQueryOrder 与 boxModelGuard 两条守卫(元素选择器、全部后续同选择器规则、反序媒体条件、跨规则拆分的 width+height+border)。

---

## 结论一览

TRUE 发现 7 条(1 条中危、6 条低危),全部集中在两条系统性 seam 上:(a) 插件 adopt 宿主样式的顺序是 [自身 static styles, interactiveSurfaceStyles, listStyles] —— 宿主表永远后到,同特异性下反向覆盖插件自己的声明;(b) 若干插件/宿主表内的控件从未拿到 coarse 44px 下限。另附 4 项"清白"裁定(扩展口径下无违规),供收敛轮记账。

---

## TRUE 发现

### 1.(中)ProjectDialog 的 button 基规则被 adopt 的宿主 listStyles 反向覆盖:font: inherit 永远不生效
- 证据:
  - pi-web-plugins/workspaces/browser/ProjectDialog.ts:376 — button { box-sizing: border-box; font: inherit; border: 1px solid … }
  - pi-web-plugins/workspaces/browser/hostUi.ts:35-40 — adoptWorkspacesHostStyles 把 [host.surfaceStyles, host.listStyles] 追加到 root.adoptedStyleSheets 之后;
  - Lit 3.3.3 ReactiveElement.createRenderRoot(node_modules/@lit/reactive-element/reactive-element.js)在 super.createRenderRoot() 内已先 adopt static styles,故最终表序为 [ProjectDialog 自身, interactiveSurfaceStyles, listStyles];
  - src/client/src/components/shared.ts:341 — listStyles 的 button { font: var(--pi-text-xs) var(--pi-font-ui); … }(0,0,1),表序在后 → 胜出。
- 最小失败场景:任一布局下打开 Add project 对话框,Cancel / Add project 按钮渲染为 --pi-text-xs(12px),而所有核心对话框(SessionRenameDialog 等,不 adopt listStyles)按钮渲染继承的基础字号——同一 app 里两类对话框按钮字号不一致;且宿主缺席(无 host 的裸挂载测试)时 font: inherit 生效,测试看见的行为与生产相反。
- 这条力已经被打过一次:ProjectDialog.ts:344-346 的注释(宿主表把每个 small 钳成一行,trust 链接被裁掉)就是同一覆盖顺序的实测结果——当时用更高特异性的 small.hint 修掉了 small,button 的 font 漏网。
- 裁定:TRUE。机制为 CSS cascade 事实(adoptedStyleSheets 表序),非猜测;影响是视觉一致性而非布局破坏,故定中低危之间的"中"。

### 2.(低)MachineList 的 .machine-primary { display: flex; align-items: baseline; gap } 是死声明;机器名换行、省略号永不触发,与相邻 workspace 行不一致
- 证据:
  - pi-web-plugins/machines/browser/MachineList.ts:147 — 同一元素同时挂 action-name machine-primary 两套类;
  - MachineList.ts:268 — .machine-primary { display: flex; align-items: baseline; gap: var(--pi-space-3) }(0,1,0);
  - src/client/src/components/shared.ts:363 — listStyles 的 .action-name { display: -webkit-box; … -webkit-line-clamp: 2; overflow-wrap: anywhere }(0,1,0),表序在后(同发现 1 的 adopt 顺序)→ display 被覆盖为 -webkit-box;
  - MachineList.ts:269 — .machine-primary-label 只有 min-width:0; overflow:hidden; text-overflow:ellipsis,缺 white-space: nowrap(对照它的原型 shared.ts:367 .workspace-primary-label 三件套齐全)。
- 最小失败场景:同一导航栏里,长 workspace 名单行省略号(shared.ts:367),长机器名却折成两行且可在词中任意断行(overflow-wrap: anywhere + 2 行钳制);MachineList 写下的 baseline 对齐与 gap 对单子元素全部失效。
- 裁定:TRUE(低)。视觉被 2 行钳制兜住,不会爆行高,但"同列兄弟列表同一角色两种排版"正是本项目"一致性是设计出来的"要拦的类。

### 3.(中)updates 裸模板面板的 Copy/Run 按钮在触屏上钉死 32px —— round-25"补下限"漏掉的兄弟
- 证据:
  - pi-web-plugins/updates/pi-web-plugin.ts:35-36 — Copy / Run 两个 button 无任何尺寸类;:96-114 面板自带 <style> 里没有任何 button 尺寸规则;
  - 该面板经 registry(registry.ts:480)作为 bare template 渲染进 workspace-panel 的 shadow root(WorkspacePanel.ts:47-51 selectedPanel.render(context));
  - 该 shadow root 的唯一 button 规则是 workspacePanelStyles 的 32px 基规则(src/client/src/components/shared.ts:166 min-height: var(--pi-control-height)),整个 sheet 没有 pointer: coarse 块;
  - 对照:round-25 已给 workspace-tasks(tasksPanelElement.ts:300)与 relays(relaysPanelElement.ts:526)各自补了 coarse 44 —— 它们是自带 shadow root 的 custom element,而 updates/info 是仅有的两个裸模板面板,info 无按钮,updates 漏了。
- 最小失败场景:手机(workspace-panel 可达的任一布局)打开 Updates 面板,推荐命令行的 Copy/Run 是 32px 高,同一屏上其余面板按钮都是 44px —— 与 round-25 修复 relays"refresh 钉 32px"完全同形。
- 同一 sheet 还决定了 workspace-panel 自己的 .workspace-fullscreen-toggle(WorkspacePanel.ts:48-57)在 coarse 平板(宽 >760、非 mobile 布局)上是 32px——本项目自己的约定(SessionList.ts:797 注释:floor 按 pointer 而非宽度,平板也要有)在此不成立。
- 裁定:TRUE。

### 4.(低)workspace 信任行的 checkbox label 没有任何触控下限:24px 高,夹在一排 44px 菜单按钮中间
- 证据:pi-web-plugins/workspaces/browser/WorkspaceList.ts:412 — .workspace-menu-trust label { display:flex; align-items:center; gap …; cursor:pointer },无 min-height;:413 checkbox 为 --pi-checkbox-size(24px,src/client/index.html:111)。
- 最小失败场景:手机上长按/⋯ 打开 workspace 行菜单,菜单项按钮 coarse 下 44px(shared.ts:488),同面板顶部的 Trusted 复选行可点高度只有 24px——AA 24px 恰好达标,但与面板内其余目标的 44px 约定不一致。
- 裁定:TRUE(低;AA 已达标,属一致性问题而非无障碍硬伤)。

### 5.(低)ProjectList 的 .load-retry 钉在 32px,无 coarse 提升
- 证据:pi-web-plugins/workspaces/browser/ProjectList.ts:263 — .load-retry { box-sizing: border-box; min-height: var(--pi-control-height); padding: 0 var(--pi-space-4) … };按钮本体 :160。该 sheet 无任何 pointer: coarse 块。
- 最小失败场景:手机上 projects 区加载失败(load-failed 态)出现 Retry,32px 高;同区 .section-add 在 coarse 下是 44px(shared.ts:271-273)、菜单按钮 44px。
- 裁定:TRUE(低)。

### 6.(低)同列兄弟列表的"角落状态点"内缩不一致:session 点 8px,机器/workspace 点 6px
- 证据:
  - src/client/src/components/SessionList.ts:732 — .action-main .session-state { position:absolute; top:50%; right: var(--pi-space-4); … }(space-4 = 8px,index.html:33);
  - src/client/src/components/shared.ts:389 — .action-activity { position:absolute; top:50%; … right: var(--pi-space-3); … }(space-3 = 6px)。
- 最小失败场景:导航栏里 machines/workspaces 列表的活动点与 sessions 列表的状态点上下相邻,同一语义的角落标记在两列间错位 2px;扫描时读作两套栅格。
- 裁定:TRUE(低)。两套 vocabulary 各有一个生产者,值相近但不同源——正是"同一个症状出现两次就该枚举生产者"的那类。

### 7.(低)listStyles 宣称共享的搜索行,最大的列表没在用:SessionList 私有一份 .session-search 孪生
- 证据:
  - src/client/src/components/shared.ts:240 — 注释:Search affordance shared by the lists that have one, so a second list does not drift from the first;
  - 三个插件列表都用 .list-search(MachineList/WorkspaceList/ProjectList),但 SessionList.ts:783-791 重新声明了 .session-search/.session-search-input/.session-search-clear,SessionList.ts:799-800 还把 coarse 下限再写了一遍;SessionList 明明 import 了 listStyles(SessionList.ts:692)。
- 最小失败场景:未来任何人调 .list-search 的 sticky 偏移、z-index 或 coarse 高度,sessions 列表(最长、最常扫的列表)静默不跟随——注释承诺的"不漂移"只在插件侧成立。
- 当前值逐字相同,无现行偏差;属漂移风险而非现行 bug。
- 裁定:TRUE(低;若 owner 认为 sessions 搜索行刻意独立,请在 shared.ts 注释里写明豁免,消除半真的注释)。

---

## 清白裁定(扩展口径核查,供收敛轮记账)

- pointerQueryOrder 扩展重放(把选择器文法放宽到元素/组合选择器、比较媒体块后所有同选择器规则、匹配 (min-width…) and (pointer…) 反序条件):全树(src/client/src + pi-web-plugins)无现行违规。round-26 记录的"文法盲区、暂无案例"在更宽口径下仍然成立。已 eyeball 过 AuthDialog.ts:275(input/header button 元素选择器)、QuickSwitcher.ts:515(input)、SessionList.ts:696(h2)——均无后续同属性基规则冲突。
- boxModelGuard 跨规则重放(同一选择器的 width+height+border 或 floor+padding 分散在多条规则、且任何一条无 box-sizing):全树无违规。AppNavigationPanel 的 .header-icon-action(尺寸与 border 分属两条规则)因 box-sizing 在尺寸规则内而清白。
- rail 表与 dot 仲裁一致:sessionRowIndicator.ts 的优先级(asking > running > unread > error > background > idle)与 shared.ts:439-456 的源顺序在每个可实现组合上一一对应(单点保证使 error/asking 的表序差不可实现);两个已写明的例外(selected/archived 行类 0,2,0 胜出,shared.ts:457-458;机器 health 压过 unread,shared.ts:456)均有注释;机器 unknown 状态无 rail 与其 muted 点色一致。批量选择的 .bulk-selected(shared.ts:443 注释所记)确实只在 SessionList,注释如实声明"co-owned, not table-exhaustive"。
- 自更新横幅与错误横幅的 coarse 下限顺序正确:PiWebApp.ts:199(基)→ 200(coarse),.error .error-dismiss 同理 190 → 200;round-18 记录的"真正落地"与代码相符。
- 文档 vs 代码:.changeset/banner-retirement-model.md、.changeset/round-eighteen-audit.md、review-triage-uiux-round17/18/19.md 的可核查声明(死 coarse floor、守卫首规则、unread rail 行类移除、compact 面板单机器列表 AppNavigationPanel.ts:165 与 213 两个互斥分支各渲染一次)均与代码一致,未发现几何侧的文档漂移。孤儿 CSS 复查:AppNavigationPanel/MachineList/WorkspaceList 无无主类(round-18 声明属实)。
- 会被其他 lane 认领而未列入:rail 的 machine-status danger 规则属 round-26 已记账项;pointerQueryOrder 元素选择器文法盲区属 round-26 已记录的潜在项(本轮仅复核无案例)。

## 推测(明确标注)
- 发现 1/2 的"作者本意"是从声明内容(font: inherit、ellipsis 三件套)推断的,未经作者确认;机制本身(覆盖发生)是 cascade 事实,不属推测。
