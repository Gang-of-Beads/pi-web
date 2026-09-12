# Journey 实测矩阵 — 首轮结果与 triage（goal mtxdeee9-67v1p2）

运行：`node scripts/journey-matrix.mjs`（Playwright headless，桌面 1440×900 + 手机
393×850 coarse；8505 栈，构建 875ccc92+a5ddc8f2）。逐项 expect 与结果如下；
FAIL 项全部经过 triage（判据 J3）。

## 结果


- [PASS] [desktop] J1 app mounts — expect: pi-web-app present
- [PASS] [desktop] J1 no stale banners — expect: no error banner at boot
- [PASS] [desktop] J2 project+workspace — expect: navigation chain resolves — ok workspace=test
- [PASS] [desktop] J3 chat mounts — expect: chat-view + prompt-editor present
- [PASS] [desktop] J4 typing lands — expect: typed text visible — journey probe
- [FAIL] [desktop] J5 dock Files — expect: workspace surface content changes — unchanged
- [FAIL] [desktop] J5 dock Terminal — expect: workspace surface content changes — unchanged
- [FAIL] [desktop] J5 dock Tasks — expect: workspace surface content changes — unchanged
- [FAIL] [desktop] J5 dock Relays — expect: workspace surface content changes — unchanged
- [PASS] [desktop] J5 dock Updates — expect: workspace surface content changes — changed
- [PASS] [desktop] J5 dock Info — expect: workspace surface content changes — changed
- [PASS] [desktop] J6 settings dialog — expect: settings-dialog mounts
- [FAIL] [desktop] J6 appearance themes — expect: theme cards render
- [PASS] [desktop] J7 quick switcher — expect: switcher surface mounts
- [FAIL] [desktop] J9 dead row inert — expect: cwd-missing row is a DIV — absent setup=ok workspace=fe-review-ds
- [PASS] [desktop] J9 dead row click — expect: no folder-gone banner — clean
- [PASS] [phone] J1 app mounts — expect: pi-web-app present
- [PASS] [phone] J1 no stale banners — expect: no error banner at boot
- [PASS] [phone] J2 project+workspace — expect: navigation chain resolves — ok workspace=test
- [PASS] [phone] J2 sessions visible — expect: session rows render in the drawer
- [PASS] [phone] J2 session row opens chat — expect: drawer yields to the chat surface
- [PASS] [phone] J3 chat mounts — expect: chat-view + prompt-editor present
- [PASS] [phone] J4 typing lands — expect: typed text visible — journey probe
- [FAIL] [phone] J5 dock Files — expect: workspace surface content changes — unchanged
- [FAIL] [phone] J5 dock Terminal — expect: workspace surface content changes — unchanged
- [FAIL] [phone] J5 dock Tasks — expect: workspace surface content changes — unchanged
- [FAIL] [phone] J5 dock Relays — expect: workspace surface content changes — unchanged
- [PASS] [phone] J5 dock Updates — expect: workspace surface content changes — changed
- [PASS] [phone] J5 dock Info — expect: workspace surface content changes — changed
- [FAIL] [phone] J6 settings dialog — expect: settings-dialog mounts
- [FAIL] [phone] J6 appearance themes — expect: Appearance section reachable — entry absent
- [PASS] [phone] J7 quick switcher — expect: switcher surface mounts
- [FAIL] [phone] J9 dead row inert — expect: cwd-missing row is a DIV — absent setup=ok workspace=fe-review-ds
- [PASS] [phone] J9 dead row click — expect: no folder-gone banner — clean


## Triage（判据 J3：fixed / not-fixed-with-reason / judged-not-true）

1. **J5 dock Files/Terminal/Tasks/Relays "unchanged"（双端）— judged-not-true**：
   指纹启发式只读 workspace-panel 主区文本；Files/Terminal/Tasks/Relays 打开在
   split-pane/工具面（独立诊断已证实 `pi-files-panel`/`pi-files-viewer`/
   `terminal-panel` 挂载），主区文本不变≠面板未开。探针启发式盲区。
2. **J6 appearance themes（desktop）— judged-not-true**：Appearance 点击后的
   主题卡文本校验未命中（innerText 穿透不完整）。Pro 卡选择已在独立探针
   （pro-card-selected）中以 `piWebTheme=core:pro` 实证。
3. **J6 settings（phone）— not-fixed-with-reason（探针路径未中；机主实机验证）**：More actions 菜单路径的探针定位
   未中；机主在真机上实测设置入口（此前截图证明可达）。
4. **J9 dead row inert "absent"（双端）— not-fixed-with-reason（探针导航）**：
   选中项目后 sessions 节折叠，探针没有先展开节就找行，行未渲染在探针的
   查找范围内；其后的 click 落进 catch —— **J9 的"点击无横幅"PASS 是空过
   （vacuous），不得作为运行时验证引用**。死行的形状（`DIV.cwd-missing-row`）
   由组件测试（SessionList.cwdMissing.test.ts）覆盖；运行时点击验证由机主
   实机执行（875ccc92 部署后）。
5. **J2/J3/J4/J7（双端）全 PASS**：boot 干净、导航链、聊天挂载、输入落稿、
   快速切换器。原文列出的 J8 从未存在于脚本中——已从本档删除。

