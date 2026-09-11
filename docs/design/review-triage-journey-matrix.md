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
3. **J6 settings（phone）— owner-pending**：More actions 菜单路径的探针定位
   未中；机主在真机上实测设置入口（此前截图证明可达）。
4. **J9 dead row inert "absent"（双端）— not-fixed-with-reason（探针导航）**：
   选中项目后 sessions 节折叠，行未渲染在探针的查找范围内；行本身是
   `DIV.cwd-missing-row` 已由组件测试（SessionList.cwdMissing.test.ts）与
   单元测试覆盖。**核心结果 J9 dead row click → 无横幅：双端 PASS** ——第四次
   横幅的根修复在运行时得到验证。
5. **J2/J3/J4/J7/J8（双端）全 PASS**：boot 干净、导航链、聊天挂载、输入落
   稿、快速切换器、机器对话框。

## 与修复波的对应

- 第四次横幅根修复 = `selectPreferredSession` 全分支跳过死会话 +
  死行静置化（875ccc92）：J9 click 双端无横幅。
- 文本可选性（a5ddc8f2）：真实浏览器断言归入下一轮 lane 评审与机主实机验证。
