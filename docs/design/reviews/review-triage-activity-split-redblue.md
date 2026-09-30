# Activity 拆分红蓝对抗裁决材料

多轮 bllm 对抗记录：round1（红方攻击 / 蓝方精修 / qwen 哲学对照）→ round2（红方逐条 cross-examine / 蓝方终辩 / qwen 终审）。
子代理产物：`subagent-artifacts/023edfe1（红1）/ a69c60e4（蓝1）/ 293ea9d5（qwen1）/ 7f3c2dfa（红2）/ 1e36ccd6（蓝2）/ b5bd8c78（qwen2）`。

## 终审判定（qwen 终审：BLOCK 仅限边界定义；按下方修订后可实施）

对抗收敛出的核心修正：**缝不是裸事件总线，是核心持有的只读投影**。

## 已成立的攻击（全部采纳，修订设计）

| # | 攻击 | 证据 | 修订 |
|---|---|---|---|
| A1 | 设计文档引用的 `staleActivityReconcile.ts` 不存在（幽灵文件） | 全树 find 无果；仅 `pi-twin-plugin-design.md:86` 引用 | 修文档：真实对账 = `sessionSocket.ts:303,356`（seq/REVISIONED frames）+ `hydrateSessionStatuses({replaceKnown:true})`（sessionController.ts:1033，调用点 PiWebApp.ts:1709,2209）+ `foldDrawerAsWorkFinishes`（ChatView.ts:2183） |
| A2 | 抽屉行不走事件总线（REST 轮询），文档"consumes the same client event bus"不成立 | `activityPanelState()` 读 subagents/backgroundTasks（ChatView.ts:1610-1616），由 `readSubagents()` 轮询灌入（PiWebApp.ts:748-758） | 轮询随插件走，经壳已声明的读端口（registry fetchJson/callOperation）；`backgroundRunCount`（协议计数）与轮询行数禁止互相推导 |
| A3 | 裸事件总线必复现已修事故（断线后徽章永远转圈 / 停止已结束的 turn） | statusHydration.test.ts:42-49 事故记录；activity/status.update 不在 REVISIONED_FRAME_TYPES；对账靠重连 replaceKnown | 缝改为 `sessionActivityProjection = { ready, statuses, activities }`：订阅即回放快照；断线 `ready=false`（诚实未知）；重连由壳对账后重放；seq-once/落沿清除全留壳，插件零对账；transcript/command.output 高频帧不进投影 |
| A4 | dock ≠ drawer section（P0） | `renderActivityDock`（ChatView.ts:2126-2172）是 chat 底部浮条，依赖 pendingAsk 抑制（:2128）、isSendingPrompt（:2130）、turnStartedAt 计时（:2110-2121）、revealActivity（:2146-2156）；DrawerSectionContext（plugin-api.ts:167-192）一个字段都装不下 | dock 骨架留壳，新增专用 `activityDock` 贡献点：插件只供文案/glyph，sending/避让/计时/reveal 归壳；零插件 = 现渲染收编为素 fallback |
| A5 | `activityBadge.ts` 混两种东西，整搬会断机器树（编译期即断） | `statusActivityKind`/`hasStatusUnread`/`renderActivityIndicator` 吃机器 StatusFlags（:19-50），消费者 MachineList:8/ProjectList:8/WorkspaceList:11/MachineSwitcher:6/sessionRowIndicator:2/QuickSwitcher:8 | 拆分：机器面移壳内新模块（纯移动）；`SESSION_STATE_LABELS`/`renderSessionStateBadge` 素版归核心缝契约，插件在场时退位 |
| A6 | unread 环组合归核心（many contributors, one result） | plugins.md:428；unread ring 逻辑在 activityBadge.ts:84-113；禁 activity 插件时 notifications 的环不得死 | 核心负责 ring∘badge 组合；badge 插件只产 glyph/label/tone |
| A7 | `activityEmptyMeaning` 不是纯文案：busy 谓词与五态分类器已漂移 | activityEmptyMeaning.ts:11-16 只看 isBashRunning/isStreaming，分类器（sessionActivityState.ts:27）含 isCompacting/pendingMessageCount | 随插件搬，但判定输入改吃投影 status，消灭谓词复制；否则 compacting 会话徽章 working、空态说 nothing tracked |
| A8 | pi-web-activity 应为 browser-only | daemon 半侧无活可干（事实全留核心）；plugins.md facet 授予表 | manifest 只声明 browser facet |

## 分歧裁决（读源码定）

- **sessionActivityPolling 归属**：蓝方"随插件" vs qwen"与 notifications 共用（shouldPollSessionActivity/oneReadAtATime/20s 看门狗，PiWebApp.ts:724-748），应住 shared/"。采 qwen：搬插件会把与 notifications 共用的节流/单飞通用件劈成两份（同一症状两次打补丁）。**定：机制留 `shared/`，插件消费。**
- **`activity.update.label` 呈现文案进协议**：qwen F2 成立但降 P2——客户端已"读状态不读字"（activityDockLabel 仅 asking∧idle 改词，ChatView.ts:3542-3544）。**定：缓加结构化 inputs，label 留作零插件 fallback 文案；有第三方消费者需求时再动协议。**

## 最终边界（逐文件）

**留核心**：`shared/sessionActivityState.ts`（五态分类器=协议单一真源）；`daemon/sessionActivityLabel.ts` + `activity.update`（apiTypes.ts:1456）；sessionController 全部对账（hydrateSessionStatuses/replaceKnown/落沿清除/seq 水印）；`sessionSocket.ts`（:303,:356）；`sessionRowIndicator.ts`；`drawerTabSelection.ts`（去 `"activity"` 硬编码兜底后留壳）；新增 `sessionActivityProjection.ts`（快照+订阅=真正的"总线"）；`sessionActivityPolling.ts` 移 `shared/`；dock 骨架（避让/sending/计时/reveal）+ 素 fallback；unread ring 组合。

**搬 pi-web-activity（browser-only）**：dock 的文案/glyph 分支 + `activityDockLabel`；`activityEmptyMeaning.ts`（输入改吃投影）；抽屉行渲染 + 三态诚实缺省（未读/失败/确空，ChatView.ts:1646-1665）；`sessionBadges` 与 `activityDock` 贡献实现；Activity 抽屉走现成 `drawerSections`。

## 迁移序（每步绿灯单独提交；全程不触 daemon）

1. activityBadge 机器面移核心新模块（纯移动，零行为变化）。
2. 落投影缝 + `sessionBadges`/`activityDock` 两贡献点 + 素 fallback（纯增量）。
3. 建 pi-web-activity，与旧渲染并行，8505 栈 Playwright 393x850 验收。
4. 等价后单提交切壳删旧。回滚 = revert 或注销插件；素 fallback 常驻保证零插件壳诚实回答"有没有在干活"。

## 留 owner 裁决

1. `foldDrawerAsWorkFinishes` 输入（读 summary.working，源自轮询行）：蓝方倾向留壳（展开状态机属壳，section 契约加只读 `working(context)` 查询）。
2. 结构化 activity inputs 进协议：蓝方与 qwen 均倾向缓加。
