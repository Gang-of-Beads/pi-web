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
