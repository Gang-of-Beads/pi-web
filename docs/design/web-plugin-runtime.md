# Wave 0: the web plugin runtime and the seams it adds

Follows `machines-workspaces-extraction.md` and its owner rulings
(contract-first; no preset shell). Wave 0 changes the plugin contract so that
the two extraction waves have something to stand on. This document names the
shapes before code moves; the implementation amends it in the open.

## What exists today

- Server plugins activate only in sessiond (`sessiond.ts:187`,
  `createServerPluginRuntime`), through a closed eight-field context
  (`server-plugin-api.ts:15-37`) and a closed activation shape
  (`workspaceProvider`, `operations`, `agentFacts`, `start/stop/health`).
- Operations answer JSON only (`ServerPluginOperation` → `JsonValue`, 256 KiB
  request cap on the `api/plugins` channel); they cannot express the
  Range-streaming file preview or serve at protocol paths. (The 8 MiB figure
  belongs to the separate plugin-backend response channel.)
- The web process never runs server plugins; it only proxies operations to
  the daemon (`pluginOperationProxyRoutes.ts`).
- Browser contributions cover actions, workspace panels, labels, themes,
  composer slots, settings sections, message renderers, drawer sections —
  no dialog, no main-view ownership, no plugin-owned controllers.

## Seam 1: route contributions (server)

`ServerPluginActivation` gains:

```ts
routes?: readonly ServerPluginRouteContribution[];
```

```ts
export interface ServerPluginRouteContribution {
  method: "GET" | "POST" | "PUT" | "DELETE";
  /** Core-shaped path template, e.g. /projects/:projectId/workspaces/:workspaceId/file/preview */
  path: string;
  handle(request: ServerPluginRequest, reply: ServerPluginReply, context: { signal: AbortSignal }): Promise<void>;
}
```

`ServerPluginRequest`/`ServerPluginReply` are narrow host-owned interfaces in
`server-plugin-api.ts` — never the framework's types. The reply can answer a
stream: `code`, `headers`, and a `body` of `string | Uint8Array | readable
stream`. This is what makes the preview route expressible; the JSON-only
operation channel stays for what it is good at.

`ServerPluginRequest` exposes `params`, `query`, and `headers` — exactly the
three input faces the preview route uses today. `ServerPluginReply` answers
`code`, `headers`, and a `body` of `string | Uint8Array | Node Readable`.

Handle semantics (amended after review):

- A route handle is **not** bounded by the lifecycle timeout; the 10s
  lifecycle bound applies to activate/start/stop/health, never to a
  streaming response. The handle's signal is request cancellation (client
  disconnect), the same semantics `requestCancellation` gives daemon
  operations today.
- A route whose path is named by the federated table inherits that entry's
  transport bounds (`responseBodyLimit`, `propagateCancellation`).
- Content-type parsers stay host plumbing: pre-registered at app level
  (the file-route family's `addContentTypeParser` is a hidden side effect of
  the explorer routes today); a contribution cannot carry one, since plugins
  cannot import fastify.

Mounting rules:

- The host owns path resolution. Contributions mount at the declared path
  under `/api` AND under `/api/machines/local` — the dual-registration
  convention is the host's, not the plugin's (`app.ts:250-267`).
- An undeclared route is refused, same law as operations. A declared route
  that collides with an existing method+path is refused with a diagnostic
  and the plugin lands `failed` — never a Fastify startup crash, and never
  a transitional state where core and plugin register the same path: moving
  a route into a skeleton and removing the core route land in one commit.
- The federated route table (`shared/federatedRoutes.ts`) stays the protocol
  authority; a plugin contributing a protocol path must declare a path the
  table already names. Each end is servable by its own core/plugin
  generation: a remote machine without the plugin still answers from its
  core routes until its core removes them.
- Absence answers honestly and differently by prefix: 404 under `/api`, and
  the machine prefix's existing 501 "route not registered" under
  `/api/machines/local`.

## Seam 2: host port injection (server)

`ServerPluginActivationContext` gains typed optional ports — named fields,
not an untyped record, so no type assertions are needed anywhere:

```ts
export interface ServerPluginHostPorts {
  fleetMachines?: FleetMachinesPort;      // Wave B consumer: fleet routes
  workspaceCatalog?: WorkspaceCatalogPort; // Wave A consumer: file routes
  piWebConfig?: PiWebConfigPort;           // uploads/path-access effective config
}
```

