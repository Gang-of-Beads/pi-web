# 对比 agegr/pi-web（v0.9.1）：借鉴清单与裁定

三路 glm max-thinking lanes 分别对比消息生命周期、手机 UX/IA、功能/架构。
每条均落到两边源码 path:line（lane 原文见 subagent 日志）。本文是我的
triage：**已判定不借**、**建议借（按价值排序，落点在我们插件/进程分离
的接缝上）**、**产品语义待机主裁定**。只动 refactor（8505）。

## 一、不借（会退化我们已解决的问题）

| 他们的做法 | 不借的理由 |
| --- | --- |
| 单进程（AgentSessions 住在 Next 进程内）+ 10 分钟空闲驱逐 + 续租协议 + fork 即销毁 wrapper | 全是单进程的补偿；我们 web/daemon 分离由构造消除这些坑 |
| 2.5s 轮询运行状态 + 客户端聚合活动 | 我们有带 revision/epoch 的实时状态帧，轮询会重引漂移 |
| 连接即快照、无逐帧序号；`loadSession` 整体替换 | 读者向上翻的历史在每次 run 结束时丢失；我们水位+gap 修复+delta 重放更强 |
| 内容 hash 识别乐观气泡 | 我们端到端 `clientMessageId` 跨刷新/多端，文本匹配会重现重复气泡 |
| 5 秒 toast 当命令收条（内置命令不落任何记录） | 正是方案 B 要关闭的缺口，违反"不会自动离开" |
| 客户端重写会话文件（删除时级联 reparent） | 我们 daemon 单一生产者；第二生产者是 refactor 禁止的形状 |
| 整棵侧栏树替代 drawer + Projects sheet + QuickSwitcher | 会丢机器/fleet 层与插件 drawer 契约；其真正的好处（祖先层级常驻可达）= 我们已排期的 D1 |
| 手机端 Enter 永不发送 | 我们 auto/send/newline 偏好 + autocapitalize 守卫更优 |
| ChatMinimap 第二滚动面、react-syntax-highlighter、`.mjs` node:test | 393px 上第二滚动面违反 one-message-one-row；CodeMirror 已在；测试栈不换 |

## 二、建议借（排序 = 手机优先价值 / 工作量）

