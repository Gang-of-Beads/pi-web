# Lane A — PI WEB 手机全表面点走查报告(393×850)

审查人:Lane A(点走查 + 重叠猎捕)
日期:2026-09-10 · 栈:http://localhost:8505/(共享,未重启,未改任何仓库文件)
方法:repo 内 playwright(headless chromium),viewport 393×850 / hasTouch / isMobile,全部用 `page.touchscreen.tap` 走真实触控路径;shadow DOM 用 `page.locator("pi-web-app").locator(...)` 穿透。每个表面:打开 → 等待 800–1500ms → 截图 `/tmp/pro-walk-NN-*.png` → 关闭 → 复位对照。探针脚本仅存于 /tmp/pro-walk/。

---

## 总结论

1. **没有发现"两个页面互相叠成堆"的硬渲染叠层 bug**:手机上所有导航面(面板/聊天/工具)都是**全屏换页**,DOM 里同一时刻只有一个主表面(census 逐步验证)。真正的"叠"来自两类东西:① 弹层(对话框/palette/sheet/行菜单)与底下内容**几乎零视觉分离**;② 少数真重叠(标题行挤压、菜单压卡片文字)。
2. 观感根源是 pro 主题的三个 token:`--pi-shadow-soft/-/-strong: #0000`(`src/client/index.html:176-178`)使所有 elevation 失效;`--pi-overlay: #0008`(`src/client/index.html:175`)使遮罩只有 50% 黑——在 `#0d1117` 底色上等于没有;`--pi-font-ui: ui-monospace…`(`index.html:139`)让文字更宽更密,叠读时更难分清归属。
3. 全部表面都能打开、除以下点名的都能关闭并回到原状态;发现 1 个死按钮、2 处文字被裁/被压、1 处状态语自相矛盾、1 处状态残留。

---

## 发现清单

### P1(观感级,贯穿全 app)弹层与底下页面无分离 → "文字叠文字"
- 表面/证据:
  - Actions palette 打开时,底部 Projects 卡片以全亮度透出:`/tmp/pro-walk-09-actions-palette.png`、`/tmp/pro-walk-49-modk-quick-switcher.png`(palette 下方 Relays/Updates/Info 工具行全亮)。
  - Add project 对话框底部露出底下卡片行:`/tmp/pro-walk-13-add-project.png`。
  - Model picker 覆盖聊天时,其上/下的聊天文字透出:`/tmp/pro-walk-59-model-picker.png`。
- 机制:`src/client/src/components/ModalSurface.ts:173` — `.backdrop { … background: var(--pi-overlay); … }`;`src/client/index.html:175` `--pi-overlay: #0008`;`index.html:176-178` 三个阴影 token 全透明,`--pi-elevation-1/2/3`(`index.html` 同块)全部无效。
- 判定:**真实**(观感即 owner 报告的"叠";非功能缺陷)。

### P2(确认机制)未读徽标出现时,"Sessions" 标题行溢出,checkbox 滑到标题文字原位(= owner 的 checkbox 压 "Sessions")
- 复现路径:抽屉/Sessions 列表 heading 行出现 "N unread" 徽标时(需要未读会话;本人未写用户数据,未能在真实数据下触发)。
- 实测(浏览器内对活 DOM 注入 `<small class="section-unread-count">1 unread</small>` 后由真实 flexbox 计算,已移除,**标注为模拟**):
  - 无徽标基线(不重叠):`/tmp/pro-walk-57-sessions-measure.png`;h2 x10 w373,checkbox x105。
  - 注入后:h2 `scrollWidth 379 > clientWidth 373`(溢出),`.plain-heading`("Sessions")被压到 **w=0**,checkbox 从 x105 滑到 **x30** — 即压到标题原绘制位置。
