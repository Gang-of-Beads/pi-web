# Extracting machines and workspaces into plugins

Scouted from the live tree (2026-09-05, refactor/plugin-architecture). This
document proposes the boundaries before any code moves; the extraction waves
follow it or amend it in the open.

## The one asymmetry that shapes everything

Machines are a gateway concept: the daemon (`sessiond`) has zero knowledge of
`machineId`. Workspaces are the opposite: the daemon is authoritative, and
`cwd` strings cross the daemon protocol on roughly twenty-five session
endpoints. So the two extractions are shaped differently:

- **Machines** is a gateway-side plugin over a core `machineId` dimension.
- **Workspaces** is a thin web-side plugin over the non-negotiable
  `WorkspaceCatalog` port and the cwd daemon protocol.

And the identity tuple `(machineId, projectId, workspaceId)` stays in core
under both extractions: it is the protocol identity the shell composes keys
from (`machineKeys.ts`, notification cwd matching, terminal run keys). A
plugin owns features over the tuple; the tuple itself is core.

## Machines: what moves, what stays

**Moved-set amended after the design review**: server machines code can
only run where a web-process plugin runtime exists — today server plugins
activate only in sessiond, which by the design's own asymmetry must stay
machine-free. The moved-set below is therefore contingent on the owner's
extraction-shape decision.

- Server (contingent): `machineClient`, `machineService`, `machineStore`,
  and the machine management routes (~1.9k lines with tests). Under the
  "services stay core" shape, these stay and the plugin owns the management
  UI and CRUD routes over an injected port.
- Client: `machineController`, `machineStatusController`,
  `machineNavigationMemory`, `MachineDialog`, `MachineList`,
  `MachineSwitcher`, and the machine management actions.

Stays core, because it is the daemon protocol boundary:

- `shared/federatedRoutes.ts` — the authoritative list of proxied routes.
- The `machineId` dimension itself: `machinePrefix` URL shapes, the dual
  registration of every route under `/api` and `/api/machines/local`, and the
  key composers in `machineKeys.ts`.
- Machine-scoped contribution gating in the plugin registry: the registry
  consumes an opaque selected-machine id; it does not learn what a machine is.
- Fleet update routes: they consume machines through a narrow port
  (`MachineRouteService`-shaped), which the plugin implements and core
  injects — dependency points from core to the plugin, not copies.

Plugin seams used: contributed actions and settings sections for the
management UI; the runtime context already carries the machine id; a core
injection port for fleet routes.

## Workspaces: what moves, what stays

**Moved-set amended after the design review** (see
`review-triage-machines-workspaces-design.md`): the server-side shape below
depends on an owner decision about the plugin contract; the protocol pieces
named here move only under that decision.

- Server (contingent): the file services (`fileTreeService`,
  `fileContentService`, `filePreviewService`, `fileSuggestions`,
  `pathAccessPolicy`, `effectivePathAccess`, `workspaceDeletionRoutes`) and
  their routes (~3.7k lines with tests). Protocol pieces stay:
  `filePreviewResponsePolicy`/`Headers`, `workspaceRouteErrors`,
  `workspaceContext`, and `projectPiWebConfig`'s reader are consumed by core
  tuple routes and the machines proxy — they are shared/core, not plugin.
- Client (contingent): `projectController`, `workspaceController`,
  `workspaceSelection`, `fileExplorerController`, `ProjectList`,
  `ProjectDialog`, `WorkspaceList`, workspace files panel/viewer, and the
  workspace sections of the navigation panel. `workspaceSessionsCache`
  stays core (session lists are core).

Stays core, because the daemon protocol requires it:

- `shared/workspaces/workspaceCatalog.ts` — the web↔daemon port.
- `src/server/daemon/workspaces/` — the authoritative daemon half.
- `sessionDaemonWorkspaceCatalog.ts` moves only with its protocol constants
  (`pluginBackendProtocol`, `workspaceRemovalProtocol`) or the provider
  runtime handshake breaks; those constants stay in shared.
- Every cwd-carrying session endpoint, `composerCwd` (the shell needs the
  cwd string, never the workspace entity), and the workspace-scoped
  plugin-backend operation routes.

Plugin seams used: contributed navigation sections for projects/workspaces
lists and the files panel; the `WorkspaceCatalog` port as the server-side
dependency, injected by core; named operations for CRUD; per-workspace
config stays in `<project>/.pi-web/config.json`.

## Client wave shape (Wave A, after the server half landed)

The server half landed in `b00a0707` (routes are plugin contributions; the
contract gained a request-body face). The client half rests on a re-read of
the moved-set against the code as it stands now:

