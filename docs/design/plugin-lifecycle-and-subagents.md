# Plugin lifecycle hooks, and Subagents as an official plugin

Owner, 2026-09-30: "Have we not extracted the pi subagents plugin into our own plugin? Make it an official plugin that can be enabled and disabled in plugin management. Check whether enable/disable can always call the plugin's init and teardown, with a fixed injection point, so plugin developers know exactly what each behavior does."

## What existed (2026-09-30, before the slices below)

**The hooks exist, but a toggle calls none of them.**

| Half | Hooks a plugin gets | When they run today |
|---|---|---|
| Server (`server-plugin-api.ts`) | `activate(context)` returns `{ start, stop, health, operations, routes, agentFacts, … }` | `activate` and `start` at process start; `stop` at shutdown. A Settings toggle only marks **"Restart required"** (`serverRestartRequired`). |
| Browser (`plugin-api.ts`) | `activate(context)` returns `{ contributions, dispose }` | `activate` at page load. `registry.disposePlugin` exists, but nothing outside tests calls it: a disabled plugin stays on the page until a reload. |

So a plugin developer cannot say what "disable" does. It does nothing until two restarts and a reload happen, in an order nobody promises.

**Subagents is half extracted.**

- `pi-web-plugins/subagents` already draws the drawer section, reads runs through its own `server/runs.ts` (operations `runs.list` and `runs.output`), and shows the supervisor card.
- Core still owns:
  - an 813-line copy of the same reader (`daemon/sessions/subagentRuns.ts`);
  - the routes `/sessions/:id/subagents`, `/subagent-runs/:runId/messages` and `/output`;
  - the presence tool name (`SUBAGENT_TOOLS` in `pluginSurfaces.ts`; goals already declares its own through `agentFacts`);
  - the `SessionSubagent*` types in `apiTypes`;
  - the poll in `PiWebApp` (`refreshSubagents`);
  - the artifacts path in `backgroundWorkWatcher`;
  - the subagent share of the "N background runs" count (`backgroundRunCount.ts`). The status line and goal quiescence both read that count.
- The count is why core's copy could not be retired: core needs the number, and today only its own reader can produce it.

## Design

### 1. One lifecycle, the same injection points in both halves

Enable and disable run the plugin's hooks **live**, in a fixed order, with no restart and no reload:

| Event | Server half (in each process the plugin `runs` in) | Browser half (every open page) |
|---|---|---|
| **enable** (toggle on, process start, first page load) | import → `activate(context)` → `start(signal)`. Routes and operations answer only after `start` resolves. | import → `activate(context)` → contributions registered; panels appear. |
| **disable** (toggle off, shutdown) | Routes and operations stop answering first (with `409 plugin disabled`); in-flight operations get their signal aborted; then `stop(signal)`, bounded by the lifecycle timeout. | contributions removed, then `dispose()`. |
| **update** (a new revision of the plugin) | disable the old one, then enable the new one, as above. | the same, after the server half has switched. |

- **Guarantees a developer can rely on:**
  - `stop` runs exactly once after every `start` that resolved;
  - no operation or route handler runs after `stop` begins;
  - `dispose` runs exactly once per `activate`;
  - a hook that throws or times out leaves the plugin `failed`, with its phase recorded, and never half-enabled.
- **The page learns of a toggle** from one global frame, `plugins.changed { revision }`, and reconciles its registry to the manifest. That is the same compare-heads rule as the sync design.
- **Routes cannot be unmounted from Fastify**, so the host mounts one dispatcher per plugin that consults the live table. It already resolves paths per plugin.
- **The contract is written for developers** in `docs/plugins.md`, in a "Lifecycle" section with this table. A conformance kit (`scripts/plugin-lifecycle-check.mjs`) toggles a plugin on 8505 and asserts every guarantee against the real processes.

### 2. Subagents moves out of core entirely

| Moves to the plugin | How |
|---|---|
| The runs reader, routes and types | The plugin's own `server/runs.ts` and operations, which exist already. Core's `subagentRuns.ts`, the three routes and the `SessionSubagentRun*` types are deleted. |
| Presence | `agentFacts.surfaces: [{ surface: "subagents", tools: ["subagent"] }]`, like goals. |
| The poll | The plugin's own read loop, which already exists. `PiWebApp.refreshSubagents` is deleted. |
| Artifact watching | A plugin-declared watch path, through a new `agentFacts.workPaths`. |
| **Its share of "background runs"** | A new server contribution, `backgroundWork(sessionRef) → { running: number }`. The daemon sums every enabled plugin's answer for the status line and for goal quiescence. With Subagents disabled, its runs stop counting. The status line then says only what core knows (background tasks), and nothing claims to know more. |

- Subsessions started through PI WEB's own routes (`/sessions/:id/subsessions`) stay in core; they are PI WEB's delegation API. The plugin lists them beside the tool runs, as the drawer does now.
- **Disabling Subagents** hides its drawer section and its supervisor card, and stops its reads and its count. Enabling it brings them back, live.
- The pi extension (`pi-subagents`) is a separate thing the user installs in pi. The plugin reports it as `absent` when no loaded extension registers the `subagent` tool.