- 机制(file:line):heading 把 `[标题][checkbox][unread][Clean up][+New session]` 排在一行 — `src/client/src/components/SessionList.ts:274-281`;coarse 指针下 gap 加大到 `--pi-space-8`:`SessionList.ts:703`;`h2 > .bulk-select-entry { margin-left: auto }`:`SessionList.ts:708`;徽标样式 `flex: 0 0 auto`:`SessionList.ts:710`;标题允许收缩 `min-width: 0`:`SessionList.ts:734`。行 nowrap 无换行预算,393px 下总数超宽,唯一可收缩项是标题词。
- owner 佐证:`/tmp/heading-zoom.png`(其缩略图取自挤压态;注意 owner 截图是橙色主题+比例字体,机制相同)。
- 判定:**真实**(机制确认;像素级形态取决于徽标宽度/字体,标注为模拟复现)。

### P3(真·两表面同屏)快速切换器切到 prod-8504 机器页签 = 底部 sheet + 上方完整 Sessions 列表同屏、无分隔
- 点击路径:面板 → compact-session("Open session selection")→ quick switcher → 点 "prod-8504" 页签。
- 截图:`/tmp/pro-walk-53-qswitch-machine-tab.png` — 上半屏是面板的 sessions 区(pi web / Sunshine… / hu,全亮可读),下半屏是 quick-switcher sheet(搜索框、+New session、"Loading sessions…")。两表面同屏、遮罩弱化(P1),读起来就是"两页叠着"。
- 附加不一致:同一 sheet 内 "Open a session on this machine first" 与其下方 "Loading sessions…" 同时出现(是空态还是加载中,自相矛盾)。
- 判定:**真实**(布局合法但观感即 owner 的"叠";状态语矛盾为独立小缺陷)。

### P4(死按钮)context sheet 内的 "+ Add project" 点击无任何响应(2/2 次)
- 点击路径:面板 → compact-scope("Change machine, project or workspace")→ sheet 内 Projects 区右上 "+ Add project" → 等待 900ms ×2 次。
- 截图:`/tmp/pro-walk-63-sheet-add-project-retry.png`(与未点的 `/tmp/pro-walk-01-context-sheet.png` 无差异);DOM 检查:点击后仅存在 sheet 自己的 1 个 modal-surface,无新增对话框/输入框。
- 对照:boot 面板上的同名按钮工作正常(`/tmp/pro-walk-13-add-project.png` 全屏 Add project 表单)。
- 机制:sheet 以 `withCreate: true` 渲染 projects 区(`src/client/src/components/appShell/ContextSwitcherSheet.ts:67-70`),按钮存在且可命中(实测 rect 325,73);handler 链路为何无输出未查到,**推测**:onAddProject 回调在该宿主路径未接线或被静默 guard 拒绝 — 标注为推测。
- 判定:**真实**(用户可感知的死控件)。

### P5(文字被裁)Appearance 主题卡 "Pro (native)" 描述第三行被卡底切断(半行残字)
- 截图:`/tmp/pro-walk-16-settings-appearance.png` — "Flat mono terminal look – the app without a_ / theme extension." 第三行只露一半字高。
- 机制:描述声明为 2 行 clamp — `src/client/src/components/settings/SettingsAppearancePanel.ts:164`(`-webkit-line-clamp: 2; min-height: calc(2*1.4em); overflow: hidden`);实际渲染出 3 行且被切。**推测**:393px 双列卡内 mono 字体换行数超出 clamp 预期,或卡高度由网格行高固定后内容溢出 — 机制未定,标注为推测。
- 判定:**真实**(截图即证)。

### P6(重复标题)Appearance 对话框头与区块标题连续两个 "Appearance"
- 截图:`/tmp/pro-walk-16-settings-appearance.png`:顶部对话框标题 "Appearance",其下紧跟区块大标题 "Appearance" + 说明文。
- 判定:**真实**(风格不一致,pro 主题下同词同字号级别重复)。

### P7(文案重复)手机 scope chip 显示 "pi-web · pi-web"
- 位置:面板/会话/工具所有手机视图顶部左侧 chip。
- 机制:`src/client/src/components/appShell/AppNavigationPanel.ts:217-221` — `compactScopeLabel()` 把 project.name 与 workspace basename 用 " · " 连接,同名不去重(本仓库工作目录恰为 pi-web/pi-web)。
- 截图:`/tmp/pro-walk-19-project-open-workspaces.png`、`/tmp/pro-walk-21-sessions-list.png`。
- 判定:**真实**(数据正确、展示未去重)。

