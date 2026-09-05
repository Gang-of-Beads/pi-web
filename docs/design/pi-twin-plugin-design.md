# The web twin: pluginizing activity, notifications, machines, and voice

Status: draft for owner correction. Research + design only — no code in this
wave yet. Supersedes the third-round "delete ACTIVITY/NOTIFICATIONS from the
shell" ruling with a pluginization design; the two amendments it proposes to
`plugin-architecture.md`'s core list are listed at the end.

## What pi actually believes (researched from earendil-works/pi)

Two layers exist upstream; pi-web should stay fluent in both.

**The shipped extension model** (packages/coding-agent/docs/extensions.md):

- Extensions are TypeScript modules with one activation seam:
  `export default function (pi: ExtensionAPI)`.
- They **subscribe to events** (`pi.on("tool_call" | "session_start" | ...)`,
  interception can block or modify), **register capabilities**
  (`registerTool`, `registerCommand`), **call interaction primitives the
  host provides** (`ctx.ui.select/confirm/input/notify`), **render
  custom UI** (`ctx.ui.custom()` full components, custom message/tool
  rendering), and **persist state** (`pi.appendEntry()` survives restarts).
- The philosophy: the core is an agent loop plus a set of *seams*; a feature
  is a module that observes events and registers capabilities. pi itself
  ships as "a minimal agent loop, with tools, commands, UI, rendering, and
  persistence all supplied through one `ExtensionAPI` seam."

**The experimental facet model** (packages/agent/docs/plugins.md, the
chord-based host architecture — and the one that names us):

- Topology: a **server host** (session records, worker management, auth,
  routing), **session hosts** (the real Harness, one worker per session),
  and **presentation hosts** ("TUI today, web later" — pi-web is the web
  presentation host that document anticipated).
- "There is deliberately no `CodingAgentPlugin` runtime interface... Each
  process loads only facets built for that process." One feature ships as a
  shared contract plus per-host bundles: `question-extension/ contract.ts
  session.ts tui.ts web.ts` — "The browser build never imports session.ts;
  the session process never imports TUI or DOM code."
- Facets connect through **services**: `defineService(token)`,
  `provide/use/observe`, keyed multi-instance services via
  `provideMany`/`spawn`. "Authority stays where it belongs... Nothing
  reaches a presentation except through a deliberate contract."
- The question extension's round trip ends: "With no presentation connected,
  the question remains pending. A TUI or web facet that connects later
  obtains the same pending question."

**The convergence is already real.** pi-web's plugin contract is the facet
model with different names: `runs: "daemon" | "web" | "both"` is exactly
"each host loads only facets built for that process"; the daemon/web/browser
entry points are the per-host bundles; host ports + plugin operations are
the service mechanism; the ask-user card (daemon-owned ask, browser settles,
late connector receives the pending question) is the question extension's
round trip, already shipped. What pi-web lacks relative to the model is a
**client-side observe surface** (read-only session events as a plugin API)
and **keyed session-scoped services**. Both appear below, only where a
feature actually needs them.

## The twin contract

pi-web is a web twin of pi, not a port: the session authority IS pi (the
daemon spawns and owns real pi sessions), and the browser mirrors pi's TUI
surfaces as presentation-host surfaces. The twin rule this design follows:

1. **Truth lives where pi puts it.** Session state, transcript, delivery,
   ask settlement — daemon protocol, core. pi's harness publishes progress
   and state events; pi-web's `status.update`/`activity.update`/
   `notifications.*` socket events are the same class of fact.
2. **Presentation is a plugin surface.** Anything the browser renders over
   that truth — badges, dock sections, toasts, inbox rows, machine tabs —
   is a contribution against a published seam, never a hard-wired producer.
3. **Server-wide concerns are rare, declared, and hosted in the web
   process.** pi: "Server facets should therefore be rare and limited to
   inherently server-wide concerns." Machines/gateway routing is exactly
   that concern, and the Wave 0 web hosting (route contributions + host
   ports) was built for it.

## The four surfaces

### 1. Activity — split the truth from the presentation

Today: the daemon derives per-session activity
(`sessionActivityLabel`, `sessionActivityState`, the `activity.update`
event — protocol truth, small and stable); the client renders it in four
hard-wired places (list badges `activityBadge`, the chat dock
`ChatView.activityDock`, empty-state meaning `activityEmptyMeaning`, plus
`sessionActivityPolling`/`staleActivityReconcile` glue).