- The pickers move: `ProjectList`, `WorkspaceList`, `ProjectDialog`, plus
  their presentation closure (`projectSearch`, `contextSearch`,
  `activityBadge`, `rowMenuGestures`, `selectableRow`, `workspaceDeletion`
  semantics, clipboard/notice helpers). They become the workspaces plugin's
  browser module, registered as custom elements the way the files plugin
  registers its panel.
- The controllers stay core. `workspaceController` is the selection engine —
  it drives `AppState`, URL routing, the workspace sessions cache, and the
  trailing-refresh coordinator — and `projectController` threads the same
  app state. They are the host's state machine, the client-side sibling of
  the `WorkspaceCatalog` port, not presentation. This amends the original
  moved-set above, which predated the navigation-model wave.
- The seam is `navSections`, modelled on `drawerSections`: the plugin
  contributes a section body per reserved slot (`projects`, `workspaces`);
  the shell keeps the slot order, the keyboard section machine, and the
  collapse state. The host feeds one `NavSectionContext` — the app snapshot
  (projects, workspaces, selection, load state, machine status), the
  label-item callback, and action callbacks (select/add/close project,
  select/delete workspace, retry load) — so the plugin never calls a PI WEB
  API and never spells a URL, matching the governance test.
- Both surfaces draw the same contributions: the desktop
  `AppNavigationPanel` renders the section bodies in their slots; the phone
  `ContextSwitcherSheet` renders the same bodies compactly. When the plugin
  is absent the slots render nothing — the section is honestly missing, per
  the no-preset-shell ruling.
- `addProject`'s dialog flow moves with the pickers: the plugin renders its
  own `ProjectDialog` and asks the host through a new `createProject`
  context action; the host-owned `addProject` context action retires when
  the core dialog goes.
- Trust and deletion stay core semantics: the plugin's workspace rows call
  host actions (`deleteWorkspace`, trust via the host), because the
  deletion routes and the trust reader stayed core server-side.

Deployment ordering is unchanged: the in-repo plugin module lands in the
same change as the core slots, so no intermediate state loses the pickers.

## Wave B shape (amended after Wave A landed)

Wave A changed three things this section has to absorb: the controllers are
the host's state machine, not presentation (the original moved-set above
predates that reading); the client seam is `navSections` with reserved slot
vocabulary; and `runs: "web"` is a deployment-bearing declaration, not
decoration. The machines wave therefore splits like this:

- **Server moved-set**: `machineService`, `machineStore`, `machineClient`,
  and the management route family (`machineRoutes.ts`) move into a
  `pi-web-plugins/machines/` server plugin. The plugin calls its own
  service directly — no port in front of what it owns.
- **Server stays core**: the proxy families (`machineProxyRoutes.ts`,
  `machinePluginProxyRoutes.ts`) and `fleetRoutes.ts` remain core-served,
  but they keep only a narrow `MachineRegistry` face (list, get,
  remoteClient, health, runtime, add, update, remove — the union of what
  the proxy targets, the fleet fan-out, and the removed management routes
  actually read). `buildApp` assembles that face from the activated
  machines plugin's runtime contribution; the dependency points from core
  to the plugin, not copies. When the plugin is absent the registry is
  honestly empty: the proxy 404s unknown machines and the fleet fan-out
  covers only the local machine, which is the same answer an empty store
  gives today.
- **Client moved-set**: `MachineList` and `MachineSwitcher` move as the
  plugin's `machines` navigation section (the switcher is the compact
  section's heading, so the section body renders it above the list when the
  display says compact). `MachineDialog` moves as the plugin's dialog behind
  an `add-machine`/`edit-machine` action, wired through the same
  `ui.showDialog` seam the add-project dialog uses.
- **Client stays core**: `machineController`, `machineStatusController`,
  `machineNavigationMemory`, `machineKeys.ts`, and the machine-scoped
  contribution gating. They drive app state, URL routing and status
  hydration — the selection engine, same ruling as the workspace
  controllers. The settings trio (`SettingsMachinesPanel` and helpers) is
  not in this wave's contract and stays core until a settings-section seam
  wave takes it.
- **Seam shape (as built, client)**: machines get their own contribution
  kind, `machineSections`, rather than a navSections slot — a machines row
  is not a workspace section: the host folds each machine's health tree into
  a plain `MachineStatus` on a `NavMachineSnapshot` (id, name, kind, baseUrl,
  status), the context carries the machine actions (select/add/remove/
  rename/refresh/open), and the registry qualifies and unregisters them with
  a machine-scoped getter. The reserved slot vocabulary grows `machines`;
  the shell keeps the section order, the keyboard machine and the collapse
  state.