### 3. Background tasks move out of core too (owner, 2026-10-09)

Owner, on `PiWebApp.refreshSubagents`: "你是不是又在pi web代码里对特定的extension做兼容了？" and "如果只是命名问题，要重视一下边界" (are we again special-casing a specific extension in core; a wrong name is a boundary problem). The name was wrong: the method reads background tasks, not subagents. Behind it, core reads the private registry of one third-party extension, **pi-background-tasks** (the npm package behind `bg_run`; its `src/core/registry.ts` owns `<cwd>/.pi/tasks/<sessionId | session-<pid>>-<pid>/<taskId>.json`).

**The boundary.** Core knows pi (its session files, events, `.pi/sessions`) and PI WEB's own features (subsessions, ask_user, the delegation routes). It never parses an extension's private files, never names an extension's tools, and never carries an extension's record shape in its own types or in the plugin API. Support for a particular extension is a plugin, which a reader can turn off, and turning it off removes every trace of it: panel, count, watch, reads. A name in core that says what it does not do is a boundary leak too, and is fixed with it.

Every place core crossed it, found 2026-10-09:

| Core today | Moves to |
|---|---|
| `daemon/sessions/backgroundTasks.ts` (427 lines): the registry reader, process liveness, the ownership file it writes beside the registry | `pi-web-plugins/background-runs/server/tasks.ts` |
| Routes `GET /sessions/:id/background-tasks` and `/background-tasks/:taskId/output`, the `SessionService` methods, the closed-session read | Operations `tasks.list` and `tasks.output` of the plugin's server half |
| `backgroundTaskProbes` in `backgroundRunCount.ts`: core counts the tasks | The plugin's `backgroundWork` answer (slice 1's hook) |
| `backgroundWorkWatcher` watches `<cwd>/.pi` for the registry and the session directory for subagent artifacts | Plugin-declared work paths (below), shared with Subagents (B20 slice 3) |
| `ACTIVITY_TOOL_NAMES` in `piSessionService.ts`: `subagent`, `bg_run`, `bg_run_pi_attested`, `bg_kill`, `fusion_*`, and `spawn_subsession` (a PI WEB tool removed by no-builtin-agent-tools) | Plugin-declared work tools (below); the dead name goes |
| `workspaceChangeFilter` ignores `.pi/tasks` and `.pi/delegate` by name | Ignores every declared work path; `.pi/sessions` (pi's own) stays core |
| `SessionBackgroundTaskInfo`, `BackgroundTasksRead` in `apiTypes`; `PluginRuntimeState.backgroundTasks` / `backgroundTasksRead` in the plugin API | The plugin's own types; the two `PluginRuntimeState` fields are removed (a plugin-API change; only background-runs reads them) |
| `PiWebApp`: `refreshSubagents`, `updateSubagentPolling`, `subagentRefreshArmedFor`, `readBackgroundTasks`; `AppState.backgroundTasks` / `backgroundTasksRead`; `onBackgroundRunCountChanged` | The plugin's own read loop, polling only while the session works, as the Subagents panel does (`runsPolling`) |
| Two docstrings left from the subagent rows (`PiWebApp` above `handleRecallQueuedMessage`, `ChatView` above `renderImageZoom`) | Deleted: they describe code that is gone and sit on the wrong members |

**What a plugin declares** (extends `agentFacts`, which already carries `surfaces` and `injectedTurns`):

- `workPaths`: where its extension writes background work, as `{ root: "cwd" | "session-dir" | "session-stem", path }`. The daemon watches them to recount (`recountBackgroundRuns`), and the workspace watcher treats them as noise. Background runs: `{ root: "cwd", path: ".pi/tasks" }`, `{ root: "cwd", path: ".pi/delegate" }`. Subagents: `{ root: "session-dir", path: "subagent-artifacts" }`, `{ root: "session-stem", path: "" }`.
- ~~`workTools`~~ (built in slice a, removed in c): its one consumer was the misnamed poll, and the event fired before the extension had written its record, so the read it caused could only see the old list. The daemon no longer publishes `activity.changed`; the page still parses it from an older daemon and ignores it (a dropped frame would read as a gap). The panel reads again when the session's background run count or its turn changes, which follows the registry write within the watcher's 100 ms.

**The workspace watcher's noise rule: answered (owner, 2026-10-09, "改插件，这个我理解是插件的behavior对吧").** The directories are the plugin's `cwd` work paths and count only while the plugin runs (option A): turned off, the Files and Git panels refresh on the extension's output again, at most once per 2.5 s window. Measured on 8505 (a write under `.pi/tasks`, `workspace.changed` for the seed workspace): plugin on 0, off 1, on again 0; a write at the workspace root 1.

**What the reader sees does not change**: the Background panel lists the same tasks, the count says the same number, and output opens. Turning the Background runs plugin off removes its panel and its share of the count at once (slice 1's recount), and turning it on brings both back.

**Slices.** (a) The declarations and the watcher reading them, Subagents moved onto them (B20 slice 3). *Built 2026-10-09:* `agentFacts.workPaths` / `workTools`, validated (a path stays inside its root; only `session-stem` may be bare); the watcher watches each declared directory and its parent (the parent must exist, else the session falls back to the heartbeat scan) and re-derives them on every recount, so a reconcile adds or drops a plugin's watches; `ACTIVITY_TOOL_NAMES` is gone, with its dead `spawn_subsession`. Core's task reader declared its own `.pi/tasks` and tools beside itself (`BACKGROUND_TASK_WORK`), so (c) moved it whole.

*(b) and (c) built 2026-10-09, one change:* the registry reader moved (`git mv`) to `pi-web-plugins/background-runs/server/tasks.ts` with its tests; it spawns nothing itself (`ps` goes through the host's bounded `execFile`). The plugin's server half declares `.pi/tasks` and `.pi/delegate`, counts a session's running tasks (`backgroundWork`) and answers `tasks.list` ({ cwd, sessionFile }, both absolute; from the browser's selected session, open or closed). Its browser half reads through that operation when the session, its background run count or its turn changes, and after `session-activity-settled`. Deleted from core: the reader, both routes, the service methods, the task probes in `backgroundRunCount`, `SessionBackgroundTaskInfo` and `BackgroundTasksRead`, the two `PluginRuntimeState` fields, `AppState.backgroundTasks`, the misnamed `refreshSubagents`/`updateSubagentPolling` poll, `sessionActivityPolling` and `backgroundRunCountSignal`. Not built: `tasks.output` (the old output route had no caller). 8505, old vs new: the seed session's 12 tasks identical field for field; a running probe task counted after 10.6 s old, 0.5 s new; Background runs off: old still 1, new 0 in 7 ms and the operation answers 409; on again 1 in 0.5 s; process killed: 0, listed as lost. (b) The background-runs server half with `tasks.list`, `tasks.output` and `backgroundWork`; the browser half reads through it. (c) Core's reader, routes, types, state and the misnamed poll deleted. Each slice keeps the panel and the count working on 8505, checked old against new.

## Order

1. The lifecycle contract, the live toggle, the documentation and the conformance kit. Every plugin gains from them, and Subagents is their first real customer.
2. The `backgroundWork` contribution, then the Subagents extraction, with a guard test that fails if core names subagents again.
3. Work paths and work tools declared by plugins (B20 slice 3), then background tasks out of core (§3).

## Slices (2026-10-09)

**Slice A: a server half toggles live in its own process.** Owner question 22 is open; until it is
answered, a plugin that hands core a face (a workspace provider or a machine registry) keeps
"Restart required", and every other server half toggles live.

- `ServerPluginRuntime.reconcile(snapshot)`, serialised through one tail, compares each server
  entry's desired state (`disabledReason`) with the active list:
  - active and no longer wanted, no face: **disable**.
  - wanted and not active, no face: **enable**, the same `activateEntry` a process start runs.
  - a face either way, or a new revision of an active plugin: left as it is; the reconciliation
    (`piWebPluginLifecycle`) keeps reporting "Restart required" for it, as today.
- **Disable**, in this order:
  1. the plugin leaves the callable set: a new operation call or route request is refused with
     409 `{ code: "plugin-not-active", state }`;
  2. its own abort signal fires, which every in-flight operation and route handler of the plugin
     receives beside the request's cancellation;
  3. the host waits for those calls to settle, bounded by the lifecycle timeout;
  4. `stop(signal)` runs, bounded, exactly once;
  5. the record reads `disabled`; a throwing or timed-out stop reads `failed` with phase `stop`.
- **Who learns of it:** the config write path in the web process (a decorator beside
  `invalidatePiWebStatusOnWrite`) sees the `plugins` section change, reconciles the web runtime,
  and asks the daemon to reconcile (`POST /plugins/reconcile`). The daemon re-reads its config,
  reconciles its runtime and re-records its agent facts. No frame is published yet: the page's
  realtime parser refuses unknown frames, so `plugins.changed` lands in slice C with its parser.
- Route requests for a plugin disabled after boot are refused by its mounted handler; a plugin
  enabled after boot cannot mount routes yet (Fastify does not add routes after listen): slice B.

**Slice B: routes of a plugin enabled after boot** answer through the not-found handler, which
consults the live route table before answering route-missing.

**Slice C (done): the page follows `plugins.changed`**, disposing and loading browser halves against the
manifest, instead of reloading when Settings closes.

**Slice D: the lifecycle section of docs/plugins.md.** Its server half ("Turning a plugin on or off") landed with slice A; slice D adds the browser half and the conformance checks (owner question 23).

## Proof

- The conformance kit against the old build (a toggle calls nothing; the old build fails) and the new build (every guarantee holds).
- A live 8505 probe: disable Subagents while a run is going. The drawer section and the count disappear without a reload, and nothing is left polling. Enable it again and both come back.