### P8 项目行 "⋯" 菜单:仅 "Close" 一项、Escape 不关、压在卡片文字上
- 点击路径:Projects 网格 → 卡片右上 "⋯"(aria-label "Actions for test")。
- 截图:`/tmp/pro-walk-11-project-row-menu.png` — 菜单(120×54,唯一项 "Close")压住 test 卡的路径文字。
- 机制:菜单仅一项 "Close"(移除项目,confirm 后执行)— `pi-web-plugins/workspaces/browser/ProjectList.ts:124-126`;菜单定位贴着触发器右侧、可盖住卡内文字:`src/client/src/components/actionMenu.ts:8-33` + `shared.ts:483`(flat:border-only、零阴影 token)。
- 关闭行为(实测):① 点击 project-list **之外**(如顶栏)关闭 — `ProjectList.ts:59-66`(`composedPath().includes(this)` 判断);② 再点同一 ⋯(toggle)关闭;③ **Escape 不关闭**(该组件无菜单级 Escape handler;唯一 Escape 在搜索框,`ProjectList.ts:202`)——与全 app 其他表面(对话框/sheet/palette 均响应 Escape)不一致。④ 菜单开着时点击列表内空白(网格 gutter)既不关闭也不导航(实测复现 `/tmp/pro-walk-32-walk2-sequence-repro.png`)。
- 判定:**真实**(行为不一致 + 菜单单薄 + 压字)。

### P9 会话行 "⋯" 菜单同样压在相邻会话行上
- 点击路径:Sessions 列表 → 行 "⋯"(title="Session actions",`SessionList.ts:438`)。
- 截图:`/tmp/pro-walk-48-session-row-menu.png` — 菜单(Archive / Rename / History and branches / Reload from disk)盖住下方两行的右半,零 elevation。
- 判定:**真实**(弹层压行属正常层级,但 P1 的扁平化使其读作"文字叠文字")。

### P10(状态残留)从 "More actions" 折叠行打开的对话框关闭后,折叠行保持展开
- 路径:More actions → Settings → Escape → 折叠行(Settings/Actions 两按钮)仍占一行,后续每张 "关闭后" 截图与 boot 差 ~51k 像素均由此而来:`/tmp/pro-walk-08-settings-closed.png`(可见 Settings|Actions 行带焦点环)。
- 判定:**真实但属设计二义**(折叠行是独立 toggle; Escape 只关对话框)。建议:Escape 关闭顶层对话框时同步收起折叠行,或折叠行打开时自动收起。

### P11(诚实性小瑕疵)快速切换器 "+New session" 空态文案与加载态同屏(并入 P3 附加项)。

---

## 航向三项(父会话追加)核对结果

1. **checkbox 压 "Sessions"**:机制确认(P2)。基线(无未读)不重叠;真实触发需要未读徽标,本次未在不动用户数据的前提下于活栈触发,采用 DOM 注入模拟并如实标注。
2. **context chips 11px(projects)vs 13px(sessions)**:**未复现**。实测两视图 scope chip(`.compact-scope-name`)均 **13px**(computed font-size 逐元素扫描:projects 视图 13/13/12/12,sessions 视图 13/13/12/12/12/12 — 12px 为区块标题/按钮,两视图一致)。owner 所指可能是另一组 chips(桌面 AppContextSwitcher 或 sheet 内行),本次手机走查范围内无 11px 文本(最接近的 `--pi-text-2xs` 用于未读 pill 与主题卡描述)。
3. **搜索框高度 projects vs sessions**:输入框实测**等高 44px**(projects `.list-search-input` 44px/字号 16px;quick switcher `.session-search` 输入框 44px/字号 17px — 字号有 16→17 差异,高度无差)。真正的不一致在**存在性**:sessions 列表会话数 <5 时完全不渲染搜索(`SESSION_SEARCH_MIN_SESSIONS = 5`,`src/client/src/sessionSearch.ts:14`、`shouldShowSessionSearch` `sessionSearch.ts:92-94`),而 projects 列表恒显搜索 — 同类列表行为不一致(pi-web 工作区 3 个会话故无搜索框,对照 `/tmp/pro-walk-21-sessions-list.png` vs `/tmp/pro-walk-00-boot.png`)。