Design — **keep the fact, pluginize the rendering** (finalized after
  the bllm red/blue adjudication; see
  `review-triage-activity-split-redblue.md` for the full record):

- **Core keeps**: the daemon-side derivation and the `activity.update`
  event. This is session truth in pi's sense (`pi.on("event")` facts), not
  a feature. Removing it from the protocol would make the shell unable to
  answer "is anything working?" even with zero plugins — violating honest
  absence. Core also keeps every reconciliation duty (seq watermarks,
  `hydrateSessionStatuses({replaceKnown:true})`, edge-down clears) — a
  plugin re-implementing them would re-create the fixed
  "forever-working-after-reconnect" incident.
- **The seam is a core-owned read-only projection, not a raw event
  bus**: `sessionActivityProjection = { ready, statuses, activities }`.
  Subscribing replays the current snapshot (a late-connecting facet gets
  the same pending question, per pi); disconnect sets `ready=false`
  (honest unknown); the shell re-reconciles on reconnect and replays.
  High-frequency frames (transcript, command.output) never enter the
  projection. Raw-frame fan-out was rejected: every plugin would have to
  rebuild seq-once and gap handling.
- **`pi-web-activity` (browser-only)** owns the presentation: the
  Activity drawer becomes a **drawer section** contribution (rows come
  from HTTP polling through the declared read port, not from the bus);
  list badges move behind a new **`sessionBadges` contribution** — the
  plugin supplies `{ glyph, label, tone }` while the core owns the
  unread-ring composition (many contributors, one result) and renders a
  plain fallback when no plugin claims it. The chat dock's skeleton
  (pendingAsk suppression, sending state, turn clock, reveal) **stays
  core** behind a dedicated `activityDock` contribution — a drawer
  section cannot carry those four core-private facts.
  `activityEmptyMeaning` travels with the plugin but its predicate reads
  the projection status (its hand-rolled busy check had already drifted
  from the five-state classifier). The polling mechanism
  (`sessionActivityPolling`) moves to `shared/` — it is consumed by
  notifications too — and the plugin drives it.
- **`activityBadge` splits**: its machine `StatusFlags` face
  (`statusActivityKind`/`hasStatusUnread`/`renderActivityIndicator`) is
  consumed by MachineList/ProjectList/WorkspaceList/MachineSwitcher and
  stays core; only the session-state badge vocabulary backs the seam
  contract. `staleActivityReconcile.ts` (cited here before) does not
  exist; the real reconciliation lives in `sessionSocket.ts` and
  `sessionController.ts` and stays core.

### 2. Notifications — the bus is protocol, the inbox is a plugin

Today: daemon `sessionNotificationStore` (inbox, evictions,
`notifications.inbox`/`notifications.summary` events) + `warningFiling`
(core machinery files warnings as notifications); client
`sessionNotifications` + `sessionNotificationController` (toasts, unread,
actions) wired through PiWebApp.

Design — **three pieces, three owners**:

- **Core keeps** the notification store and wire events: the bus is
  session-adjacent truth that must exist for a plugin-less shell to stay
  honest, and ask/warning settlement law (an explicit non-plugin) files
  through it.
- **`pi-web-notifications` (daemon facet)** owns **filing policy**:
  observing session events (tool failures, stale runs, compaction) and
  deciding what becomes a notification. This is the daemon-facet pattern —
  the plugin activates inside sessiond with a read-only session-event
  context and calls the store through a declared host port. Filing policy
  is product behavior that will keep changing; it should never require a
  core release.
- **`pi-web-notifications` (browser facet)** owns the inbox drawer
  section, toasts, unread badges, and per-notification actions
  (dismiss/retry ride the existing action/`PluginAction` seam). The shell
  renders nothing when the plugin is absent — honest absence, same as
  settings sections today.

The daemon facet needs one new declared port: **`notificationBus.file`
(file/expire entries)** plus a read-only **session-events observe** on the
daemon side (daemon plugins already sit inside sessiond; this formalizes
the observation).

### 3. Machines — the first real tenant of the web hosting seam