- **Seam shape (server, this wave's contract work)**: `ServerPluginActivation`
  gains `machineRegistry?: MachineRegistryContribution` — list, get,
  localMachine, add, update, remove, health, runtime, remoteClient — and the
  contract re-exports the machine protocol types (`Machine`,
  `MachineHealth`, `MachineRuntime`, `PiWebRuntimeResponse`,
  `PiWebStatusResponse`, `PiWebComponentStatus`, `PiWebRuntimeComponent`,
  `PiWebDeprecatedAgentInput`, the `MachineClient` request face,
  `RemoteMachineRequestError`, the remote timeout constants, and
  `parsePiWebRuntimeResponse`) so the plugin imports the contract, never
  core internals. Two new host ports feed the plugin: `machinesStorePath()`
  (the host resolves the store file, keeping data-dir knowledge core-side)
  and `localRuntime()` (the local runtime read for local health). The
  route-body contract is extended to hand parsed JSON objects to route
  handlers — the machines management family is a route family with JSON
  bodies, exactly like core's own POST /api/projects, and the current "a
  JSON call is an operation" stance does not fit it.
- **Slice state**: the plugin package skeleton exists at
  `pi-web-plugins/machines/` (manifest with `runs: "web"`; the service,
  store and client moved and port-adapted — store path injected,
  `localRuntime` required). The contract edits and the core rewiring land
  once the parallel client-seam work on `server-plugin-api.ts`/`plugin-api.ts`
  settles; the intermediate state is deployable — the plugin contributes a
  registry nothing consumes yet, and the package exists before core removal
  per the ordering constraint.

## Owner rulings, 2026-09-05 (second round)

1. **Extraction shape: contract-first.** The plugin contract is extended
   before either extraction: server plugins also activate in the web
   process, with a route-contribution seam that can answer streaming
   responses, host-port injection, and a dialog seam on the browser side.
2. **No preset shell.** The project list, workspace list, machine switcher,
   and files panel are all plugin-extensible surfaces, not core preset UI.
   The core shell renders only what plugins contribute; when
   pi-web-workspaces or pi-web-machines is not installed, those surfaces
   honestly do not render (absence is stated, not silently filled by a
   core fallback).

## Owner rulings, 2026-09-05 (third round, phone screenshot on the 8506 deployment)

1. **The transcript is a plugin too.** Message history (the chat view)
   moves out of core into a plugin; the shell keeps the composer and renders
   what plugins contribute.
2. **Voice finishes as a plugin.** The voice plugin owns its whole surface;
   remaining core-side voice wiring moves into it.
3. **Activity and notifications leave the core shell** — the ACTIVITY and
   NOTIFICATIONS drawer tabs are removed, not converted; a plugin that wants
   such a surface builds its own page extension.

These extend the moved-set beyond machines/workspaces. The Wave 0 contract
(dialog and main-view seams, route contributions) is the prerequisite for
all three, so Wave 0 keeps priority; the new waves slot after Wave B and the
task tree is restructured when the goal is resumed.

## Sequencing (amended after review)

The original ordering collapsed under review: the Files main view is not a
section but a core-shell first citizen; the preview policy and error
mappings consumed by core tuple routes and the machines proxy had to be
re-homed first; and neither wave is independently deployable across
federated machines unless the file-route family stays core-served. The
revised order:

1. ~~Decide the extraction shape~~ — decided: contract-first.
2. **Wave 0, the contract wave**: web-process server-plugin runtime; route
   contributions with streaming responses; host-port injection into
   `ServerPluginActivationContext`; browser dialog and main-view/panel
   contribution seams; honest absence rendering for uninstalled surfaces.
3. **Re-home the protocol pieces** shared by core routes and the machines
   proxy (preview policy/headers, workspace route errors, workspace
   context) — the policy/headers reach plugin code through contract
   re-exports (Wave 0 design), and the rest stay shared/core as triaged.
4. **Then the waves**, each with the standing multi-lane bllm review plus a
   red team focused on: identity-tuple leakage, plugin-runtime breakage
   (asset serving, lifecycle handshake, runtimeProvider wiring), and
   path-access policy drift between plugin-served and core-served reads.
5. **Deployment ordering is a hard constraint**: the in-repo
   `pi-web-plugins/` intermediate state or the package must exist before
   core removal, so published builds and the docker runtime never lose the
   features mid-wave.

## Known non-goals

- Worktree semantics stay as they are; a worktree is a workspace to the
  protocol. (`worktreePreRemoveHook.ts` is worktree-specific daemon code
  and stays in the daemon.)
- The daemon keeps its workspace authority; this wave does not move
  workspace management into the daemon or split sessiond.
