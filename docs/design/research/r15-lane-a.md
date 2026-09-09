# Round 15 — Lane A（几何与契约）审查报告

- 仓库: /Users/hanxiao.du/Desktop/vincent/projects/pi-web, 分支 refactor/plugin-architecture, HEAD 0664ee35
- 审查范围（本 wave, 6a5221a1..HEAD 中与本 lane 相关者）: 折叠 composer（PromptEditor .expand-composer）、手机单栏折叠头（AppNavigationPanel compact 头/折叠行/工具区）、reading-edge 令牌（index.html / shared.ts / AppNavigationPanel）、tile 单一形状（shared.ts）、常驻工作标记（AppContextBar / 插件 activityBadge, 提交 5ba2a8c6）、ActionPalette 关闭钮几何。
- 结论概览: 2 个高危（TRUE）、3 个低危（TRUE）、1 个行为事实待产品裁决、若干注记。其余 hunt 项在末尾逐条给出干净声明。

---

## F1（高危, 裁决 TRUE）空闲时“working”点永远渲染 — hidden 属性被类样式覆盖

- 引入提交: 5ba2a8c6（Stop rebuilding the marks that report work, 本 wave 内）。
- 证据:
  - src/client/src/components/appShell/AppContextBar.ts:56-63 — 工作标记改为常驻元素: span class=working 一直挂载, 仅用 ?hidden=!isWorking 切换。
  - src/client/src/components/appShell/AppContextBar.ts:86 — .working { display: inline-flex; ... } 作者规则存在, 但全文件没有 .working[hidden] { display: none } 伴随规则。
  - 级联机制: UA 样式表的 [hidden] { display: none } 输给作者来源的 .working { display: inline-flex }（作者 normal 声明优先于 UA normal, 与特异性无关）。代码库自己记录过这个坑: src/client/src/components/shared.ts:252-256（“A host display beats the UA stylesheet [hidden] display:none”因此 :host([hidden]) 需要显式规则）。
  - 同 wave 的正确对照: src/client/src/components/appShell/AppNavigationPanel.ts:493 — .compact-working[hidden] { display: none; }（f4e5b33f 为同样的常驻标记加了伴随规则; 5ba2a8c6 给 AppContextBar 改造时漏掉了）。
  - 测试盲区: src/client/src/components/appShell/AppContextBar.harness.test.ts:76 只断言 hasAttribute(hidden)（属性存在）, 不断言计算后的 display, 因此 CI 绿而真实渲染错。
- 最小失败场景: 桌面端（或手机 chat 视图）打开一个完全空闲的会话 → 顶栏会话名右侧永远显示三个跳动的 accent 色圆点, aria-label 为空字符串的 role=status 常驻 → 界面持续声称“正在工作”, 而实际上没有任何工作。这把“缺席不等于否定”反过来踩了: 无工作被渲染成了有工作。
- 修复方向（供 owner 裁决）: 补 .working[hidden] { display: none; }（与 AppNavigationPanel.ts:493 同型）; 若想连空间都稳定, 再决定是否同时预留宽度。

## F2（高危, 裁决 TRUE）空闲行渲染幽灵“unread”点, 且 :has() 把整列表的状态轨点亮成 accent

- 引入提交: 5ba2a8c6（同一提交, machines 与 workspaces 两个插件各一份）。
- 证据链:
  1. pi-web-plugins/machines/browser/activityBadge.ts:38-47 与 pi-web-plugins/workspaces/browser/activityBadge.ts:38-47 — renderActionActivityIndicator 改为永远返回元素: <span class=action-activity ?hidden=!present>，空闲时（kind 与 unreadLabel 均无）内部仍渲染 class=activity-ring > class=activity-indicator unread（markKind = kind ?? "unread"）。
  2. src/client/src/components/shared.ts:406 — .action-activity { ... display: grid; ... }，全仓库（含 pi-web-plugins）没有任何 .action-activity[hidden] 规则（grep [hidden] 仅命中 shared.ts:252-256 的 :host 规则、AppNavigationPanel.ts:493、ChatView.ts:163）。同 F1 的级联机制: hidden 属性失效。
  3. 插件行确实吃到这条样式: MachineList/MachineSwitcher/ProjectList/WorkspaceList 在 createRenderRoot 里 adopt 宿主 listStyles（pi-web-plugins/machines/browser/hostUi.ts:35-40, pi-web-plugins/workspaces/browser/hostUi.ts:38, src/client/src/plugins/pluginHostUi.ts:35）。
  4. 放大器: src/client/src/components/shared.ts:423-424 — .action-row:has(.activity-indicator.unread) .action-main, .action-row:has(.unread-ring) { border-left-color: var(--pi-accent) }。空闲行的常驻节点恰恰带 .activity-indicator.unread → 每一行（包括选中、已归档之外的全部行）的左侧状态轨都被点亮成 accent。shared.ts:435 再给这个点画 6px accent 圆 + 2px halo。
  5. 测试盲区: pi-web-plugins/machines/browser/MachineList.test.ts:142、159 改成断言 hasAttribute(hidden) 与 :not([hidden]) 选择器 — 断言的是属性, 不是绘制; 且单测环境没有宿主样式（hostUi.ts 注释“absence of a host means no styles”）, 渲染缺陷在单测里原理性不可见。
