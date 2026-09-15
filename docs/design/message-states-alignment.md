# 消息状态与加载：与 pi agent 对齐的设计稿

状态：待机主裁定。范围：聊天消息的生命周期呈现、slash 命令的呈现路线、
长会话/列表的加载策略。本文先写全貌再动代码（AGENTS.md：先设计后补丁；
产品语义归机主）。

## 1. 现状（refactor 分支已建成）

浏览器侧消息状态机（`MessageDeliveryState`）：

```
sending ──HTTP 200──> received ──服务器事件──> queued ──turn 采纳──> delivered("Read")
   │                      │                     │
   └─ 网络失败 ──> failed（可重试，outbox 持久化）
                          └─ 重连无回执 ──> unverifiable（"No answer yet"，重查安全）
```

- **steering queue**：session 忙时新消息入队，`kind: "steer" | "followUp"`
  由服务端裁定；队列持久化在服务端，浏览器 outbox 只兜网络失败。
- **顺序同步**：`clientMessageId` 关联 optimistic bubble ↔ 服务器事件；
  revision 检查 + gap repair + history delta replay 保证一致。
- **slash 命令**：走 commandLedger（pending/ok/failed），不进 transcript，
  收条独立呈现（8504 的"绿色特殊样式"是旧版本；refactor 已改为
  可关闭的收条，不再常驻）。
- **加载**：transcript 已有窗口化（span 400 封顶）+ 水位增量重放 +
  prefetch-on-intent + lazySurfaces。

## 2. 本轮已按机主裁定落地

- 手机左右 margin 10→16px（740891e6）。
- **received（"Sent"）取消独立呈现**：HTTP 回执即入队，
  `received` 直接呈现为 `Queued`（6f6e827c）。用户可见状态收敛为：
  **发送中 → 队列中（Queued · 序位）→ 已读（Read）/ 未发送（Not sent，
  可重试）/ 暂无回执（No answer yet）**——与 pi agent 的
  发送/排队/采纳三段对齐，网络中间态只保留有意义的三种。

## 3. slash 命令：机主已选方案 B（slash 即消息）

**修正一处事实**：web 端没有任何命令会清空当前会话历史（服务端支持集
`/session /name /compact /reload /clone /fork /tree` + 扩展命令；`/new`
`/clear` 返回 unsupported；`/clone` `/fork` 新建会话并跳转，原会话不动）。
先前"气泡会随新会话消失"的代价不存在，撤回。

**为什么不能只在浏览器端画气泡**：今天命令不进 transcript 的真正原因写在
`deliverCommandToSession` 里——服务端历史不记录内置命令，浏览器端插入的
行**刷新即消失、别的客户端看不到**，违反"不会自动离开"的裁定。

**方案 B 的正确实现（需动 daemon）**：
1. daemon 的 `sessionCommandService` 在执行内置命令时，用
   `sendCustomMessage`（写 `custom_message` 条目**并**实时推送在线客户端；
   `appendCustomEntry` 写的是 transcript 忽略的 opaque `custom` 类型，仅子会话链接用）写入一条
   `web-command` 自定义条目：`{ text, result: { type, message } }`——
   命令与结果成为 pi 会话文件的**规范历史**，刷新/多端/分支全部收敛。
2. 浏览器端 transcript 把该条目渲染为 **用户气泡（命令原文）+ 回复行
   （结果文本）**，用户气泡套同一套 delivery 状态机
   （sending → Queued → Read；失败 Not sent 可重试）。
3. 转发给 agent 的运行时/skill 命令：agent 自己会流回展开后的规范消息，
   保持现状（不重复写条目）。
4. `commandLedger` 与其收条 UI 整体退役（含 dialogRows/dismissable 测试）。

**影响面**：daemon 代码路径变更；只动 refactor（8505），8505 daemon 由我重启。8504 不碰。

### 3.1 实施前必须裁定：命令记录进不进模型上下文

读 pi 源码确认（`session-manager.d.ts`）：`custom_message` 条目
"在 buildSessionContext() 中转换为 user message"——即 **进入模型上下文**；
`display: true` 时 TUI "以区别于用户消息的样式渲染"。pi 自己的
`/session` `/name` 等内置命令并不写这种条目（它们是 TUI 本地动作）。

两条路：

- **B1 · `sendCustomMessage`（进上下文）**：命令原文 + 结果成为模型可见的
  一条 user-ish 消息。优点：刷新/多端/分支全收敛、实时推送现成、与
  pi TUI 对 custom_message 的渲染语义一致。代价：每条 `/session` 都会占
  一点上下文，模型能"看见"你跑过什么命令（对 `/compact` `/reload` 而言
  这是信息，对 `/name` 是噪音）。
- **B2 · `appendCustomEntry`（不进上下文）+ 我们自己的实时推送**：写 pi 的
  opaque `custom` 条目（模型不可见，TUI 不渲染），daemon 额外向在线客户端
  发一条会话事件，transcript 用 `messageRenderers` 认领的 tag 渲染为
  命令气泡。优点：上下文零污染。代价：pi TUI 打开同一会话看不到这些
  气泡（仅 PI WEB 可见），需要新增一条会话事件类型。

建议 **B2**：命令是 UI 动作不是对话内容，不该喂给模型；"多端一致"在
PI WEB 各客户端之间成立即可。若机主更看重"pi TUI 也看得到"，选 B1。

## 4. 加载策略盘点（已有 vs 缺口）

| 项 | 状态 |
| --- | --- |
| 长会话消息懒加载 | ✅ span 窗口（400 封顶）+ 新旧边界 chip |
| 历史增量同步 | ✅ 水位 delta replay + resync 回退 |
| 页面级预加载 | ✅ prefetch-on-intent（drawer/session 悬停/按下预取） |
| 会话**列表**虚拟化 | ❌ 列表全量渲染 DOM（数百会话时才成问题，先测后做） |
| SPA 式页面预取 | ✅ lazySurfaces 按需挂载 + 路由级 code-split 已在 |

缺口只有列表虚拟化一项，建议先实测 500+ 会话的帧率再决定（避免过早优化）。

## 5. 落地顺序（机主点头后）

1. slash 路线 B：daemon 写 `web-command` 规范条目 + transcript 渲染 + ledger 退役（daemon 与 web 各一次提交，先 daemon）。
2. 会话列表虚拟化：先写 500 会话的帧率基线探针，超标再上（独立提交）。