Port interfaces are defined once in `server-plugin-api.ts` (or shared types it
re-exports), and each is optional: a host that cannot supply one leaves it
undefined and the plugin degrades honestly (health reports what is missing).
Core keeps the concrete implementations; plugins receive the port. The
`FleetMachinesPort` shape is the existing `FleetMachines`
(`fleetRoutes.ts:27-33`: `list/localMachine/health/runtime/remoteClient`) —
not `MachineRouteService`.

## Seam 3: the web process hosts server plugins

`createServerPluginRuntime` is already generic (catalog, importer, execFile,
storage root). The web process (`src/server/index.ts` → `web/app.ts`) creates
its own instance:

- Catalog parity comes first (amended after review — today the two catalogs
  disagree on project plugin discovery, agentDir resolution, and config
  timing): the web catalog gains `projectPlugins` and the same
  agentDir/config semantics sessiond uses, so both processes agree on what
  is installed.
- Its activation context assembles web-side ports (machines service, the
  workspace catalog port implementation, config service).
- Returned route contributions mount on the fastify app with the dual
  prefix; operations keep proxying to the daemon for daemon-owned plugins —
  a plugin activated in the web process serves its operations locally (the
  catch-all proxy becomes a per-plugin split), with the same 256 KiB
  operation body limit on both legs. Which process runs which plugin is a
  catalog-level declaration (see Seam 5), not inferred.

The provider-runtime handshake is per process (amended after review — one
flat snapshot cannot say "web active, daemon failed"; implemented as a
local merge, amended during Wave 0 — the daemon cannot know the web
process's runtime state, and carrying a web section on the wire would make
rolling upgrades lie):

- The daemon's handshake payload stays the flat daemon snapshot (wire
  unchanged, protocolVersion stays 1). The web process freezes its own
  runtime into the same snapshot shape at startup and the lifecycle
  reconciliation takes both as role-keyed views
  (`WorkspaceProviderRuntimeViews` in `piWebPluginLifecycle.ts`).
- Each desired plugin reconciles against the view of the process its
  `runs` declaration addresses; `restartRequired` is judged against that
  process, so a web-activated plugin is not misreported as daemon-missing
  and stays `active` while the daemon is briefly unavailable.
- A `both` plugin must be current in BOTH processes before its browser
  module publishes: the web view serves the browser asset and routes, the
  daemon still answers the proxied operations until the per-plugin split
  below ships. Drift in either view means restart-required.
- `cachedArtifactIsActive` (`piWebPluginService.ts`) reads the web view
  whenever it holds the plugin, so asset cache invalidation follows the
  process that actually serves them; the daemon view is the fallback for
  daemon-only plugins.
- The web runtime applies the same `safeStart` level as the daemon, so
  recovery mode keeps the plugin sets aligned at both ends; a mismatch in
  either process is restart-required.
- A web-only record whose desired entry is gone renders as
  `discovered: false` — the same honest rendering the daemon path always
  had, instead of vanishing while its routes still serve.

Interim (Wave 0) and deferred to the extraction waves, recorded so the gap
is a decision rather than an accident: the daemon still activates
`runs: "web"` plugins (its operations proxy is the only operations channel
until the per-plugin split), route-mount collisions log a diagnostic and
leave the contributed route absent while the plugin record stays `active`
(the runtime cannot see the mount, and the absent route is the honest
signal), POST/PUT/DELETE are mountable but a handler has no body face yet
and federated transport bounds are not consulted — both land with the
first real route migration, and catalog parity (`projectPlugins`) rides
the pilot.

## Seam 4: dialog and owned-panel seams (browser)

- `PluginRuntimeContext` gains `openDialog(request)` — the host mounts a
  host-chromed modal, the plugin renders the body, the promise settles with
  a defined close-reason outcome (the same reason family the daemon-driven
  ExtensionDialogCard uses: answered/cancelled/dismissed/timeout — not a
  free-form value). A plugin dialog integrates with all three host modal
  registries: `modalLayerRegistry` (streaming auto-focus suppression), the
  `modalLayerOpen` list, and `pushModalLayerFrame` (Android back closes the
  layer it is looking at). The `machine.add` action chain migrates together
  with MachineDialog — the core action does not survive as a core → host →
  plugin → host bounce.