- 受影响面: 机器列表行、机器切换器 tile（手机折叠头里的机器选择器! MachineSwitcher.ts:142）、项目行、工作区行 — 在桌面导航面板、上下文表、tile 网格全部命中。SessionList 不受影响（它走 renderSessionRowIndicator, 空闲返回 undefined, src/client/src/components/sessionRowIndicator.ts:65-66）。
- 最小失败场景: 默认单机安装、一切空闲 → 打开导航面板: 机器行、每个项目行、每个工作区行右缘各有一颗“未读”accent 点, 左缘状态轨全部是 accent 蓝 — 整个列表看起来“全部未读/全部活跃”, unread 信号被摧毁（也正是 shared.ts:421-436 注释里“状态轨是扫视依据”的设计被噪声淹没）。
- 裁决依据说明: 级联机制是规范行为, 非猜测; 具体像素观感建议在 8505 栈上 5 秒目检确认（空闲机器列表行应有蓝轨+蓝点）。
- 修复方向（供 owner 裁决）: 给 .action-activity 补 [hidden] 伴随规则（最小修）; 或空闲时返回 nothing、仅在有标记时常驻（回到“至少两个模板形状”的旧权衡 — 这是 5ba2a8c6 想避免的, 所以补 CSS 规则更贴合该提交的意图）。

## F3（低危, 裁决 TRUE）.compact-fold { padding: 0 } 是死规则 — 被后面的同特异性规则覆盖

- 证据: src/client/src/components/appShell/AppNavigationPanel.ts:499 新增 .compact-fold { padding: 0; }（f4e5b33f）; 同文件 :503 的 .compact-header-action { ...; padding: 0 var(--pi-space-4); ... } 位于其后, 两者特异性同为 (0,1,0)（单类）, 后者胜出。折叠按钮 :194 同时带两个类（class="compact-header-action compact-fold"）。
- 最小失败场景: 细指针下的窄窗口（触发 mobile 布局）里, 折叠钮实际渲染为 8px 图标 + 左右各 8px 内边距 = 24px 宽的药丸, 而规则作者写下的“方形图标钮”意图静默失效; 粗指针下因 :507 的 min-width 44px 被遮住, 恰好看不出差别。
- 附注（裁决: 规则意图本身未闭环）: 若只是把 padding:0 挪到后面“修复顺序”, 细指针下按钮会退化成 8px 宽的细条 — 更糟。要闭环需要同时给出宽度（如 header-icon-action 式的 width: var(--pi-panel-header-control-height)）或更高特异性。当前是“死规则+侥幸兜底”的组合。

## F4（低危, 裁决 TRUE）tile 路径行硬编码 2.6em 却不钉行高 — 姊妹规则钉了, 它没钉

