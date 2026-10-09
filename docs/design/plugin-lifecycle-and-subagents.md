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

## Order

1. The lifecycle contract, the live toggle, the documentation and the conformance kit. Every plugin gains from them, and Subagents is their first real customer.
2. The `backgroundWork` contribution, then the Subagents extraction, with a guard test that fails if core names subagents again.

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
