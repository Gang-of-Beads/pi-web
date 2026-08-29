# PI WEB — Capability Map, Gaps, Visual Rules, Structure
*Read-only investigation. No repo files were modified. All `file:line` references are to the working tree at `/Users/hanxiao.du/Desktop/vincent/projects/pi-web` (client paths abbreviated `C:` = `src/client/src`, `S:` = `src/server`, `SH:` = `src/shared`).*

---

## ONE-PAGE SUMMARY (read this first)

**The model the app actually implements today:** a browser talks to one *gateway* machine; the gateway knows a *fleet* of machines. Each machine has *projects* (a folder on disk), projects have *workspaces* (worktrees), workspaces have *sessions*, sessions have *messages*, and can spawn *child work* (tracked subsessions, pi-subagent runs, background tasks). Scope is real and mostly enforced: almost every call is prefixed `api/machines/:machineId/...` and every session call carries the session's `cwd`.

**What you can do, where:**
- **Sessions**: create / open / search from three places (navigation panel, Quick Switcher `⌘P`, palette `⌘K`); rename from three places with three different UIs; archive/restore/delete/detach/reload/tree only from the navigation panel's row menu or the palette; **pin only in the Quick Switcher (device-local, not archived in the list)**.
- **Messages**: copy / resend / recall-queued on every bubble; load-earlier by button or scroll; **no edit-in-place, no jump-to-message, no transcript search**.
- **Composer**: send, steer (same button, contextual), stop (abort + returns the queue to the composer), clear-queue, recall, prompt history, attachments (picker/paste/drop), model + thinking + catalog, shell mode (`!`), dictation (only when configured), `@`-completions.
- **Subagents**: you can *watch* everything and *act* on almost nothing. A tracked subsession can be stopped only by opening it as a session and pressing the composer's Stop. A pi-subagent run **cannot be stopped or steered from anywhere** — the app literally ships a constant saying so (`C:appState.ts:45`).
- **Fleet/machines/projects/workspaces**: add/switch/rename/remove from lists, switcher, palette and Settings; goals are read-only plus Pause/Resume/Abandon-as-slash-command; terminals are full-featured; files are browse/view/upload only — **no delete/rename/move/edit in the UI even though the endpoints exist**.

