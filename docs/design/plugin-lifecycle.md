# Plugin lifecycle: turning a plugin on or off live

Owner, 2026-09-30: "Check whether enable/disable can always call the plugin's init and teardown, with a fixed injection point, so plugin developers know exactly what each behavior does."

## What existed (2026-09-30, before the slices below)

**The hooks existed, but a toggle called none of them.**

| Half | Hooks a plugin gets | When they ran |
|---|---|---|
| Server (`server-plugin-api.ts`) | `activate(context)` returns `{ start, stop, health, operations, routes, agentFacts, … }` | `activate` and `start` at process start; `stop` at shutdown. A Settings toggle only marked **"Restart required"** (`serverRestartRequired`). |
| Browser (`plugin-api.ts`) | `activate(context)` returns `{ contributions, dispose }` | `activate` at page load. `registry.disposePlugin` existed, but nothing outside tests called it: a disabled plugin stayed on the page until a reload. |

So a plugin developer could not say what "disable" did. It did nothing until two restarts and a reload happened, in an order nobody promised.

## Design

### One lifecycle, the same injection points in both halves

Enable and disable run the plugin's hooks **live**, in a fixed order, with no restart and no reload:

| Event | Server half (in each process the plugin `runs` in) | Browser half (every open page) |
|---|---|---|
| **enable** (toggle on, process start, first page load) | import → `activate(context)` → `start(signal)`. Routes and operations answer only after `start` resolves. | import → `activate(context)` → contributions registered; panels appear. |
| **disable** (toggle off, shutdown) | Routes and operations stop answering first (409 `plugin-not-active`); in-flight operations get their signal aborted; then `stop(signal)`, bounded by the lifecycle timeout. | listeners dropped, `dispose()` called, contributions removed, in one step. |
| **update** (a new revision of the plugin) | disable the old one, then enable the new one, as above. | the same, after the server half has switched. |

- **Guarantees a developer can rely on:**
  - `stop` runs exactly once after every `start` that resolved;
  - no operation or route handler runs after `stop` begins;
  - `dispose` runs exactly once per `activate`;
  - a hook that throws or times out leaves the plugin `failed`, with its phase recorded, and never half-enabled.
- **The page learns of a toggle** from one global frame, `plugins.changed`, and reconciles its registry to the manifest. That is the same compare-heads rule as the sync design.
- **Routes cannot be unmounted from Fastify**, so the host mounts one handler per declared route that consults the live table on every request (`serverPluginRouteMount.ts`).
- **The contract is written for developers** in the plugin documentation (`docs/plugins.md` and the pages it links), with the conformance checks as a checklist a reviewer or a plugin author follows on a running PI WEB (owner question 23, 2026-10-10; committed probe scripts were removed on 2026-10-03).

### The boundary (owner, 2026-10-09)

The owner asked whether core was again special-casing a specific extension, and said a wrong name is a boundary problem.

Core knows pi (its session files, events, `.pi/sessions`) and PI WEB's own features (subsessions and the delegation routes). It never parses an extension's private files, never names an extension's tools, and never carries an extension's record shape in its own types or in the plugin API. Support for a particular extension is a plugin, which a reader can turn off, and turning it off removes every trace of it: panel, count, watch, reads. A name in core that says what it does not do is a boundary leak too, and is fixed with it.

Two seams let a plugin carry what core used to know:

- `backgroundWork(sessionRef) → { running: number }`: a plugin's share of a session's "background runs" count. The daemon sums every enabled plugin's answer for the status line and for goal quiescence; a disabled plugin's share stops counting at once (`recountBackgroundRuns` after a reconcile).
- `agentFacts.workPaths`: where a plugin's extension writes background work, as `{ root: "cwd" | "session-dir" | "session-stem", path }`. The daemon watches them to recount, and the workspace watcher treats a `cwd` work path as noise only while its plugin runs.

The Subagents and Background runs plugins that first used these seams moved out of core on 2026-10-09 and now live in their own repositories (pi-web-subagents, pi-web-background-runs). The record of that move is in git history.

## Slices (2026-10-09)

**Slice A (built): a server half toggles live in its own process.** A plugin that hands core a face (a workspace provider or a machine registry; owner question 22) keeps "Restart required", and every other server half toggles live.

- `ServerPluginRuntime.reconcile(snapshot)`, serialised through one tail, compares each server entry's desired state (`disabledReason`) with the active list:
  - active and no longer wanted, no face: **disable**.
  - wanted and not active, no face: **enable**, the same `activateEntry` a process start runs.
  - a face either way, or a new revision of an active plugin: left as it is; the reconciliation (`piWebPluginLifecycle`) keeps reporting "Restart required" for it.
- **Disable**, in this order:
  1. the plugin leaves the callable set: a new operation call or route request is refused with 409 `{ code: "plugin-not-active", state }`;
  2. its own abort signal fires, which every in-flight operation and route handler of the plugin receives beside the request's cancellation;
  3. the host waits for those calls to settle, bounded by the lifecycle timeout;
  4. `stop(signal)` runs, bounded, exactly once;
  5. the record reads `disabled`; a throwing or timed-out stop reads `failed` with phase `stop`.
- **Who learns of it:** the config write path in the web process sees the `plugins` section change, reconciles the web runtime, and asks the daemon to reconcile (`POST /plugins/reconcile`). The daemon re-reads its config, reconciles its runtime and re-records its agent facts.

**Slice B (not built): routes of a plugin first enabled after boot.** Fastify takes routes only at boot, and the host mounts the routes of the plugins active then. A plugin turned off and on again answers on its routes; one first enabled after boot has none until the web process restarts.

**Slice C (built): the page follows `plugins.changed`**, disposing and loading browser halves against the manifest, instead of reloading when Settings closes.

**Slice D (built 2026-10-10): the lifecycle section of the plugin docs**, with the browser half (what each page does on a toggle, and the guarantees a browser entry can rely on) and the conformance checks as a hand checklist (owner question 23).

## Proof

The checklist in the plugin docs, followed by hand; no kit script is committed. Slices A and C were checked live on a dev stack when they landed.
