# ROUND FOUR — Lane A:应用外壳与 chrome 几何(尺度化之后)

范围:appShell/*、SessionList.ts、StatusBar.ts、ChatView.ts、shared.ts、index.html token 块。
重点面:boot;sessions;chat;chat-drawer;context-sheet。
方法:逐行读源码,所有 file:line 均已在当前 HEAD(64045ac4,分支 refactor/plugin-architecture)核实;几何结论给出可复算的算式。已复查并确认不再是问题的 round-3 项(如 --pi-panel-header-control-height 等于所含控件高度、resident bar 工作点动画、cleanup entry 高度、panel-toggle 图标居中)均未重复上报。

---

## F1 活动坞 asking/error 两个状态引用了不存在的 token,底色洗染失效
- file:line: src/client/src/components/ChatView.ts:254-255
- surface: chat
- finding: \`.activity-dock.asking { background: var(--pi-warning-bg-overlay); }\` 与 \`.activity-dock.error { border-color: var(--pi-danger-border); background: var(--pi-danger-bg-overlay); }\` 共引用三个未被定义的自定义属性。--pi-warning-bg-overlay、--pi-danger-bg-overlay、--pi-danger-border 既不在 index.html 的 :root token 块(index.html 只定义了 --pi-success-bg-overlay),也不在 theme.ts 的 THEME_TOKENS 白名单(src/client/src/theme.ts:33-75,theme 因此永远无法提供它们),shared/pluginApiTypes.ts:293 的 token 联合类型里也只有 success 版。三条规则均无 fallback。var() 落空时该声明按 unset 处理:两个状态的 background 透明,error 的 border-color 回退到 currentColor(即正文同色的全饱和红)。
- minimal failure scenario: 会话进入 ask_user 等待或 activity error:活动坞只剩边框加文字加 backdrop blur,没有其它四个状态(active/sending/idle/background)都有的色底;error 状态的边框比同族其它状态用的暗色 border token(--pi-warning-border 一类)亮一整档,六个状态两种观感。与 round-3 修掉的 failed-command-receipt 命名三个不存在 token 是同一类缺陷的新实例。
- confidence: high

## F2 桌面侧栏标题不可收缩也不可省略,长会话名把头部按钮挤出面板
- file:line: src/client/src/components/appShell/AppNavigationPanel.ts:146(模板)、:457(header 布局)、:483(header strong flex: 0 0 auto)、:455(:host overflow hidden)
- surface: sessions(桌面 rail chrome)
- finding: 头部标题是 headerName() = sessionLabel() 的输出:未命名会话回退到整个第一条消息文本(src/client/src/sessionLabels.ts:17-21 返回 firstMessage 全文,不限长)。strong 声明 flex: 0 0 auto,.header-actions 也是 flex: 0 0 auto(:486),header 用 justify-content: space-between:两个都不收缩的子项在宽于容器时从行尾溢出,被 :host 的 overflow: hidden 裁掉。同一个值在 resident bar 上有完整的三件套处理(AppContextBar.ts 的 .session-title-text:min-width: 0 + ellipsis),rail 头部一处都没有。
- minimal failure scenario: 会话首条消息是一段 200 字符的日志(未命名),选中它:桌面 rail 头部被撑开,gear 与 Actions 按钮被推出面板右缘裁掉,鼠标无法点到;上方 resident bar 对同一个名字正常省略。同一数据、两个 chrome 头,一个截断一个溢出。
- confidence: high

## F3 粗指针多选:复选框右缘压住行名前 4px
- file:line: src/client/src/components/SessionList.ts:726(selecting padding)、:727(复选框)、:747(粗指针重定位)、:748(粗指针只抬高 has-subtree/is-child 的 padding)
- surface: sessions
- finding: 粗指针下 .session-checkbox left = var(--pi-space-3) + (var(--pi-control-height-comfort) - 24px)/2 = 6+6 = 12,宽 24,右缘 x=36;而 .action-main.selecting 的 padding-left 仍是 calc(32px + depth*space-7),:743 的 coarse 块只抬高 has-subtree-toggle/is-child 两条(44px),没有同步 .selecting。32 < 36:每个进入多选、无子树开关的行,名字前 4px 落在复选框下面(复选框 z-index:3 在按钮之上)。
- minimal failure scenario: 手机上长按行进入多选(或点标题 ☑),任意一个无子会话的根行:名字首字符的左 4px 被原生复选框盖住;基线几何(fine 指针:复选框 6..30、文字 32)原本留了 2px,round-3 把复选框右移居中到 36px 槽位时没有同步抬高这条 padding。
- confidence: high(算式来自源码,可复算)

## F4 会话进度条的左右缘不读会话栏自己的 gutter token
- file:line: src/client/src/components/ConversationMeter.ts:33(left: 16px; right: 16px; top: -4px)、:39(10px marker);对照 src/client/index.html 的 @media (max-width: 640px) :root --pi-chat-gutter: 6px 与 ChatView.ts:222(dock 读 margin: 0 var(--pi-chat-gutter))
- surface: chat
- finding: 进度条是会话栏顶上的 chrome,但左右内缩写死 16px,而它所度量的消息列在 ≤640px 时 gutter 是 6px。它下面的活动坞用同一 token 对齐了消息边缘,进度条没有:手机上两侧各缩进 10px,与消息列、活动坞的边都不共线。另:marker 是 10px 圆点,比点尺度顶格的 --pi-dot-md(8px)再大一档(从属问题)。
- minimal failure scenario: 393px 宽的手机打开有历史进度的会话:消息卡边缘在 6px 处,活动坞边缘在 6px 处,进度条轨道却在 16px 处起止——同一竖直方向上三种左缘。
- confidence: high(数值核实)/ medium(是否有意为之)

## F5 同一滚动容器里,消息头有两根粘住线:一条读 token,一条写死 -16px
- file:line: src/client/src/components/ChatView.ts:203(token 定义 --pi-chat-sticky-top: calc(-1 * var(--pi-space-9)),与 .chat 的 padding-top space-9 同源)、:297(event-group summary 读 token)、:381(group-msg 头读 token)、:374(.msg > .msg-header 的 top: -16px 写死)
- surface: chat
- finding: 三条粘性消息头规则里两条读共享 token(-24px),普通消息头写死 -16px:两者在同一次滚动中的粘住点相差 8px(无论 sticky 视矩取哪种解释,差值都是 8px)。-16px 同时也脱离了 token 的推导来源(.chat 的 padding-top = space-9 = 24px),token 改动时两条线会进一步拉开。仓库里没有测试钉住 -16px。
- minimal failure scenario: 同屏滚动既有普通消息卡又有 event-group(工具事件折叠组)的会话:折叠组 summary 与组内消息头粘在一条线上,普通消息头粘在低 8px 的另一条线上,两种同角色 chrome 在同一顶边出现两档位置。
- confidence: medium(数值与引用关系核实;8px 差在任一 sticky 视矩解释下都成立)

## F6 粗指针下,横幅行的按钮停留在 32px,同列其余动作全部升到 44px
- file:line: src/client/src/components/PiWebApp.ts:206(.self-update-banner button 的 min-height: var(--pi-control-height),无 coarse 覆盖)、:199(error-dismiss 同为 32,round-3 定格);对照 ChatView.ts:338-342(command-dismiss / image-zoom-close / queued-clear-button / history-load-button 均 coarse 44)与 PiWebApp.ts 的 .empty button coarse 44
- surface: chat(横幅 chrome)
- finding: main 列顶部的横幅槽里,Reload / Update now / Skip 在触屏上仍是 32px 高,而同一列里 transcript 侧的收据关闭、灯箱关闭、清队、加载更早、空态按钮在粗指针下全部是 44px。列内出现两档触控地面:横幅行 32、其余 44。round-3 把 error-dismiss 定在 32 属于既有裁决,但 self-update 的主按钮与这些 44px 邻居并存,地面分裂没有任何规则或豁免记录。
- minimal failure scenario: 手机收到 pi-web 有新版本横幅:Update now(32px)与下方会话里的 Clear queue(44px)同屏,两条动作高度差 12px,拇指命中差一档。
- confidence: medium(事实核实;可能被归入 error-dismiss 的既有 32px 裁决)

## F7 同一横幅槽三种边缘决策:全宽条、全宽条、写死 12px 的内缩卡
- file:line: src/client/src/components/PiWebApp.ts:196(.error 全宽 + border-bottom)、:200(.deprecation-notice 全宽)、:204(.self-update-banner 的 margin: 0 var(--pi-space-6) var(--pi-space-5))
- surface: chat
- finding: 三个横幅叠在同一个槽(main 顶部、chat-view 之上)。.error 与 .deprecation-notice 是 0 外距的全宽条,.self-update-banner 是左右各 12px 的圆角卡——12px 既不等于 error 条的 0,也不等于会话栏的 --pi-chat-gutter(桌面 16px、手机 6px),也不等于它正下方活动坞用的 gutter。横幅 chrome 的左右缘在同一屏上出现三个值。
- minimal failure scenario: 手机上同时出现 stale-client 横幅与一条错误横幅:错误横幅通栏到底,版本横幅两侧各缩 12px,而它们脚下的消息列缩 6px——三行 chrome 三种边缘节奏。
- confidence: medium(数值核实;全宽与卡片之分可能是有意的强弱区分,但 12px 与任何既有量度都不对齐)

## F8 前导槽的同一缩进量,基础规则写 16px/8px/6px 字面量,粗指针覆盖写 token
- file:line: src/client/src/components/SessionList.ts:727(var(--depth, 0) * 16px)、:728(top: 8px; left: calc(6px + var(--depth, 0) * 16px))对照 :732、:740、:747、:748(同一缩进写作 var(--pi-space-7),6 写作 var(--pi-space-3),44 写作字面量而非 var(--pi-control-height-touch))
- surface: sessions
- finding: 会话行前导控件的定位簇里,同一个 16px 树缩进在相邻规则里两种拼法(字面量 vs --pi-space-7),8px/6px 基线偏移同样;spacing 守卫只查 padding/margin/gap,top/left 的逃逸无人拦截。今天数值恰好与 token 相等,token 一动基础规则与粗指针规则就会剪切错位;38px(:732/:740)这个推导出的槽宽也是裸数。
- minimal failure scenario: 未来把 --pi-space-7 调成 18px:粗指针下复选框/子树开关按 18px 逐级右移,而基础规则仍按 16px,is-child 行的名字与它的开合框逐级错位,深层行肉眼可见地歪。
- confidence: medium(逃逸属实;当前无数值差)

## F9 桌面 rail 头部一排同高控件两种形状:圆形刷新键 vs 圆角矩形 gear/Actions
- file:line: src/client/src/components/appShell/AppRefreshControl.ts:40(44×44 + border-radius: var(--pi-radius-pill) = 正圆)对照 src/client/src/components/appShell/AppNavigationPanel.ts:498(面板通用按钮 border-radius: var(--pi-radius-md))、:458-460(header 内 gear/Actions 继承该圆角)
- surface: sessions(桌面 rail)
- finding: .header-actions 一排三个 44px 高的控件:刷新是整圆,gear 与 Actions 是 8px 圆角矩形。紧凑头部(.compact-header-action,radius-pill)里三者都是胶囊,桌面头部成了唯一混排的一行。高度一致(round-3 已修),形状没有决策记录。
- minimal failure scenario: 桌面展开 rail:同一行内圆按钮与方按钮并列,与手机端三个胶囊的家族样式不一致;视觉上刷新键像另一族的控件。
- confidence: medium(形状差核实;可能是有意的品牌标记)

## F10 同一枚计数徽章,三处三种字色、两种高度
- file:line: src/client/src/components/SessionList.ts:683(unread:color: var(--pi-accent),line-height 16px)对照 src/client/src/components/ChatView.ts:158(drawer tab:color: var(--pi-text-bright),line-height 16px)与 src/client/src/components/appShell/AppNavigationPanel.ts:479(tool row:color: var(--pi-text),min-height 20px)
- surface: sessions / chat-drawer
- finding: 三个计数徽章都是 selection-bg 底 + pill 半径 + 2xs 字号,但字色一个 accent、一个 text-bright、一个 text,高度一个 16px 行高、一个 20px min-height。同一计数徽章母题没有单一实现,分不清哪处是刻意的语义色、哪处是漂移。
- minimal failure scenario: 同屏看到会话列表的 unread 蓝字徽章与 chat drawer 活动 tab 的白字徽章:两个都是待读计数,色制不同;再切到面板工具行,第三个徽章比前两个高 4px。
- confidence: medium

## F11 队列条是胶囊里套胶囊,同一 warning 描边画两圈
- file:line: src/client/src/components/ChatView.ts:326(.queued-strip:warning 边 + pill + padding 4/6)套 :337(.queued-clear-button:同一 warning 边 + pill)
- surface: chat
- finding: 队列条里只有一个按钮,却画了两层同色(--pi-warning-border)的同心描边,垂直间距 4px、水平 6px。shared.ts 里成文的家规是 one surface per row——两个描边盒并排读起来像表格单元(listStyles 注释),这里是嵌套版本:同一动词、同一色、两层框。
- minimal failure scenario: 服务器队列非空时,transcript 末尾出现一个金色描边胶囊,里面 4px 处又是一个金色描边胶囊;coarse 下按钮升到 44px,外框内衬只剩 4px,两层边几乎贴死,读作渲染毛边。
- confidence: medium

## F12 关闭/抹除动词的字形分叉:错误横幅用 ✕,其余全部用 ×
- file:line: src/client/src/components/errorBanner.ts:18(✕ U+2715)对照 src/client/src/components/ChatView.ts:1161、:1502、src/client/src/components/SessionList.ts:233、src/client/src/components/appShell/ContextSwitcherSheet.ts:34(均 × U+00D7)
- surface: chat(错误横幅)对全家
- finding: 同一个移除动词,错误横幅是唯一用 ✕ 的:同字号下 ✕ 笔画更重、更宽,与相邻 surface 的 × 并排即可辨认出两族。lightbox 与 + 字形在 round-2 已统一过一次,这个 ×/✕ 分叉是同族问题的残留。
- minimal failure scenario: 同一屏:命令收据的 × 与顶部错误横幅的 ✕ 相距几十像素,两个关闭字形粗细不一。
- confidence: high(事实)/ low-medium(严重度)

## F13 抽屉头图标 17px 是全库唯一的尺寸,与同级 16px 头图标差 1px
- file:line: src/client/src/components/ChatView.ts:178(.drawer-icon 的 width/height 17px)对照 src/client/src/components/appShell/AppNavigationPanel.ts:460(gear 16px)与 src/client/src/components/appShell/AppRefreshControl.ts:41(refresh 16px)
- surface: chat-drawer
- finding: chat drawer 折叠钮的 chevron 是 17px,面板头部与刷新键的图标是 16px;图标尺寸没有尺度,17px 在客户端 chrome 里仅此一处。同一 chrome 层级的两排头图标差 1px,无 token 也无豁免记录。
- minimal failure scenario: 手机上同时看到面板头(16px 图标)与抽屉头(17px chevron):两个头部图标肉眼可辨地不同大,却属于同一图标族。
- confidence: high(事实)/ low(严重度)

---

已核对、判定为既有裁决或非问题而未上报:drawer tab min-height 22px(pinned,do-not-report);picker 层级倒置与 current value 文案(deliberately unfixed);.msg-action 24px + ::after 扩展热区(round-2 已裁);.code-copy-button 24px(守卫注释明示低于控件区间按图标处理);.tool-row 52px(孤立卡行,无同排兄弟可比);compact 头与 drawer 头在粗指针下同为约 52px 的涌现高度(彼此一致)。

TOTAL: 13 findings