Today: `machines/` in the web process (MachineService/Store, fleet,
machine-scoped proxies — ~1.9k lines) plus client machine tabs, machine
selection state, and `/api/machines/:machineId/*` scoped routing. sessiond
holds zero machine knowledge (gateway concept, already correct per pi:
session authority never learns about servers).

Design — **`pi-web-machines` (`runs: "web"` + browser facet)**:

- The web-process half moves **whole** (one feature moves whole or does
  not move): MachineService/Store, fleet routes, and the machine-scoped
  proxy legs become **route contributions** mounted at
  `/api/machines/*` — the dual-prefix mount, parametric paths, and
  collision diagnostics from Wave 0 are exactly the machinery this needs.
  This makes machines the first real consumer that proves the web hosting
  seam end to end, which was its stated purpose.
- The **browser facet** owns the machine roster surfaces (QuickSwitcher
  tabs, navigation machine section, breadcrumb machine chip) through one
  producer: the plugin writes the roster into core `state.machines` via a
  host capability and existing classifiers degrade untouched. Core keeps
  the identity triple (machine + project + workspace + session scoping
  stays a core law — data must carry the scope it belongs to), the local
  session proxy (`/api/sessions`), auth, and static serving. The machine
  axis itself is core law, not plugin capability: the opaque
  `machineId`, the `?machine=` route parameter, the
  `/api/machines/local/*` dual registration, and local-machine semantics
  cannot move without contradicting the plugin system's own
  `machineId`-keyed contracts (the plugin system dispatches by machine —
  discovery cannot depend on a plugin).
- **Zero-plugin behavior is explicit, not silent**: a
  `machinesLoad` state machine (unknown/absent/failed/ready) derived from
  the plugin registry keeps an absent axis from rendering as an error or
  as "this machine has no machines", and a remote deep link
  (`?machine=…`) survives until the roster is ready instead of being
  rewritten to local. Quick access adapts (a new `navigationSections`
  contribution carries the machine section); the quick-access surfaces
  themselves are shell chrome and are **not** pluginized — without the
  plugin they would still have to switch sessions.
- Full record: `machines-axis-plugin-design.md`.
- What makes this safe where earlier attempts were not: the machines
  plugin cannot touch session truth (it has no daemon facet; it only
  routes), and the scope law lives in the core URL/API contract the plugin
  must obey, not in the plugin.
- Sequencing note: this is Wave B as already planned; the design change
  here is that it now consumes the Wave 0 web hosting directly instead of
  waiting for more seams.

### 4. Voice — already the existence proof; finish, don't redesign

Voice is extracted (`pi-web-plugins/voice`: browser composer contribution,
live dictation, azure streaming, speech token server plugin) and the core
holds only the seam comment in PromptEditor. The remaining work is closure,
not design: audit for residual core wiring, keep `runs` off the manifest
until the daemon-side question below resolves, and treat voice as the
reference consumer when extending the composer contribution contract.

## What stays core (unchanged from the architecture doc, restated)

Message sync/delivery, the outbox, session lifecycle, ask/dialog settlement
law, bottom anchor, breakpoints, the transcript, the composer contract,
auth, the plugin runtime itself. These carry correctness invariants; a seam
through them would re-open every producer question already closed.

## Amendments this design proposes to `plugin-architecture.md`

1. Core client shell list: drop "notifications surface" (becomes
   `pi-web-notifications`); activity was never listed — the fact stays in
   protocol, the presentation becomes `pi-web-activity`.
2. Core web process list: "machines/fleet proxying" becomes
   "machines/fleet via the `pi-web-machines` plugin (`runs: "web"`)".
3. Extraction table: add activity and notifications rows with the split
   documented above; voice row moves to "done, closure pending".

## Migration order (each step gated on its predecessor's green)

1. Client seams (pure additions): the session-activity projection plus
   the `sessionBadges`/`activityDock` contribution points with plain
   fallbacks; the machine face of `activityBadge` moves to its own core
   module first (pure move, zero behavior change).
2. `pi-web-activity` (browser-only) — smallest plugin, proves badges +
   dock copy + drawer, parallel-run behind the seams.
3. `pi-web-notifications` (browser, then daemon filing facet).
4. `pi-web-machines` (web + browser) — the Wave B extraction, now the
   proving tenant of the web hosting seam; the `machinesLoad` state
   machine and remote-deep-link preservation land in the same batch.
5. Voice closure audit (no new seams expected).