| # | 借什么 | 我们的缺口（已核实） | 落点 | 量 |
| --- | --- | --- | --- | --- |
| 1 | **Web Push + service worker：run 完成推送**（iOS 陷阱：push 到达不显示通知会吊销订阅；点击通知聚焦已有窗口） | `src/client` 零 SW/零 Notification；daemon 已有 SessionNotificationStore 与 `session-activity-settled` | web 路由族（VAPID 存 `$PI_WEB_DATA_DIR`）+ daemon 事件订阅 + `public/sw.js` | M |
| 2 | **URL 承载会话深链** `?session=`（刷新/PWA 重启/通知点击直达） | 只有 settings 走 URL（`settingsRoute.ts`）；会话身份纯内存 | `sessionRoute` 与 `machineNavigationMemory`、boot 分类器组合；#1 的前置 | M |
| 3 | **工具结果图片延迟加载**（base64 → 按条目 URL + "[N 张省略]"） | `boundToolResultContent` 只封顶文本，截图仍内联；击穿 512KiB sessionStorage 缓存上限 | daemon 新路由 + url 型 image ChatPart | M |
| 4 | **一键自动命名会话**（影子 agent，所有工具 execute 抛错桩，90s 超时） | `/name` 存在但无生成 | daemon 影子 run + 行菜单/palette 动作 | M |
| 5 | **气泡上的分支动作**（"从这里编辑"→ navigate_tree；"新会话"→ fork） | 后端 `navigateTree/forkFromTree` 已在，但 entry id 未下发浏览器，只能走 /tree 对话框 | daemon 把 entryId 穿到 `meta.entryId`；ChatView 两个按钮 | M |
| 6 | **选中文本 → "在此追问 / 新会话追问"**（popover 按 visualViewport 定位，键盘弹起不丢） | 无 transcript 选区捕获 | ChatView + #5 的 entryId | M |
| 7 | **Mermaid 渲染**（懒 import、strict、先 parse 再 render、放大/下载） | 全无，agent 输出的图当原始 fence | 共享 markdown 渲染接缝（`renderMarkdownHtml`） | S |
| 8 | **会话正文全文搜索**（有界扫描 + truncated 诚实标记 + entryId 直达块） | 只搜 name/firstMessage | daemon 搜索操作（按工作区 scope）+ QuickSwitcher | M |
| 9 | **休眠 skill 在 slash 面板降序+标注** | daemon 列 `skill:*` 但不读 `disable-model-invocation` | daemon 命令项加 dormant 标记；面板置灰后排 | S |
| 10 | **扩展 status/widget 货架** | daemon 把 `setStatus/setWidget` 丢弃 | daemon 转发为会话事件；drawer section 或 transcript 底部 | M |
| 11 | **文件监听自动刷新**（目录级 fs.watch、ino/ctime 去重） | 预览手动刷新 | workspaces 插件 watch 操作 + realtime hub（machine+project+workspace scope） | M |
| 12 | **UI 创建 worktree** | git 插件能列/删，无创建 | git 插件一个操作 + nav section `withCreate` | S |
| 13 | **@file 与查看器行区间 mention**（`path:start-end` 入 composer） | composer 只有附件 | files 插件 composer 动作 + `insertText` | S |
| 14 | **会话 HTML 导出**（递归改迭代防深栈） | 无 | daemon 操作 + drawer 下载 | S |
| 15 | **会话列表虚拟化**（固定行高 + 纯窗口函数保留焦点行） | 全量渲染；设计稿已设"先测 500 会话"门槛 | 借形状不借代码（我们行高可变） | M–L |
| 16 | **models.json 编辑 + 模型探测/发现/目录预设** | 有凭据与 enabledModels，无 authoring/探测 | SettingsSection + daemon 操作 | M |
| 17 | **Provider 用量/配额面板** | 仅会话成本 | 插件（数据表 + 每 provider 一个 normalize） | S |
| 18 | **skills 管理面**（列表、frontmatter 外科编辑、安装、搜索） | 无管理 UI | settings section + daemon 操作 | M |
| 19 | DOCX 预览 | 无 | files 插件预览类型 | S（低优先） |

## 三、产品语义待机主裁定（不擅动）

- **网关密码登录 + Basic Auth**：手机 PWA 无法握 SSH 隧道；远程机器已按 token 认证但网关本身敞开。#1 在蜂窝网络下的前置。默认绑定/回环不变。
- **每会话工具预设**（none/read-only/default/full，纯聊天模式）：他们的 ADR-0002 是现成设计；与你"模型选择归核心"是不同裁定。
- **i18n（zh-CN/zh-TW）**：真实且做得好，但每个 Lit 模板都要抽取，L 级；作为产品定，不作为借鉴。

## 四、对既有设计稿的修正

- 方案 B（slash 即消息）的 daemon 原语应为 **`sendCustomMessage`**（写 `custom_message` **并**实时推送给在线客户端），而非 `appendCustomEntry`（opaque `custom` 类型，transcript 忽略，仅子会话链接使用）。`message-states-alignment.md` §3 按此修正。他们的 reader 把 `custom_message` 作为一等 `role:"custom"` 渲染，证明该格式可移植。

## 五、建议落地顺序（你点头后）

1. #3 图片延迟（唯一修复现存缺陷而非加能力）
2. #1+#2 推送+深链（最大手机缺口，二者一体）
3. 方案 B（用 `sendCustomMessage`）
4. #5+#6 分支动作与选区追问（共用 entryId 管道）
5. #7 Mermaid、#9 休眠 skill、#12 worktree 创建、#13 mention（S 级，随手）


## 六、机主 reflect 的对抗裁定（两路 glm max：对抗 + 插件可行性）

