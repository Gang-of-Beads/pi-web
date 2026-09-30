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

### 3.1 机主裁定：对齐 pi agent 原生实现（已落地）

读 `interactive-mode.js`：pi TUI 的 `/session` `/name` 等内置命令**不写任何
会话条目**（`handleSessionCommand`/`handleNameCommand` 只往 chat 容器里加
一段本地文本），模型看不到，重开会话也不在。所以"命令即消息"在 pi 原生
语义里是：**命令原文当作用户气泡在本地呈现，结果贴在下面，不进 transcript
也不进模型上下文**。方案 B 的 daemon 写条目一步据此撤回；`commandLedger`
保留为本地投影，但改用消息的呈现语法：

- 命令行 = `.msg.user.command` 用户气泡（等宽命令原文）+ 下方结果行；
- 交付标记走同一套词汇：daemon 标记 `deferred`（转发给 agent 的运行时命令、
  忙时排队的 /reload）或会话尚未启动 → **Queued**（accepted 态，空闲沿
  结算为 Read）、请求已发未答 **Running**、成功 **Read**、拒绝/失败/对话框
  未答关闭 **Not sent**；每个态在 `commandLedger.test.ts` 枚举；
- 结果只出现一次：原先 `applyCommandResult` 另外注入 transcript 的
  system/tool 行删除（刷新即消失、与气泡重复）；
- 收条的 Dismiss 按钮退役（pi 原生也不可关闭，页面生命期内留存，容量上限
  20 条淘汰最旧已结算行）。

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