- 证据: src/client/src/components/shared.ts:324（7f08d5c6, 本 wave）: .list-body.tiles small { ...; min-height: 2.6em; max-height: 2.6em; -webkit-line-clamp: 2; ... } — 2.6em 隐含“行高恰为 1.3”。同文件 :331 的姊妹规则 .workspace-primary-label { ...; min-height: calc(2 * 1.3em); line-height: 1.3; ... } 显式钉住了 line-height: 1.3 来保证自己的 calc 成立。small 的行高实际继承自 listStyles :host 的 font 简写（shared.ts:251）→ font 简写会把 line-height 复位为 normal, 即字体度量相关、未钉住。
- 最小失败场景: 在 normal 行高大于 1.3 的字体栈上（如 Windows/Segoe UI）, 两行路径的第二行被 max-height: 2.6em + overflow: hidden 裁掉降部（descender）— 正是 7f08d5c6 声称修掉的“路径被切”在另一种字体下的复发; 行高小于 1.3 的字体上则多出空隙, 与钉了 1.3 的标题行内部对齐不一致。（裁切幅度属字体度量推断, 标注为推断; “姊妹规则钉了、本规则没钉”的不一致是事实。）

## F5（低-中危, 裁决 TRUE）折叠态 composer 用私有 10px 水平内边距, 违反本 wave 自己立下的“同列共享一条左缘”契约

- 证据: src/client/src/components/PromptEditor.ts:64 — footer.collapsed { padding: var(--pi-space-3) var(--pi-space-5); }（水平 10px, 私有字面值）。展开态 footer 测量自 --pi-chat-gutter（:61, :180 的媒体查询同样用 gutter）。src/client/index.html:78-80 的令牌注释: “The conversation column: the transcript, the composer and the status dock all measure from these, so they share one left edge at every window size.”。da1479af（本 wave）给这个角色起了名并迁移了两个读者（列表行、工具区）, 但同一屏上的折叠 composer 仍私有作答。
- 数字: 桌面 gutter=16px vs 折叠 10px → 展开/折叠时盒缘向内跳 6px; 手机 gutter=6px vs 折叠 10px → 向外跳 4px。两个断点上跳动方向相反, 说明 10px 既不是 gutter 也不是 reading-edge 的角色值, 而是第三个私有答案。
- 最小失败场景: 在桌面读着会话, 点折叠 → 输入盒左缘从 16px 跳到 10px, 与上方转写文字的左缘错开 6px; 在手机上错开方向相反。应为 .collapsed 选择 gutter 或 reading-edge 之一（owner 裁决角色归属: 折叠行属于“会话列”还是“读边”）。

## F6（行为事实, 裁决 TRUE-存活; 严重度低, 是否算缺陷待产品裁决）折叠状态跨 section 切换与 nav/chat 切换存活

- 证据: compactActionsOpen 是面板上的 @state（AppNavigationPanel.ts:44）, 全仓库无任何复位点（grep 仅 4 处, 全在折叠钮自身）。手机上面板跨视图切换只是 display:none（PiWebApp.ts:183: main:not(.navigation-view) .mobile-navigation-panel { display: none; }）, 元素不卸载; section 切换（machines/projects/workspaces/sessions 折叠标志）也只是属性变化。只有跨断点翻转时元素才在两处模板位之间重建（PiWebApp.ts:3812 与 :3821 的三元互斥）→ 状态仅在那时复位。
- 最小失败场景: 手机上点开折叠（出现第二行 Settings/Actions, 52px）→ 通过上下文表切换工作区（section 切换）或点开一个会话再返回导航视图 → 第二行仍然展开, 列表起点比用户记忆的低一行。该行是全局动作（设置/动作面板）, 存活本身可辩护; 但代码库对同类瞬态披露态有“换上下文就收起”的先例（PromptEditor willUpdate 里 session/machine 变化即 historyOpen=false, PromptEditor.ts willUpdate 分支）, 是否同样收起应由 owner 定夺, 而不是默认存活。

## F7 注记与次要裁决（每条已给 TRUE/FALSE）

