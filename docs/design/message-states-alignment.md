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

## 3. 待机主裁定：slash 命令的呈现路线

**方案 A（现状）**：slash 不进 transcript，走 ledger 收条（可关闭）。
- 优点：transcript 干净；命令不是"对话内容"，重放/分支不含命令气泡。
- 代价：收条仍是"另一种东西"（机主已点名不满的根源）。

**方案 B（机主倾向）**：slash 当普通消息——发出即在 transcript 产生
用户气泡（`/new` 原文），套同一套 delivery 状态机（Queued→Read/Not sent），
命令的**效果**（如 model 切换提示）进系统通知，不进气泡。
- 优点：一种消息一种呈现，状态机单轨；与 pi agent TUI 的
  "输入即历史"一致。
- 代价：重放/分支的 transcript 里混入命令文本；`/new` 这类清空型命令
  会自己把自己刷掉（气泡随新会话消失，收条需要短暂 toast 兜底）。

推荐 **B + 收条 toast 兜底**：状态机单轨的价值大于 transcript 纯度。

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

1. slash 路线 B：commandLedger 的收条改为消息气泡 + toast 兜底（一次提交）。
2. 会话列表虚拟化：先写 500 会话的帧率基线探针，超标再上（独立提交）。