---

## 关闭/返回清洁度(逐表面)

| 表面 | 打开 | 截图(开) | 关闭方式 | 关闭后状态 |
|---|---|---|---|---|
| Context sheet(scope chip) | ✓ | 01 | X 按钮 | boot 逐像素一致(diff 0)✓ |
| Quick switcher(Local 页签) | ✓ | 03 | Escape | 一致(554px 残差=焦点环,04)✓ |
| Quick switcher(prod-8504 页签) | ✓ | 53 | Escape | ✓(见 P3) |
| More actions 折叠行 | ✓ | 05 | 再点(Fewer actions) | 对称 ✓ |
| Settings 对话框 | ✓ | 07/15 | Escape | 对话框关 ✓,折叠行残留(P10) |
| Settings → Appearance(主题卡) | ✓ | 16 | Back 链接 + Escape | ✓ |
| Actions palette(按钮 / mod+k) | ✓ | 09/49 | Escape | ✓(折叠行残留同 P10) |
| 项目行菜单 | ✓ | 11 | 点列表外/再点 ⋯;Escape ✗ | ✓(P8) |
| 会话行菜单 | ✓ | 48 | 点列表外(未测 Escape) | ✓ |
| + Add project(面板) | ✓ | 13 | Escape | ✓(census 干净,14) |
| + Add project(sheet 内) | ✗ 死按钮 | 63 | — | —(P4) |
| 打开项目 → Workspaces | ✓ | 19/20 | —(导航) | — |
| 打开工作区 → Sessions | ✓ | 21 | —(导航) | — |
| 打开会话 → Chat | ✓ | 22 | —(导航) | — |
| Chat 汉堡 → 面板(全屏换页) | ✓ | 23 | 再入会话返回 | ✓ |
| 工具 Files/Terminal/Tasks/Relays/Updates/Info | ✓ 六面 | 25/42/40-tasks/40-relays/40-updates/52 | 汉堡往返 ✓×6 | ✓ |
| Model picker(聊天内) | ✓ | 59 | Escape | ✓ |
| 会话行 "New session"(空工作区) | ✓ | 46 | — | 报错横幅+空态诚实(56 附注) |

另:**boot 态是有状态的**(选择持久化):同一 URL 新开 context 有时落在 Projects 网格、有时直接落在所选工作区的 Sessions 列表 — "关闭后回到 boot"因此没有唯一参照系(对照基准 `/tmp/pro-walk-00-boot.png` 为无选择时的 Projects 网格)。

---

## 误报澄清(lane 自我纠错,避免后续 lanes 重复踩)

- "行菜单卡死不关":实为探针点击落在网格 15px gutter(点在 project-list 内但不落任何卡片 → 既不关闭也不导航);点击列表外或真实卡片均正常(walk9/11)。非缺陷。
- "点 Terminal 打开 Files":探针闭包变量泄漏(`window.name=""` 使 startsWith(name) 恒真,永远点到第一行 Files);修正后六工具全部正确切换(walk13/14/15/16)。非缺陷。

## 未验证项(如实声明)

- **Clean up 对话框**(SessionCleanupDialog):两次尝试均被工作区选择状态污染打断,未成功打开其内容。
- 聊天内 **session-title → quick switcher** 入口:共享栈两次抖动(500/200 错误一次)未完成。
- 聊天输入框 "/" 命令 picker:未测。
- 真实未读徽标态下的 heading 挤压(P2):模拟复现,未在活数据上复现(避免写入用户会话)。