1. AppNavigationPanel.ts:507 — @media (pointer: coarse) 里 var(--pi-control-height-touch, 44px) 带回退字面值, 是该文件唯一带回退的用法（其余全部无回退）。裁决: 作为 bug 为 FALSE（令牌已发布, 回退永不生效）; 作为不一致为 TRUE — 若令牌日后改名, 这里会静默退回 44px, 正是往轮“未定义令牌”类缺陷的温床。
2. AppNavigationPanel.ts:194 — 折叠钮有 aria-expanded 但无 aria-controls（:199 的行无 id）。裁决 TRUE（轻微）: 读屏契约不完整, 展开状态宣告了却不指向它控制的区域。
3. 归档行 prefetch（hunt 项）: SessionList.ts:196 归档行走同一 renderSession → :413-414 pointerenter/focus 同样触发 onPrefetch。裁决: 触发为 TRUE; 有害为 FALSE — sessionController.prefetchSession（src/client/src/controllers/sessionController.ts:1908-1917）以 .catch(() => undefined) 吞错, 不上屏; 代价只是每个悬停过的归档行一次消息页读取。悬停/聚焦逐行触发但 prefetched 集合去重, 至多一次。
4. prefetched 去重标记与缓存驱逐的契约漂移: sessionController.ts:1920 的 prefetched 集合永不失效, 而 chatHistoryCache 有 TTL/配额驱逐（src/client/src/chatHistoryCache.ts writeChatHistoryCache/TTL 检查）。驱逐后标记仍声称“已预热”, 下次悬停不再预热（打开会话仍会正常拉取）。裁决 TRUE, 影响可忽略, 记录在案。
5. lazySurfaces 文档漂移: src/client/src/components/lazySurfaces.ts 文档串声称 “Opening awaits the load rather than rendering an empty frame”, 而调用点是 fire-and-forget: openLazySurface（PiWebApp.ts:1715-1723）不 await, openSettings 同步置 settingsOpen=true（:1726-1727）→ 冷打开时 <settings-dialog> 以未升级的未知元素先渲染（不可见, 非空框）, 模块到位后才出现; 失败时横幅报错且不可见元素滞留。裁决: 文档与机制不符为 TRUE; 可观察行为（稍后出现/失败报错）健全, 严重度低。isRenderedModalOpen 走 DOM 实测（PiWebApp.ts:923-925）, 假打开不会污染快捷键判定。

## 已检查且干净的项（明确声明, 非缺席）

- 指针查询顺序: 本 wave 新增/触碰的 coarse 块均位于同特异性基础规则之后（AppNavigationPanel.ts:507 在 :503 后; ActionPalette coarse 在其 header button 基础规则后）; 无“coarse 在前被基础规则反压”的回归。FALSE（无缺陷）。
- 折叠行/动作行触底: .compact-fold 与 .compact-actions-row 两钮均 ≥44px（基础 min-height=touch; coarse 再加 min-width/min-height 44）。动作行双钮 flex 1 1 auto, 393px 下各约 186px。FALSE（无缺陷）。
- 头行高度契约: .compact-header min-height 44 + 1px 边 = 45, 与桌面栏一致; 行内各控件 44px, 注释宣称的“53→45”达成。FALSE（无缺陷）。
- reading-edge 令牌: 双断点发布且派生自刻度（index.html:87 = space-7=16px, :203 = space-5=10px）, readingEdge.test.ts 三条契约测试成立; 迁移点（shared.ts:274 section、AppNavigationPanel tools-section :509）正确。FALSE（无缺陷）。
- tile 单一形状的盒模型: .action-name min-height 2.5em 与其钉住的 line-height 1.25 精确自洽; .action-main min-height 56+24=80 为 border-box, 与 coarse 菜单尺寸派生无冲突。除 F4 外 FALSE（无缺陷）。
- in-flight 共享竞态: 仅 GET 共享、带 signal 的调用方完全排除（http.ts diff, shareKey 判定）, 共享的是字节、各自 parse, 结算即删且以同一 Promise 身份判删（inFlight.ts:26-35）— abort/解析两条竞态都关死了。FALSE（无缺陷）。
- 缓存驱逐: evictionOrder 最早优先、排除自键、解析失败视为最旧先驱逐; fitToEntry 保尾且 start 映射修正; 单条超限则放弃写入而非半写。FALSE（无缺陷）。
- ask 提交后的 composer 再展开: setState 仅在 pendingAsk 与 pendingDialogs 双空时释放（PiWebApp.ts:1079）; 指针按下期间的折叠/展开经 held 延迟到抬起（composerCollapse.ts transition）; 焦点残留场景由 shouldReleaseComposerCollapse 兜底。未发现错误重展开路径。FALSE（无缺陷）。

## 猜测标注

- F4 的具体裁切像素数依赖字体度量（推断, 未实测）; 其余全部发现均基于可引用的级联/盒模型机制与源码行号。
- F1/F2 建议在 8505 栈做一次 5 秒目检（空闲机器列表 + 空闲桌面顶栏）作为最终确证; 静态机制已可裁决为 TRUE。