- Workspace panels become ownable: a plugin's `workspacePanels` entry may
  declare `ownsController: true`. One state principle, aligned with the
  terminal precedent (amended after review, superseding "removed rather
  than mirrored"): **selection pointers mirror into core AppState** (the
  selected file path, the URL `file=` namespace, machine navigation memory,
  workspace-scoped reset, refresh dispatch — these are shell concerns);
  **file content/tree state is plugin-owned** (the tree, expanded dirs,
  file contents move out of core AppState). Core actions and refresh
  dispatch resolve panel ids through `resolveWorkspacePanelRouteId` instead
  of hardcoding `core:workspace.files`; migrated panels declare
  `routeAliases` for old URLs.
- The identity tuple stays core: panels receive opaque ids and cwd strings
  exactly as today (`composerCwd`, `workspaceFilePreviewPath`). The machines
  list and `selectedMachine` are tuple state and stay core AppState; the
  Wave B controller writes them through host setters, and with the plugin
  absent an empty machines list plus an unresolvable URL machine param is
  the honest presentation.

## Seam 5: where a plugin runs (catalog)

Each plugin's manifest gains an optional `runs: "daemon" | "web" | "both"`
(default `daemon`, preserving today's behavior). The catalog snapshot carries
it; each process activates the plugins addressed to it. Wave A/B set
`both` (server half in web for routes/ports, daemon half for workspace
provider/operations as today).

## Honest absence

Everything Wave A/B moves is a contribution. With pi-web-workspaces absent
there is no project list, no workspace panel, no files view; with
pi-web-machines absent there is no switcher. No core fallback UI exists
(owner ruling), and the mechanics are named rather than assumed (the
`pluginSurfaceVisibility` abstraction once referenced here was deleted on
2026-09-04): the workspace panel selector must not silently fall back to the
first visible panel when the requested tool is missing — an absent panel
renders as explicitly missing; core actions that navigate to contributed
surfaces gate on registry availability with a disabled reason (the
`checkForPiWebUpdates` precedent); the projects/workspaces lists become
contributed navigation sections, so an absent plugin leaves no empty columns
standing in for "unloaded". Route paths contributed by an absent plugin
answer 404 under `/api` and the machine prefix's honest 501 under
`/api/machines/local`.

## Pilot slice (amended after review: two named proofs, not "one vertical")

The in-repo bundled skeletons `pi-web-plugins/workspaces/` and
`pi-web-plugins/machines/` are created first (the deployment ordering
constraint wants the intermediate state to exist before core removal).

**Proof 1 — workspaces skeleton (streaming + ports + web hosting).** The
file-preview route re-homes into the skeleton as a route contribution
together with its semantic body: `filePreviewService`, `pathAccessPolicy`,
and the file classification constants move as plugin code; the response
policy/headers reach the plugin through re-exports in
`server-plugin-api.ts` (the contract package already carries shared types).
The handler resolves tuples through `WorkspaceCatalogPort` and path access
through `PiWebConfigPort`; its health reports any missing port (honest
degrade). This proves streaming routes, port injection, and web-process
hosting against the real hardest case. Acceptance includes the resilience
change: with the skeleton deactivated, preview answers 404 and the 8505
probe asserts it — this route is no longer core-served forever.

**Proof 2 — updates plugin (dialog seam).** A minimal NEW dialog (nothing
dialog-shaped exists in updates today) proves the seam: host-chromed
modal, three registry integrations, close reasons.

Explicitly not proven by the pilot, shape only: `ownsController` panels
(proven in Wave A where the Files-main-view risk lives) and the
`fleetMachines` port's plugin-side consumption (Wave 0 only retypes fleet
routes' `deps.machines` to the contract port — a type move, not an
injection proof; Wave B proves it).

## Contract release

Routes/ports change `src/server-plugin-api.ts`: contract baseline update
(`test-fixtures/plugin-api-baseline/`) and a `plugin-api-v*` tag release of
`@gang-of-beads/pi-web-plugin-api` before any split-repo plugin can consume
them. The `runs` manifest key is catalog metadata parsed by the host — no
contract release, and old hosts ignore it harmlessly.
`docs/design/plugin-architecture.md` gains supersession notes: the
`client/daemon/web` three-entry-point model and the
`api/plugins/<plugin>/...` route-namespace rule are superseded by the
`runs` declaration and core-shaped route contributions respectively.

## Non-goals

- No hot reload; the runtime stays activate-once, restart-to-change.
- No plugin-to-plugin imports; the tuple and protocol pieces stay core.
- The daemon keeps workspace authority and the provider runtime.
- The machines proxy's preview leg stays as it is today (Range not
  forwarded, Content-Range stripped by the header whitelist) — a
  pre-existing federated-leg defect filed separately in CHECKLIST #75, not
  a Wave 0 work item.