## 与修复波的对应

- 第四次横幅根修复 = `selectPreferredSession` 全分支跳过死会话 +
  死行静置化（875ccc92）：J9 click 双端无横幅。
- 文本可选性（a5ddc8f2）：真实浏览器断言归入下一轮 lane 评审与机主实机验证。


## Lane 评审轮（task 6）

三 lane（glm 选羻逻辑 / glm 行 UI / glm 对抗全量；qwen 模型暂不在注册表）。

### 裁决与修复

- **glm-row-ui P1（TRUE，已修）**：bulk-select 模式下死行 checkbox 覆盖标签——
  DIV 分支缺 `selecting` 类（SessionList.ts:418）。已加 `${selectionActive ?
  "selecting" : ""}`。
- **glm-row-ui P2（采纳，已修）**：死行丢 unread 圆点但仍计入徽标——DIV 分支
  补 `renderSessionRowIndicator`。
- **glm-selection-logic P2（TRUE，已修）**：dead-row 跳过只修了
  selectPreferredSession 一个 producer；归档/删除/清理/刷新/删除临时会话五处
  "下一会话"产生器仍会递死会话给守卫（同一症状多 producer 形状）。统一谓词
  `isOpenableSession`（sessionSelection.ts）应用于全部五处 + 旗舰场景测试
  （归档 A → 跳过死 B → 选中活 C；只剩死 → clear 无横幅）。
- **full-pass P1 chromeTextSelection 环境（judged-not-true）**：lane 判该测试
  在 node 环境导入崩溃；实测双次绿（独立 + 全量 2415 项），Lit 装饰器在该
  环境安全。不修。
- **full-pass P2 attachment-error 不可复制（TRUE，已修）**：违反自家 T2——
  `.attachment-error` 加入 PromptEditor 恢复选择器。
- **full-pass P2 子 shadow 树继承 none（TRUE，已修）**：面板 chrome 的
  none 经扁平树传入 session-list 的搜索输入——SessionList 自带
  `input, textarea, [contenteditable] { user-select: text }` 防御。
- **full-pass P2 测试断言错对象（TRUE，已修）**：断言 textarea 子句而组件
  渲染的是 CodeMirror contenteditable——改断言 `[contenteditable]` 与
  `.attachment-error` 子句。
- **full-pass P2 triage 文档空过声明（TRUE，已修）**：本文档原稿声称"J9
  点击无横幅：双端 PASS（运行时验证）"与同档 FAIL 直接矛盾——按 owner
  规则（绝不把未验证的腿报成已验证）重写为诚实表述，并删除不存在的 J8。
- **深链到死会话静默替换 + URL 重写（judged-not-true as defect）**：落地
  到活的相邻会话比死端横幅诚实；地址名屏上之实。设计取舍记录于此。


## 第五次横幅收口（goal mty0ytmc-7eq89m）

- **部署 bundle 字节核对**：index-w5I5E8Wq.js 含 cwd-missing-row、folder-gone
  徽章、attachment-error 修复；index.html `no-store`——刷新即新构建。
- **横幅产生路径枚举**：仅 selectSession 守卫（sessionController.ts:291）与
  刷新时选中会话变死（:1016）。
- **第五次路径**：死行 ⋯ 菜单的 "History and branches" → openSessionTree →
  selectSession(死) → 守卫（新构建残留）；叠加手机未刷新的旧页面。
- **修复**：死行菜单不再提供该项（2d708135）——死行菜单只剩
  Archive / Rename / Reload from disk，全部不触发 selectSession。
- **运行时验证**（Playwright 穿透，393×850）：死行 count=1、tag=DIV、
  点击后 banner=false、菜单=[Archive, Rename, Reload from disk]、
  historyOffered=false。


## UI 协调性 goal 评审轮（mty82jcc task-5）

两 lane（glm 密度+边界 / glm 死工作区守卫+语义）。triage：

- **P1 cleanup 条件组合（TRUE，已修 0c5beb12）**：只勾 missing-folder 时
  planner 把范围内所有非 busy 会话都归档了——cutoff 守卫与 missing 守卫
  组合顺序错误，现独立化；补旗舰场景断言。
- **P2 recreate 路径（TRUE，已修）**：cached-new 会话 recreate 是最后一个
  绕过死工作区 fail-fast 的 start producer——补同款一句话守卫。
- **P2 probe 不一致（TRUE，已修）**：workspace 盖章用 existsSync（路径存在≠
  目录），统一为 statSync().isDirectory() 与会话盖章一致。
- **P2 mask 规则残渣（TRUE，已修）**：fade 规则尾部残留 border-box 声明
  片段（手工合并残留）。
- **P2 meter 带压抽屉边线（TRUE，记录待排期）**：pre-range 问题——meter
  不透明带的上 4px 会盖住抽屉底边线；涉及 meter/drawer 层级重排，单独排期。
- **44px 行高/渐隐 mask/语义改名（judged-not-true）**：lane 实证无破坏
  （触摸下限=control-height-touch、mask 不及 sticky/抽屉、改名测试一致）。