| 项 | 机主判断 | 裁定 | 依据（源码） |
| --- | --- | --- | --- |
| #1 推送 | 回来会增量同步，不需要 | **SPLIT** | 同步确实完备（browserResumeController + 42s 静默预算）；但锁屏期间"跑完/ask_user 阻塞"无从得知——attentionInbox 已把 waiting/unread 排第一，只是仅在 app 内渲染。是"被告知"能力不是同步。**代价要诚实计价**：不可插件化（ServerPluginHostPorts 无会话事件端口），需核心接缝 + sw.js；跨机器还要 remote daemon→gateway→push，比 M 大。产品决定权在机主 |
| #2 URL 深链 | 至少刷新回原页 | **OVERTURN（已实现）** | `route.ts:25-74` 读写 machine/project/workspace/session；boot 全量恢复（PiWebApp.ts:1188-1394）。借鉴清单该行过时，删除 |
| #3 图片延迟 | 不懂 | **HOLD（修缺陷）** | daemon 只封顶 text 部分（piSessionService.ts:5796-5815），截图 base64 内联；`fitToEntry` 单条超 512KiB 即放弃缓存 → 截图会话恰是最慢的 |
| #5 气泡分支动作 | /tree 够，极简 | **SPLIT** | /tree 是 slash-only 全屏导航：手机上≥4 步 + 在截断摘要里重新找消息；"能力覆盖"成立，"最短路径"不成立。且**无法插件化**（无气泡动作接缝），navigate/fork 绑死在 tree 对话框快照。推迟是合法产品决定，"已覆盖"表述不准 |
| #6 选区追问 | 做 | **HOLD** | 无需 daemon 改动即可"在此追问"；"新会话追问"需要 #5 同一条 entryId 管道 |
| #7 Mermaid | 插件 or 原生？ | **原生一个小接缝 → 之后插件化** | transcript 渲染无 fence 钩子；在 FormattedText 既有的 post-parse enhance 步加"按语言认领 fence 渲染器"（S），Mermaid 插件即可认领 |
| #8 全文搜索 | 已插件化 | **OVERTURN（回忆有误）** | 无 search 插件；只搜 name/firstMessage。插件化需两接缝：daemon 只读 transcript 端口 + QuickSwitcher 结果贡献（M–L） |
| #10 扩展 status/widget | 插件 | **HOLD + 接缝** | daemon 代理丢弃 setStatus/setWidget（:4177-4244）；一条附加 SessionUiEvent + 现成 DrawerSection（各 S） |
| #11 文件监听 | 文件插件 | **SPLIT** | 归属对；但推送无插件通道——最小：核心发 `workspace.changed` 全局实时事件 + host 翻译为 invalidate，插件契约不动（S–M） |
| #12 建 worktree | 插件能做？ | **HOLD（今天就能）** | git 插件已管 list/remove；create = provider 操作 + 从 git 工作区面板触发（`WorkspaceContext.backend`）。借鉴清单写的 nav `withCreate` 是错接缝（无 addWorkspace 回调） |
| #13 @file mention | 加 | **SPLIT（半已实现）** | `@` 补全已在（promptCompletions.ts）；缺的只是查看器"行区间 mention" |
| #14 HTML 导出 | 插件 | **SPLIT** | 服务端插件无 transcript 端口；web 侧重建渲染 = 第二生产者。干净路径与 #8 共用同一"只读 transcript 端口"接缝（S） |
| 网关登录 | 不懂 | **SPLIT** | = 给 web 入口加密码。tailscale 替代了传输加密与可达性；**不保护**：同 tailnet 其他设备（按设备不按人）、Funnel 公开、host 上第二绑定、无按人审计。单人 tailnet ⇒ 多余 |
| 工具预设 | 插件 | **接缝 M** | daemon 无按会话工具白名单；可搭 `delegationToolsEnabled` 同路径读预设 + 插件附带 pi 扩展执行过滤 |
| i18n | 插件 + 原生词表 | **接缝 S，抽取 L** | 照抄他们 LocalePlugin 形状；词表模块经 PluginHostUi 暴露，语言包=数据贡献（同 themes）；700–1200 条硬编码串抽取是真正成本 |

**跨项事实**：#8 与 #14 需要**同一个**缺失接缝（插件只读 transcript 端口）——一接缝两用。