**The three things to settle first:**
1. **Stop a subagent** — feasible now; the daemon already hosts the agent process and the SDK event bus is injectable (design in Part 2, no code written).
2. **Tile inconsistency** — there are *three independent grid systems* with different column widths (150/240/140px), min heights (52/56/58/60px) and title clamp rules (1 vs 2 lines); `grid-auto-rows: min-content` guarantees tiles of different heights (your screenshot). House rules in Part 3.
3. **Scope honesty** — a few surfaces quietly operate wider or differently than the place they sit in (e.g. "Clean up" launched from a workspace's session list is machine-wide; goal buttons execute in whatever session happens to be selected). Enumerated in Part 1(c).

---

# PART 1 — THE CAPABILITY MAP

Legend: **Scope** = what the action operates on. **Derives** = the surface takes its target from the *current selection* (machine → project → workspace → session as you drill in) vs **explicit** = you picked the target in that row/dialog. **Touch** = reachable with a finger: yes / menu (via ⋯ or long-press) / palette (⌘K only).

### Scope: GLOBAL (this browser / whole app)
| Action | Surface(s) & how reached | Scope | Derives? | Touch | file:line |
|---|---|---|---|---|---|
| Open action palette | `⌘K`, context-bar "Show Actions" button | global | — | yes | C:plugins/core/actions.ts:10; C:components/appShell/AppContextBar.ts:297 |
| Open Quick Switcher | `⌘P`, context-bar quick-switch button | global (all loaded sessions) | — | yes | C:components/PiWebApp.ts:2415-2424,3196-3201 |
| Full page reload / hard reload | palette; refresh control | global | — | yes | C:plugins/core/actions.ts:91; C:components/PiWebApp.ts:3266 |
| Open settings (`⌘,`) | palette; settings route `?settings=` | global | — | yes | C:plugins/core/actions.ts:83; C:settingsRoute.ts:2 |
| Select theme / follow system / UI scale | Settings → Appearance; palette theme.select | global | — | yes | C:components/settings/SettingsAppearancePanel.ts:48,88,102 |
| Keyboard shortcut customization | Settings → Shortcuts (record/none/reset) | global | — | yes | C:components/settings/SettingsShortcutsPanel.ts:208-211 |
| Go to Chat / Files / Terminal (`⌘1/2/3`) | palette; mobile tool sheet | global→current workspace | derives (needs workspace) | yes | C:plugins/core/actions.ts:98-121; C:components/appShell/AppMobileToolSheet.ts:58 |
| Keyboard focus jumps (`⌘G` m/p/w/s/c) | palette + keyboard | global | — | palette | C:components/PiWebApp.ts:2469-2497; C:plugins/core/actions.ts:18 |
| Reset panel sizes | palette | global | — | palette | C:components/PiWebApp.ts:2444-2467 |
| Fleet report / update / restart machines | Settings → fleet section buttons | fleet (gateway's machine list) | explicit per machine + "all" | yes | C:api/clients.ts:97-104 (fleetApi); C:components/settings/SettingsFleetSection.ts:57-69 |
| Self update check / apply | pi-web status banner & status endpoints | this host | — | yes | C:api/clients.ts:80-84; C:components/PiWebApp.ts (renderSelfUpdateBanner) |
| Auth login/logout/configure provider | palette auth.login/logout → AuthDialog (method → provider → OAuth/API-key) | machine | derives (selected machine) | yes | C:plugins/core/actions.ts:62-74; C:components/PiWebApp.ts:3313 |
| Package install/update/remove (pi packages) | Settings → Packages (machine selector) | machine | derives | yes | C:api/clients.ts:110-126 (piPackagesApi); C:components/settings/SettingsPackagesPanel.ts:94,128-129 |
| Plugin enable/disable; config save | Settings → Plugins / machine config | machine | derives | yes | C:components/settings/SettingsPluginsPanel.ts:154; C:api/clients.ts:79-81 (configApi) |

### Scope: MACHINE
| Action | Surface(s) | Scope | Derives? | Touch | file:line |
|---|---|---|---|---|---|
| Switch machine | MachineSwitcher dropdown in nav panel; context-bar machine chip opens machines section | machine | explicit | yes | C:components/MachineSwitcher.ts:63-66,98; C:components/appShell/AppContextBar.ts:218 |
| Add machine | MachineList heading "+ Add machine", palette, Settings → Machines, MachineDialog | machine | explicit | yes | C:components/MachineList.ts:181-184; C:plugins/core/actions.ts:26; C:components/settings/SettingsMachinesPanel.ts:41; C:components/MachineDialog.ts:93 |
| Check health / refresh machine | row menu "Check again"; palette machine.refresh | machine | explicit row | menu | C:components/MachineList.ts:160; C:plugins/core/actions.ts:33 |
| Rename machine (incl. local alias) | row menu Rename… (native prompt); Settings → Machines (inline input) | machine | explicit row | menu | C:components/MachineList.ts:227-234; C:components/settings/SettingsMachinesPanel.ts:70-82 |
| Open machine's own PI WEB (remote) | row menu "Open PI WEB"; palette machine.open | machine | explicit row | menu | C:components/MachineList.ts:163; C:plugins/core/actions.ts:40 |
| Remove machine (remote only) | row menu Remove; MachineSwitcher actions; palette machine.remove; Settings | machine | explicit row | menu | C:components/MachineList.ts:165; C:components/MachineSwitcher.ts:116; C:plugins/core/actions.ts:48 |
| Machine-wide session **cleanup** (archive idle + delete archived) | "Clean up" in Sessions heading; palette "Clean up sessions" → SessionCleanupDialog | **machine (all projects/cwds)** | **NO — machine-wide despite living in a workspace list** | yes | C:components/SessionList.ts:290; C:components/PiWebApp.ts:2433-2438; SH:apiTypes.ts:785-792 |
| Status/health per machine | MachineList row meta + activity dot | machine | explicit | read-only | C:components/MachineList.ts:125-127 |

### Scope: PROJECT
| Action | Surface(s) | Scope | Derives? | Touch | file:line |
|---|---|---|---|---|---|
| Browse projects of machine | nav panel (tile grid) | project | derives | yes | C:components/appShell/AppNavigationPanel.ts:264-281 |
| Search projects | in-panel search field | project | derives | yes | C:components/ProjectList.ts:150-170 |
| Add project (path + optional create + trust) | ProjectList heading "+ Add project"; palette project.add; ProjectDialog with directory suggestions | project | explicit | yes | C:components/ProjectList.ts:216-221; C:plugins/core/actions.ts:56; C:components/ProjectDialog.ts:286-302 |
| Open/switch project | tile click | project | explicit | yes | C:components/ProjectList.ts:122 |
| Close project (remove from PI WEB only) | row menu "Close" + confirm | project | explicit row | menu | C:components/ProjectList.ts:140-142,232-236 |
| Project trust lookup (add dialog) | trustApi.projectTrust during add | project | explicit | dialog | C:api/clients.ts (trustApi); C:components/ProjectDialog.ts |

### Scope: WORKSPACE
| Action | Surface(s) | Scope | Derives? | Touch | file:line |
|---|---|---|---|---|---|
| Browse/search workspaces | nav panel (tile grid), search field | workspace | derives | yes | C:components/WorkspaceList.ts:87-104,157 |
| Switch workspace | tile click | workspace | explicit | yes | C:components/WorkspaceList.ts:157 |
| Workspace trust toggle | row menu → details → "Trusted" checkbox | workspace | explicit row | menu | C:components/WorkspaceList.ts:225-246,289-300 |
| Remove workspace (provider removal run, tracked as terminal command) | row menu → "Remove workspace" + confirm; palette workspace.delete | workspace | explicit row | menu | C:components/WorkspaceList.ts:218-227; C:plugins/core/actions.ts:131 |
| Copy workspace label / path | row menu details ⧉ buttons | workspace | explicit row | menu | C:components/WorkspaceList.ts:305-330 |
| Files: browse tree / view (raw/preview) / open-in-new-window | Files panel (core plugin view) | workspace | derives | yes | C:components/WorkspaceFilesPanel.ts:106; C:components/WorkspaceFileViewer.ts:141,156-161 |
| Files: upload (picker + drag-drop), cancel/dismiss batch, review dialog | Files panel toolbar + upload dialog | workspace | derives | yes | C:components/WorkspaceFilesPanel.ts:69,152,181-210; C:api/workspaceUploads.ts |
| Files refresh (`⌘⇧F`) | panel toolbar; palette | workspace | derives | yes | C:components/WorkspaceFilesPanel.ts:70; C:plugins/core/actions.ts:123 |
| Terminals: list/open/close one/close all, soft keys, copy mode, select+copy, continue-in-shell, cancel command run | Terminal panel (core plugin view) | workspace / terminal | derives (selected terminal) | yes | C:components/TerminalPanel.ts:458,471,547-565,631-634,662-667 |
| Workspace goals read: list, expand, per-task progress | GoalPanel (nav panel, max-height section) | workspace | derives | read-only | C:components/GoalPanel.ts:57-65,104-121,224-241 |
| Goal refresh | ↻ button | workspace | derives | yes | C:components/GoalPanel.ts:55-65 |
| Goal Pause/Resume/Abandon | GoalPanel command buttons → sends `/goal-pause|/goal-resume|/goal-clear` **into the selected session** | workspace list, **session execution** | mixed (see 1c) | yes | C:components/GoalPanel.ts:74-90; C:goalProgress.ts:106-128; C:components/PiWebApp.ts:2978-2998 |
| Archive a goal (workspace record → `archived/`) | two-press "Archive goal" | workspace | explicit goal | yes | C:components/GoalPanel.ts:176-190,211-219; C:api/clients.ts:161-166 (archiveWorkspaceGoal) |

### Scope: SESSION
| Action | Surface(s) | Scope | Derives? | Touch | file:line |
|---|---|---|---|---|---|
| Start session (`⌘⏎`, `⌘⇧N`) | Sessions heading "+", QuickSwitcher create row, palette | session | derives (selected workspace) | yes | C:components/SessionList.ts:296; C:components/QuickSwitcher.ts:104-120; C:plugins/core/actions.ts:139 |
| Open session | row/tile click in list or switcher; Enter in switcher opens first match | session | explicit | yes | C:components/SessionList.ts:399-410; C:components/QuickSwitcher.ts:156-160,297-303 |
| Search sessions | in-list search; QuickSwitcher search + project/workspace filter chips | session | derives | yes | C:components/SessionList.ts:219-229; C:components/QuickSwitcher.ts:96-107,250-272 |
| Rename session | row menu (native `prompt()`); QuickSwitcher inline form; context-bar inline rename | session | explicit row | menu | C:components/SessionList.ts:602-608; C:components/QuickSwitcher.ts:227-247; C:components/appShell/AppContextBar.ts:126-156 |
| Pin to top (**client-local, QuickSwitcher only**) | switcher row menu / long-press menu | session | explicit | menu | C:components/QuickSwitcher.ts:197-223 |
| Mark read | row menu; bulk toolbar | session | explicit row | menu | C:components/SessionList.ts:426,333 |
| Archive | row menu; bulk toolbar; palette session.archive | session | explicit | menu/yes | C:components/SessionList.ts:428,332; C:plugins/core/actions.ts:163 |
| Archive with descendants | row menu + confirm | session tree | explicit | menu | C:components/SessionList.ts:429,597-600 |
| Bulk archive / bulk delete archived / bulk mark-read | long-press→multi-select, ☑ heading toggles, toolbars | sessions (explicit set) | explicit | yes (long-press) | C:components/SessionList.ts:332-347,481-490 |
| Restore archived session | row menu | session | explicit | menu | C:components/SessionList.ts:420 |
| Delete transient "new" session | row menu; palette session.delete | session | explicit | menu | C:components/SessionList.ts:424; C:plugins/core/actions.ts:179 |
| Delete archived session (permanent, confirmed) | row menu; bulk toolbar | session | explicit | menu | C:components/SessionList.ts:421,347 |
| Detach from parent | row menu only | session | explicit | menu | C:components/SessionList.ts:433 |
| Reload from disk | row menu (disabled while active); palette session.reload | session | explicit | menu | C:components/SessionList.ts:434; C:plugins/core/actions.ts:171 |
| History & branches (tree navigator: expand, select, **fork**, cancel summarization) | row menu "History and branches" → dialog; also `/tree` | session tree | explicit | menu | C:components/SessionList.ts:432; C:components/SessionTreeNavigator.ts:147-154,275-291 |
| Stop active work (`⌘.`) | composer stop button; palette session.stop | session (selected) | derives | yes | C:components/PromptEditor.ts:384; C:plugins/core/actions.ts:187-196; C:components/PiWebApp.ts:3021-3024 |
| Cycle model / thinking (`/model`, thinking dialog) | composer status buttons; palette model.select/thinking.select | session | derives | yes | C:components/PromptEditor.ts:482-483; C:components/ModelPicker.ts:123-172 |
| Enable/disable models in catalog | ModelPicker catalog tab toggles | session | derives | yes | C:components/ModelPicker.ts:166-172; C:api/clients.ts:527-528 |
| Dismiss session warning | warnings strip | session | derives | yes | C:components/ChatView.ts:1669,1696 |
| Subtree expand/collapse of children | chevron in session row | session tree | explicit row | yes | C:components/SessionList.ts:452-469 |

### Scope: MESSAGE (selected session's transcript)
| Action | Surface(s) | Scope | Derives? | Touch | file:line |
|---|---|---|---|---|---|
| Send / **steer while streaming** (same button) | composer send button; `⏎` | session | derives | yes | C:components/PromptEditor.ts:383; C:components/PiWebApp.ts:2991-3002 |
| Stop & return queue to composer | composer stop | session | derives | yes | C:components/PromptEditor.ts:384; C:components/PiWebApp.ts:3019-3024 |
| Clear queue (without stopping) | queued strip "Clear queue" | session | derives | yes | C:components/ChatView.ts:2050 |
| Recall one queued message (↩) | queued bubble button | message | explicit | yes | C:components/ChatView.ts:2332 |
| Resend / "edit and send again" (↻) | bubble hover action → refills composer | message | explicit | yes | C:components/ChatView.ts:2346-2349; C:resendMessage.ts |
| Copy message (⧉) | bubble action | message | explicit | yes | C:components/ChatView.ts:2351 |
| Prompt history (recall past prompt) | composer history button → sheet with search | session | derives | yes | C:components/PromptEditor.ts:659; C:components/PromptHistoryPanel.ts:64-76 |
| Attachments (picker/paste/drop), remove, zoom | composer; image parts | message | derives | yes | C:components/PromptEditor.ts:362-376,495,512; C:components/ChatView.ts:2458 |
| Shell mode (`!`), autocomplete (`/`, `@`) | composer editor | message | derives | yes | C:inputModes.ts; C:components/PromptEditor.ts:358-360 |
| Dictation (when configured) | composer mic button; tap-to-talk | message | derives | yes | C:components/PromptEditor.ts:688-706 |
| Load earlier messages | button / scroll-up | session | derives | yes | C:components/ChatView.ts:2168 |
| Expand message meta | meta line toggle | message | explicit | yes | C:components/ChatView.ts:2291 |
| Answer `ask_user` (multi-step form, keep editing, send anyway) | AskUserCard | session | derives | yes | C:components/AskUserCard.ts:101,200-229 |
| Answer/cancel extension dialogs (+ settled cards) | ExtensionDialogCard | session | derives | yes | C:components/ExtensionDialogCard.ts (wiring C:components/ChatView.ts:2065-2085) |
| Copy/dismiss one notification; dismiss all; per-notification overflow info | drawer notifications tab | session inbox | derives | yes | C:components/ChatView.ts:1578-1586,1285 |
| Jump to bottom | floating button | session | derives | yes | C:components/ChatView.ts:1186 |

### Scope: SUBAGENT RUN / CHILD WORK (selected session's drawer)
| Action | Surface(s) | Scope | Derives? | Touch | file:line |
|---|---|---|---|---|---|
| Open tracked subsession (selects it as a session) | drawer "Subagent" row | child session | explicit row | yes | C:components/ChatView.ts:1495-1509; C:components/PiWebApp.ts:711-716 |
| **Stop a tracked subsession** | only indirectly: open it, then composer Stop | child session | explicit (after open) | indirect | C:components/PiWebApp.ts:711-716 + C:components/PromptEditor.ts:384 |
| Open a pi-subagent run's conversation (read-only) | drawer "Agent" row → dialog; states why steering is unavailable | subagent run | explicit row | yes | C:components/ChatView.ts:1512-1532; C:appState.ts:37-61 |
| Open background task output | drawer "Task" row (disabled until output exists) | background task | explicit row | yes | C:components/ChatView.ts:1536-1553; C:components/PiWebApp.ts:3043-3046 |
| Activity filter (kind) / active-vs-finished scope | drawer chips | session | derives | yes | C:components/ChatView.ts:1434,1483 |
| **Steer / interrupt / stop / resume a pi-subagent run** | **NOWHERE** — constant `SUBAGENT_INTERVENTION_UNAVAILABLE` | subagent run | — | — | C:appState.ts:45,61 |
| Cancel a queued terminal-command run | terminal command-run card | terminal command | explicit | yes | C:components/TerminalPanel.ts:458 |

### Scope: TERMINAL
Covered above (TerminalPanel). All workspace-scoped, derived from selected workspace; terminal selection is per panel state (`C:controllers/terminalSelection.ts`).

### 1(a) Same action, more than one place, different behavior
1. **Rename session** — three UIs: native `prompt()` in SessionList (`SessionList.ts:602-608`), inline form in QuickSwitcher (`QuickSwitcher.ts:227-247`), inline form in the context bar (`AppContextBar.ts:126-136`). Machine rename likewise: `prompt()` in MachineList (`MachineList.ts:227-234`) vs inline in Settings (`SettingsMachinesPanel.ts:70-82`).
2. **Pin vs Archive** — two "keep this visible" concepts on disjoint surfaces: Pin exists *only* in the Quick Switcher and is device-local (`pinnedSessionIds`, `QuickSwitcher.ts:197-223`); Archive exists *only* in the nav list/palette and is server-side. Neither surface offers the other.
3. **Stop-like controls** — three adjacent semantics: composer Stop (aborts turn *and* returns queue to composer, `PiWebApp.ts:3019-3024`), palette "Stop active work" (same), and queued-strip "Clear queue" (clears *without* stopping, `ChatView.ts:2050`). Intentional, but nothing in the UI names the difference; a fourth stop (child sessions) is missing entirely.
4. **Delete archived sessions** — three paths with different scopes: one row (`SessionList.ts:421`), bulk selected (`:347`), machine-wide age-based cleanup (`SessionCleanupDialog`, `apiTypes.ts:785-792`).
5. **Refresh** — `⌘⇧R` "Refresh current panel" (`PiWebApp.ts:2401-2408`) vs `⌘⇧F` "Refresh files" (`core/actions.ts:123-129`): same verb, different scope, both global shortcuts.
6. **Remove machine** — four surfaces (row menu, switcher actions, palette, Settings), same op, consistent — the counter-example that shows the pattern works when applied.

### 1(b) Actions only where a user is unlikely to look
1. **Fork from history** — only inside Session tree dialog after selecting a node and pressing Next (`SessionTreeNavigator.ts:275-291`).
2. **History & branches / Detach from parent / Reload from disk** — row-menu-only (`SessionList.ts:432-434`).
3. **Workspace trust** — buried in the workspace row menu details (`WorkspaceList.ts:225-246`).
4. **Model catalog enable/disable** — second tab of the model picker (`ModelPicker.ts:166-172`).
5. **"Clean up"** — deliberately quiet text button in the heading (`SessionList.ts:290`); its machine-wide scope (see 1c) makes the quietness riskier.
6. **Pin** — only in the switcher row menu (`QuickSwitcher.ts:216-223`).
7. **Fleet update/restart per machine** — Settings → fleet (`SettingsFleetSection.ts:57-69`).
8. **Terminal "Continue in shell" / "Cancel command"** — inside the command-run card (`TerminalPanel.ts:458-471`).

### 1(c) Scope-bearing surfaces that do NOT derive scope from the current session/project
1. **"Clean up" sessions** (`SessionList.ts:290` → `sessionsApi.cleanupPreview`, `apiTypes.ts:785-792`): launched from a *workspace's* session list, but the preview covers **every discovered project/workspace path on the machine** (`projectCwds` defaults to all). A surface that says "sessions here" acting machine-wide is exactly the "must resolve against the current project" violation.
2. **Goal Pause/Resume/Abandon buttons** (`GoalPanel.ts:74-90` → `PiWebApp.ts:2978-2998`): the list is workspace-scoped, but execution is "type this slash command into **whatever session is currently selected**". If that session isn't the one working the goal, the extension must raise a picker. The button never names the session it will run in.
3. **QuickSwitcher "New session"** (`QuickSwitcher.ts:104-120`): creates in the workspace selected *before* the sheet opened, not the project/workspace currently active as filter chips inside the sheet. The subtitle "In <workspace>" states it, but the filter chips imply otherwise.
4. **Subagent "Open" silent no-op** (`PiWebApp.ts:711-716`): finds the child in already-loaded session lists; if the child isn't in this workspace's listing the tap does nothing — scope resolution fails silently instead of saying "not in this workspace".
5. **`machineId = "local"` defaults everywhere** (`C:api/clients.ts:9`, `sessionSocket.ts:44`, and component props `PromptEditor.ts:211`, `TerminalPanel.ts:29`, `ProjectDialog.ts:24`, `WorkspaceList.ts:30`): today's call sites pass `selectedMachineId(state)` (138 references), so it's a structural foot-gun rather than an active bug — one forgotten argument silently targets the local machine.
6. **Fleet operations** (`clients.ts:97-104`): "every machine" means *the gateway's* machine list — correctly documented at the API, but the Settings section doesn't restate it.

---

# PART 2 — THE GAPS

## Gap 1: A user cannot stop a subagent run anywhere

**Today's state.** The web UI renders child work in the chat drawer: *Subagent* rows (tracked subsessions, `ChatView.ts:1495-1509`) and *Agent* rows (pi-subagent tool runs, `:1512-1532`). Both are open-only buttons. A run's conversation opens read-only with the banner "Steering this run is not available from the web app." — the exported constant `SUBAGENT_INTERVENTION_UNAVAILABLE` (`C:appState.ts:45`, used at `:61`). The justification comment (`appState.ts:31-36`) says steering "travels over the subagent extension's RPC on the in-process Pi event bus, which this server does not hold." **That premise is now false**: the daemon *is* the process hosting the agent, and the event bus is injectable.

**Verified mechanism (all paths checked in this repo):**
- The SDK's `DefaultResourceLoader` creates or accepts one `EventBus` per session: `this.eventBus = options.eventBus ?? createEventBus()` (`node_modules/@earendil-works/pi-coding-agent/dist/core/resource-loader.js:158`), and `DefaultResourceLoaderOptions.eventBus?: EventBus` is a public injection point (`dist/core/resource-loader.d.ts:71`).
- Every extension is loaded against that same bus (`loadExtensionsCached(..., this.eventBus)` at resource-loader.js:411/425/440/748), and the extension API exposes it as `pi.events.emit(channel, data)` / `pi.events.on(channel, handler)` (`dist/core/extensions/loader.js:333-340`).
- So an extension inside the agent process can RPC another extension — proven by the pi-goal fork (commit `c1057d2`, `extensions/goal-background.ts`): request on `"subagents:rpc:v1:request"` with `{version:1, requestId, method, params}`, reply on `"subagents:rpc:v1:reply:<requestId>"`; methods `ping/status/manage/spawn/steer/interrupt/stop/resume`.
- pi-web builds each session's services in the daemon via `createAgentSessionServices({resourceLoaderOptions})` (`S:sessions/piSessionService.ts:973-978`), and `piWebResourceLoaderOptions` (`:940-945`) currently passes only `appendSystemPromptOverride` — **the daemon does not yet keep a handle to the bus, but the option to hand it one already exists.**
- The daemon holds the rest of what's needed: `PiAgentSession` with `session.extensionRunner` and `runtime.services.resourceLoader` (`piSessionService.ts:431-446, 556-584`), a per-session HTTP route family (`S:sessions/sessionRoutes.ts:522-537` abort/stop, `:319-332` subagent-run reads), and run-ownership facts on disk (`S:sessions/subagentRuns.ts:7-40`: `<sessionDir>/<parentId>/<runId>/…`, forks under `…/forks/…`, artifacts under `subagent-artifacts/`).

**Two child mechanisms, two fixes:**
1. **Tracked subsessions** are full AgentSessions the daemon itself started and keeps in its active map (`piSessionService.ts:1549-1590`). For these, *no event bus is needed*: the daemon can abort the child exactly like the session `abort` route does. Today the only stop is indirect — open the child as a session, then press the composer Stop (`PiWebApp.ts:711-716` + `PromptEditor.ts:384`).
2. **pi-subagent runs** are files on disk plus an extension-owned process; only the extension can interrupt them → the RPC route.

**Recommended design (ranked):**

**Design A — one daemon route family, two backends (recommended).**
- New routes, following the existing session-route shape (`sessionRoutes.ts:522`):
  - `POST api/machines/:m/sessions/:id/subagent-runs/:runId/stop` (and later `/steer` with a text body) → daemon validates ownership (run directory under this session per `subagentRuns.ts` rules, or named by the parent transcript), then emits `method:"interrupt"` (or `"stop"`) over that session's event bus and awaits the reply.
  - `POST api/machines/:m/sessions/:id/subsessions/:childId/stop` → direct `abort()` of the tracked child session in the daemon's active map; returns the discarded queue like `abort` does.
- Bus injection: pass a per-session `EventBusController` via `resourceLoaderOptions.eventBus` in `createDefaultRuntimeFactory` (`piSessionService.ts:947-978`), store it on the runtime record next to `services`/`diagnostics` (`:488-489`). Request/reply with a bounded timeout — the codebase already has the pattern to copy: `ExtensionDialogWaiters` (`S:sessions/extensionDialogWaiters.ts`).
- Client: Stop button on the *Agent* row and on the *Subagent* row in the drawer (`ChatView.ts:1495-1532`), plus Stop in the run-conversation dialog replacing/augmenting the `interventionUnavailable` banner (`appState.ts:45`). Gate visibility on a capability flag (the `PI_WEB_CAPABILITIES` pattern used for plugin lifecycle, `PiWebApp.ts:2550-2560` region) so an older daemon degrades to today's read-only behavior instead of erroring.
- Why not the alternatives: **(B)** typing `/subagent …` slash commands through `runCommand` — reaches only the *selected* session's extension, output is human-facing text, no structured result; **(C)** asking the parent agent to interrupt ("send a message telling the agent to stop the child") — non-deterministic and slow, exactly what the RPC exists to avoid.

**Failure modes to design for (each maps to a specific response):**
| Failure | Detection | Response |
|---|---|---|
| Run not owned by this session | validate `runId` against the ownership records before emitting (`subagentRuns.ts` header rules: run dir under parent, or named in parent transcript) | 404 with owner hint |
| Run already finished | extension's own status (ping/status) or artifact present | 409; row stays read-only |
| Extension not loaded (pi-subagents not installed, or project untrusted so its extensions were skipped) | no handler on request channel → timeout; or proactively `session.extensionRunner.getExtensionPaths()` / `hasHandlers` | 503 "the subagents extension is not loaded in this session" — UI hides Stop instead of advertising it |
| Daemon restarted mid-request | reply never arrives → bounded timeout; repeat call is idempotent ("finished"/"not found") | 504-style error, row refreshes |
| Fork-context children (transcript in `…/forks/…`, no run dir until finished) | same RPC, same params the tool itself uses (`subagent({action:"interrupt", id})`) | treat identically; ownership via parent transcript record |
| Race: user presses Stop while the child is completing | reply says finished | 409 → refresh row |

**Risks (ranked):** (1) injecting the bus is an unused SDK option — needs a test double proving extensions receive the same bus instance (the loader code path says yes); (2) timeout discipline — a hung extension must not hang the HTTP route (bounded waiter, like dialogs); (3) `steer` shares the channel — ship stop first, steer second behind the same route shape so the surface doesn't grow twice; (4) ownership checks must be as strict as every other session route (`cwd`-checked refs, machine prefix) so a cross-machine guess can't interrupt another machine's child.

## Gap 2: Other capabilities users reasonably expect and cannot reach (evidence-driven)

1. **File management in the Files panel.** Endpoints and the plugin API exist for delete/move/write (`clients.ts` workspacesApi; `C:plugins/workspaceFiles.ts:11-13`), but the core panel offers only browse, view (raw/preview), upload, refresh (`WorkspaceFilesPanel.ts:69-70,106,152`). Renaming or deleting a file requires a terminal.
2. **Archive (and friends) missing from the Quick Switcher** — the phone's primary session surface offers only Open / Pin / Rename (`QuickSwitcher.ts:216-223`). The owner already logged this; confirmed still true.
3. **Pin is client-local and switcher-only.** `pinnedSessionIds` never reaches the server and doesn't appear in the nav list — a "pin" that vanishes on another device reads as a bug.
4. **No stop from the session list.** A row actively working has no Stop in its menu; the one action that cares ("Reload from disk") *mentions* stopping in its disabled tooltip but offers no way to do it (`SessionList.ts:434`).
5. **Subagent steer.** Same RPC channel as stop (`method:"steer"`); the web can watch a child's conversation read-only (`appState.ts:37-61`) but cannot talk to it. Design A above leaves the door open; ship after stop.
6. **No transcript search.** Session list search matches labels (`sessionSearch.ts`); nothing searches message content (server has no endpoint; QuickSwitcher only filters loaded sessions).
7. **Notifications are dismiss-only** — copy + dismiss per row, dismiss-all (`ChatView.ts:1578-1586`); no "open the session at this message" affordance even though the inbox knows the session.
8. **(Cross-cutting, already on MOBILE-UX-CHECKLIST:190-201)** one cross-machine "where do I need to act?" surface — unread badges exist per section, but no ranked cross-machine inbox.

---

# PART 3 — VISUAL CONSISTENCY: HOUSE RULES + CURRENT VIOLATIONS

**How each surface decides height today:**

| Surface | Height model | Title clamp | Meta line | Grid | Touch floor | Evidence |
|---|---|---|---|---|---|---|
| QuickSwitcher tiles | `min-height: 52px`, **no fixed height**; rows auto → tiles differ by row | **1-line ellipsis desktop; 2-line ≤420px** | subtitle 1-line ellipsis | `minmax(240px,1fr)` → **`minmax(140px,1fr)` on phones** | 52px row; menu btn 32px | C:components/QuickSwitcher.ts:373-374,417-418 |
| ProjectList / WorkspaceList tiles | `min-height: 56px` + **`grid-auto-rows: min-content` + `align-self: start`** → rows are each as tall as their tallest tile | **2-line clamp, break-all** | Workspace: only when label items exist; Project: path always | `minmax(150px,1fr)` | menu btn 32px (36px coarse) | C:components/shared.ts:252-266 |
| MachineSwitcher options | `min-height: 60px`, own grid | 1-line (own classes) | status line | **`minmax(140px,1fr)`, 6px gap, 8px padding** | ~60px | C:components/MachineSwitcher.ts:303,309 |
| SessionList rows | no min-height on `.action-main` (list mode) | 2-line clamp (`max-height: 2.5em`) | `<small>` meta **always** (status · N messages) | rows, not tiles | heading buttons **30px** (36px mobile); menu 32px (36px) | C:components/shared.ts:297-299; C:components/SessionList.ts:665,745-747 |
| MachineList rows | `min-height: 58px` (own override) | 1-line ellipsis | always | rows | 58px | C:components/MachineList.ts:243 |
| GoalPanel cards | `min-height: 40px` header (42px narrow) | 1-line ellipsis objective | meta row optional (collapsed) | cards stacked | 40/42px | C:components/GoalPanel.ts:186-196,271-273 |
| ChatView activity rows (subagent/run/task) | `min-height: 38px` | 1-line ellipsis per column | optional detail line | single column | 38px | C:components/ChatView.ts:188,227 |
| Notification rows | **no min-height**; padding only | wraps free | always | single column | controls 32px | C:components/ChatView.ts:263,279 |

**Root cause of your screenshot:** *both* grid systems use `align-content: start` with auto-sized rows — `grid-auto-rows: min-content` in the shared tiles (`shared.ts:252`) and default auto rows in the QuickSwitcher (`QuickSwitcher.ts:373`). Tiles in one row stretch together, but each row is only as tall as its tallest title/subtitle, so the sheet becomes a quilt of different heights. The QuickSwitcher then adds a second divergence: 1-line titles on desktop, 2-line on phones (`:417-418`), and a third column width (240/140 vs 150 elsewhere).

**Proposed house rules (short, enforceable):**
1. **One tile grid.** Grid tiles: fixed row height (`grid-auto-rows: 1fr`, `align-items: stretch`) so every tile in the sheet is identical; title clamped to exactly **2 lines** with ellipsis at every width (no desktop/mobile split); a metadata line **always rendered** (placeholder text when empty, e.g. the workspace path or "—") so single-line tiles can't shrink; one reserved trailing inset for the ⋯ button.
2. **One column metric.** `repeat(auto-fit, minmax(150px, 1fr))` everywhere a tile grid appears; delete the QuickSwitcher 240/140 pair and the MachineSwitcher 140/6px pair (or move them onto the same token).
3. **One touch floor.** Interactive control minimum 40px (44px on `pointer: coarse`) via a single token. Today's heading buttons are 30px (`SessionList.ts:665`, `GoalPanel.ts:227`), activity rows 38px (`ChatView.ts:188`), drawer controls 32px (`:263`) — all below the floor the codebase itself acknowledges elsewhere (36px mobile bumps in `SessionList.ts:745-747`, 44px on the attachment zoom close `shared.ts` workspacePanelStyles).
4. **Row lists** (non-tile): `.action-main` min-height 44px, name clamp 2 lines, meta line always — SessionList already matches; MachineList (58px, 1-line) and ChatView rows (38px) should fold in.
5. **Clamps live in one place.** Extract the `-webkit-line-clamp` pattern (currently re-implemented in QuickSwitcher:379/418, shared.ts:259/299) into one shared style so the line count can't drift again.

**Exact violations to fix against those rules:** `QuickSwitcher.ts:373-374` (grid + height), `:379` + `:417-418` (clamp split), `shared.ts:252-254` (`grid-auto-rows: min-content`, `align-self: start`), `shared.ts:259` (2-line, break-all — keep as the rule), `MachineSwitcher.ts:303,309` (third grid), `MachineList.ts:243` (58px row), `ChatView.ts:188,231` (38px/30px rows), `SessionList.ts:665` + `GoalPanel.ts:227` (30px heading buttons), `ChatView.ts:263` (32px controls).

---

# PART 4 — STRUCTURE / CLEANLINESS (top findings)

**(a) Client–server contract drift.** The single-source design is right: `SH:apiTypes.ts` (1,649 lines) is re-exported verbatim by the client (`C:api.ts`) and aliased by the server (`S:types.ts`). The drift surface is **`C:api/parsers.ts` — 2,390 lines of hand-written per-field validators** that re-state every response shape with no compile-time link to `apiTypes`; a server shape change fails per-field at runtime, not at typecheck. Concrete second home: `SelfUpdateApplyResponse` is defined and parsed ad hoc inside `clients.ts` (local `parseSelfUpdateApplyResponse`, ~clients.ts:88-101) instead of `shared/apiTypes`. Risk is structural (drift is silent), not an active bug found.

**(b) Dead code / knip.** `npm run knip` exits **0 with no findings** today. Config (`knip.json`) has **no suppression lists** — only entry globs, `ignoreExportsUsedInFile: true`, and `ignoreBinaries: ["systemd-run"]`. Nothing to clean; the gate is already doing its job.

**(c) Comment noise.** The stated convention is "comments explain why; avoid restating the code" (`.agents/skills/code-quality-architecture/SKILL.md:42`). Spot audits (`// Set/Get/Create/Check…` patterns, random samples of PiWebApp/ChatView/SessionList) found essentially none — comments here are consistently justification comments (e.g. `SessionList.ts:701-703`, `QuickSwitcher.ts:408-413`). Only cosmetic nit found: trailing blank lines at the end of `C:components/shared.ts`. No action needed beyond keeping the bar.

**(d) Highest-value module splits (by size × mixed responsibility):**
1. **`S:sessions/piSessionService.ts` (5,233 lines)** — one class owning session lifecycle, prompt/queue semantics, spawn + tracked-subsessions (spawn/register/verify/hydrate ≈ `:1478-2170`), ask-user + extension dialogs (`:1647-1877`), unread, cleanup, models. Splitting **subsession tracking** and **ask/dialog orchestration** (both already have separate stores to lean on) would make the stop-a-subagent work of Part 2 land in a module instead of deepening the monolith.
2. **`C:components/PiWebApp.ts` (3,464 lines)** — shell rendering *plus* the action catalog (`getDefaultActions`/`runAction`, `:2392-2497`, `:2786+`) *plus* controller wiring *plus* every dialog host. Extracting the action catalog (it's already data-shaped) is mechanical and shrinks the hottest file.
3. **`C:components/ChatView.ts` (3,266 lines)** — transcript rendering + the entire top drawer (activity rows, notifications, warnings, goals tabs, four dialogs ≈ `:1144-1800`). The drawer is a self-contained stateful widget with its own styles (`:188-290`); it wants to be `SessionActivityDrawer`.

---

*End of report. Investigated read-only; scratch state only under /tmp (`/tmp/knip-out.txt`).*
