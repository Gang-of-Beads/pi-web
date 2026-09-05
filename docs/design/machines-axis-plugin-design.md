# Machines 轴插件化设计（回应 owner 三问）

子代理产物：`subagent-artifacts/5d971792（边界攻击）/ 1c0c5cfb（契约设计）`。
owner 顾虑：machines 本质是管理多个 pi-web 实例的交互；若是插件，零插件原生壳少了这个 axis；快速访问等面要不要适配甚至插件化。

## 问一：零插件会不会丢轴 —— 不会，axis 本来就是核心事实

插件能拿走"机器清单+凭据+联邦网关+管理 UI"，拿不走 `(machineId, projectId, workspaceId)` 元组：

**核心必留（≈30% 残留，都是"实例"作为身份维度，不是 machines 功能）**：
1. 不透明 `machineId` + `LOCAL_MACHINE_ID` 常量 + 按机器分区的 key（machineKeys.ts：localStorage/历史/草稿/通知/realtime）。
2. `?machine=` 作为 core 路由一等参数（解析并忽略未知值；未知回落 local，PiWebApp.ts:1151,1280-1282）。
3. `/api/machines/local/*` 字面双注册（app.ts:255-287 全部 core 路由已双挂），代理腿对 local 显式 501（machineProxyRoutes.ts:73-75）。
4. "本机"产品语义：可命名（machineService.ts:43-46）、不可删（machineController.ts:88-91）、runtime/status 归本机。

**插件所有（pi-web-machines，runs:"web"）**：machines.json、`/api/machines` 集合与 `:id/{health,runtime}`、`:id/*` 联邦代理、远端插件清单代理（machinePluginProxyRoutes.ts:40）、MachineList/MachineSwitcher/SettingsMachinesPanel/SettingsFleetSection、9 个服务端文件整体搬运。

**硬证据（为什么轴不能进插件）**：插件系统自身按机器分发——`PluginRuntimeContext.machineId`（plugins/types.ts:15-18）、`DrawerSectionContext.machineId`（:167）。轴若是插件，"插件发现"就依赖一个插件，契约字段却要求 machineId，实现与契约自相矛盾。

## 零插件降级行为（absence is not negation）

**必须同批落地的两条 P1**（否则卸载插件当天把"故障"包装成"没有"）：
1. `machinesLoad` 状态机（unknown/absent/failed/ready）：从插件注册表读 `pi-web-machines` 是否 active 得显式 absent；absent → machines 恒 `[]`、不请求、**不弹错**（现状：零插件 404 会走 errorNoticePatch，健康单机每次启动弹红错，machineController.ts:12-35）；failed → 占位+重试（对齐 projects 已有的 `projectsLoad:"failed"`+重试，PiWebApp.ts:1068）。现在 `length>0` 门控（AppNavigationPanel.ts:451、AppContextBar.ts:523）把"查询失败"渲染成"这台设备没有设备概念"。
2. remote 深链保留：`?machine=office&project=…` 在插件缺席/清单失败时，现状被 `routeForSelectedMachine` 改写 local 并 `replaceState` 抹掉 URL（PiWebApp.ts:1060,1281-1282），无法回退。改为 machine≠local 且 `machinesLoad≠ready` 时保留 URL 进重试。

**两条 P2（随批修）**：
3. 本机 deprecation 告警零插件时变哑（告警遍历 machines 清单）→ absent 时回落 `piWebRuntime()`。
4. fleet 自更新页反向依赖：`FleetMachines` 窄口已存在（fleetRoutes.ts:27,:45 注入点）但默认值 `new MachineService()`（:58）在 core import 插件-to-be 模块 → 抽取后默认改由插件注册提供，零插件只报 local。

## 问二：快速访问要不要适配 —— yes，一个生产者三个表面

- **新增 `navigationSections` 贡献点**（形状照抄 `DrawerSectionContribution`，types.ts:186）：导航面板机器 section（AppNavigationPanel.ts:162-174,231-253 硬编码迁出）；壳保折叠、`NAVIGATION_SECTION_ORDER` 键盘序、focusSection。节序里硬编码的 `"machines"`（navigationState.ts:3）改为贡献排序+未知节忽略。
- **QuickSwitcher machine tabs 与面包屑 machine chip 不新增缝**：插件激活时经 host 能力把 roster 写入 core `state.machines`，两处继续读该 state，现有 classifier 原样生效（tabs `length<2` 隐藏、chip 同 gating）——**三个表面一个生产者**。数据归插件、`selectedMachine` 指针与 URL machineId 归 core（scope 法，调和 pi-twin-plugin-design.md:158-159 与 extraction.md:42-46 的措辞冲突）。
- 同删 `PluginRuntimeContext` 的 addMachine/refreshSelectedMachine/removeSelectedMachine/openSelectedMachine（types.ts:381）——core 点名插件功能即 multi-producer，改插件 actions。

## 问三：快速访问页面本身要不要插件化 —— no

QuickSwitcher/导航面板/面包屑是 shell chrome，承载跨插件不变量（会话浏览、键盘导航、折叠、breakpoints、与所有贡献 section 共存）。反证：若 QuickSwitcher 归机器插件，零插件壳连会话切换都没有——feature 越权接管了 shell。**插件化的是"机器轴"，不是切换器。**

## 必须成文的契约

Fastify 静态 local 路由优先于插件参数化 `/api/machines/:machineId/*`，参数化腿对 local 显式 501。验收测试：**local 会话事件 socket 永不进代理腿**（注册顺序翻转=本地流量被代理给远端，最小失败场景）。

## 迁移四步（每步验收）

1. 契约先行：types+registry+`navigationSections` 测试，零消费者变化。验收：现有套件全绿。
2. 核心走缝：导航机器 section 由 registry 渲染，core 内置 builtin-machines section。验收：8505 探针 393x850 coarse pointer 三处快速访问行为与迁移前一致。
3. 服务端搬运：9 文件→pi-web-machines（runs:"web"，Wave 0 双前缀挂载+碰撞诊断即为此建）。验收：零插件壳 `/api/machines` 404 无错误通知、机器面全隐、`/api/machines/local` 全通；装插件后 CRUD/代理/远端清单回归绿。
4. roster 收尾：tabs/面包屑 absent-aware；删 core 4 个回调。验收：absent 无通知；单机安装时机器 section 仍显示（单机也要能改名/加机器）。

## 留 owner 裁决

- roster 写回 host API 形状（直写 `state.machines` vs 只读事件流）：本文只锁"一个生产者"。
- machineStatusController、machineNavigationMemory 归属边界（两代理均未读到，未判）。
