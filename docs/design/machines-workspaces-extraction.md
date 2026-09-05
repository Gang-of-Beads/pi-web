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

Moves to `pi-web-machines` (server + browser modules):

- Server: `machineClient`, `machineService`, `machineStore`, and the
  machine management routes (~1.5k lines with tests).
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

Moves to `pi-web-workspaces` (server + browser modules):

- Server: the file services (`fileTreeService`, `fileContentService`,
  `filePreviewService` + response policy/headers, `fileSuggestions`,
  `pathAccessPolicy`, `effectivePathAccess`, `workspaceContext`,
  `workspaceDeletionRoutes`, `projectPiWebConfig`) and their routes glue
  (~2.5k lines with tests).
- Client: `projectController`, `workspaceController`, `workspaceSelection`,
  `fileExplorerController`, `ProjectList`, `ProjectDialog`,
  `WorkspaceList`, workspace files panel/viewer, deletion and upload state,
  and the workspace sections of the navigation panel (via the contributed
  sections seam the goals wave built).

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

## Sequencing

1. **Workspaces first.** Its UI is already section-shaped (the goals wave
   built the navigation seam), its server half is route-shaped behind one
   port, and removing it from core visibly answers the owner's direction.
2. **Machines second.** Its mechanism (proxy transport, management UI) moves,
   but the id dimension it leaves behind means the review has to check every
   `machinePrefix` consumer.
3. Both waves get the standing multi-lane bllm review plus a red team focused
   on: identity-tuple leakage into plugins, plugin-runtime breakage (asset
   serving, lifecycle handshake), and path-access policy drift between
   plugin-served and core-served file reads.

## Known non-goals

- Worktree semantics stay as they are; a worktree is a workspace to the
  protocol, and no worktree-specific core code exists to extract.
- The daemon keeps its workspace authority; this wave does not move
  workspace management into the daemon or split sessiond.
